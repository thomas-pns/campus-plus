import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Coffre } from '../src/coffre.js';
import { Depot } from '../src/depot.js';
import { Comptes } from '../src/comptes.js';
import { lireCle } from '../src/config.js';
import { CLE_TEST } from './donnees.js';

describe('coffre', () => {
  const coffre = new Coffre(CLE_TEST);

  it('chiffre et déchiffre', () => {
    const paquet = coffre.chiffrer('secret é à ü');
    expect(paquet).not.toContain('secret');
    expect(coffre.dechiffrer(paquet)).toBe('secret é à ü');
    expect(coffre.chiffrer('secret é à ü')).not.toBe(paquet); // vecteur aléatoire à chaque fois
  });

  it('refuse un paquet modifié ou une autre clé', () => {
    const paquet = coffre.chiffrer('secret');
    const morceaux = paquet.split('.');
    morceaux[3] = Buffer.from('autre!').toString('base64');
    expect(() => coffre.dechiffrer(morceaux.join('.'))).toThrow();
    expect(() => new Coffre(Buffer.alloc(32, 9)).dechiffrer(paquet)).toThrow();
  });

  it('exige une clé de 32 octets', () => {
    expect(() => lireCle(undefined)).toThrow(/CAMPUS_SECRET_KEY/);
    expect(() => lireCle('trop-court')).toThrow();
    expect(lireCle(CLE_TEST.toString('base64'))).toHaveLength(32);
  });
});

describe('dépôt et comptes', () => {
  let dossier: string;
  let depot: Depot;
  let comptes: Comptes;
  let horloge = 1_800_000_000_000;
  const coffre = new Coffre(CLE_TEST);

  beforeEach(async () => {
    dossier = await mkdtemp(join(tmpdir(), 'campus-'));
    depot = new Depot(dossier, coffre);
    comptes = new Comptes(depot, coffre, () => horloge);
  });
  afterEach(() => rm(dossier, { recursive: true, force: true }));

  it('n’écrit rien en clair sur le disque', async () => {
    const c = await comptes.enregistrer('Camille.Bernard', 'mot-de-passe-de-test');
    await comptes.changer(c.id, { nom: 'Camille BERNARD--COSTE' });
    const fichiers = await readdir(join(dossier, 'eleves', c.id));
    expect(fichiers).toEqual(['compte.enc']);
    const brut = await readFile(join(dossier, 'eleves', c.id, 'compte.enc'), 'utf8');
    for (const mot of ['mot-de-passe', 'Camille', 'camille', 'BERNARD']) expect(brut).not.toContain(mot);
    expect(c.id).not.toContain('camille');
    expect((await comptes.lire(c.id))?.motDePasse).toBe('mot-de-passe-de-test');
  });

  it('retrouve le même compte quelle que soit la casse de l’identifiant', async () => {
    const a = await comptes.enregistrer('Camille.Bernard', 'un');
    const b = await comptes.enregistrer(' camille.bernard ', 'deux');
    expect(b.id).toBe(a.id);
    expect(await comptes.lister()).toEqual([a.id]);
    expect((await comptes.lire(a.id))?.motDePasse).toBe('deux');
  });

  it('refuse les chemins fabriqués', async () => {
    await expect(depot.lire('../../etc', 'compte')).rejects.toThrow();
    await expect(depot.ecrire('a'.repeat(24), '../x', 1)).rejects.toThrow();
  });

  it('ouvre, vérifie, ferme et fait expirer les sessions', async () => {
    const c = await comptes.enregistrer('camille.bernard', 'x');
    const jeton = await comptes.ouvrirSession(c.id);
    expect((await comptes.verifierSession(jeton))?.id).toBe(c.id);
    expect(await comptes.verifierSession(jeton.slice(0, -2) + 'zz')).toBeNull();
    expect(await comptes.verifierSession('n-importe-quoi')).toBeNull();
    expect(await comptes.verifierSession(undefined)).toBeNull();
    // Le jeton n'est pas stocké tel quel.
    expect(JSON.stringify(await comptes.lire(c.id))).not.toContain(jeton.split('.')[1]);

    const autre = await comptes.ouvrirSession(c.id);
    await comptes.fermerSession(jeton);
    expect(await comptes.verifierSession(jeton)).toBeNull();
    expect(await comptes.verifierSession(autre)).not.toBeNull();

    horloge += 61 * 24 * 3600 * 1000;
    expect(await comptes.verifierSession(autre)).toBeNull();
  });

  it('garde toutes les modifications faites en même temps', async () => {
    const c = await comptes.enregistrer('camille.bernard', 'x');
    const jetons = await Promise.all([1, 2, 3, 4, 5].map(() => comptes.ouvrirSession(c.id)));
    for (const j of jetons) expect(await comptes.verifierSession(j)).not.toBeNull();
  });

  it('efface tout à la suppression', async () => {
    const c = await comptes.enregistrer('camille.bernard', 'x');
    const jeton = await comptes.ouvrirSession(c.id);
    await depot.ecrire(c.id, 'planning', [1, 2]);
    await comptes.supprimer(c.id);
    expect(await comptes.lister()).toEqual([]);
    expect(await comptes.verifierSession(jeton)).toBeNull();
    expect(await depot.lire(c.id, 'planning')).toBeNull();
  });
});
