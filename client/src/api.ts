/** Appels au serveur Campus+ et copie des données sur l'appareil (pour l'affichage hors ligne). */
import type { Absence, Alerte, Cours, Donnees, Echeance, Etat, EtatCours, EtatMails, Evenement, Mail, Moi, MoyenneCours, Note, Tache } from './types';

export class ErreurApi extends Error {
  /** `code` : statut HTTP, ou 0 si le serveur est injoignable. */
  constructor(public code: number, message: string) {
    super(message);
  }
}

async function appel<T>(methode: string, url: string, corps?: unknown): Promise<T> {
  let rep: Response;
  try {
    rep = await fetch(url, {
      method: methode,
      credentials: 'same-origin',
      headers: corps === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    });
  } catch {
    throw new ErreurApi(0, 'Serveur injoignable');
  }
  const json = await rep.json().catch(() => null);
  if (!rep.ok) throw new ErreurApi(rep.status, json?.erreur ?? `Erreur ${rep.status}`);
  return json as T;
}

export const connexion = (identifiant: string, motDePasse: string) =>
  appel<{ nom: string; etat: Etat }>('POST', '/api/connexion', { identifiant, motDePasse });
export const deconnexion = () => appel<{ ok: true }>('POST', '/api/deconnexion');
export const supprimerCompte = () => appel<{ ok: true }>('DELETE', '/api/compte');
export const synchroniser = () => appel<{ etat: Etat }>('POST', '/api/synchro');

/** Route absente : le serveur est plus ancien que l'appli. */
const siAbsent = (e: unknown) => {
  if (e instanceof ErreurApi && e.code === 404) return null;
  throw e;
};

export async function chargerTout(): Promise<Donnees> {
  const [moi, planning, notes, absences, alertes, cours, afaire, mails] = await Promise.all([
    appel<Moi>('GET', '/api/moi'),
    appel<{ evenements: Evenement[] }>('GET', '/api/planning'),
    appel<{ notes: Note[]; moyennes: MoyenneCours[] }>('GET', '/api/notes'),
    appel<{ absences: Absence[] }>('GET', '/api/absences'),
    appel<{ alertes: Alerte[] }>('GET', '/api/alertes'),
    appel<{ cours: Cours[]; etat: EtatCours }>('GET', '/api/cours').catch(siAbsent),
    appel<{ echeances: Echeance[]; taches: Tache[] }>('GET', '/api/afaire').catch(siAbsent),
    appel<{ etat: EtatMails; mails: Mail[] }>('GET', '/api/mails').catch(siAbsent),
  ]);
  return {
    moi,
    planning: planning.evenements,
    notes: notes.notes,
    moyennes: notes.moyennes,
    absences: absences.absences,
    alertes: alertes.alertes,
    cours: cours?.cours ?? null,
    etatCours: cours?.etat ?? null,
    afaire,
    mails,
    recuLe: Date.now(),
  };
}

/* ---------- Copie sur l'appareil ---------- */

const CLE = 'campus-plus:donnees:v4';
const CLE_ALERTES_VUES = 'campus-plus:alertes-vues';
const CLE_COURS_VUS = 'campus-plus:fichiers-vus';

/** Clés des fichiers déjà vus sur cet appareil (pour le badge « nouveau »). null : jamais ouvert l'onglet Cours. */
export function fichiersVus(): Set<string> | null {
  try {
    const v = localStorage.getItem(CLE_COURS_VUS);
    return v ? new Set(JSON.parse(v) as string[]) : null;
  } catch {
    return null;
  }
}

export function marquerFichiersVus(cles: string[]): void {
  try {
    localStorage.setItem(CLE_COURS_VUS, JSON.stringify(cles));
  } catch { /* rien à faire */ }
}

export function lireCopie(): Donnees | null {
  try {
    const d = JSON.parse(localStorage.getItem(CLE) ?? 'null') as Donnees | null;
    return d && Array.isArray(d.planning) && d.moi ? d : null;
  } catch {
    return null;
  }
}

export function ecrireCopie(d: Donnees): void {
  try {
    localStorage.setItem(CLE, JSON.stringify(d));
  } catch {
    // Stockage plein ou refusé (navigation privée) : l'appli marche quand même, sans mode hors ligne.
  }
}

/** À la déconnexion : ne rien laisser de personnel sur l'appareil. */
export function viderCopie(): void {
  try {
    localStorage.removeItem(CLE);
    localStorage.removeItem('campus-plus:donnees:v1');
    localStorage.removeItem('campus-plus:donnees:v2');
    localStorage.removeItem('campus-plus:donnees:v3');
    localStorage.removeItem(CLE_COURS_VUS);
    localStorage.removeItem(CLE_ALERTES_VUES);
  } catch { /* rien à faire */ }
}

export function alertesVuesJusqua(): string {
  try {
    return localStorage.getItem(CLE_ALERTES_VUES) ?? '';
  } catch {
    return '';
  }
}

export function marquerAlertesVues(date: string): void {
  try {
    localStorage.setItem(CLE_ALERTES_VUES, date);
  } catch { /* rien à faire */ }
}

/* ---------- Notifications ---------- */

export interface ReglagesNotifications {
  cle: string;
  types: Record<Alerte['type'], boolean>;
  appareils: number;
  /** Rappel avant chaque créneau, en minutes (0 : aucun). Absent sur un serveur plus ancien. */
  rappel?: number;
}

