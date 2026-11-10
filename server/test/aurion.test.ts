import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AurionClient, ErreurAurion, ErreurIdentifiants } from '../src/sources/aurion.js';
import { FauxAurion } from './faux-aurion.js';
import { donneesFausses } from './donnees.js';

const DEBUT = new Date(2026, 7, 20);
const FIN = new Date(2027, 6, 31);

describe('client WebAurion (contre le faux site)', () => {
  let faux: FauxAurion;
  let base: string;
  beforeEach(async () => { faux = new FauxAurion(donneesFausses()); base = await faux.demarrer(); });
  afterEach(() => faux.arreter());

  const connecte = async () => {
    const c = new AurionClient(base);
    await c.connexion(faux.donnees.identifiant, faux.donnees.motDePasse);
    return c;
  };

  it('refuse un mauvais mot de passe avec une erreur dédiée', async () => {
    const c = new AurionClient(base);
    await expect(c.connexion(faux.donnees.identifiant, 'faux')).rejects.toBeInstanceOf(ErreurIdentifiants);
  });

  it('récupère le planning et le nom de l’élève', async () => {
    const c = await connecte();
    const evts = await c.planning(DEBUT, FIN);
    expect(evts).toHaveLength(4);
    expect(evts[0]).toMatchObject({ matiere: 'Algèbre linéaire', salles: ['F008'], categorie: 'cours' });
    expect(c.nomEleve).toBe('Camille BERNARD--COSTE');
  });

  it('ne demande que la période voulue', async () => {
    const c = await connecte();
    expect(await c.planning(new Date(2027, 0, 1), FIN)).toHaveLength(1);
  });

  it('enchaîne planning, notes, absences puis planning (jeton propre à chaque page)', async () => {
    const c = await connecte();
    await c.planning(DEBUT, FIN);
    expect(await c.notes()).toEqual([
      { semestre: '26_27 - Semestre 5', module: 'Maths', cours: 'Algèbre linéaire', epreuve: 'Ecrit 1', coefficient: 50, note: 12.5, motifAbsence: '' },
      { semestre: '26_27 - Semestre 5', module: 'Maths', cours: 'Algèbre linéaire', epreuve: 'Ecrit 2', coefficient: 50, note: null, motifAbsence: '' },
    ]);
    expect(await c.absences()).toEqual([]);
    expect(await c.planning(DEBUT, FIN)).toHaveLength(4);
    expect(faux.connexionsReussies).toBe(1);
  });

  it('lit les absences quand il y en a', async () => {
    faux.donnees.absences = [['05/11/2026', 'Non justifiée', '2h00', '08:00 - 10:00', 'Cours', 'DUPONT Alice', 'Algèbre linéaire', '']];
    const c = await connecte();
    expect(await c.absences()).toEqual([
      { date: '05/11/2026', motif: 'Non justifiée', duree: '2h00', horaire: '08:00 - 10:00', cours: 'Cours', intervenant: 'DUPONT Alice', matiere: 'Algèbre linéaire' },
    ]);
  });

  it('retrouve le menu par son libellé si les numéros changent', async () => {
    faux.premierNumero = 30;
    const c = await connecte();
    expect(await c.planning(DEBUT, FIN)).toHaveLength(4);
    expect(await c.notes()).toHaveLength(2);
  });

  it('signale une panne du site sans la confondre avec un mauvais mot de passe', async () => {
    faux.enPanne = true;
    const erreur = await new AurionClient(base).connexion('x', 'y').catch((e) => e);
    expect(erreur).toBeInstanceOf(ErreurAurion);
    expect(erreur).not.toBeInstanceOf(ErreurIdentifiants);
  });

  it('échoue proprement sans connexion', async () => {
    await expect(new AurionClient(base).notes()).rejects.toBeInstanceOf(ErreurAurion);
  });
});
