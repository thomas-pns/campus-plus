/** Formes des réponses de l'API du serveur Campus+ (voir server/src). */

export type Categorie =
  | 'cours' | 'td' | 'tp' | 'langues' | 'fhes' | 'examen' | 'sport'
  | 'autonomie' | 'presentation' | 'evenement' | 'reunion' | 'autre';

export interface Evenement {
  id: string;
  cle: string;
  /** ISO avec décalage, heure de Paris : « 2026-11-10T10:30:00+01:00 ». */
  debut: string;
  fin: string;
  categorie: Categorie;
  salles: string[];
  groupe: string;
  matiere: string;
  type: string;
  intervenants: string[];
  remarques: string[];
  /** Pour les examens : la salle de l'élève d'après la répartition par nom, si elle a pu être déduite. */
  salleExamen?: string[] | null;
}

export interface Note {
  semestre: string;
  module: string;
  cours: string;
  epreuve: string;
  coefficient: number | null;
  note: number | null;
  motifAbsence: string;
}

export interface MoyenneCours {
  semestre: string;
  module: string;
  cours: string;
  moyenne: number | null;
  epreuvesNotees: number;
}

export interface Absence {
  date: string;
  motif: string;
  duree: string;
  horaire: string;
  cours: string;
  intervenant: string;
  matiere: string;
}

export interface Alerte {
  id: string;
  type: 'salle' | 'horaire' | 'supprime' | 'ajoute' | 'note' | 'fichier';
  date: string;
  titre: string;
  detail: string;
  cleEvenement?: string;
  /** Cours e-campus concerné (alertes « fichier »). */
  cours?: number;
}

export interface Etat {
  derniereSynchro: string | null;
  derniereTentative: string | null;
  erreur: string | null;
  echecs: number;
}

export interface Moi {
  nom: string;
  aReconnecter: boolean;
  etat: Etat;
}

export interface Fichier {
  cle: string;
  nom: string;
  dossier: string;
  taille: number;
  /** Secondes depuis 1970 (date e-campus). */
  modifie: number;
  type: string;
}

export interface ElementCours {
  id: number;
  nom: string;
  type: string;
  lien: string;
  fichiers: Fichier[];
}

export interface Cours {
  id: number;
  nom: string;
  code: string;
  categorie: string;
  sections: { nom: string; elements: ElementCours[] }[];
}

export interface EtatCours {
  derniereSynchro: string | null;
  erreur: string | null;
  ignores: number;
}

/** Tout ce que l'appli affiche, gardé aussi sur l'appareil pour fonctionner hors ligne. */
export interface Donnees {
  moi: Moi;
  planning: Evenement[];
  notes: Note[];
  moyennes: MoyenneCours[];
  absences: Absence[];
  alertes: Alerte[];
  /** null : le serveur ne gère pas encore les cours. */
  cours: Cours[] | null;
  etatCours: EtatCours | null;
  /** Moment où l'appareil a reçu ces données (ms). */
  recuLe: number;
}
