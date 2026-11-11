import { describe, expect, it } from 'vitest';
import { ajouterJours, dans, grilleMois, moisDecale, heureDe, ilYA, initialesDe, jourDe, jourEnToutesLettres, jourParis, lundiDe, minutesDe, numeroSemaine, prenomDe, rangDansSemaine } from '../src/dates';
import { aLaUne, disposer, duJour, prochainJourAvecCours, salleDe, salleDeduite, semaineDe } from '../src/planning';
import type { Evenement } from '../src/types';

const evt = (jour: string, debut: string, fin: string, plus: Partial<Evenement> = {}): Evenement => ({
  id: jour + debut, cle: jour + debut, debut: `${jour}T${debut}:00+01:00`, fin: `${jour}T${fin}:00+01:00`,
  categorie: 'cours', salles: ['F008'], groupe: '3ETI', matiere: 'Algèbre', type: 'Cours', intervenants: [], remarques: [], ...plus,
});

describe('dates', () => {
  it('construit la grille du mois en semaines complètes', () => {
    const g = grilleMois('2026-11-11');
    expect(g[0]).toBe('2026-10-26');
    expect(g.at(-1)).toBe('2026-12-06');
    expect(g.length % 7).toBe(0);
    expect(grilleMois('2027-03-15').length).toBe(35);
    expect(moisDecale('2026-12-31', 1)).toBe('2027-01-01');
    expect(moisDecale('2026-01-31', -1)).toBe('2025-12-01');
  });

  it('lit le jour et l’heure écrits dans la chaîne (heure de Paris)', () => {
    expect(jourDe('2026-11-10T10:30:00+01:00')).toBe('2026-11-10');
    expect(heureDe('2026-11-10T10:30:00+01:00')).toBe('10:30');
    expect(minutesDe('2026-11-10T10:30:00+01:00')).toBe(630);
  });

  it('donne le jour à Paris, quel que soit le fuseau de l’appareil', () => {
    expect(jourParis(Date.parse('2026-11-10T23:30:00+01:00'))).toBe('2026-11-10');
    expect(jourParis(Date.parse('2026-11-10T23:30:00Z'))).toBe('2026-11-11');
    expect(jourParis(Date.parse('2026-07-01T22:30:00Z'))).toBe('2026-07-02'); // heure d'été
  });

  it('calcule sur les jours, changements de mois, d’année et d’heure compris', () => {
    expect(ajouterJours('2026-11-30', 1)).toBe('2026-12-01');
    expect(ajouterJours('2027-01-01', -1)).toBe('2026-12-31');
    expect(ajouterJours('2026-10-24', 2)).toBe('2026-10-26'); // passage à l'heure d'hiver
    expect(rangDansSemaine('2026-11-10')).toBe(1); // mardi
    expect(lundiDe('2026-11-15')).toBe('2026-11-09'); // dimanche
    expect(lundiDe('2026-11-09')).toBe('2026-11-09');
  });

  it('donne le numéro de semaine ISO', () => {
    expect(numeroSemaine('2026-11-10')).toBe(46);
    expect(numeroSemaine('2027-01-01')).toBe(53);
    expect(numeroSemaine('2027-01-04')).toBe(1);
    expect(numeroSemaine('2026-01-01')).toBe(1);
  });

  it('écrit les dates et les durées en français', () => {
    expect(jourEnToutesLettres('2026-11-10')).toBe('Mardi 10 novembre');
    expect(dans(20_000)).toBe('dans un instant');
    expect(dans(50 * 60_000)).toBe('dans 50 min');
    expect(dans(2 * 3600_000)).toBe('dans 2 h');
    expect(dans(130 * 60_000)).toBe('dans 2 h 10');
    expect(dans(3 * 86_400_000)).toBe('dans 3 j');
    expect(ilYA(10_000)).toBe("à l'instant");
    expect(ilYA(12 * 60_000)).toBe('il y a 12 min');
    expect(ilYA(3 * 3600_000)).toBe('il y a 3 h');
  });

  it('sépare prénom et nom', () => {
    expect(prenomDe('Camille BERNARD--COSTE')).toBe('Camille');
    expect(prenomDe('Jean Paul DE LA TOUR')).toBe('Jean Paul');
    expect(prenomDe('')).toBe('');
    expect(initialesDe('Camille BERNARD--COSTE')).toBe('CB');
    expect(initialesDe('Nina')).toBe('N');
    expect(initialesDe('')).toBe('?');
  });
});

