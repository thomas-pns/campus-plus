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

/* ---------- Tri par type ---------- */

export type TypeDoc = 'cours' | 'td' | 'corriges' | 'tp' | 'annales' | 'autres';

export const TYPES_DOC: { id: TypeDoc; nom: string }[] = [
  { id: 'cours', nom: 'Cours' },
  { id: 'td', nom: 'TD' },
  { id: 'corriges', nom: 'Corrigés' },
  { id: 'tp', nom: 'TP' },
  { id: 'annales', nom: 'Annales et examens' },
  { id: 'autres', nom: 'Autres' },
];

/**
 * Mots repérés, du plus précis au plus général. Un sujet d'examen et son corrigé vont ensemble dans
 * les annales ; un corrigé de TD va dans les corrigés.
 */
const REGLES: [TypeDoc, RegExp][] = [
  ['annales', /annale|examen|\bexam\b|partiel|\bds\d*\b|controle|epreuve|interro|\bqcm\b|sujet/],
  ['corriges', /corrig|correction|solution|\bsol(s)?\b|\bcorr\b/],
  ['tp', /\btp\s?\d*\b|tp\d|travaux pratiques|\blabo|manip|\bprojet\b/],
  ['td', /\btd\s?\d*\b|td\d|travaux diriges|exercice|\bexos?\b|\bfeuille/],
  ['cours', /cours|\bpoly|chapitre|\bchap|\bch\d|slide|diapo|transparent|presentation|\blecture|\bnotes?\b|resume|fiche/],
];

const normaliser = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[_\-.]+/g, ' ');

function typeDe(texte: string): TypeDoc | null {
  const t = normaliser(texte);
  for (const [type, re] of REGLES) if (re.test(t)) return type;
  return null;
}

/**
 * Type d'un fichier : d'abord son nom (et son sous-dossier), puis le nom de l'élément e-campus,
 * puis celui de la section. Le premier niveau qui donne un indice l'emporte :
 * « td3.pdf » rangé dans une section « Cours » reste un TD.
 */
export function classer(f: Fichier, element: string, section: string): TypeDoc {
  const nomFichier = f.nom.replace(/\.[a-z0-9]{1,5}$/i, '');
  return typeDe(`${nomFichier} ${f.dossier}`) ?? typeDe(element) ?? typeDe(section) ?? 'autres';
}

export interface FichierClasse { f: Fichier; element: string; section: string }

/** Les fichiers d'un cours regroupés par type, dans l'ordre de TYPES_DOC (types vides omis). */
export function parType(c: Cours): { type: (typeof TYPES_DOC)[number]; fichiers: FichierClasse[] }[] {
  const groupes = new Map<TypeDoc, FichierClasse[]>();
  for (const s of c.sections) {
    for (const e of s.elements) {
      for (const f of e.fichiers) {
        const t = classer(f, e.nom, s.nom);
        groupes.set(t, [...(groupes.get(t) ?? []), { f, element: e.nom, section: s.nom }]);
      }
    }
  }
  return TYPES_DOC.filter((t) => groupes.has(t.id)).map((type) => ({
    type,
    fichiers: groupes.get(type.id)!.sort((a, b) => a.f.nom.localeCompare(b.f.nom, 'fr', { numeric: true })),
  }));
}
