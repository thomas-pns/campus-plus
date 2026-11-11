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
import { messagesPour, Notifications, type Abonnement, type Message } from '../src/notifications.js';
import type { Alerte } from '../src/alertes.js';
import { FauxAurion } from './faux-aurion.js';
import { CLE_TEST, donneesFausses } from './donnees.js';

const abonnement = (n = 1): Abonnement => ({ endpoint: `https://push.example.test/abonnement-${n}`, keys: { p256dh: 'B'.repeat(87), auth: 'a'.repeat(22) } });
const alerte = (i: number, type: Alerte['type'] = 'salle'): Alerte => ({ id: `a${i}`, type, date: '2026-11-10T12:00:00Z', titre: `Titre ${i}`, detail: `Détail ${i}` });

describe('messages', () => {
  it('un message par alerte, ou un résumé au-delà de trois', () => {
    expect(messagesPour([alerte(1), alerte(2)])).toEqual([{ titre: 'Titre 1', corps: 'Détail 1', tag: 'a1' }, { titre: 'Titre 2', corps: 'Détail 2', tag: 'a2' }]);
    expect(messagesPour([1, 2, 3, 4, 5].map((i) => alerte(i)))).toEqual([{ titre: '5 changements détectés', corps: 'Titre 1 · Titre 2 · Titre 3', tag: 'resume' }]);
    expect(messagesPour([])).toEqual([]);
  });
});

