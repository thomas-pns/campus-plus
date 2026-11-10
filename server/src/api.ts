/**
 * API JSON du serveur Campus+ (consommée par l'appli web).
 * Toutes les routes sauf /api/sante et /api/connexion demandent le cookie de session.
 */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import statique from '@fastify/static';
import { resolve } from 'node:path';
import { AurionClient, ErreurIdentifiants, type Absence, type Note } from './sources/aurion.js';
import { salleExamenPour, type Evenement } from './sources/planning.js';
import { moyennesParCours, type Alerte } from './alertes.js';
import type { Compte, Comptes } from './comptes.js';
import type { Depot } from './depot.js';
import type { Synchro } from './synchro.js';
import { abonnementValide, TYPES_PAR_DEFAUT, type Notifications } from './notifications.js';

const COOKIE = 'cp_session';
const DUREE_COOKIE_S = 60 * 24 * 3600;
const FENETRE_MS = 15 * 60_000;
const ESSAIS_PAR_COMPTE = 5;
const ESSAIS_PAR_ADRESSE = 20;
const DELAI_SYNCHRO_MANUELLE_MS = 60_000;

export interface Services {
  depot: Depot;
  comptes: Comptes;
  synchro: Synchro;
  notifications?: Notifications;
  fabriqueAurion: () => AurionClient;
  cookieSecurise: boolean;
  /** Vrai derrière un proxy inversé (cas du NAS) : l'adresse du visiteur est lue dans X-Forwarded-For. */
  derriereProxy?: boolean;
  /** Dossier de l'appli web compilée ; absent : le serveur ne sert que l'API. */
  dossierClient?: string | null;
  journal?: boolean;
  maintenant?: () => number;
}

/** Compteur d'essais de connexion ratés, par clé, sur une fenêtre glissante. */
class Limiteur {
  private essais = new Map<string, number[]>();
  constructor(private maintenant: () => number) {}

  private recents(cle: string): number[] {
    const t = this.maintenant();
    const liste = (this.essais.get(cle) ?? []).filter((x) => t - x < FENETRE_MS);
    if (liste.length) this.essais.set(cle, liste);
    else this.essais.delete(cle);
    return liste;
  }
  bloque(cle: string, max: number) { return this.recents(cle).length >= max; }
  noter(cle: string) { this.essais.set(cle, [...this.recents(cle), this.maintenant()]); }
  oublier(cle: string) { this.essais.delete(cle); }
}

declare module 'fastify' {
  interface FastifyRequest { compte: Compte | null }
}

