import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Coffre } from '../src/coffre.js';
import { Depot } from '../src/depot.js';
import type { SynchroCours } from '../src/cours.js';
import type { Cours, Fichier } from '../src/sources/moodle.js';
import { nomSur, placer, REGLES } from '../src/rangement.js';
import { SynchroOneDrive } from '../src/onedrive.js';
import { FauxMicrosoft } from './faux-microsoft.js';
import { CLE_TEST } from './donnees.js';

const fichier = (cle: string, nom: string, dossier = ''): Fichier => ({ cle: cle.padEnd(32, '0'), nom, dossier, taille: 10, modifie: 1, type: 'application/pdf', adresse: `https://e/${cle}` });
const cours = (nom: string, code: string, sections: { nom: string; elements: { nom: string; fichiers: Fichier[] }[] }[]): Cours => ({
  id: 1, nom, code, categorie: '', sections: sections.map((s) => ({ nom: s.nom, elements: s.elements.map((e, i) => ({ id: i, nom: e.nom, type: 'resource', lien: '', fichiers: e.fichiers })) })),
});

const COURS: Cours[] = [
  cours('Algèbre linéaire (S5)', '26_27_3ETI_05_MSP_101_C', [
    { nom: 'Chapitre 1', elements: [{ nom: 'Poly', fichiers: [fichier('a1', 'poly.pdf')] }, { nom: 'TD 1', fichiers: [fichier('a2', 'feuille1.pdf'), fichier('a3', 'feuille1_corrige.pdf')] }] },
    { nom: 'Examens', elements: [{ nom: 'Annales', fichiers: [fichier('a4', 'DS 2024.pdf'), fichier('a5', 'DS 2024.pdf', 'vieux')] }] },
  ]),
  cours('Électronique : bases?', '26_27_3ETI_06_ELPH_201_C', [
    { nom: 'TP', elements: [{ nom: 'Énoncés', fichiers: [fichier('b1', 'gros.pdf'), fichier('b2', 'fiche.pdf'), fichier('b3', 'fiche.pdf')] }] },
  ]),
];

describe('rangement OneDrive', () => {
  it('range par semestre, matière et type', () => {
    const chemins = placer(COURS).map((p) => p.chemin);
    expect(chemins).toEqual([
      'Cours CPE/S5/Algèbre linéaire/Cours/poly.pdf',
      'Cours CPE/S5/Algèbre linéaire/TD/feuille1.pdf',
      'Cours CPE/S5/Algèbre linéaire/Corrigés/feuille1_corrige.pdf',
      'Cours CPE/S5/Algèbre linéaire/Annales et examens/DS 2024.pdf',
      'Cours CPE/S5/Algèbre linéaire/Annales et examens/vieux/DS 2024.pdf',
      'Cours CPE/S6/Électronique - bases-/TP/gros.pdf',
      'Cours CPE/S6/Électronique - bases-/Cours/fiche.pdf',
      'Cours CPE/S6/Électronique - bases-/Cours/fiche (2).pdf',
    ]);
  });

  it('écrit des noms acceptés par OneDrive', () => {
    expect(nomSur('a/b:c*?.')).toBe('a-b-c--');
    expect(nomSur('  ...  ')).toBe('Sans nom');
  });

  it('suit les mêmes règles que l’onglet Cours de l’appli', async () => {
    const client = join(import.meta.dirname, '../../client/src/cours.ts');
    if (!existsSync(client)) return;
    const texte = await readFile(client, 'utf8');
    for (const [type, re] of REGLES) expect(texte).toContain(`['${type}', ${re.toString()}]`);
  });
});

