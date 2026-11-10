/**
 * Dates et heures. Les créneaux arrivent en heure de Paris (« 2026-11-10T10:30:00+01:00 ») :
 * on affiche toujours l'heure écrite dans la chaîne, même si le téléphone est sur un autre fuseau.
 * Un « jour » est une chaîne « AAAA-MM-JJ ».
 */

export const jourDe = (iso: string) => iso.slice(0, 10);
export const heureDe = (iso: string) => iso.slice(11, 16);
export const minutesDe = (iso: string) => Number(iso.slice(11, 13)) * 60 + Number(iso.slice(14, 16));

const PARIS = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });

/** Le jour qu'il est à Paris à cet instant. */
export function jourParis(instant: number): string {
  const p = Object.fromEntries(PARIS.formatToParts(instant).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

const enUTC = (jour: string) => {
  const [a, m, j] = jour.split('-').map(Number);
  return Date.UTC(a, m - 1, j);
};

export function ajouterJours(jour: string, n: number): string {
  return new Date(enUTC(jour) + n * 86_400_000).toISOString().slice(0, 10);
}

/** 0 = lundi … 6 = dimanche. */
export const rangDansSemaine = (jour: string) => (new Date(enUTC(jour)).getUTCDay() + 6) % 7;
export const lundiDe = (jour: string) => ajouterJours(jour, -rangDansSemaine(jour));

/** Numéro de semaine ISO. */
export function numeroSemaine(jour: string): number {
  const jeudi = enUTC(ajouterJours(lundiDe(jour), 3));
  const premierJanvier = Date.UTC(new Date(jeudi).getUTCFullYear(), 0, 1);
  return Math.floor((jeudi - premierJanvier) / (7 * 86_400_000)) + 1;
}

export function libelleJour(jour: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat('fr-FR', { ...options, timeZone: 'UTC' }).format(enUTC(jour));
}

const majuscule = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** « Mardi 10 novembre ». */
export const jourEnToutesLettres = (jour: string) => majuscule(libelleJour(jour, { weekday: 'long', day: 'numeric', month: 'long' }));

/** « dans 50 min », « dans 2 h 10 », « dans 3 j ». */
export function dans(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'dans un instant';
  if (min < 60) return `dans ${min} min`;
  if (min < 24 * 60) {
    const h = Math.floor(min / 60);
    const reste = min % 60;
    return reste ? `dans ${h} h ${String(reste).padStart(2, '0')}` : `dans ${h} h`;
  }
  return `dans ${Math.round(min / (24 * 60))} j`;
}

/** « à l'instant », « il y a 12 min », « il y a 3 h », « il y a 2 j ». */
export function ilYA(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  if (min < 24 * 60) return `il y a ${Math.floor(min / 60)} h`;
  return `il y a ${Math.floor(min / (24 * 60))} j`;
}

/** WebAurion écrit « Prénom NOM » : le prénom est ce qui n'est pas en capitales. */
export function prenomDe(nom: string): string {
  const mots = nom.trim().split(/\s+/).filter(Boolean);
  const prenom = mots.filter((m) => m !== m.toUpperCase() || m.length === 1);
  return (prenom.length ? prenom : mots.slice(0, 1)).join(' ');
}

export function initialesDe(nom: string): string {
  const mots = nom.trim().split(/\s+/).filter(Boolean);
  if (!mots.length) return '?';
  const famille = mots.find((m) => m.length > 1 && m === m.toUpperCase()) ?? mots[mots.length - 1];
  const premier = mots[0];
  return (premier === famille ? premier.charAt(0) : premier.charAt(0) + famille.charAt(0)).toUpperCase();
}
