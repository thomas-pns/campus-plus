/** Données inventées, partagées par les tests. Aucun vrai nom, aucune vraie note. */
import type { DonneesFausses } from './faux-aurion.js';

export const CLE_TEST = Buffer.alloc(32, 7);

export function donneesFausses(): DonneesFausses {
  return {
    identifiant: 'camille.bernard',
    motDePasse: 'mot-de-passe-de-test',
    nom: 'Camille BERNARD--COSTE',
    evenements: [
      { title: 'F008\n3ETI\nAlgèbre linéaire\nCours\nDUPONT Alice\n\n', start: '2026-11-12T08:00:00+0100', end: '2026-11-12T10:00:00+0100', className: 'N01_COURS' },
      { title: 'I105\n3ETI GRA\nLogique Numérique\nTP\nMARTIN Paul / DURAND Léa\nTP-ELN1\n', start: '2026-11-12T13:30:00+0100', end: '2026-11-12T17:45:00+0100', className: 'N01_TP_LABO' },
      { title: 'F004 / F005 / F008\n3ETI\nPhysique\nExamen \nDUPONT Alice\nDe Hugo ABADIE à Zoé LEROY inclus en salle Salle F004_F005\nDe Nina MARCHAND à Yann ZIMMER inclus en Salle F008\n', start: '2026-11-17T10:30:00+0100', end: '2026-11-17T12:00:00+0100', className: 'N01_EXAMEN' },
      { title: 'Gymnase\n3ETI\nSport\nSport\n\n\n', start: '2027-03-04T15:45:00+0100', end: '2027-03-04T17:45:00+0100', className: 'N01_SPORT' },
    ],
    notes: [
      ['26_27 - Semestre 5', 'Maths', 'Algèbre linéaire', 'Ecrit 1', '50', '12,5', ''],
      ['26_27 - Semestre 5', 'Maths', 'Algèbre linéaire', 'Ecrit 2', '50', '', ''],
    ],
    absences: [],
  };
}
