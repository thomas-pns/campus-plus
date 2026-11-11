/** Moyenne d'un cours selon la répartition saisie par l'élève, et note à viser sur ce qui reste. */
import type { Note } from './types';

export interface Partie {
  nom: string;
  /** Part de la note du cours, en pourcentage. */
  poids: number;
  /** Note connue (MyCPE ou estimée par l'élève) ; null : à venir. */
  note?: number | null;
  /** Épreuve MyCPE liée : sa note est reprise automatiquement. */
  epreuve?: string | null;
}

export interface Repartition {
  objectif: number;
  parties: Partie[];
}

export interface Bilan {
  totalPoids: number;
  /** Moyenne sur les parties déjà notées (null s'il n'y en a pas). */
  actuelle: number | null;
  /** Moyenne finale si tout est noté. */
  finale: number | null;
  /** Note à avoir en moyenne sur les parties à venir pour atteindre l'objectif. */
  aViser: number | null;
  poidsRestant: number;
}

/** Répartition proposée au départ : une partie par épreuve, au prorata des coefficients (sinon à parts égales). */
export function repartitionParDefaut(epreuves: Note[]): Repartition {
  const coefs = epreuves.map((n) => n.coefficient ?? 0);
  const somme = coefs.reduce((a, b) => a + b, 0);
  return {
    objectif: 10,
    parties: epreuves.map((n, i) => ({
      nom: n.epreuve, epreuve: n.epreuve,
      poids: Math.round(somme ? (100 * coefs[i]) / somme : 100 / epreuves.length),
    })),
  };
}

/** Note de chaque partie : celle de MyCPE si l'épreuve liée est notée, sinon celle saisie. */
export function noteDe(p: Partie, epreuves: Note[]): number | null {
  const liee = p.epreuve ? epreuves.find((n) => n.epreuve === p.epreuve) : undefined;
  return liee?.note ?? p.note ?? null;
}

export function bilan(r: Repartition, epreuves: Note[]): Bilan {
  let somme = 0, connu = 0, restant = 0;
  for (const p of r.parties) {
    const n = noteDe(p, epreuves);
    if (n === null) restant += p.poids;
    else { somme += p.poids * n; connu += p.poids; }
  }
  const total = connu + restant;
  const arrondi = (x: number) => Math.round(x * 100) / 100;
  return {
    totalPoids: total,
    actuelle: connu ? arrondi(somme / connu) : null,
    finale: !restant && total ? arrondi(somme / total) : null,
    aViser: restant ? arrondi((r.objectif * total - somme) / restant) : null,
    poidsRestant: restant,
  };
}
