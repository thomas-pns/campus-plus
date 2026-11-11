import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { categorieDe, etiquettesDe, profDe, profsDuPlanning, SynchroMails } from '../src/mails.js';
import { PartageClient, ErreurIdentifiantsPartage } from '../src/sources/partage.js';
import { lireEvenement } from '../src/sources/planning.js';
import { creerApp } from '../src/api.js';
import { Coffre } from '../src/coffre.js';
import { Comptes } from '../src/comptes.js';
import { Depot } from '../src/depot.js';
import { Synchro } from '../src/synchro.js';
import { AurionClient } from '../src/sources/aurion.js';
import type { Alerte } from '../src/alertes.js';
import { FauxPartage, mailsFaux } from './faux-partage.js';
import { FauxAurion } from './faux-aurion.js';
import { CLE_TEST, donneesFausses } from './donnees.js';

const evt = (matiere: string, profs: string) => lireEvenement({ id: 'x', title: `F008\n3ETI\n${matiere}\nCours\n${profs}\n`, start: '2026-11-12T08:00:00+0100', end: '2026-11-12T10:00:00+0100', className: 'N01_COURS' });

describe('tri des mails', () => {
  const profs = profsDuPlanning([evt('Algèbre linéaire', 'DUPONT Alice'), evt('Algèbre linéaire', 'DUPONT Alice'), evt('Analyse numérique', 'DUPONT Alice / LE GALL Yann'), evt('Logique', 'MARTIN Paul')]);

  it('retient les profs et leur matière principale', () => {
    expect(profs.get('dupont')).toEqual(['Algèbre linéaire', 'Analyse numérique']);
    expect(profs.get('le gall')).toEqual(['Analyse numérique']);
  });

  it('reconnaît un prof par son nom affiché ou son adresse', () => {
    expect(profDe({ deNom: 'Alice DUPONT', deAdresse: 'x@cpe.fr' }, profs)).toBe('dupont');
    expect(profDe({ deNom: '', deAdresse: 'yann.le-gall@cpe.fr' }, profs)).toBe('le gall');
    expect(profDe({ deNom: 'Nina Petit', deAdresse: 'nina.petit@cpe.fr' }, profs)).toBeNull();
    expect(profDe({ deNom: 'M. Dupont', deAdresse: 'secretariat@cpe.fr' }, profs)).toBe('dupont');
  });

  it('ne confond pas un élève avec un prof du même nom de famille', () => {
    const avecPetit = profsDuPlanning([evt('Web', 'PETIT Hugo')]);
    expect(profDe({ deNom: 'Nina Petit', deAdresse: 'nina.petit@cpe.fr' }, avecPetit)).toBeNull();
    expect(profDe({ deNom: 'Hugo PETIT', deAdresse: 'hugo.petit@cpe.fr' }, avecPetit)).toBe('petit');
    expect(profDe({ deNom: '', deAdresse: 'hugo.petit@cpe.fr' }, avecPetit)).toBe('petit');
  });

  it('distingue l’école des élèves et de l’extérieur', () => {
    expect(categorieDe({ deNom: 'Scolarité', deAdresse: 'scolarite3eti@cpe.fr' }, null)).toBe('ecole');
    expect(categorieDe({ deNom: 'BDE', deAdresse: 'bde@asso.cpe.fr' }, null)).toBe('ecole');
    expect(categorieDe({ deNom: 'Nina Petit', deAdresse: 'nina.petit@cpe.fr' }, null)).toBe('autre');
    expect(categorieDe({ deNom: 'Boutique', deAdresse: 'noreply@boutique.example' }, null)).toBe('autre');
    expect(categorieDe({ deNom: 'Alice DUPONT', deAdresse: 'alice.dupont@cpe.fr' }, 'dupont')).toBe('prof');
  });

  it('étiquette par mots-clés', () => {
    expect(etiquettesDe('Partiel : changement de salle, vous passez en F008')).toEqual(['salle', 'examen']);
    expect(etiquettesDe('Cette semaine nous corrigerons les exercices 10 et 14')).toEqual(['devoir']);
    expect(etiquettesDe('Je viens de poster une nouvelle version du cours')).toEqual(['cours']);
    expect(etiquettesDe('Le cours de demain est annulé')).toEqual(['annulation']);
    expect(etiquettesDe('Bonne journée')).toEqual([]);
  });
});