describe('copie sur OneDrive', () => {
  let dossier: string;
  let depot: Depot;
  let ms: FauxMicrosoft;
  let journal: string[];
  const contenus = new Map<string, Buffer>([
    ['a1'.padEnd(32, '0'), Buffer.from('poly')],
    ['a2'.padEnd(32, '0'), Buffer.from('td')],
    ['a3'.padEnd(32, '0'), Buffer.from('corrigé')],
    ['a4'.padEnd(32, '0'), Buffer.alloc(9 * 1024 * 1024, 7)],
    ['a5'.padEnd(32, '0'), Buffer.from('ds')],
    ['b2'.padEnd(32, '0'), Buffer.from('fiche')],
    ['b3'.padEnd(32, '0'), Buffer.from('fiche 2')],
  ]);
  const faussesCours = { cours: async () => COURS, octetsEnCache: async (cle: string) => contenus.get(cle) ?? null } as unknown as SynchroCours;
  const id = 'a'.repeat(24);
  const creer = (parPassage = 40) => new SynchroOneDrive(depot, faussesCours, { clientId: 'client-test', baseConnexion: ms.base, baseGraph: `${ms.base}/v1.0`, pauseMin: 10, parPassage, journal: (m) => journal.push(m) });
  const attendre = async (test: () => Promise<boolean>) => {
    for (let i = 0; i < 200; i++) { if (await test()) return; await new Promise((r) => setTimeout(r, 10)); }
    throw new Error('délai dépassé');
  };

  beforeEach(async () => {
    dossier = await mkdtemp(join(tmpdir(), 'cp-onedrive-'));
    depot = new Depot(dossier, new Coffre(CLE_TEST));
    ms = new FauxMicrosoft();
    await ms.demarrer();
    journal = [];
  });
  afterEach(async () => {
    await ms.arreter();
    await rm(dossier, { recursive: true, force: true });
  });

  it('se connecte par code d’appareil puis copie les fichiers, gros compris', async () => {
    const od = creer();
    const c = await od.demarrerConnexion(id);
    expect(c.code).toBe('ABCD-EFGH');
    expect((await od.etat(id)).connexion?.code).toBe('ABCD-EFGH');
    ms.valide = true;
    await attendre(async () => (await od.etat(id)).copies === 7);
    const etat = await od.etat(id);
    expect(etat).toMatchObject({ actif: true, compte: 'camille.bernard@exemple.fr', erreur: null, restants: 0, connexion: null });
    expect(ms.fichiers.get('Cours CPE/S5/Algèbre linéaire/Corrigés/feuille1_corrige.pdf')?.toString()).toBe('corrigé');
    expect(ms.fichiers.get('Cours CPE/S5/Algèbre linéaire/Annales et examens/DS 2024.pdf')?.length).toBe(9 * 1024 * 1024);
    expect(ms.morceaux).toBe(1);
    // « gros.pdf » n'a pas de copie sur le serveur : il n'est pas envoyé.
    expect([...ms.fichiers.keys()].some((k) => k.includes('gros'))).toBe(false);
    // Le jeton de renouvellement est chiffré sur le disque.
    const brut = await readFile(join(dossier, 'eleves', id, 'onedrivejeton.enc'), 'utf8');
    expect(brut).not.toContain('r-');

    // Rien de nouveau : rien n'est renvoyé.
    ms.fichiers.clear();
    await od.synchroniser(id);
    expect(ms.fichiers.size).toBe(0);
  });

  it('copie par petits paquets et reprend où elle s’est arrêtée', async () => {
    const od = creer(3);
    await od.demarrerConnexion(id);
    ms.valide = true;
    await attendre(async () => (await od.etat(id)).actif && !!(await od.etat(id)).derniereSynchro);
    expect((await od.etat(id)).restants).toBe(5);
    await od.synchroniser(id);
    await od.synchroniser(id);
    const etat = await od.etat(id);
    expect(etat.restants).toBe(0);
    expect(etat.copies).toBe(7);
  });

  it('se coupe si Microsoft retire l’accès, et oublie tout à la déconnexion', async () => {
    const od = creer();
    await od.demarrerConnexion(id);
    ms.valide = true;
    await attendre(async () => (await od.etat(id)).copies === 7);
    ms.renouvellementsRefuses = true;
    const neuf = creer(); // nouveau processus : plus de jeton d'accès en mémoire
    contenus.set('a1'.padEnd(32, '0'), Buffer.from('poly v2'));
    await depot.ecrire(id, 'onedrivecopies', {});
    const etat = await neuf.synchroniser(id);
    expect(etat.actif).toBe(false);
    expect(etat.erreur).toMatch(/reconnecte OneDrive/);
    const vide = await neuf.deconnecter(id);
    expect(vide).toMatchObject({ actif: false, compte: null, copies: 0 });
    expect(await depot.lire(id, 'onedrivejeton')).toBeNull();
  });

  it('signale un refus sur la page Microsoft', async () => {
    const od = creer();
    await od.demarrerConnexion(id);
    ms.refuse = true;
    await attendre(async () => !(await od.etat(id)).connexion);
    expect((await od.etat(id))).toMatchObject({ actif: false, erreur: 'Connexion Microsoft annulée' });
  });
});
