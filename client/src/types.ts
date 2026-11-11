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
  type: 'salle' | 'horaire' | 'supprime' | 'ajoute' | 'note' | 'fichier' | 'devoir' | 'mail' | 'examen';
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
  /** Copie des fichiers en cours sur le serveur. */
  progression?: { faits: number; total: number } | null;
}

export interface Echeance {
  id: number;
  nom: string;
  /** assign (devoir), quiz (test)… */
  module: string;
  cours: number;
  nomCours: string;
  /** Date limite, secondes depuis 1970. */
  date: number;
  action: string;
  lien: string;
  enRetard: boolean;
  fait: boolean;
}

export interface Tache {
  id: string;
  titre: string;
  /** « AAAA-MM-JJ » ou null. */
  echeance: string | null;
  cours: number | null;
  matiere?: string | null;
  fait: boolean;
  creeLe: string;
}

export type EtiquetteMail = 'salle' | 'annulation' | 'examen' | 'devoir' | 'cours';

export interface Mail {
  id: string;
  /** Date de réception (ms). */
  date: number;
  de: string;
  adresse: string;
  sujet: string;
  extrait: string;
  categorie: 'prof' | 'ecole' | 'autre';
  etiquettes: EtiquetteMail[];
  matiere: string | null;
  /** Texte du mail (profs et école seulement), sans la signature ni l'historique. */
  texte?: string;
  lien: string;
  /** Clé de l'expéditeur pour les corrections. */
  expediteur?: string;
  /** Vrai si la catégorie vient d'un choix de l'élève pour cet expéditeur. */
  corrige?: boolean;
  nonLu?: boolean;
}

export interface EtatMails {
  actif: boolean;
  derniereSynchro: string | null;
  erreur: string | null;
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
  /** null : le serveur ne gère pas encore les devoirs. */
  afaire: { echeances: Echeance[]; taches: Tache[] } | null;
  /** null : le serveur ne gère pas encore les mails. */
  mails: { etat: EtatMails; mails: Mail[] } | null;
  /** Moment où l'appareil a reçu ces données (ms). */
  recuLe: number;
}
