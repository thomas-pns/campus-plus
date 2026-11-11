import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { creerApp } from '../src/api.js';
import { Coffre } from '../src/coffre.js';
import { Comptes } from '../src/comptes.js';
import { Depot } from '../src/depot.js';
import { Synchro } from '../src/synchro.js';
import { AurionClient } from '../src/sources/aurion.js';
import { FauxAurion } from './faux-aurion.js';
import { CLE_TEST, donneesFausses } from './donnees.js';

describe('serveur Campus+ de bout en bout (faux WebAurion)', () => {
  let faux: FauxAurion;
  let dossier: string;
  let app: FastifyInstance;
  let synchro: Synchro;
  let comptes: Comptes;
  let horloge: number;

  beforeEach(async () => {
    faux = new FauxAurion(donneesFausses());
    const base = await faux.demarrer();
    dossier = await mkdtemp(join(tmpdir(), 'campus-api-'));
    horloge = Date.parse('2026-11-10T12:00:00+0100');
    const coffre = new Coffre(CLE_TEST);
    const depot = new Depot(dossier, coffre);
    comptes = new Comptes(depot, coffre, () => horloge);
    const fabriqueAurion = () => new AurionClient(base);
    synchro = new Synchro(depot, comptes, fabriqueAurion, { minutes: 15, maintenant: () => new Date(horloge) });
    app = await creerApp({ depot, comptes, synchro, fabriqueAurion, cookieSecurise: true, maintenant: () => horloge });
  });
  afterEach(async () => {
    await app.close();
    await faux.arreter();
    await rm(dossier, { recursive: true, force: true });
  });

  const connexion = (motDePasse = faux.donnees.motDePasse, identifiant = faux.donnees.identifiant) =>
    app.inject({ method: 'POST', url: '/api/connexion', payload: { identifiant, motDePasse } });
  const cookieDe = (rep: Awaited<ReturnType<typeof connexion>>) => {
    const c = rep.cookies.find((x) => x.name === 'cp_session')!;
    return { cp_session: c.value };
  };
  const ouvrir = async () => cookieDe(await connexion());
  const get = (url: string, cookies?: Record<string, string>) => app.inject({ method: 'GET', url, cookies });

  it('garde les préférences d’affichage de l’élève, pour tous ses appareils', async () => {
    const cookies = await ouvrir();
    const put = (payload: unknown) => app.inject({ method: 'PUT', url: '/api/preferences', cookies, payload: payload as object });
    expect((await get('/api/preferences', cookies)).json()).toEqual({ preferences: {} });
    await put({ photo: true, tuileGauche: 'fichiers' });
    await put({ photo: false });
    expect((await get('/api/preferences', cookies)).json().preferences).toEqual({ photo: false, tuileGauche: 'fichiers' });
    expect((await put({ x: { y: 1 } })).statusCode).toBe(400);
    expect((await get('/api/preferences')).statusCode).toBe(401);
  });

  it('génère le certificat de scolarité et envoie un justificatif d’absence, à la demande de l’élève', async () => {
    const cookies = await ouvrir();
    const certificat = await app.inject({ method: 'GET', url: '/api/certificat', cookies });
    expect(certificat.statusCode).toBe(200);
    expect(certificat.headers['content-type']).toBe('application/pdf');
    expect(certificat.body.startsWith('%PDF-1.4')).toBe(true);
    // Redemandé aussitôt (aperçu puis partage) : servi sans relancer MyCPE.
    expect((await app.inject({ method: 'GET', url: '/api/certificat', cookies })).statusCode).toBe(200);
    // Mais pas deux démarches de suite auprès de MyCPE.
    expect((await app.inject({ method: 'GET', url: '/api/certificat?langue=EN', cookies })).statusCode).toBe(429);

    expect((await get('/api/justificatif/motifs', cookies)).json().motifs).toEqual(['Absence pour autre motif', 'Absence pour maladie']);
    const envoyer = (corps: object) => app.inject({ method: 'POST', url: '/api/justificatif', cookies, payload: corps });
    const fichier = { nom: 'certificat-medical.pdf', donnees: Buffer.from('%PDF-1.4 arrêt').toString('base64') };
    expect((await envoyer({ debut: '2026-11-10T08:00', fin: '2026-11-10T18:00', motif: 'Absence pour maladie', fichier: { ...fichier, nom: 'virus.exe' } })).statusCode).toBe(400);
    expect((await envoyer({ debut: '2026-11-10T18:00', fin: '2026-11-10T08:00', motif: 'Absence pour maladie', fichier })).statusCode).toBe(400);
    horloge += 21_000;
    const rep = await envoyer({ debut: '2026-11-10T08:00', fin: '2026-11-10T18:00', motif: 'Absence pour maladie', fichier });
    expect(rep.json()).toEqual({ ok: true, message: 'Votre demande a bien été enregistrée.' });
    expect(faux.justificatifs).toEqual([{ debut: '10/11/2026 08:00', fin: '10/11/2026 18:00', motif: '190705', fichier: 'certificat-medical.pdf', taille: 15 }]);
  });

  it('garde la répartition des notes saisie par l’élève', async () => {
    const cookies = await ouvrir();
    const put = (cours: string, corps: unknown) => app.inject({ method: 'PUT', url: `/api/repartitions/${encodeURIComponent(cours)}`, cookies, headers: { 'content-type': 'application/json' }, payload: JSON.stringify(corps) });
    const r = { objectif: 10, parties: [{ nom: 'Écrit 1', poids: 20, note: null, epreuve: 'Ecrit 1' }, { nom: 'TP', poids: 40 }] };
    expect((await put('Électronique analogique', r)).json().repartitions).toEqual({ 'Électronique analogique': r });
    expect((await put('X', { objectif: 30, parties: [] })).statusCode).toBe(400);
    expect((await put('Électronique analogique', null)).json().repartitions).toEqual({});
  });

  it('répond à la sonde de santé sans session', async () => {
    expect((await get('/api/sante')).json()).toEqual({ ok: true });
  });

  it('protège toutes les routes de données', async () => {
    for (const url of ['/api/moi', '/api/planning', '/api/notes', '/api/absences', '/api/alertes']) {
      expect((await get(url)).statusCode, url).toBe(401);
      expect((await get(url, { cp_session: 'a'.repeat(24) + '.' + 'b'.repeat(43) })).statusCode, url).toBe(401);
    }
    expect((await app.inject({ method: 'POST', url: '/api/synchro' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'DELETE', url: '/api/compte' })).statusCode).toBe(401);
  });

  it('connecte l’élève, pose un cookie protégé et récupère ses données aussitôt', async () => {
    const rep = await connexion();
    expect(rep.statusCode).toBe(200);
    expect(rep.json()).toMatchObject({ nom: 'Camille BERNARD--COSTE', etat: { erreur: null } });
    const c = rep.cookies.find((x) => x.name === 'cp_session')!;
    expect(c).toMatchObject({ httpOnly: true, secure: true, sameSite: 'Strict', path: '/' });
    expect(faux.connexionsReussies).toBe(1); // la première synchro réutilise la connexion du login

    const cookies = cookieDe(rep);
    expect((await get('/api/moi', cookies)).json()).toMatchObject({ nom: 'Camille BERNARD--COSTE', aReconnecter: false });
    const { notes, moyennes } = (await get('/api/notes', cookies)).json();
    expect(notes).toHaveLength(2);
    expect(moyennes).toEqual([{ semestre: '26_27 - Semestre 5', module: 'Maths', cours: 'Algèbre linéaire', moyenne: 12.5, epreuvesNotees: 1 }]);
    expect((await get('/api/absences', cookies)).json()).toEqual({ absences: [] });
    expect((await get('/api/alertes', cookies)).json()).toEqual({ alertes: [] });
  });

  it('renvoie le planning, filtré par dates, avec la salle d’examen de l’élève', async () => {
    const cookies = await ouvrir();
    const tout = (await get('/api/planning', cookies)).json().evenements;
    expect(tout).toHaveLength(4);
    const examen = tout.find((e: { categorie: string }) => e.categorie === 'examen');
    expect(examen.salleExamen).toEqual(['F004', 'F005']);
    expect(tout[0].salleExamen).toBeUndefined();

    const semaine = (await get('/api/planning?debut=2026-11-09T00:00:00%2B01:00&fin=2026-11-15T23:59:00%2B01:00', cookies)).json().evenements;
    expect(semaine).toHaveLength(2);
    expect((await get('/api/planning?debut=pas-une-date', cookies)).statusCode).toBe(400);
    expect((await get('/api/planning?autre=1', cookies)).statusCode).toBe(200); // paramètre inconnu ignoré
  });

  it('refuse un mauvais mot de passe sans créer de compte, puis bloque après 5 essais', async () => {
    for (let i = 0; i < 5; i++) expect((await connexion('faux')).statusCode).toBe(401);
    expect(await comptes.lister()).toEqual([]);
    const bloque = await connexion(); // même le bon mot de passe attend
    expect(bloque.statusCode).toBe(429);
    expect(faux.tentatives).toBe(5); // le site de l'école n'est plus sollicité
    horloge += 16 * 60_000;
    expect((await connexion()).statusCode).toBe(200);
  });

  it('valide le corps de la connexion', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/connexion', payload: { identifiant: 'x' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/connexion', payload: { identifiant: 'x', motDePasse: 'y'.repeat(300) } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/connexion', payload: 'identifiant=x&motDePasse=y', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).statusCode).toBe(415);
    expect(faux.tentatives).toBe(0);
  });

  it('répond 502 si le site de l’école est en panne', async () => {
    faux.enPanne = true;
    expect((await connexion()).statusCode).toBe(502);
    expect(await comptes.lister()).toEqual([]);
  });

  it('ne stocke rien en clair', async () => {
    await ouvrir();
    const [id] = await readdir(join(dossier, 'eleves'));
    const fichiers = await readdir(join(dossier, 'eleves', id));
    expect(fichiers.sort()).toEqual(['absences.enc', 'compte.enc', 'etat.enc', 'notes.enc', 'photo.enc', 'planning.enc']);
    for (const f of fichiers) {
      const brut = await readFile(join(dossier, 'eleves', id, f), 'utf8');
      for (const mot of ['mot-de-passe', 'camille', 'BERNARD', 'Algèbre', 'F008', '12,5', '12.5']) expect(brut, `${f} contient ${mot}`).not.toContain(mot);
    }
  });

  it('actualise à la demande, au plus une fois par minute, et crée les alertes', async () => {
    const cookies = await ouvrir();
    faux.donnees.evenements[0].title = faux.donnees.evenements[0].title.replace('F008', 'F002');
    faux.donnees.notes[1][5] = '15';

    const tropTot = await app.inject({ method: 'POST', url: '/api/synchro', cookies });
    expect(tropTot.statusCode).toBe(200);
    expect(faux.connexionsReussies).toBe(1);
    expect((await get('/api/alertes', cookies)).json().alertes).toEqual([]);

    horloge += 61_000;
    const rep = await app.inject({ method: 'POST', url: '/api/synchro', cookies });
    expect(rep.json().etat).toMatchObject({ erreur: null, derniereSynchro: new Date(horloge).toISOString() });
    expect(faux.connexionsReussies).toBe(2);
    const alertes = (await get('/api/alertes', cookies)).json().alertes;
    expect(alertes.map((a: { type: string }) => a.type).sort()).toEqual(['examen', 'note', 'salle']);
    expect((await get('/api/planning', cookies)).json().evenements[0].salles).toEqual(['F002']);

    // Une nouvelle synchro sans changement ne recrée pas les alertes.
    horloge += 61_000;
    await app.inject({ method: 'POST', url: '/api/synchro', cookies });
    expect((await get('/api/alertes', cookies)).json().alertes).toHaveLength(3);
  });

  it('garde les anciennes données si une synchro échoue', async () => {
    const cookies = await ouvrir();
    faux.enPanne = true;
    horloge += 61_000;
    const rep = await app.inject({ method: 'POST', url: '/api/synchro', cookies });
    expect(rep.json().etat).toMatchObject({ echecs: 1, derniereSynchro: '2026-11-10T11:00:00.000Z' });
    expect(rep.json().etat.erreur).toBeTruthy();
    expect((await get('/api/planning', cookies)).json().evenements).toHaveLength(4);
  });

  it('arrête les synchros si le mot de passe CPE a changé, jusqu’à la reconnexion', async () => {
    const cookies = await ouvrir();
    faux.donnees.motDePasse = 'nouveau-mot-de-passe';
    horloge += 16 * 60_000;
    await synchro.tour();
    expect((await get('/api/moi', cookies)).json()).toMatchObject({ aReconnecter: true });
    const tentatives = faux.tentatives;

    horloge += 5 * 3600_000;
    await synchro.tour(); // ne retente pas : pas de risque de bloquer le compte CPE
    expect(faux.tentatives).toBe(tentatives);
    expect((await app.inject({ method: 'POST', url: '/api/synchro', cookies })).statusCode).toBe(409);

    expect((await connexion('nouveau-mot-de-passe')).statusCode).toBe(200);
    expect((await get('/api/moi', cookies)).json()).toMatchObject({ aReconnecter: false });
  });

  it('synchronise automatiquement à l’intervalle prévu, et espace les essais après un échec', async () => {
    await ouvrir();
    await synchro.tour();
    expect(faux.connexionsReussies).toBe(1); // trop tôt
    horloge += 15 * 60_000;
    await synchro.tour();
    expect(faux.connexionsReussies).toBe(2);

    faux.enPanne = true;
    horloge += 15 * 60_000;
    await synchro.tour(); // échec n°1
    faux.enPanne = false;
    horloge += 15 * 60_000;
    await synchro.tour(); // attente doublée : pas encore
    expect(faux.connexionsReussies).toBe(2);
    horloge += 15 * 60_000;
    await synchro.tour();
    expect(faux.connexionsReussies).toBe(3);
  });

  it('déconnecte et supprime le compte', async () => {
    const cookies = await ouvrir();
    const autre = await ouvrir();
    const rep = await app.inject({ method: 'POST', url: '/api/deconnexion', cookies });
    expect(rep.statusCode).toBe(200);
    expect((await get('/api/moi', cookies)).statusCode).toBe(401);
    expect((await get('/api/moi', autre)).statusCode).toBe(200);

    expect((await app.inject({ method: 'DELETE', url: '/api/compte', cookies: autre })).statusCode).toBe(200);
    expect((await get('/api/moi', autre)).statusCode).toBe(401);
    expect(await readdir(join(dossier, 'eleves'))).toEqual([]);
  });

  it('sépare les données de deux élèves', async () => {
    const a = await ouvrir();
    faux.donnees = { ...donneesFausses(), identifiant: 'nina.petit', motDePasse: 'autre-mot-de-passe', nom: 'Nina PETIT', notes: [] };
    const b = cookieDe(await connexion('autre-mot-de-passe', 'nina.petit'));
    expect((await get('/api/moi', b)).json().nom).toBe('Nina PETIT');
    expect((await get('/api/notes', b)).json().notes).toEqual([]);
    expect((await get('/api/notes', a)).json().notes).toHaveLength(2);
    const examen = (await get('/api/planning', b)).json().evenements.find((e: { categorie: string }) => e.categorie === 'examen');
    expect(examen.salleExamen).toEqual(['F008']);
  });
});

