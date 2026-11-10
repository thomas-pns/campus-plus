import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MoodleClient } from '../src/sources/moodle.js';
import { SynchroCours } from '../src/cours.js';
import { Taches } from '../src/taches.js';
import { Coffre } from '../src/coffre.js';
import { Comptes } from '../src/comptes.js';
import { Depot } from '../src/depot.js';
import { Synchro } from '../src/synchro.js';
import { AurionClient } from '../src/sources/aurion.js';
import { creerApp } from '../src/api.js';
import { comparerEcheances, type Alerte } from '../src/alertes.js';
import { coursFaux, FauxMoodle } from './faux-moodle.js';
import { FauxAurion } from './faux-aurion.js';
import { CLE_TEST, donneesFausses } from './donnees.js';

const MAINTENANT = Date.parse('2026-11-11T09:00:00+01:00');
const S = (iso: string) => Date.parse(iso) / 1000;

describe('alertes de devoirs', () => {
  const e = (id: number, date: string) => ({ id, nom: `Devoir ${id}`, nomCours: 'Algèbre linéaire (S5)', cours: 4280, date: S(date) });
  it('signale un nouveau devoir et une date limite modifiée, pas un devoir passé', () => {
    const avant = [e(1, '2026-11-20T23:59:00+01:00')];
    const apres = [e(1, '2026-11-22T23:59:00+01:00'), e(2, '2026-11-25T12:00:00+01:00'), e(3, '2026-11-01T12:00:00+01:00')];
    const a = comparerEcheances(avant, apres, new Date(MAINTENANT));
    expect(a.map((x) => x.titre)).toEqual(['Date limite modifiée : Devoir 1', 'Nouveau devoir : Devoir 2']);
    expect(a[1].detail).toBe('Algèbre linéaire (S5) · à rendre mercredi 25 novembre à 12:00');
    expect(comparerEcheances(apres, apres, new Date(MAINTENANT))).toEqual([]);
  });
});