describe('notifications de bout en bout (faux WebAurion, faux service push)', () => {
  let faux: FauxAurion;
  let dossier: string;
  let app: FastifyInstance;
  let horloge: number;
  let envoyes: { abonnement: Abonnement; message: Message }[];
  let morts: Set<string>;
  let cookies: Record<string, string>;

  beforeEach(async () => {
    faux = new FauxAurion(donneesFausses());
    const base = await faux.demarrer();
    dossier = await mkdtemp(join(tmpdir(), 'campus-notif-'));
    horloge = Date.parse('2026-11-10T12:00:00+0100');
    envoyes = [];
    morts = new Set();
    const coffre = new Coffre(CLE_TEST);
    const depot = new Depot(dossier, coffre);
    const comptes = new Comptes(depot, coffre, () => horloge);
    const notifications = new Notifications(depot, async (a, m) => {
      if (morts.has(a.endpoint)) throw Object.assign(new Error('Gone'), { statusCode: 410 });
      envoyes.push({ abonnement: a, message: m });
    });
    notifications.clePublique = 'cle-publique-de-test';
    const fabriqueAurion = () => new AurionClient(base);
    const synchro = new Synchro(depot, comptes, fabriqueAurion, { minutes: 15, maintenant: () => new Date(horloge), surNouvellesAlertes: (id, a) => notifications.alertes(id, a) });
    app = await creerApp({ depot, comptes, synchro, notifications, fabriqueAurion, cookieSecurise: true, maintenant: () => horloge });
    const rep = await app.inject({ method: 'POST', url: '/api/connexion', payload: { identifiant: faux.donnees.identifiant, motDePasse: faux.donnees.motDePasse } });
    cookies = { cp_session: rep.cookies.find((c) => c.name === 'cp_session')!.value };
  });
  afterEach(async () => {
    await app.close();
    await faux.arreter();
    await rm(dossier, { recursive: true, force: true });
  });

  const req = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object, c: Record<string, string> | undefined = cookies) =>
    app.inject({ method, url, payload, cookies: c });
  const changerEtSynchroniser = async () => {
    faux.donnees.evenements[0].title = faux.donnees.evenements[0].title.replace('F008', 'F002');
    faux.donnees.notes[1][5] = '15';
    horloge += 61_000;
    await req('POST', '/api/synchro');
  };

  it('protège les routes', async () => {
    for (const [m, u] of [['GET', '/api/notifications'], ['POST', '/api/notifications/abonnement'], ['PUT', '/api/notifications/types'], ['POST', '/api/notifications/essai']] as const) {
      expect((await req(m, u, {}, {})).statusCode, u).toBe(401);
    }
  });

  it('donne la clé publique et les réglages par défaut', async () => {
    expect((await req('GET', '/api/notifications')).json()).toEqual({
      cle: 'cle-publique-de-test', appareils: 0,
      types: { salle: true, horaire: true, ajoute: true, supprime: true, note: true, fichier: true, devoir: true, mail: true, examen: true },
    });
  });

  it('refuse un abonnement invalide', async () => {
    for (const a of [{}, { endpoint: 'http://pas-https.test/x', keys: { p256dh: 'x', auth: 'y' } }, { endpoint: 'https://push.example.test/x' }]) {
      expect((await req('POST', '/api/notifications/abonnement', { abonnement: a })).statusCode).toBe(400);
    }
  });

  it('prévient l’élève abonné quand une synchro trouve du nouveau', async () => {
    expect((await req('POST', '/api/notifications/abonnement', { abonnement: abonnement() })).statusCode).toBe(200);
    await changerEtSynchroniser();
    expect(envoyes.map((e) => e.message.titre).filter((t) => !t.startsWith('Examen')).sort()).toEqual(['Changement de salle : Algèbre linéaire (Cours)', 'Note publiée : Algèbre linéaire']);
    const avant = envoyes.length;
    expect(envoyes[0].abonnement.endpoint).toBe(abonnement().endpoint);

    // La même alerte n'est pas renvoyée à la synchro suivante.
    horloge += 61_000;
    await req('POST', '/api/synchro');
    expect(envoyes).toHaveLength(avant);
  });

  it('respecte les types choisis', async () => {
    await req('POST', '/api/notifications/abonnement', { abonnement: abonnement() });
    const rep = await req('PUT', '/api/notifications/types', { note: false, examen: false });
    expect(rep.json().types).toMatchObject({ note: false, salle: true });
    // Un type inconnu est ignoré.
    expect((await req('PUT', '/api/notifications/types', { inconnu: true })).json().types).toMatchObject({ note: false, salle: true });
    await changerEtSynchroniser();
    expect(envoyes.map((e) => e.message.titre)).toEqual(['Changement de salle : Algèbre linéaire (Cours)']);
  });

  it('envoie à chaque appareil, oublie ceux qui n’existent plus, et se désabonne', async () => {
    await req('POST', '/api/notifications/abonnement', { abonnement: abonnement(1) });
    await req('POST', '/api/notifications/abonnement', { abonnement: abonnement(2) });
    await req('POST', '/api/notifications/abonnement', { abonnement: abonnement(2) }); // pas de doublon
    expect((await req('GET', '/api/notifications')).json().appareils).toBe(2);

    morts.add(abonnement(2).endpoint);
    expect((await req('POST', '/api/notifications/essai')).json()).toEqual({ envoyes: 1 });
    expect((await req('GET', '/api/notifications')).json().appareils).toBe(1);

    await req('DELETE', '/api/notifications/abonnement', { endpoint: abonnement(1).endpoint });
    expect((await req('GET', '/api/notifications')).json().appareils).toBe(0);
    expect((await req('POST', '/api/notifications/essai')).json()).toEqual({ envoyes: 0 });
  });

  it('n’empêche pas la synchro si l’envoi plante, et ne stocke rien en clair', async () => {
    await req('POST', '/api/notifications/abonnement', { abonnement: abonnement() });
    const [id] = await readdir(join(dossier, 'eleves'));
    const brut = await readFile(join(dossier, 'eleves', id, 'notifications.enc'), 'utf8');
    expect(brut).not.toContain('push.example.test');
  });
});

describe('clés VAPID', () => {
  it('sont créées une fois puis relues, chiffrées sur le disque', async () => {
    const dossier = await mkdtemp(join(tmpdir(), 'campus-vapid-'));
    try {
      const coffre = new Coffre(CLE_TEST);
      const depot = new Depot(dossier, coffre);
      const a = await Notifications.demarrer(depot, coffre, dossier);
      const b = await Notifications.demarrer(depot, coffre, dossier);
      expect(a.clePublique).toMatch(/^[A-Za-z0-9_-]{80,}$/);
      expect(b.clePublique).toBe(a.clePublique);
      expect(await readFile(join(dossier, 'vapid.enc'), 'utf8')).not.toContain(a.clePublique);
    } finally {
      await rm(dossier, { recursive: true, force: true });
    }
  });
});