describe('client PARTAGE', () => {
  let faux: FauxPartage;
  beforeEach(async () => { faux = new FauxPartage(); faux.mails = mailsFaux(Date.now()); await faux.demarrer(); });
  afterEach(() => faux.arreter());

  it('se connecte, liste et lit les mails (texte ou HTML)', async () => {
    const c = new PartageClient(faux.base);
    await c.connexion(faux.adresse, faux.motDePasse);
    const boite = await c.boite();
    expect(boite.map((m) => m.id)).toEqual(['101', '102', '103', '104', '105', '106']);
    expect(boite[0]).toMatchObject({ sujet: 'Nouvelle version du cours', deNom: 'Alice DUPONT', deAdresse: 'alice.dupont@cpe.fr' });
    expect(await c.texte('102')).toBe('Cette semaine nous corrigerons les exercices 10, 14, 15 et 16. Merci de les préparer.');
    expect(await c.texte('101')).toContain('démonstration corrigée');
  });

  it('distingue un mauvais mot de passe', async () => {
    await expect(new PartageClient(faux.base).connexion(faux.adresse, 'faux')).rejects.toBeInstanceOf(ErreurIdentifiantsPartage);
  });
});

describe('mails de bout en bout', () => {
  let aurion: FauxAurion;
  let partage: FauxPartage;
  let dossier: string;
  let app: FastifyInstance;
  let mails: SynchroMails;
  let cookies: Record<string, string>;
  let id: string;
  let notifiees: Alerte[];

  beforeEach(async () => {
    aurion = new FauxAurion(donneesFausses());
    const baseAurion = await aurion.demarrer();
    partage = new FauxPartage();
    partage.adresse = aurion.donnees.identifiant;
    partage.motDePasse = aurion.donnees.motDePasse;
    partage.mails = mailsFaux(Date.now());
    await partage.demarrer();
    dossier = await mkdtemp(join(tmpdir(), 'campus-mails-'));
    const coffre = new Coffre(CLE_TEST);
    const depot = new Depot(dossier, coffre);
    const comptes = new Comptes(depot, coffre);
    notifiees = [];
    mails = new SynchroMails(depot, comptes, () => new PartageClient(partage.base), { base: partage.base, surNouvellesAlertes: async (_, a) => { notifiees.push(...a); } });
    const fabriqueAurion = () => new AurionClient(baseAurion);
    const synchro = new Synchro(depot, comptes, fabriqueAurion, { minutes: 15, mails });
    app = await creerApp({ depot, comptes, synchro, mails, fabriqueAurion, cookieSecurise: true });
    const rep = await app.inject({ method: 'POST', url: '/api/connexion', payload: { identifiant: aurion.donnees.identifiant, motDePasse: aurion.donnees.motDePasse } });
    cookies = { cp_session: rep.cookies.find((c) => c.name === 'cp_session')!.value };
    id = comptes.idPour(aurion.donnees.identifiant);
  });
  afterEach(async () => {
    await app.close();
    await aurion.arreter();
    await partage.arreter();
    await rm(dossier, { recursive: true, force: true });
  });

  const req = (method: 'GET' | 'PUT', url: string, payload?: object) => app.inject({ method, url, payload, cookies });

  it('est désactivé par défaut et ne touche pas à PARTAGE', async () => {
    expect((await req('GET', '/api/mails')).json()).toMatchObject({ etat: { actif: false }, mails: [] });
    await mails.synchroniser(id);
    expect(partage.connexions).toBe(0);
    expect((await app.inject({ method: 'GET', url: '/api/mails' })).statusCode).toBe(401);
  });

  it('trie les mails à l’activation, sans lire le texte des mails sans intérêt', async () => {
    const { etat, mails: liste } = (await req('PUT', '/api/mails/actif', { actif: true })).json();
    expect(etat).toMatchObject({ actif: true, erreur: null });
    expect(liste.map((m: { id: string; categorie: string }) => [m.id, m.categorie])).toEqual([['101', 'prof'], ['102', 'prof'], ['103', 'ecole'], ['104', 'ecole'], ['105', 'autre'], ['106', 'autre']]);
    expect(liste[0]).toMatchObject({ matiere: 'Algèbre linéaire', etiquettes: ['cours'], de: 'Alice DUPONT' });
    expect(liste[1].etiquettes).toEqual(['devoir']);
    expect(liste[2].etiquettes).toEqual(['salle', 'examen']);
    expect(liste[4].etiquettes).toEqual([]); // élève : pas d'étiquette même si « salle » apparaît
    expect(liste[0].lien).toBe(`${partage.base}/`);
    expect(liste[1].texte).toBe('Cette semaine nous corrigerons les exercices 10, 14, 15 et 16. Merci de les préparer.');
    expect(liste[4].texte).toBe(''); // mail d'élève : pas de texte gardé
    expect(partage.lectures).toBe(4); // seulement profs et école
    expect(notifiees).toEqual([]); // première lecture : pas d'alerte
  });

  it('retient le choix de l’élève pour un expéditeur, le relit et l’applique aux mails suivants', async () => {
    await req('PUT', '/api/mails/actif', { actif: true });
    const lectures = partage.lectures;
    const rep = (await req('PUT', '/api/mails/expediteur', { adresse: 'Nina.Petit@cpe.fr', categorie: 'prof' })).json();
    expect(rep.mails.find((m: { id: string }) => m.id === 'relire:105')).toMatchObject({ categorie: 'prof', corrige: true });
    await mails.synchroniser(id);
    const apres = await mails.mails(id);
    expect(apres.find((m) => m.id === '105')).toMatchObject({ categorie: 'prof', corrige: true, etiquettes: ['salle'] });
    expect(apres.some((m) => m.id.startsWith('relire:'))).toBe(false);
    expect(partage.lectures).toBe(lectures + 1);
    expect(notifiees).toEqual([]); // relu, pas nouveau : pas d'alerte

    partage.mails.push({ id: '109', date: Date.now(), sujet: 'Groupe projet', texte: 'On se retrouve demain.', deNom: 'Nina Petit', deAdresse: 'nina.petit@cpe.fr' });
    await mails.synchroniser(id);
    expect((await mails.mails(id)).find((m) => m.id === '109')).toMatchObject({ categorie: 'prof' });

    // Retirer le choix : on revient au tri automatique.
    const retour = (await req('PUT', '/api/mails/expediteur', { adresse: 'nina.petit@cpe.fr', categorie: null })).json();
    expect(retour.mails.find((m: { id: string }) => m.id === '105')).toMatchObject({ categorie: 'autre', corrige: false, texte: '' });
    expect((await req('PUT', '/api/mails/expediteur', { adresse: 'x@y.z', categorie: 'chef' })).statusCode).toBe(400);
  });

  it('ne garde pas le texte entier sur le serveur, seulement un extrait, chiffré', async () => {
    await req('PUT', '/api/mails/actif', { actif: true });
    const brut = await readFile(join(dossier, 'eleves', id, 'mails.enc'), 'utf8');
    expect(brut).not.toContain('DUPONT');
    const liste = (await req('GET', '/api/mails')).json().mails;
    expect(liste.every((m: { extrait: string }) => m.extrait.length <= 240)).toBe(true);
  });

  it('alerte sur un nouveau mail de prof, pas sur celui d’un élève, et ne relit pas les anciens', async () => {
    await req('PUT', '/api/mails/actif', { actif: true });
    const lectures = partage.lectures;
    partage.mails.push(
      { id: '107', date: Date.now(), sujet: 'Cours de demain annulé', texte: 'Je ne pourrai pas assurer le cours de demain.', deNom: 'Alice DUPONT', deAdresse: 'alice.dupont@cpe.fr' },
      { id: '108', date: Date.now(), sujet: 'dispo ce soir ?', texte: '...', deNom: 'Nina Petit', deAdresse: 'nina.petit@cpe.fr' },
    );
    await mails.synchroniser(id);
    expect(notifiees.map((a) => [a.type, a.titre])).toEqual([['mail', 'Alice DUPONT : Cours de demain annulé']]);
    expect(partage.lectures).toBe(lectures + 1);
  });

  it('se désactive si PARTAGE refuse le mot de passe, et efface les mails quand on désactive', async () => {
    await req('PUT', '/api/mails/actif', { actif: true });
    partage.motDePasse = 'change';
    const etat = await mails.synchroniser(id);
    expect(etat).toMatchObject({ actif: false, erreur: 'PARTAGE refuse ton mot de passe' });
    await mails.synchroniser(id);
    expect(partage.connexions).toBe(1);

    partage.motDePasse = aurion.donnees.motDePasse;
    await req('PUT', '/api/mails/actif', { actif: true });
    expect((await req('GET', '/api/mails')).json().mails).toHaveLength(6);
    expect((await req('PUT', '/api/mails/actif', { actif: false })).json()).toMatchObject({ etat: { actif: false }, mails: [] });
    expect(await mails.mails(id)).toEqual([]);
    expect(await readdir(join(dossier, 'eleves', id))).toContain('mails.enc');
  });
});
