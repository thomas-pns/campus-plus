/**
 * API JSON du serveur Campus+ (consommée par l'appli web).
 * Toutes les routes sauf /api/sante et /api/connexion demandent le cookie de session.
 */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import statique from '@fastify/static';
import { resolve } from 'node:path';
import { Readable } from 'node:stream';
import { AurionClient, ErreurAurion, ErreurIdentifiants, type Absence, type Note } from './sources/aurion.js';
import { salleExamenPour, type Evenement } from './sources/planning.js';
import { moyennesParCours, type Alerte } from './alertes.js';
import type { Compte, Comptes } from './comptes.js';
import type { Depot } from './depot.js';
import type { Synchro } from './synchro.js';
import type { SynchroCours } from './cours.js';
import type { Taches } from './taches.js';
import type { SynchroMails } from './mails.js';
import { ErreurOneDrive, type SynchroOneDrive } from './onedrive.js';
import { abonnementValide, RAPPELS_POSSIBLES, TYPES_PAR_DEFAUT, type Notifications } from './notifications.js';

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
  cours?: SynchroCours;
  taches?: Taches;
  mails?: SynchroMails;
  /** Absent si ONEDRIVE_CLIENT_ID n'est pas réglé : l'option est alors cachée. */
  onedrive?: SynchroOneDrive;
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
    if (!rep.getHeader('Content-Security-Policy')) {
      rep.header('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    }
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
    // Les cours e-campus (fichiers compris) peuvent être longs à récupérer : en arrière-plan.
    if (s.cours) {
      const cours = s.cours;
      void cours.debloquer(id).then(() => cours.synchroniser(id)).catch(() => undefined);
    }
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
    if (s.cours) void s.cours.synchroniser(c.id).catch(() => undefined);
    if (s.mails) void s.mails.synchroniser(c.id).catch(() => undefined);
    return { etat: await s.synchro.synchroniser(c.id) };
  });

  /* ---------- Cours e-campus ---------- */

  const cours = s.cours;
  if (cours) {
    app.get('/api/cours', { onRequest: exigerSession }, async (req) => {
      const id = req.compte!.id;
      // L'adresse Moodle des fichiers reste sur le serveur : l'appli passe par /api/fichiers.
      const liste = (await cours.cours(id)).map((c) => ({
        ...c,
        sections: c.sections.map((sec) => ({
          ...sec,
          elements: sec.elements.map((e) => ({ ...e, fichiers: e.fichiers.map(({ adresse: _, ...f }) => f) })),
        })),
      }));
      return { cours: liste, etat: { ...(await cours.etat(id)), progression: cours.progression(id) } };
    });

    app.get('/api/fichiers/:cle', { onRequest: exigerSession }, async (req, rep) => {
      const { cle } = req.params as { cle: string };
      const trouve = await cours.fichier(req.compte!.id, cle);
      if (!trouve) return rep.code(404).send({ erreur: 'Fichier introuvable ou e-campus injoignable' });
      const nom = trouve.fichier.nom.replace(/[\r\n"]/g, '');
      rep.header('Content-Type', /^[\w.+-]+\/[\w.+-]+$/.test(trouve.fichier.type) ? trouve.fichier.type : 'application/octet-stream');
      const telecharger = (req.query as { telecharger?: string }).telecharger === '1';
      rep.header('Content-Disposition', `${telecharger ? 'attachment' : 'inline'}; filename="${nom.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(nom)}`);
      rep.header('Cache-Control', 'private, max-age=86400');
      // Un fichier de cours ne doit jamais exécuter de script dans l'appli.
      rep.header('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox");
      if ('octets' in trouve) return rep.send(trouve.octets);
      // Transmis directement depuis e-campus, sans passer par le disque.
      const taille = trouve.flux.headers.get('content-length');
      if (taille) rep.header('Content-Length', taille);
      rep.header('Cache-Control', 'private, no-store');
      return rep.send(Readable.fromWeb(trouve.flux.body as never));
    });
  }

  /* ---------- À faire : devoirs e-campus et tâches perso ---------- */

  const taches = s.taches;
  if (taches) {
    const JOUR = { type: ['string', 'null'], pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
    app.get('/api/afaire', { onRequest: exigerSession }, async (req) => {
      const id = req.compte!.id;
      const [perso, echeances] = await Promise.all([taches.lire(id), s.cours ? s.cours.echeances(id) : []]);
      const faites = new Set(perso.echeancesFaites);
      return { taches: perso.taches, echeances: echeances.map((e) => ({ ...e, fait: faites.has(e.id) })) };
    });

    app.post('/api/taches', {
      onRequest: exigerSession,
      schema: { body: { type: 'object', required: ['titre'], additionalProperties: false, properties: {
        titre: { type: 'string', minLength: 1, maxLength: 200 }, echeance: JOUR, cours: { type: ['integer', 'null'] },
        matiere: { type: ['string', 'null'], maxLength: 120 },
      } } },
    }, async (req) => ({ tache: await taches.ajouter(req.compte!.id, req.body as { titre: string; echeance?: string | null; cours?: number | null; matiere?: string | null }) }));

    app.patch('/api/taches/:tache', {
      onRequest: exigerSession,
      schema: {
        params: { type: 'object', properties: { tache: { type: 'string', pattern: '^[0-9a-f]{16}$' } } },
        body: { type: 'object', additionalProperties: false, properties: {
          titre: { type: 'string', minLength: 1, maxLength: 200 }, echeance: JOUR, fait: { type: 'boolean' },
        } },
      },
    }, async (req, rep) => {
      const tache = await taches.changer(req.compte!.id, (req.params as { tache: string }).tache, req.body as object);
      return tache ? { tache } : rep.code(404).send({ erreur: 'Tâche introuvable' });
    });

    app.delete('/api/taches/:tache', {
      onRequest: exigerSession,
      schema: { params: { type: 'object', properties: { tache: { type: 'string', pattern: '^[0-9a-f]{16}$' } } } },
    }, async (req, rep) => ((await taches.supprimer(req.compte!.id, (req.params as { tache: string }).tache)) ? { ok: true } : rep.code(404).send({ erreur: 'Tâche introuvable' })));

    app.put('/api/echeances/:echeance/fait', {
      onRequest: exigerSession,
      schema: {
        params: { type: 'object', properties: { echeance: { type: 'integer', minimum: 1 } } },
        body: { type: 'object', required: ['fait'], additionalProperties: false, properties: { fait: { type: 'boolean' } } },
      },
    }, async (req) => ({
      echeancesFaites: await taches.marquerEcheance(req.compte!.id, (req.params as { echeance: number }).echeance, (req.body as { fait: boolean }).fait),
    }));
  }

  /* ---------- Mails PARTAGE ---------- */

  const mails = s.mails;
  if (mails) {
    app.get('/api/mails', { onRequest: exigerSession }, async (req) => {
      const id = req.compte!.id;
      const etat = await mails.etat(id);
      return { etat, mails: etat.actif ? await mails.mails(id) : [] };
    });

    app.put('/api/mails/expediteur', {
      onRequest: exigerSession,
      schema: { body: { type: 'object', required: ['adresse', 'categorie'], additionalProperties: false, properties: {
        adresse: { type: 'string', minLength: 3, maxLength: 400 },
        categorie: { type: ['string', 'null'], enum: ['prof', 'ecole', 'autre', null] },
      } } },
    }, async (req) => {
      const { adresse, categorie } = req.body as { adresse: string; categorie: 'prof' | 'ecole' | 'autre' | null };
      const id = req.compte!.id;
      return { etat: await mails.etat(id), mails: await mails.corriger(id, adresse, categorie) };
    });

    app.put('/api/mails/actif', {
      onRequest: exigerSession,
      schema: { body: { type: 'object', required: ['actif'], additionalProperties: false, properties: { actif: { type: 'boolean' } } } },
    }, async (req) => {
      const id = req.compte!.id;
      const { actif } = req.body as { actif: boolean };
      await mails.activer(id, actif);
      // Première lecture tout de suite, pour un retour immédiat (mauvais mot de passe, etc.).
      const etat = actif ? await mails.synchroniser(id) : await mails.etat(id);
      return { etat, mails: etat.actif ? await mails.mails(id) : [] };
    });
  }

  /* ---------- Documents MyCPE : certificat de scolarité, justificatif d'absence ---------- */

  // Une démarche à la fois par élève, et pas plus d'une toutes les 20 secondes : MyCPE est lent.
  const demarches = new Map<string, number>();
  const certificats = new Map<string, { pdf: Buffer; t: number }>();
  const avecMyCpe = async <T>(id: string, action: (client: AurionClient) => Promise<T>): Promise<T> => {
    const derniere = demarches.get(id) ?? 0;
    if (maintenant() - derniere < 20_000) throw Object.assign(new Error('Patiente quelques secondes avant de recommencer'), { statusCode: 429 });
    demarches.set(id, maintenant());
    const compte = await s.comptes.lire(id);
    if (!compte) throw Object.assign(new Error('Compte introuvable'), { statusCode: 401 });
    const client = s.fabriqueAurion();
    await client.connexion(compte.identifiant, compte.motDePasse);
    return action(client);
  };
  const erreurMyCpe = (e: unknown, rep: FastifyReply) => {
    const code = (e as { statusCode?: number }).statusCode;
    if (code) return rep.code(code).send({ erreur: (e as Error).message });
    if (e instanceof ErreurAurion) return rep.code(502).send({ erreur: e.message });
    throw e;
  };

  app.get('/api/certificat', { onRequest: exigerSession }, async (req, rep) => {
    const langue = (req.query as { langue?: string }).langue === 'EN' ? 'EN' : 'FR';
    const id = req.compte!.id;
    try {
      // Gardé 10 minutes : l'aperçu puis le partage le redemandent sans relancer MyCPE.
      const garde = certificats.get(`${id}|${langue}`);
      const pdf = garde && maintenant() - garde.t < 600_000 ? garde.pdf : await avecMyCpe(id, (c) => c.certificat(langue));
      certificats.set(`${id}|${langue}`, { pdf, t: garde && garde.pdf === pdf ? garde.t : maintenant() });
      rep.header('Content-Type', 'application/pdf');
      rep.header('Content-Disposition', `inline; filename="certificat-scolarite-${langue.toLowerCase()}.pdf"`);
      rep.header('Cache-Control', 'private, no-store');
      return rep.send(pdf);
    } catch (e) {
      return erreurMyCpe(e, rep);
    }
  });

  app.get('/api/justificatif/motifs', { onRequest: exigerSession }, async (req, rep) => {
    try {
      const compte = await s.comptes.lire(req.compte!.id);
      if (!compte) return rep.code(401).send({ erreur: 'Compte introuvable' });
      const client = s.fabriqueAurion();
      await client.connexion(compte.identifiant, compte.motDePasse);
      return { motifs: await client.motifsAbsence() };
    } catch (e) {
      return erreurMyCpe(e, rep);
    }
  });

  const DATE_HEURE = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}$' };
  app.post('/api/justificatif', {
    onRequest: exigerSession,
    bodyLimit: 8 * 1024 * 1024,
    schema: { body: { type: 'object', required: ['debut', 'fin', 'motif', 'fichier'], additionalProperties: false, properties: {
      debut: DATE_HEURE, fin: DATE_HEURE, motif: { type: 'string', minLength: 3, maxLength: 120 },
      fichier: { type: 'object', required: ['nom', 'donnees'], additionalProperties: false, properties: {
        nom: { type: 'string', minLength: 1, maxLength: 200 }, donnees: { type: 'string', maxLength: 7_000_000 },
      } },
    } } },
  }, async (req, rep) => {
    const b = req.body as { debut: string; fin: string; motif: string; fichier: { nom: string; donnees: string } };
    const extension = b.fichier.nom.toLowerCase().match(/\.(pdf|docx|png|jpe?g)$/)?.[1];
    if (!extension) return rep.code(400).send({ erreur: 'Fichier accepté par MyCPE : PDF, DOCX, PNG ou JPG' });
    const octets = Buffer.from(b.fichier.donnees, 'base64');
    if (!octets.length || octets.length > 5_000_000) return rep.code(400).send({ erreur: 'Fichier vide ou trop gros (5 Mo au plus)' });
    if (b.fin < b.debut) return rep.code(400).send({ erreur: 'La fin de l’absence est avant son début' });
    const types: Record<string, string> = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' };
    // MyCPE attend « jj/mm/aaaa hh:mm ».
    const fr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)} ${d.slice(11, 16)}`;
    try {
      const message = await avecMyCpe(req.compte!.id, (c) => c.justifierAbsence({
        debut: fr(b.debut), fin: fr(b.fin), motif: b.motif, fichier: { nom: b.fichier.nom, type: types[extension], octets },
      }));
      return { ok: true, message };
    } catch (e) {
      return erreurMyCpe(e, rep);
    }
  });

  /* ---------- Répartition des notes par cours (saisie par l'élève, pour simuler sa moyenne) ---------- */

  app.get('/api/repartitions', { onRequest: exigerSession }, async (req) => ({
    repartitions: (await s.depot.lire<Record<string, unknown>>(req.compte!.id, 'repartitions')) ?? {},
  }));
  app.put('/api/repartitions/:cours', {
    onRequest: exigerSession,
    schema: {
      params: { type: 'object', properties: { cours: { type: 'string', minLength: 1, maxLength: 200 } } },
      body: { anyOf: [{ type: 'null' }, { type: 'object', required: ['parties', 'objectif'], additionalProperties: false, properties: {
        objectif: { type: 'number', minimum: 0, maximum: 20 },
        parties: { type: 'array', maxItems: 20, items: { type: 'object', required: ['nom', 'poids'], additionalProperties: false, properties: {
          nom: { type: 'string', minLength: 1, maxLength: 80 }, poids: { type: 'number', minimum: 0, maximum: 100 },
          note: { type: ['number', 'null'], minimum: 0, maximum: 20 }, epreuve: { type: ['string', 'null'], maxLength: 120 },
        } } },
      } }] },
    },
  }, async (req) => {
    const id = req.compte!.id;
    const { cours } = req.params as { cours: string };
    const toutes = (await s.depot.lire<Record<string, unknown>>(id, 'repartitions')) ?? {};
    if (req.body === null) delete toutes[cours];
    else toutes[cours] = req.body;
    if (Object.keys(toutes).length > 60) return { repartitions: toutes };
    await s.depot.ecrire(id, 'repartitions', toutes);
    return { repartitions: toutes };
  });

  /* ---------- Préférences d'affichage (les mêmes sur tous les appareils de l'élève) ---------- */

  app.get('/api/preferences', { onRequest: exigerSession }, async (req) => ({
    preferences: (await s.depot.lire<Record<string, unknown>>(req.compte!.id, 'preferences')) ?? {},
  }));
  app.put('/api/preferences', {
    onRequest: exigerSession,
    // Rien que des petits réglages : booléens ou mots courts, en nombre limité.
    schema: { body: { type: 'object', maxProperties: 30, additionalProperties: { anyOf: [{ type: 'boolean' }, { type: 'string', maxLength: 30 }] } } },
  }, async (req) => {
    const id = req.compte!.id;
    const fusion = { ...((await s.depot.lire<Record<string, unknown>>(id, 'preferences')) ?? {}), ...(req.body as Record<string, unknown>) };
    await s.depot.ecrire(id, 'preferences', fusion);
    return { preferences: fusion };
  });

  /* ---------- Photo d'identité (MyCPE) ---------- */

  app.get('/api/photo', { onRequest: exigerSession }, async (req, rep) => {
    const p = await s.depot.lire<{ type: string | null; donnees: string | null }>(req.compte!.id, 'photo');
    if (!p?.type || !p.donnees) return rep.code(404).send({ erreur: 'Pas de photo' });
    rep.header('Content-Type', p.type);
    rep.header('Cache-Control', 'private, max-age=86400');
    return rep.send(Buffer.from(p.donnees, 'base64'));
  });

  /* ---------- OneDrive ---------- */

  const onedrive = s.onedrive;
  app.get('/api/onedrive', { onRequest: exigerSession }, async (req) => (
    onedrive ? { disponible: true, etat: await onedrive.etat(req.compte!.id) } : { disponible: false, etat: null }
  ));
  if (onedrive) {
    app.post('/api/onedrive/connexion', { onRequest: exigerSession }, async (req, rep) => {
      try {
        return { connexion: await onedrive.demarrerConnexion(req.compte!.id) };
      } catch (e) {
        if (e instanceof ErreurOneDrive) return rep.code(502).send({ erreur: e.message });
        throw e;
      }
    });
    app.delete('/api/onedrive/connexion', { onRequest: exigerSession }, async (req) => {
      onedrive.annulerConnexion(req.compte!.id);
      return { etat: await onedrive.etat(req.compte!.id) };
    });
    app.post('/api/onedrive/copie', { onRequest: exigerSession }, async (req) => {
      const id = req.compte!.id;
      void onedrive.synchroniser(id).catch(() => undefined);
      return { etat: await onedrive.etat(id) };
    });
    app.delete('/api/onedrive', { onRequest: exigerSession }, async (req) => {
      await onedrive.deconnecter(req.compte!.id);
      return { etat: await onedrive.etat(req.compte!.id) };
    });
  }

  /* ---------- Notifications ---------- */

  const n = s.notifications;
  if (n) {
    const typesSchema = { type: 'object', additionalProperties: false, properties: Object.fromEntries(Object.keys(TYPES_PAR_DEFAUT).map((t) => [t, { type: 'boolean' }])) };

    app.get('/api/notifications', { onRequest: exigerSession }, async (req) => {
      const r = await n.reglages(req.compte!.id);
      return { cle: n.clePublique, types: r.types, appareils: r.abonnements.length, rappel: r.rappel };
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

    app.put('/api/notifications/rappel', {
      onRequest: exigerSession,
      schema: { body: { type: 'object', required: ['minutes'], additionalProperties: false, properties: { minutes: { type: 'integer', enum: RAPPELS_POSSIBLES } } } },
    }, async (req) => ({ rappel: await n.changerRappel(req.compte!.id, (req.body as { minutes: number }).minutes) }));

    /** Notification d'essai, pour vérifier que tout marche sur l'appareil. */
    app.post('/api/notifications/essai', { onRequest: exigerSession }, async (req) => ({
      envoyes: await n.envoyer(req.compte!.id, [{ titre: 'Campus+', corps: 'Les notifications marchent : tu seras prévenu des changements de salle et des nouvelles notes.', tag: 'essai' }]),
    }));
  }

  /** Efface le compte et toutes ses données du serveur. */
  app.delete('/api/compte', { onRequest: exigerSession }, async (req, rep) => {
    s.onedrive?.annulerConnexion(req.compte!.id);
    await s.comptes.supprimer(req.compte!.id);
    rep.clearCookie(COOKIE, optionsCookie);
    return { ok: true };
  });

  return app;
}