describe('devoirs e-campus et tâches perso de bout en bout', () => {
  let aurion: FauxAurion;
  let moodle: FauxMoodle;
  let dossier: string;
  let app: FastifyInstance;
  let cours: SynchroCours;
  let cookies: Record<string, string>;
  let id: string;
  let notifiees: Alerte[];

  beforeEach(async () => {
    aurion = new FauxAurion(donneesFausses());
    const baseAurion = await aurion.demarrer();
    moodle = new FauxMoodle();
    moodle.cours = coursFaux();
    moodle.identifiant = aurion.donnees.identifiant;
    moodle.motDePasse = aurion.donnees.motDePasse;
    moodle.echeances = [
      { id: 501, nom: 'Compte rendu TP1', module: 'assign', cours: 4268, date: S('2026-11-14T23:59:00+01:00') },
      { id: 502, nom: 'QCM chapitre 3', module: 'quiz', cours: 4280, date: S('2026-11-12T08:00:00+01:00') },
      { id: 503, nom: 'Exercices semaine 44', module: 'assign', cours: 4280, date: S('2026-11-05T23:59:00+01:00'), enRetard: true },
    ];
    const adresses = await moodle.demarrer();
    dossier = await mkdtemp(join(tmpdir(), 'campus-devoirs-'));
    const coffre = new Coffre(CLE_TEST);
    const depot = new Depot(dossier, coffre);
    const comptes = new Comptes(depot, coffre);
    notifiees = [];
    cours = new SynchroCours(depot, comptes, coffre, dossier, () => new MoodleClient(adresses), {
      maintenant: () => new Date(MAINTENANT), surNouvellesAlertes: async (_, a) => { notifiees.push(...a); },
    });
    const fabriqueAurion = () => new AurionClient(baseAurion);
    const synchro = new Synchro(depot, comptes, fabriqueAurion, { minutes: 15, cours });
    app = await creerApp({ depot, comptes, synchro, cours, taches: new Taches(depot), fabriqueAurion, cookieSecurise: true });
    const rep = await app.inject({ method: 'POST', url: '/api/connexion', payload: { identifiant: aurion.donnees.identifiant, motDePasse: aurion.donnees.motDePasse } });
    cookies = { cp_session: rep.cookies.find((c) => c.name === 'cp_session')!.value };
    id = comptes.idPour(aurion.donnees.identifiant);
    await cours.synchroniser(id);
  });
  afterEach(async () => {
    await app.close();
    await aurion.arreter();
    await moodle.arreter();
    await rm(dossier, { recursive: true, force: true });
  });

  const req = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT', url: string, payload?: object) => app.inject({ method, url, payload, cookies });

  it('liste les échéances e-campus, en retard compris', async () => {
    const { echeances, taches } = (await req('GET', '/api/afaire')).json();
    expect(taches).toEqual([]);
    expect(echeances.map((e: { nom: string }) => e.nom)).toEqual(['Exercices semaine 44', 'QCM chapitre 3', 'Compte rendu TP1']);
    expect(echeances[0]).toMatchObject({ enRetard: true, nomCours: 'Algèbre linéaire (S5)', fait: false, module: 'assign' });
    expect(echeances[1]).toMatchObject({ action: 'Tenter le test', module: 'quiz' });
    expect(echeances[2].lien).toContain('/mod/assign/view.php?id=501');
    expect((await app.inject({ method: 'GET', url: '/api/afaire' })).statusCode).toBe(401);
  });

  it('pagine au-delà de 50 échéances', async () => {
    moodle.echeances = Array.from({ length: 120 }, (_, i) => ({ id: 1000 + i, nom: `D${i}`, module: 'assign', cours: 4280, date: S('2026-11-20T10:00:00+01:00') + i * 60 }));
    const client = new MoodleClient({ moodle: moodle.base, cas: moodle.base });
    const jeton = await client.obtenirJeton(moodle.identifiant, moodle.motDePasse);
    expect(await client.echeances(jeton, MAINTENANT)).toHaveLength(120);
  });

  it('alerte sur un nouveau devoir à la synchro suivante', async () => {
    expect(notifiees).toEqual([]);
    moodle.echeances.push({ id: 504, nom: 'Projet web', module: 'assign', cours: 4268, date: S('2026-12-01T18:00:00+01:00') });
    await cours.synchroniser(id);
    expect(notifiees.map((a) => [a.type, a.titre])).toEqual([['devoir', 'Nouveau devoir : Projet web']]);
  });

  it('coche un devoir e-campus comme fait', async () => {
    expect((await req('PUT', '/api/echeances/502/fait', { fait: true })).json()).toEqual({ echeancesFaites: [502] });
    expect((await req('GET', '/api/afaire')).json().echeances.find((e: { id: number }) => e.id === 502).fait).toBe(true);
    await req('PUT', '/api/echeances/502/fait', { fait: false });
    expect((await req('GET', '/api/afaire')).json().echeances.find((e: { id: number }) => e.id === 502).fait).toBe(false);
  });

  it('ajoute, coche, modifie et supprime une tâche perso', async () => {
    const { tache } = (await req('POST', '/api/taches', { titre: '  Relire le chapitre 4  ', echeance: '2026-11-15' })).json();
    expect(tache).toMatchObject({ titre: 'Relire le chapitre 4', echeance: '2026-11-15', fait: false, cours: null });
    expect((await req('PATCH', `/api/taches/${tache.id}`, { fait: true })).json().tache.fait).toBe(true);
    expect((await req('PATCH', `/api/taches/${tache.id}`, { echeance: null })).json().tache.echeance).toBeNull();
    expect((await req('GET', '/api/afaire')).json().taches).toHaveLength(1);
    expect((await req('DELETE', `/api/taches/${tache.id}`)).statusCode).toBe(200);
    expect((await req('DELETE', `/api/taches/${tache.id}`)).statusCode).toBe(404);
    expect((await req('GET', '/api/afaire')).json().taches).toEqual([]);
  });

  it('valide les entrées', async () => {
    expect((await req('POST', '/api/taches', { titre: '' })).statusCode).toBe(400);
    expect((await req('POST', '/api/taches', { titre: 'x', echeance: 'demain' })).statusCode).toBe(400);
    expect((await req('PATCH', '/api/taches/pas-un-id', { fait: true })).statusCode).toBe(400);
    expect((await req('PUT', '/api/echeances/abc/fait', { fait: true })).statusCode).toBe(400);
  });

  it('garde les tâches ajoutées en même temps', async () => {
    await Promise.all([1, 2, 3, 4, 5].map((i) => req('POST', '/api/taches', { titre: `T${i}` })));
    expect((await req('GET', '/api/afaire')).json().taches).toHaveLength(5);
  });
});
