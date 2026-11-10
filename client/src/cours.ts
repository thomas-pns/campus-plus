/** Logique d'affichage des cours e-campus. */
import type { Cours, Fichier } from './types';

/** Semestre lu dans le nom ou le code : « (S5) », « _05_ ». */
export function semestreDe(c: Cours): string {
  const m = c.nom.match(/\(S(\d+)\)/) ?? c.code.match(/_0?(\d+)_[A-Z]/);
  return m ? `S${Number(m[1])}` : 'Autres';
}

/** « Algèbre linéaire (S5) » → « Algèbre linéaire ». */
export const nomCourt = (c: Cours) => c.nom.replace(/\s*\(S\d+\)\s*$/, '');

/** Pôle d'enseignement lu dans la catégorie « 3ETI_05_ELPH ». */
const POLES: Record<string, { nom: string; classe: string }> = {
  ELPH: { nom: 'Électronique & physique', classe: 'c-cours' },
  MSP: { nom: 'Maths & signal', classe: 'c-td' },
  COMSC: { nom: 'Informatique', classe: 'c-tp' },
  L: { nom: 'Langues', classe: 'c-langues' },
  ESS: { nom: 'Formation humaine', classe: 'c-fhes' },
  IP: { nom: 'Stages', classe: 'c-neutre' },
};

export function poleDe(c: Cours): { nom: string; classe: string } {
  const code = c.categorie.split('_').pop() ?? '';
  return POLES[code] ?? { nom: 'Autres ressources', classe: 'c-neutre' };
}

/** Deux ou trois lettres pour la vignette du cours. */
export function sigle(c: Cours): string {
  const mots = nomCourt(c).split(/[\s'’-]+/).filter((m) => m.length > 2 || /^[A-Z0-9]+$/.test(m));
  return (mots.length >= 2 ? mots[0][0] + mots[1][0] : nomCourt(c).slice(0, 2)).toUpperCase();
}

export const fichiersDe = (c: Cours): Fichier[] => c.sections.flatMap((s) => s.elements.flatMap((e) => e.fichiers));

export function taille(octets: number): string {
  if (octets < 1000) return `${octets} o`;
  if (octets < 1e6) return `${Math.round(octets / 1000)} Ko`;
  return `${(octets / 1e6).toFixed(octets < 1e7 ? 1 : 0).replace('.', ',')} Mo`;
}

export function typeFichier(f: Fichier): string {
  const ext = f.nom.split('.').pop()?.toLowerCase() ?? '';
  return ext && ext !== f.nom.toLowerCase() ? ext.toUpperCase() : 'Fichier';
}

/** Recherche sans tenir compte des accents ni de la casse. */
const simple = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function correspond(texte: string, recherche: string): boolean {
  const mots = simple(recherche).split(/\s+/).filter(Boolean);
  const t = simple(texte);
  return mots.every((m) => t.includes(m));
}
