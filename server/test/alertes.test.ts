import { describe, expect, it } from 'vitest';
import { comparerNotes, comparerPlanning, moyennesParCours } from '../src/alertes.js';
import { lireEvenement, type Evenement } from '../src/sources/planning.js';
import type { Note } from '../src/sources/aurion.js';

const MAINTENANT = new Date('2026-11-10T12:00:00+0100');
const evt = (jour: string, debut: string, fin: string, salle: string, matiere = 'Algèbre linéaire', type = 'Cours', classe = 'N01_COURS'): Evenement =>
  lireEvenement({ id: String(Math.random()), title: `${salle}\n3ETI\n${matiere}\n${type}\nDUPONT Alice\n\n`, start: `${jour}T${debut}:00+0100`, end: `${jour}T${fin}:00+0100`, className: classe });

describe('alertes du planning', () => {
  const base = [evt('2026-11-12', '08:00', '10:00', 'F008'), evt('2026-11-13', '10:15', '12:15', 'H001', 'Signaux', 'TD', 'N01_TD')];

  it('ne signale rien quand rien ne change (même si les id WebAurion changent)', () => {
    const memes = [evt('2026-11-12', '08:00', '10:00', 'F008'), evt('2026-11-13', '10:15', '12:15', 'H001', 'Signaux', 'TD', 'N01_TD')];
    expect(comparerPlanning(base, memes, MAINTENANT)).toEqual([]);
  });

  it('signale un changement de salle', () => {
    const a = comparerPlanning(base, [evt('2026-11-12', '08:00', '10:00', 'F002'), base[1]], MAINTENANT);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ type: 'salle', titre: 'Changement de salle : Algèbre linéaire (Cours)', detail: '12/11/2026 à 08h00 : F002 au lieu de F008', cleEvenement: base[0].cle });
  });

  it('signale un horaire modifié, un créneau supprimé et un nouvel examen', () => {
    const apres = [evt('2026-11-12', '08:00', '09:30', 'F008'), evt('2026-11-17', '10:30', '12:00', 'F004 / F005', 'Physique', 'Examen ', 'N01_EXAMEN')];
    const a = comparerPlanning(base, apres, MAINTENANT);
    expect(a.map((x) => x.type).sort()).toEqual(['ajoute', 'horaire', 'supprime']);
    expect(a.find((x) => x.type === 'ajoute')?.titre).toBe('Nouvel examen : Physique');
    expect(a.find((x) => x.type === 'horaire')?.detail).toBe('12/11/2026 à 08h00 : fin à 09h30 au lieu de 10h00');
    expect(a.find((x) => x.type === 'supprime')?.titre).toContain('Signaux');
  });

  it('ignore le passé et ce qui est à plus de deux semaines', () => {
    const avant = [evt('2026-11-09', '08:00', '10:00', 'F008'), evt('2027-02-01', '08:00', '10:00', 'F008')];
    const apres = [evt('2026-11-09', '08:00', '10:00', 'F002'), evt('2027-02-01', '08:00', '10:00', 'F002')];
    expect(comparerPlanning(avant, apres, MAINTENANT)).toEqual([]);
  });

  it('donne le même identifiant à la même alerte (pas de doublon d’une synchro à l’autre)', () => {
    const apres = [evt('2026-11-12', '08:00', '10:00', 'F002'), base[1]];
    expect(comparerPlanning(base, apres, MAINTENANT)[0].id).toBe(comparerPlanning(base, apres, new Date(MAINTENANT.getTime() + 60_000))[0].id);
  });
});

describe('notes', () => {
  const note = (epreuve: string, coefficient: number | null, valeur: number | null, cours = 'Algèbre linéaire'): Note =>
    ({ semestre: 'S5', module: 'Maths', cours, epreuve, coefficient, note: valeur, motifAbsence: '' });

  it('signale une note publiée puis modifiée, pas une note inchangée', () => {
    const avant = [note('Ecrit 1', 50, 12.5), note('Ecrit 2', 50, null)];
    expect(comparerNotes(avant, avant, MAINTENANT)).toEqual([]);
    const a = comparerNotes(avant, [note('Ecrit 1', 50, 13), note('Ecrit 2', 50, 9.25), note('TP', 20, 15, 'Signaux')], MAINTENANT);
    expect(a.map((x) => x.titre)).toEqual(['Note modifiée : Algèbre linéaire', 'Note publiée : Algèbre linéaire', 'Note publiée : Signaux']);
    expect(a[1].detail).toBe('Ecrit 2 : 9,25/20');
  });

  it('calcule la moyenne pondérée par cours', () => {
    const m = moyennesParCours([note('Ecrit 1', 50, 10), note('Ecrit 2', 25, 16), note('Oral', 25, null), note('TP', null, 14, 'Signaux'), note('Ecrit', 50, null, 'Physique')]);
    expect(m).toEqual([
      { semestre: 'S5', module: 'Maths', cours: 'Algèbre linéaire', moyenne: 12, epreuvesNotees: 2 },
      { semestre: 'S5', module: 'Maths', cours: 'Signaux', moyenne: 14, epreuvesNotees: 1 },
      { semestre: 'S5', module: 'Maths', cours: 'Physique', moyenne: null, epreuvesNotees: 0 },
    ]);
  });
});