describe('planning', () => {
  const lundi = [evt('2026-11-09', '10:15', '12:15'), evt('2026-11-09', '08:00', '10:00')];
  const mardi = [evt('2026-11-10', '08:00', '10:00'), evt('2026-11-10', '10:30', '12:00', { categorie: 'examen', salles: ['F004', 'F005', 'F008'], salleExamen: ['F004', 'F005'] })];
  const tous = [...lundi, ...mardi, evt('2026-11-12', '08:00', '10:00')];
  const a = (heure: string) => Date.parse(`2026-11-10T${heure}:00+01:00`);

  it('trie les créneaux du jour', () => {
    expect(duJour(tous, '2026-11-09').map((e) => heureDe(e.debut))).toEqual(['08:00', '10:15']);
    expect(duJour(tous, '2026-11-11')).toEqual([]);
  });

  it('met en avant le créneau en cours, sinon le prochain', () => {
    expect(aLaUne(tous, a('09:00'))).toMatchObject({ enCours: true, evenement: { debut: '2026-11-10T08:00:00+01:00' } });
    expect(aLaUne(tous, a('10:10'))).toMatchObject({ enCours: false, evenement: { categorie: 'examen' } });
    expect(aLaUne(tous, a('12:00'))).toMatchObject({ enCours: false, evenement: { debut: '2026-11-12T08:00:00+01:00' } });
    expect(aLaUne(tous, Date.parse('2026-12-01T00:00:00+01:00'))).toBeNull();
  });

  it('trouve le prochain jour de cours', () => {
    expect(prochainJourAvecCours(tous, '2026-11-10')).toBe('2026-11-12');
    expect(prochainJourAvecCours(tous, '2026-11-12')).toBeNull();
  });

  it('affiche la salle de l’élève pour un examen', () => {
    expect(salleDe(mardi[1])).toBe('F004 / F005');
    expect(salleDeduite(mardi[1])).toBe(true);
    expect(salleDe(mardi[0])).toBe('F008');
    expect(salleDeduite(mardi[0])).toBe(false);
    expect(salleDe(evt('2026-11-10', '08:00', '10:00', { categorie: 'examen', salleExamen: null }))).toBe('F008');
  });

  it('range côte à côte les créneaux qui se chevauchent', () => {
    const blocs = disposer([evt('2026-11-09', '08:00', '10:00'), evt('2026-11-09', '09:00', '11:00'), evt('2026-11-09', '10:00', '12:00'), evt('2026-11-09', '14:00', '15:00')]);
    expect(blocs.map((b) => [b.voie, b.voies])).toEqual([[0, 2], [1, 2], [0, 2], [0, 1]]);
  });

  it('construit la semaine : lundi à vendredi, samedi seulement s’il y a cours, heures élargies au besoin', () => {
    const s = semaineDe(tous, '2026-11-09');
    expect(s.jours).toHaveLength(5);
    expect([s.heureDebut, s.heureFin]).toEqual([8, 18]);
    expect(s.colonnes.map((c) => c.length)).toEqual([2, 2, 0, 1, 0]);
    const large = semaineDe([...tous, evt('2026-11-14', '07:30', '20:15')], '2026-11-09');
    expect(large.jours).toHaveLength(6);
    expect([large.heureDebut, large.heureFin]).toEqual([7, 21]);
    expect(semaineDe([], '2026-11-09')).toMatchObject({ heureDebut: 8, heureFin: 18 });
  });
});

import { aVenir, grouper, lignes } from '../src/afaire';
import type { Echeance, Tache } from '../src/types';

describe('à faire', () => {
  const maintenant = Date.parse('2026-11-11T09:00:00+01:00'); // mercredi
  const S = (iso: string) => Date.parse(iso) / 1000;
  const ech = (id: number, nom: string, date: string, plus: Partial<Echeance> = {}): Echeance => ({
    id, nom, module: 'assign', cours: 1, nomCours: 'Algèbre linéaire (S5)', date: S(date), action: '', lien: '', enRetard: false, fait: false, ...plus,
  });
  const tache = (id: string, titre: string, echeance: string | null, fait = false): Tache => ({ id, titre, echeance, cours: null, fait, creeLe: '' });
  const liste = lignes(
    [ech(1, 'CR TP1', '2026-11-14T23:59:00+01:00'), ech(2, 'QCM', '2026-11-11T18:00:00+01:00', { module: 'quiz' }), ech(3, 'Exos S44', '2026-11-05T23:59:00+01:00'), ech(4, 'Projet', '2026-12-01T18:00:00+01:00'), ech(5, 'Ancien', '2026-11-04T10:00:00+01:00', { fait: true })],
    [tache('a', 'Relire chap. 4', '2026-11-13'), tache('b', 'Acheter une calculatrice', null), tache('c', 'Fiche résumé', '2026-11-09', true)],
    maintenant,
  );

  it('fusionne et trie par date, heure de Paris', () => {
    expect(liste.map((l) => l.titre)).toEqual(['Ancien', 'Exos S44', 'Fiche résumé', 'QCM', 'Relire chap. 4', 'CR TP1', 'Projet', 'Acheter une calculatrice']);
    expect(liste.find((l) => l.titre === 'QCM')).toMatchObject({ heure: '18:00', sous: 'Test · Algèbre linéaire' });
    expect(liste.find((l) => l.titre === 'Relire chap. 4')).toMatchObject({ sous: 'Ajouté par toi', heure: null });
  });

  it('range en groupes', () => {
    expect(grouper(liste, maintenant).map(([g, l]) => [g, l.map((x) => x.titre)])).toEqual([
      ['retard', ['Exos S44']],
      ['aujourdhui', ['QCM']],
      ['semaine', ['Relire chap. 4', 'CR TP1']],
      ['plusTard', ['Projet']],
      ['sansDate', ['Acheter une calculatrice']],
      ['faits', ['Fiche résumé', 'Ancien']],
    ]);
  });

  it('montre au plus 3 éléments urgents sur Aujourd’hui', () => {
    expect(aVenir(liste, maintenant).map((l) => l.titre)).toEqual(['Exos S44', 'QCM', 'Relire chap. 4']);
  });
});

import { memeMatiere } from '../src/afaire';
describe('matières', () => {
  it('rapproche le planning et e-campus', () => {
    expect(memeMatiere('Algèbre linéaire', 'Algèbre linéaire (S5)')).toBe(true);
    expect(memeMatiere('Signaux Analogiques et Numériques', 'Signaux analogiques et numériques (S5)')).toBe(true);
    expect(memeMatiere('Techniques et Langages du WEB', 'Techniques et Langages du Web (S5)')).toBe(true);
    expect(memeMatiere('Algèbre linéaire', 'Analyse numérique (S5)')).toBe(false);
    expect(memeMatiere('', 'Analyse')).toBe(false);
  });
});
