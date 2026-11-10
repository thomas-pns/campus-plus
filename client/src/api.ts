/** Appels au serveur Campus+ et copie des données sur l'appareil (pour l'affichage hors ligne). */
import type { Absence, Alerte, Donnees, Etat, Evenement, Moi, MoyenneCours, Note } from './types';

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

export async function chargerTout(): Promise<Donnees> {
  const [moi, planning, notes, absences, alertes] = await Promise.all([
    appel<Moi>('GET', '/api/moi'),
    appel<{ evenements: Evenement[] }>('GET', '/api/planning'),
    appel<{ notes: Note[]; moyennes: MoyenneCours[] }>('GET', '/api/notes'),
    appel<{ absences: Absence[] }>('GET', '/api/absences'),
    appel<{ alertes: Alerte[] }>('GET', '/api/alertes'),
  ]);
  return {
    moi,
    planning: planning.evenements,
    notes: notes.notes,
    moyennes: notes.moyennes,
    absences: absences.absences,
    alertes: alertes.alertes,
    recuLe: Date.now(),
  };
}

/* ---------- Copie sur l'appareil ---------- */

const CLE = 'campus-plus:donnees:v1';
const CLE_ALERTES_VUES = 'campus-plus:alertes-vues';

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
}

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