describe('fichiers de l’appli et clé de chiffrement', () => {
  it('sert l’appli compilée, avec les bons caches, et garde /api en JSON', async () => {
    const { mkdir, writeFile } = await import('node:fs/promises');
    const dossier = await mkdtemp(join(tmpdir(), 'campus-client-'));
    await mkdir(join(dossier, 'assets'));
    await writeFile(join(dossier, 'index.html'), '<!doctype html><title>Campus+</title>');
    await writeFile(join(dossier, 'assets', 'app-abc123.js'), 'console.log(1)');
    const coffre = new Coffre(CLE_TEST);
    const depot = new Depot(dossier + '-donnees', coffre);
    const comptes = new Comptes(depot, coffre);
    const fabriqueAurion = () => new AurionClient('http://127.0.0.1:9');
    const app = await creerApp({ depot, comptes, synchro: new Synchro(depot, comptes, fabriqueAurion, { minutes: 15 }), fabriqueAurion, cookieSecurise: true, dossierClient: dossier });
    try {
      const accueil = await app.inject({ method: 'GET', url: '/' });
      expect(accueil.statusCode).toBe(200);
      expect(accueil.body).toContain('Campus+');
      expect(accueil.headers['cache-control']).toBe('no-cache');
      expect(accueil.headers['content-security-policy']).toContain("default-src 'self'");
      expect(accueil.headers['x-content-type-options']).toBe('nosniff');
      const js = await app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
      expect(js.headers['cache-control']).toContain('immutable');
      expect((await app.inject({ method: 'GET', url: '/une/page/quelconque' })).body).toContain('Campus+');
      const api = await app.inject({ method: 'GET', url: '/api/inconnu' });
      expect(api.statusCode).toBe(404);
      expect(api.json()).toEqual({ erreur: 'Introuvable' });
      expect((await app.inject({ method: 'GET', url: '/../../etc/passwd' })).body).not.toContain('root:');
    } finally {
      await app.close();
      await rm(dossier, { recursive: true, force: true });
    }
  });

  it('crée la clé au premier démarrage, la relit ensuite, et préfère celle de l’environnement', async () => {
    const { chargerCle } = await import('../src/config.js');
    const dossier = await mkdtemp(join(tmpdir(), 'campus-cle-'));
    try {
      const a = await chargerCle({}, dossier);
      expect(a).toHaveLength(32);
      expect((await chargerCle({}, dossier)).equals(a)).toBe(true);
      expect((await chargerCle({ CAMPUS_SECRET_KEY: CLE_TEST.toString('base64') }, dossier)).equals(CLE_TEST)).toBe(true);
      await expect(chargerCle({ CAMPUS_SECRET_KEY: 'trop-court' }, dossier)).rejects.toThrow(/CAMPUS_SECRET_KEY/);
    } finally {
      await rm(dossier, { recursive: true, force: true });
    }
  });
});

