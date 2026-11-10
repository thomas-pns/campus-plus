import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ErreurIdentifiantsMoodle, MoodleClient, nomPropre } from '../src/sources/moodle.js';
import { SynchroCours } from '../src/cours.js';
import { Coffre } from '../src/coffre.js';
import { Comptes } from '../src/comptes.js';
import { Depot } from '../src/depot.js';
import type { Alerte } from '../src/alertes.js';
import { coursFaux, FauxMoodle } from './faux-moodle.js';
import { CLE_TEST } from './donnees.js';

describe('noms de cours', () => {
  it('retire le code de fin et décode les entités', () => {
    expect(nomPropre('Algèbre linéaire (S5) * 26_27_3ETI_05_MSP_101_C')).toBe('Algèbre linéaire (S5)');
    expect(nomPropre('Approfondissements des syst&egrave;mes d&#39;électronique (S6) * 26_27_3ETI_06_ELPH_003_C')).toBe("Approfondissements des systèmes d'électronique (S6)");
    expect(nomPropre('Guide LOGICIELS')).toBe('Guide LOGICIELS');
  });
});

describe('client e-campus (faux CAS + faux Moodle)', () => {
  let faux: FauxMoodle;
  let client: MoodleClient;
  beforeEach(async () => {
    faux = new FauxMoodle();
    faux.cours = coursFaux();
    client = new MoodleClient(await faux.demarrer());
  });
  afterEach(() => faux.arreter());

  it('obtient un jeton par le CAS', async () => {
    const jeton = await client.obtenirJeton(faux.identifiant, faux.motDePasse);
    expect(jeton).toMatch(/^[0-9a-f]{32}$/);
    expect(faux.connexionsCas).toBe(1);
  });

  it('distingue un mauvais mot de passe', async () => {
    await expect(client.obtenirJeton(faux.identifiant, 'faux')).rejects.toBeInstanceOf(ErreurIdentifiantsMoodle);
  });

  it('lit les cours, range sections et fichiers, et télécharge', async () => {
    const jeton = await client.obtenirJeton(faux.identifiant, faux.motDePasse);
    const cours = await client.cours(jeton);
    expect(cours.map((c) => c.nom)).toEqual(['Bases de la physique quantique et des semi-conducteurs (S5)', 'Algèbre linéaire (S5)']);
    expect(cours[0].sections.map((s) => s.nom)).toEqual(['Généralités', 'Docs', 'TD & corrigés']);
    const td = cours[0].sections[2].elements[0];
    expect(td.fichiers.map((f) => [f.nom, f.dossier])).toEqual([['td1.pdf', 'TD'], ['td2.pdf', 'TD']]);
    expect(td.fichiers[0].adresse).not.toContain('forcedownload');
    expect(cours[1].sections[0].elements[1]).toMatchObject({ type: 'url', fichiers: [] });
    expect((await client.telecharger(jeton, td.fichiers[0].adresse, 1000)).toString()).toBe('%PDF-1.4 TD1');
    await expect(client.telecharger(jeton, td.fichiers[0].adresse, 5)).rejects.toThrow(/trop gros/);
  });

  it('refuse un jeton mal signé', () => {
    const faux64 = Buffer.from('00000000000000000000000000000000:::' + 'a'.repeat(32)).toString('base64');
    expect(() => MoodleClient.lireJeton(`moodlemobile://token=${faux64}`, 'https://e-campus.cpe.fr', 'abc')).toThrow(/illisible/);
  });
});