export async function creerApp(s: Services): Promise<FastifyInstance> {
  const maintenant = s.maintenant ?? Date.now;
  const app = Fastify({ logger: s.journal ?? false, trustProxy: s.derriereProxy ?? false, bodyLimit: 16 * 1024 });
  await app.register(cookie);
  const limiteur = new Limiteur(maintenant);
  app.decorateRequest('compte', null);

  const exigerSession = async (req: FastifyRequest, rep: FastifyReply) => {
    req.compte = await s.comptes.verifierSession(req.cookies[COOKIE]);
    if (!req.compte) return rep.code(401).send({ erreur: 'Connexion requise' });
  };
  const optionsCookie = { path: '/', httpOnly: true, sameSite: 'strict' as const, secure: s.cookieSecurise };

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, rep) => {
    const code = err.statusCode && err.statusCode >= 400 && err.statusCode < 500 ? err.statusCode : 500;
    if (code === 500) app.log.error(err);
    rep.code(code).send({ erreur: code === 500 ? 'Erreur du serveur' : 'Requête invalide' });
  });

  // En-têtes de sécurité : l'appli ne charge rien d'ailleurs que de ce serveur et ne s'affiche dans aucun cadre.
  app.addHook('onSend', async (_req, rep) => {
    rep.header('X-Content-Type-Options', 'nosniff');
    rep.header('Referrer-Policy', 'no-referrer');
    rep.header('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  });

  if (s.dossierClient) {
    await app.register(statique, {
      root: resolve(s.dossierClient),
      // Les fichiers de /assets/ portent une empreinte dans leur nom : cache long. Le reste est revérifié à chaque fois.
      setHeaders: (res, chemin) => {
        res.header('Cache-Control', /[\\/]assets[\\/]/.test(chemin) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
  }
  app.setNotFoundHandler((req, rep) => {
    if (s.dossierClient && req.method === 'GET' && !req.url.startsWith('/api/')) return rep.sendFile('index.html');
    return rep.code(404).send({ erreur: 'Introuvable' });
  });

  app.get('/api/sante', async () => ({ ok: true }));

  /* ---------- Connexion ---------- */

  app.post('/api/connexion', {
    schema: {
      body: {
        type: 'object', required: ['identifiant', 'motDePasse'], additionalProperties: false,
        properties: {
          identifiant: { type: 'string', minLength: 1, maxLength: 100 },
          motDePasse: { type: 'string', minLength: 1, maxLength: 200 },
        },
      },
    },
  }, async (req, rep) => {
    const { identifiant, motDePasse } = req.body as { identifiant: string; motDePasse: string };
    const id = s.comptes.idPour(identifiant);
    const cles = [`compte:${id}`, `adresse:${req.ip}`] as const;
    if (limiteur.bloque(cles[0], ESSAIS_PAR_COMPTE) || limiteur.bloque(cles[1], ESSAIS_PAR_ADRESSE)) {
      return rep.code(429).send({ erreur: 'Trop d’essais. Réessaie dans un quart d’heure.' });
    }
    const client = s.fabriqueAurion();
    try {
      await client.connexion(identifiant.trim(), motDePasse);
    } catch (e) {
      if (e instanceof ErreurIdentifiants) {
        cles.forEach((c) => limiteur.noter(c));
        return rep.code(401).send({ erreur: 'Identifiant ou mot de passe CPE incorrect' });
      }
      return rep.code(502).send({ erreur: 'MyCPE ne répond pas pour le moment' });
    }
    limiteur.oublier(cles[0]);
    await s.comptes.enregistrer(identifiant, motDePasse);
    const jeton = await s.comptes.ouvrirSession(id);
    // Première récupération avec la connexion déjà ouverte : l'élève a ses données tout de suite.
    const etat = await s.synchro.synchroniser(id, client);
    const compte = await s.comptes.lire(id);
    rep.setCookie(COOKIE, jeton, { ...optionsCookie, maxAge: DUREE_COOKIE_S });
    return { nom: compte?.nom ?? '', etat };
  });

  app.post('/api/deconnexion', async (req, rep) => {
    await s.comptes.fermerSession(req.cookies[COOKIE]);
    rep.clearCookie(COOKIE, optionsCookie);
    return { ok: true };
  });

  /* ---------- Données de l'élève ---------- */

  app.get('/api/moi', { onRequest: exigerSession }, async (req) => {
    const c = req.compte!;
    return { nom: c.nom, aReconnecter: c.aReconnecter, etat: await s.synchro.etat(c.id) };
  });

  app.get('/api/planning', {
    onRequest: exigerSession,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: { debut: { type: 'string', maxLength: 40 }, fin: { type: 'string', maxLength: 40 } },
      },
    },
  }, async (req, rep) => {
    const c = req.compte!;
    const q = req.query as { debut?: string; fin?: string };
    const debut = q.debut ? Date.parse(q.debut) : -Infinity;
    const fin = q.fin ? Date.parse(q.fin) : Infinity;
    if (Number.isNaN(debut) || Number.isNaN(fin)) return rep.code(400).send({ erreur: 'Dates invalides' });
    const tous = (await s.depot.lire<Evenement[]>(c.id, 'planning')) ?? [];
    const evenements = tous
      .filter((e) => Date.parse(e.fin) >= debut && Date.parse(e.debut) <= fin)
      .map((e) => (e.categorie === 'examen' ? { ...e, salleExamen: salleExamenPour(e, c.nom) } : e));
    return { evenements };
  });

  app.get('/api/notes', { onRequest: exigerSession }, async (req) => {
    const notes = (await s.depot.lire<Note[]>(req.compte!.id, 'notes')) ?? [];
    return { notes, moyennes: moyennesParCours(notes) };
  });

  app.get('/api/absences', { onRequest: exigerSession }, async (req) => ({
    absences: (await s.depot.lire<Absence[]>(req.compte!.id, 'absences')) ?? [],
  }));

  app.get('/api/alertes', { onRequest: exigerSession }, async (req) => ({
    alertes: (await s.depot.lire<Alerte[]>(req.compte!.id, 'alertes')) ?? [],
  }));

  /** « Tirer pour actualiser » : au plus une synchro manuelle par minute. */
  app.post('/api/synchro', { onRequest: exigerSession }, async (req, rep) => {
    const c = req.compte!;
    if (c.aReconnecter) return rep.code(409).send({ erreur: 'Reconnecte-toi avec ton compte CPE' });
    const etat = await s.synchro.etat(c.id);
    if (etat.derniereTentative && maintenant() - Date.parse(etat.derniereTentative) < DELAI_SYNCHRO_MANUELLE_MS) return { etat };
    return { etat: await s.synchro.synchroniser(c.id) };
  });

  /* ---------- Notifications ---------- */

  const n = s.notifications;
  if (n) {
    const typesSchema = { type: 'object', additionalProperties: false, properties: Object.fromEntries(Object.keys(TYPES_PAR_DEFAUT).map((t) => [t, { type: 'boolean' }])) };

    app.get('/api/notifications', { onRequest: exigerSession }, async (req) => {
      const r = await n.reglages(req.compte!.id);
      return { cle: n.clePublique, types: r.types, appareils: r.abonnements.length };
    });

    app.post('/api/notifications/abonnement', {
      onRequest: exigerSession,
      schema: { body: { type: 'object', required: ['abonnement'], additionalProperties: false, properties: { abonnement: { type: 'object' } } } },
    }, async (req, rep) => {
      const { abonnement } = req.body as { abonnement: unknown };
      if (!abonnementValide(abonnement)) return rep.code(400).send({ erreur: 'Abonnement invalide' });
      await n.abonner(req.compte!.id, abonnement);
      return { ok: true };
    });

    app.delete('/api/notifications/abonnement', {
      onRequest: exigerSession,
      schema: { body: { type: 'object', required: ['endpoint'], additionalProperties: false, properties: { endpoint: { type: 'string', maxLength: 1000 } } } },
    }, async (req) => {
      await n.desabonner(req.compte!.id, (req.body as { endpoint: string }).endpoint);
      return { ok: true };
    });

    app.put('/api/notifications/types', { onRequest: exigerSession, schema: { body: typesSchema } }, async (req) => ({
      types: await n.changerTypes(req.compte!.id, req.body as Record<string, boolean>),
    }));

    /** Notification d'essai, pour vérifier que tout marche sur l'appareil. */
    app.post('/api/notifications/essai', { onRequest: exigerSession }, async (req) => ({
      envoyes: await n.envoyer(req.compte!.id, [{ titre: 'Campus+', corps: 'Les notifications marchent : tu seras prévenu des changements de salle et des nouvelles notes.', tag: 'essai' }]),
    }));
  }

  /** Efface le compte et toutes ses données du serveur. */
  app.delete('/api/compte', { onRequest: exigerSession }, async (req, rep) => {
    await s.comptes.supprimer(req.compte!.id);
    rep.clearCookie(COOKIE, optionsCookie);
    return { ok: true };
  });

  return app;
}
