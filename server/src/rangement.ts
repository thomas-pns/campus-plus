/**
 * Rangement des fichiers de cours par semestre, matière et type, pour la copie sur OneDrive.
 * Mêmes règles que l'onglet Cours de l'appli (client/src/cours.ts) : un test vérifie qu'elles restent identiques.
 */
import type { Cours, Fichier } from './sources/moodle.js';

export type TypeDoc = 'cours' | 'td' | 'corriges' | 'tp' | 'annales' | 'autres';

export const NOMS_TYPES: Record<TypeDoc, string> = {
  cours: 'Cours', td: 'TD', corriges: 'Corrigés', tp: 'TP', annales: 'Annales et examens', autres: 'Autres',
};

export const REGLES: [TypeDoc, RegExp][] = [
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

export function classer(f: Fichier, element: string, section: string): TypeDoc {
  const nomFichier = f.nom.replace(/\.[a-z0-9]{1,5}$/i, '');
  return typeDe(`${nomFichier} ${f.dossier}`) ?? typeDe(element) ?? typeDe(section) ?? 'autres';
}

export function semestreDe(c: Cours): string {
  const m = c.nom.match(/\(S(\d+)\)/) ?? c.code.match(/_0?(\d+)S?_[A-Z]+_\d+/);
  return m ? `S${Number(m[1])}` : 'Ressources';
}

export const nomCourt = (c: Cours) => c.nom.replace(/\s*\(S\d+\)\s*$/, '');

/** Nom accepté par OneDrive : sans caractères interdits, ni point ou espace en fin de nom. */
export function nomSur(nom: string): string {
  const propre = nom.replace(/["*:<>?/\\|\u0000-\u001f]/g, '-').replace(/\s+/g, ' ').trim().replace(/[. ]+$/, '');
  return (propre || 'Sans nom').slice(0, 200);
}

export interface Placement { fichier: Fichier; chemin: string }

/**
 * Chemin de chaque fichier : « Cours CPE/S5/Algèbre linéaire/TD/feuille 1.pdf ».
 * Deux fichiers qui tomberaient au même endroit reçoivent un suffixe « (2) ».
 */
export function placer(cours: Cours[], racine = 'Cours CPE'): Placement[] {
  const pris = new Set<string>();
  const vus = new Set<string>();
  const sortie: Placement[] = [];
  for (const c of cours) {
    for (const s of c.sections) {
      for (const e of s.elements) {
        for (const f of e.fichiers) {
          if (vus.has(f.cle)) continue;
          vus.add(f.cle);
          const dossier = [racine, semestreDe(c), nomSur(nomCourt(c)), NOMS_TYPES[classer(f, e.nom, s.nom)], ...f.dossier.split('/').filter(Boolean).map(nomSur)].join('/');
          const nom = nomSur(f.nom);
          const point = nom.lastIndexOf('.');
          let chemin = `${dossier}/${nom}`;
          for (let n = 2; pris.has(chemin.toLowerCase()); n++) {
            chemin = point > 0 ? `${dossier}/${nom.slice(0, point)} (${n})${nom.slice(point)}` : `${dossier}/${nom} (${n})`;
          }
          pris.add(chemin.toLowerCase());
          sortie.push({ fichier: f, chemin });
        }
      }
    }
  }
  return sortie;
}