describe('synchro des cours', () => {
  let faux: FauxMoodle;
  let dossier: string;
  let synchro: SynchroCours;
  let comptes: Comptes;
  let depot: Depot;
  let id: string;
  let notifiees: Alerte[];

  beforeEach(async () => {
    faux = new FauxMoodle();
    faux.cours = coursFaux();
    const adresses = await faux.demarrer();
    dossier = await mkdtemp(join(tmpdir(), 'campus-cours-'));
    const coffre = new Coffre(CLE_TEST);
    depot = new Depot(dossier, coffre);
    comptes = new Comptes(depot, coffre);
    id = (await comptes.enregistrer(faux.identifiant, faux.motDePasse)).id;
    notifiees = [];
    synchro = new SynchroCours(depot, comptes, coffre, dossier, () => new MoodleClient(adresses), {
      surNouvellesAlertes: async (_, a) => { notifiees.push(...a); },
    });
  });
  afterEach(async () => {
    await faux.arreter();
    await rm(dossier, { recursive: true, force: true });
  });

  it('copie les fichiers chiffrés, une seule fois, et les rend à l’élève', async () => {
    const etat = await synchro.synchroniser(id);
    expect(etat).toMatchObject({ erreur: null, ignores: 0 });
    expect(faux.telechargements).toBe(4);
    const fichiers = await readdir(join(dossier, 'fichiers'));
    expect(fichiers).toHaveLength(4);
    for (const f of fichiers) expect((await readFile(join(dossier, 'fichiers', f))).toString('latin1')).not.toContain('%PDF');

    const cle = (await synchro.cours(id))[0].sections[1].elements[0].fichiers[0].cle;
    const trouve = await synchro.fichier(id, cle);
    expect(trouve && 'octets' in trouve && trouve.octets.toString()).toBe('%PDF-1.4 cours MQ');
    expect(await synchro.fichier(id, 'f'.repeat(32))).toBeNull();
    expect(await synchro.fichier(id, '../../etc/passwd')).toBeNull();

    await synchro.synchroniser(id);
    expect(faux.telechargements).toBe(4); // déjà en cache
    expect(faux.connexionsCas).toBe(1); // le jeton est réutilisé
    expect(notifiees).toEqual([]); // première synchro : pas d'alerte
  });

  it('signale un nouveau fichier et un fichier mis à jour', async () => {
    await synchro.synchroniser(id);
    faux.cours[1].sections[0].elements[0].fichiers![0].modifie += 100;
    faux.cours[0].sections[1].elements[0].fichiers!.push({ nom: 'complement.pdf', contenu: '%PDF-1.4 plus', modifie: 1_790_000_500 });
    await synchro.synchroniser(id);
    expect(notifiees.map((a) => a.titre).sort()).toEqual([
      'Fichier mis à jour : Algèbre linéaire (S5)',
      'Nouveau fichier : Bases de la physique quantique et des semi-conducteurs (S5)',
    ]);
    expect(notifiees.find((a) => a.titre.startsWith('Nouveau'))?.detail).toBe('complement.pdf · Docs');
    const alertes = await depot.lire<Alerte[]>(id, 'alertes');
    expect(alertes).toHaveLength(2);
  });

  it('redemande un jeton s’il a expiré', async () => {
    await synchro.synchroniser(id);
    faux.revoquerJetons();
    const etat = await synchro.synchroniser(id);
    expect(etat.erreur).toBeNull();
    expect(faux.connexionsCas).toBe(2);
  });

  it('ne copie pas les fichiers trop gros, mais les transmet à la demande depuis e-campus', async () => {
    const petit = new SynchroCours(depot, comptes, new Coffre(CLE_TEST), dossier, () => new MoodleClient({ moodle: faux.base, cas: faux.base }), { tailleMax: 14 });
    const etat = await petit.synchroniser(id);
    expect(etat).toMatchObject({ erreur: null, ignores: 1 }); // seul « cours-mq.pdf » (17 octets) dépasse
    expect(await readdir(join(dossier, 'fichiers'))).toHaveLength(3);
    const cle = (await petit.cours(id))[0].sections[1].elements[0].fichiers[0].cle;
    const avant = faux.telechargements;
    const trouve = await petit.fichier(id, cle);
    expect(trouve && 'flux' in trouve && (await trouve.flux.text())).toBe('%PDF-1.4 cours MQ');
    expect(faux.telechargements).toBe(avant + 1);
    expect(await readdir(join(dossier, 'fichiers'))).toHaveLength(3); // rien d'écrit sur le disque

    faux.revoquerJetons(); // jeton expiré : on en redemande un et ça passe
    const encore = await petit.fichier(id, cle);
    expect(encore && 'flux' in encore && (await encore.flux.text())).toBe('%PDF-1.4 cours MQ');
  });

  it('s’arrête si le CAS refuse le mot de passe, jusqu’à la prochaine connexion', async () => {
    faux.motDePasse = 'change';
    const etat = await synchro.synchroniser(id);
    expect(etat.erreur).toMatch(/refusés/);
    await synchro.synchroniser(id);
    expect(faux.connexionsCas).toBe(0);
    await comptes.enregistrer(faux.identifiant, 'change');
    await synchro.debloquer(id);
    expect((await synchro.synchroniser(id)).erreur).toBeNull();
  });
});

