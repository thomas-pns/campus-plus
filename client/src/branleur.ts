/**
 * Mode branleur (caché, pour rire) : repère les cours magistraux qu'on peut sécher sans conséquence.
 * Les TD, TP, langues, examens et le sport sont obligatoires : jamais proposés.
 */
import type { Evenement } from './types';
import { heureDe, jourDe } from './dates';

export interface Verdict {
  message: string;
  /** Heure de fin de journée si on sèche les derniers cours facultatifs. */
  finPossible: string | null;
}

const OBLIGATOIRE = /\b(td|tp|ds|examen|partiel|controle|langue|anglais|lv\d)\b/i;

/** Créneaux « non pédagogiques » (réunions, amphis d'info…) : jamais d'appel. */
const NON_PEDAGOGIQUE = /non p[ée]dagogique/i;

export function sechable(e: Evenement): boolean {
  if (NON_PEDAGOGIQUE.test(`${e.matiere} ${e.type}`) && e.categorie !== 'examen') return true;
  if (!['cours', 'fhes'].includes(e.categorie)) return false;
  return !OBLIGATOIRE.test(`${e.type} ${e.matiere}`);
}

const PHRASES = [
  'Cours magistral : les slides sont sur e-campus 📄',
  'Le poly ne bougera pas d’ici ce soir 🛌',
  'Personne ne fait l’appel en amphi… en théorie 👀',
  'Un café, un résumé d’un pote, et c’est réglé ☕',
  'Ton lit t’appelle, et il est très convaincant 🛏️',
  'Le prof parle à 200 personnes, il ne verra rien 🕶️',
  'Grand amphi, petite conscience 🫣',
  'Ce cours existe aussi en PDF, version 0 effort 📚',
  'Va prendre un vrai petit-déj’ 🥐',
  'Ton futur toi relira les slides, promis 🤞',
  'Mode économie d’énergie activé 🔋',
];

/** Pour les examens, en mode branleur : pas d'excuse, juste du soutien moral. */
const EXAMENS = ['😵‍💫 Pas d’échappatoire, courage', '🧠 Réveille tes neurones', '☕ Double café recommandé', '🫠 Respire, ça va bien se passer', '🍀 Croise les doigts (et révise)'];

export function soutienExamen(e: Evenement): string | null {
  return e.categorie === 'examen' ? EXAMENS[hache(e.cle) % EXAMENS.length] : null;
}

/** Planning de l'élève, retenu pour que chaque ligne du planning trouve sa propre excuse. */
let planningRetenu: Evenement[] = [];
export const retenirPlanning = (p: Evenement[]) => { planningRetenu = p; };

const hache = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export function verdict(e: Evenement, planning: Evenement[] = planningRetenu): Verdict | null {
  if (!sechable(e)) return null;
  const jour = planning.filter((x) => jourDe(x.debut) === jourDe(e.debut)).sort((a, b) => a.debut.localeCompare(b.debut));
  const obligatoires = jour.filter((x) => !sechable(x));
  const dernierObligatoire = obligatoires.at(-1);
  const apresTout = !dernierObligatoire || dernierObligatoire.fin <= e.debut;
  const avantTout = !obligatoires.length || obligatoires[0].debut >= e.fin;
  const finPossible = apresTout && dernierObligatoire ? heureDe(dernierObligatoire.fin) : null;
  let message: string;
  if (NON_PEDAGOGIQUE.test(`${e.matiere} ${e.type}`)) message = 'Non pédagogique : personne ne vérifie, va dormir 😴';
  else if (!obligatoires.length) message = 'Que du facultatif aujourd’hui : journée off ? 🏖️';
  else if (avantTout && heureDe(e.debut) <= '08:30') message = 'Cours à 8 h facultatif : grasse mat’ validée 😴';
  else if (apresTout) message = `Tu peux finir à ${finPossible} : la sortie est à gauche 🚪`;
  else message = PHRASES[hache(e.cle) % PHRASES.length];
  return { message, finPossible };
}