export const changerRappel = (minutes: number) => appel<{ rappel: number }>('PUT', '/api/notifications/rappel', { minutes });
export const lireNotifications = () => appel<ReglagesNotifications>('GET', '/api/notifications');
export const changerTypes = (types: Partial<Record<Alerte['type'], boolean>>) =>
  appel<{ types: ReglagesNotifications['types'] }>('PUT', '/api/notifications/types', types);
export const essaiNotification = () => appel<{ envoyes: number }>('POST', '/api/notifications/essai');

/** Où en sont les notifications sur cet appareil. */
export type EtatAppareil = 'impossible' | 'installer' | 'refusees' | 'actives' | 'inactives';

const surIPhone = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
const installee = () => (navigator as { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches;

export async function etatAppareil(): Promise<EtatAppareil> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
    return surIPhone() && !installee() ? 'installer' : 'impossible';
  }
  if (Notification.permission === 'denied') return 'refusees';
  const reg = await navigator.serviceWorker.getRegistration();
  const ab = await reg?.pushManager.getSubscription();
  return ab && Notification.permission === 'granted' ? 'actives' : 'inactives';
}

const versOctets = (s: string) => {
  const brut = atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(brut, (c) => c.charCodeAt(0));
};

/** Demande l'autorisation (doit suivre un geste de l'utilisateur) et abonne cet appareil. */
export async function activerNotifications(cle: string): Promise<EtatAppareil> {
  if ((await Notification.requestPermission()) !== 'granted') return Notification.permission === 'denied' ? 'refusees' : 'inactives';
  const reg = await navigator.serviceWorker.ready;
  const ab = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: versOctets(cle) }));
  await appel('POST', '/api/notifications/abonnement', { abonnement: ab.toJSON() });
  return 'actives';
}

export async function desactiverNotifications(): Promise<EtatAppareil> {
  const reg = await navigator.serviceWorker.getRegistration();
  const ab = await reg?.pushManager.getSubscription();
  if (ab) {
    await appel('DELETE', '/api/notifications/abonnement', { endpoint: ab.endpoint }).catch(() => undefined);
    await ab.unsubscribe();
  }
  return 'inactives';
}

/* ---------- Affichage choisi pour chaque cours ---------- */

const CLE_AFFICHAGE = 'campus-plus:affichage-cours';
export type Affichage = 'type' | 'prof';

export function affichageCours(id: number): Affichage {
  try {
    return (JSON.parse(localStorage.getItem(CLE_AFFICHAGE) ?? '{}') as Record<string, Affichage>)[id] ?? 'type';
  } catch {
    return 'type';
  }
}

export function choisirAffichage(id: number, a: Affichage): void {
  try {
    const tout = JSON.parse(localStorage.getItem(CLE_AFFICHAGE) ?? '{}') as Record<string, Affichage>;
    localStorage.setItem(CLE_AFFICHAGE, JSON.stringify({ ...tout, [id]: a }));
  } catch { /* rien à faire */ }
}

/* ---------- À faire ---------- */

export const lireAFaire = () => appel<{ echeances: Echeance[]; taches: Tache[] }>('GET', '/api/afaire');
export const ajouterTache = (t: { titre: string; echeance: string | null; cours?: number | null; matiere?: string | null }) => appel<{ tache: Tache }>('POST', '/api/taches', t);
export const changerTache = (id: string, champs: Partial<Pick<Tache, 'titre' | 'echeance' | 'fait'>>) => appel<{ tache: Tache }>('PATCH', `/api/taches/${id}`, champs);
export const supprimerTache = (id: string) => appel<{ ok: true }>('DELETE', `/api/taches/${id}`);
export const marquerEcheance = (id: number, fait: boolean) => appel<{ echeancesFaites: number[] }>('PUT', `/api/echeances/${id}/fait`, { fait });

export const activerMails = (actif: boolean) => appel<{ etat: EtatMails; mails: Mail[] }>('PUT', '/api/mails/actif', { actif });

export const corrigerExpediteur = (adresse: string, categorie: Mail['categorie'] | null) =>
  appel<{ etat: EtatMails; mails: Mail[] }>('PUT', '/api/mails/expediteur', { adresse, categorie });

/* ---------- OneDrive ---------- */

export interface ConnexionOneDrive { code: string; adresse: string; expire: number }
export interface EtatOneDrive {
  actif: boolean;
  compte: string | null;
  derniereSynchro: string | null;
  erreur: string | null;
  copies: number;
  restants: number;
  connexion: ConnexionOneDrive | null;
}

export const lireOneDrive = () =>
  appel<{ disponible: boolean; etat: EtatOneDrive | null }>('GET', '/api/onedrive').catch((e) => siAbsent(e) ?? { disponible: false, etat: null });
export const connecterOneDrive = () => appel<{ connexion: ConnexionOneDrive }>('POST', '/api/onedrive/connexion');
export const annulerOneDrive = () => appel<{ etat: EtatOneDrive }>('DELETE', '/api/onedrive/connexion');
export const copierOneDrive = () => appel<{ etat: EtatOneDrive }>('POST', '/api/onedrive/copie');
export const deconnecterOneDrive = () => appel<{ etat: EtatOneDrive }>('DELETE', '/api/onedrive');