describe('API des cours', () => {
  it('liste les cours sans exposer les adresses e-campus et ne sert que les fichiers de l’élève', async () => {
    const { creerApp } = await import('../src/api.js');
    const { Synchro } = await import('../src/synchro.js');
    const { AurionClient } = await import('../src/sources/aurion.js');
    const { FauxAurion } = await import('./faux-aurion.js');
    const { donneesFausses } = await import('./donnees.js');
    const aurion = new FauxAurion(donneesFausses());
    const baseAurion = await aurion.demarrer();
    const moodle = new FauxMoodle();
    moodle.cours = coursFaux();
    moodle.identifiant = aurion.donnees.identifiant;
    moodle.motDePasse = aurion.donnees.motDePasse;
    const adresses = await moodle.demarrer();
    const dossier = await mkdtemp(join(tmpdir(), 'campus-api-cours-'));
    const coffre = new Coffre(CLE_TEST);
    const depot = new Depot(dossier, coffre);
    const comptes = new Comptes(depot, coffre);
    // tailleMax 14 : « cours-mq.pdf » (17 octets) n'est pas copié et passe par e-campus à la demande.
    const cours = new SynchroCours(depot, comptes, coffre, dossier, () => new MoodleClient(adresses), { tailleMax: 14 });
    const fabriqueAurion = () => new AurionClient(baseAurion);
    const synchro = new Synchro(depot, comptes, fabriqueAurion, { minutes: 15, cours });
    const app = await creerApp({ depot, comptes, synchro, cours, fabriqueAurion, cookieSecurise: true });
    try {
      const rep = await app.inject({ method: 'POST', url: '/api/connexion', payload: { identifiant: aurion.donnees.identifiant, motDePasse: aurion.donnees.motDePasse } });
      const cookies = { cp_session: rep.cookies.find((c) => c.name === 'cp_session')!.value };
      const id = comptes.idPour(aurion.donnees.identifiant);
      await cours.synchroniser(id); // attend la synchro lancée en arrière-plan par la connexion

      expect((await app.inject({ method: 'GET', url: '/api/cours' })).statusCode).toBe(401);
      const liste = (await app.inject({ method: 'GET', url: '/api/cours', cookies })).json();
      expect(liste.etat.erreur).toBeNull();
      expect(liste.cours).toHaveLength(2);
      expect(JSON.stringify(liste)).not.toContain('pluginfile');
      const f = liste.cours[0].sections[1].elements[0].fichiers[0];
      expect(f).toMatchObject({ nom: 'cours-mq.pdf', type: 'application/pdf' });

      const fichier = await app.inject({ method: 'GET', url: `/api/fichiers/${f.cle}`, cookies });
      expect(fichier.statusCode).toBe(200);
      expect(fichier.body).toBe('%PDF-1.4 cours MQ');
      expect(fichier.headers['content-type']).toBe('application/pdf');
      expect(fichier.headers['content-disposition']).toContain('inline; filename="cours-mq.pdf"');
      expect(fichier.headers['content-security-policy']).toContain('sandbox');
      expect(fichier.headers['cache-control']).toBe('private, no-store'); // transmis, pas en cache

      const copie = liste.cours[0].sections[2].elements[0].fichiers[0];
      const td = await app.inject({ method: 'GET', url: `/api/fichiers/${copie.cle}`, cookies });
      expect(td.body).toBe('%PDF-1.4 TD1');
      expect(td.headers['cache-control']).toBe('private, max-age=86400'); // copie du serveur
      expect((await app.inject({ method: 'GET', url: `/api/fichiers/${'0'.repeat(32)}`, cookies })).statusCode).toBe(404);
      expect((await app.inject({ method: 'GET', url: `/api/fichiers/${f.cle}` })).statusCode).toBe(401);

      // Un autre élève, sans ce cours, ne peut pas lire le fichier.
      aurion.donnees = { ...donneesFausses(), identifiant: 'nina.petit', motDePasse: 'autre', nom: 'Nina PETIT' };
      const autre = await app.inject({ method: 'POST', url: '/api/connexion', payload: { identifiant: 'nina.petit', motDePasse: 'autre' } });
      const cookiesAutre = { cp_session: autre.cookies.find((c) => c.name === 'cp_session')!.value };
      await cours.synchroniser(comptes.idPour('nina.petit')); // le CAS refuse : aucun cours
      expect((await app.inject({ method: 'GET', url: `/api/fichiers/${f.cle}`, cookies: cookiesAutre })).statusCode).toBe(404);
    } finally {
      await app.close();
      await aurion.arreter();
      await moodle.arreter();
      await rm(dossier, { recursive: true, force: true });
    }
  });
});
