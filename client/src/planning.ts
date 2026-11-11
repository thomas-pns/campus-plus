/** Logique d'affichage du planning : couleurs, prochain cours, disposition de la semaine. */
import type { Categorie, Evenement } from './types';
import { ajouterJours, jourDe, minutesDe } from './dates';

export const CATEGORIES: Record<Categorie, { nom: string; classe: string }> = {
  cours: { nom: 'Cours', classe: 'c-cours' },
  td: { nom: 'TD', classe: 'c-td' },
  tp: { nom: 'TP', classe: 'c-tp' },
  langues: { nom: 'Langues', classe: 'c-langues' },
  fhes: { nom: 'FHES', classe: 'c-fhes' },
  examen: { nom: 'Examen', classe: 'c-examen' },
  sport: { nom: 'Sport', classe: 'c-sport' },
  autonomie: { nom: 'Autonomie', classe: 'c-neutre' },
  presentation: { nom: 'Présentation', classe: 'c-neutre' },
  evenement: { nom: 'Événement', classe: 'c-neutre' },
  reunion: { nom: 'Réunion', classe: 'c-neutre' },
  autre: { nom: 'Autre', classe: 'c-neutre' },
};

/** La salle à afficher : pour un examen, celle de l'élève si elle a pu être déduite. */
export function salleDe(e: Evenement): string {
  const salles = e.salleExamen?.length ? e.salleExamen : e.salles;
  return salles.join(' / ');
}

/** Vrai si la salle affichée vient de la répartition par nom de l'examen. */
export const salleDeduite = (e: Evenement) => !!e.salleExamen?.length && e.salleExamen.join() !== e.salles.join();

export const titreDe = (e: Evenement) => e.matiere || e.type.trim() || CATEGORIES[e.categorie].nom;

const parDebut = (a: Evenement, b: Evenement) => a.debut.localeCompare(b.debut);

export function duJour(evts: Evenement[], jour: string): Evenement[] {
  return evts.filter((e) => jourDe(e.debut) === jour).sort(parDebut);
}

/** Le créneau à mettre en avant : celui en cours, sinon le prochain. */
export function aLaUne(evts: Evenement[], maintenant: number): { evenement: Evenement; enCours: boolean } | null {
  const tries = [...evts].sort(parDebut);
  const enCours = tries.find((e) => Date.parse(e.debut) <= maintenant && maintenant < Date.parse(e.fin));
  if (enCours) return { evenement: enCours, enCours: true };
  const prochain = tries.find((e) => Date.parse(e.debut) > maintenant);
  return prochain ? { evenement: prochain, enCours: false } : null;
}

/** Premier jour, strictement après `jour`, où il y a au moins un créneau. */
export function prochainJourAvecCours(evts: Evenement[], jour: string): string | null {
  const jours = evts.map((e) => jourDe(e.debut)).filter((j) => j > jour).sort();
  return jours[0] ?? null;
}

/* ---------- Vue semaine ---------- */

export interface Semaine {
  jours: string[];
  /** Bornes de la grille, en heures pleines. */
  heureDebut: number;
  heureFin: number;
  /** Par jour : les créneaux avec leur colonne quand plusieurs se chevauchent. */
  colonnes: Bloc[][];
}

export interface Bloc {
  evenement: Evenement;
  debutMin: number;
  finMin: number;
  /** Rang (à partir de 0) parmi les créneaux qui se chevauchent, et nombre de voies du groupe. */
  voie: number;
  voies: number;
}

/** Range côte à côte les créneaux qui se chevauchent. */
export function disposer(evts: Evenement[]): Bloc[] {
  const blocs: Bloc[] = [...evts].sort(parDebut).map((e) => {
    const debutMin = minutesDe(e.debut);
    // Un créneau qui finit le lendemain est coupé à minuit.
    const finMin = jourDe(e.fin) === jourDe(e.debut) ? Math.max(minutesDe(e.fin), debutMin + 15) : 24 * 60;
    return { evenement: e, debutMin, finMin, voie: 0, voies: 1 };
  });
  let groupe: Bloc[] = [];
  let finGroupe = -1;
  const cloturer = () => {
    const voies = Math.max(0, ...groupe.map((b) => b.voie)) + 1;
    for (const b of groupe) b.voies = voies;
    groupe = [];
  };
  for (const b of blocs) {
    if (groupe.length && b.debutMin >= finGroupe) cloturer();
    const prises = new Set(groupe.filter((g) => g.finMin > b.debutMin).map((g) => g.voie));
    while (prises.has(b.voie)) b.voie++;
    groupe.push(b);
    finGroupe = Math.max(finGroupe, b.finMin);
  }
  cloturer();
  return blocs;
}

export function semaineDe(evts: Evenement[], lundi: string): Semaine {
  const tous = Array.from({ length: 7 }, (_, i) => ajouterJours(lundi, i));
  const parJour = tous.map((j) => duJour(evts, j));
  // Du lundi au vendredi, plus le samedi ou le dimanche seulement s'il s'y passe quelque chose.
  const dernier = parJour[6].length ? 7 : parJour[5].length ? 6 : 5;
  const colonnes = parJour.slice(0, dernier).map(disposer);
  const blocs = colonnes.flat();
  const heureDebut = Math.min(8, ...blocs.map((b) => Math.floor(b.debutMin / 60)));
  const heureFin = Math.max(18, ...blocs.map((b) => Math.ceil(b.finMin / 60)));
  return { jours: tous.slice(0, dernier), heureDebut, heureFin, colonnes };
}

/** Examens à venir dans les `jours` prochains jours, du plus proche au plus lointain (un par créneau). */
export function examensAVenir(evts: Evenement[], maintenant: number, jours = 45): Evenement[] {
  const limite = maintenant + jours * 86_400_000;
  const vus = new Set<string>();
  return [...evts].sort(parDebut).filter((e) => {
    const t = Date.parse(e.fin);
    if (e.categorie !== 'examen' || t <= maintenant || Date.parse(e.debut) > limite || vus.has(e.cle)) return false;
    vus.add(e.cle);
    return true;
  });
}
