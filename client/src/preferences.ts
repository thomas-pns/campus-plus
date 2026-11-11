/**
 * Préférences d'affichage. Gardées sur l'appareil pour s'afficher tout de suite, et sur le serveur
 * pour être les mêmes sur le téléphone, l'iPad et l'ordinateur. Le thème reste propre à chaque appareil.
 */
export type Tuile = 'note' | 'fichiers' | 'alertes' | 'aucune';
/** Ancien nom. */
export type TuileGauche = Tuile;

export interface Preferences {
  /** Notes en boosters : la tuile ne montre pas la note, chaque nouvelle note s'ouvre comme un paquet. */
  cacherNote: boolean;
  accueilExamens: boolean;
  accueilAFaire: boolean;
  /** Les deux tuiles en bas de l'accueil, comme des widgets. */
  tuileGauche: Tuile;
  tuileDroite: Tuile;
  /** Photo d'identité MyCPE à la place des initiales. */
  photo: boolean;
  /** Mode branleur (caché) : débloqué, puis activé. */
  branleurDebloque: boolean;
  branleur: boolean;
}

const CLE = 'campus-plus:preferences';
const DEFAUT: Preferences = { cacherNote: false, accueilExamens: true, accueilAFaire: true, tuileGauche: 'note', tuileDroite: 'alertes', photo: false, branleurDebloque: false, branleur: false };

function nettoyer(brut: Record<string, unknown>): Preferences {
  const p = { ...DEFAUT };
  for (const k of Object.keys(DEFAUT) as (keyof Preferences)[]) {
    const v = brut[k];
    if (k === 'tuileGauche' || k === 'tuileDroite') { if (v === 'note' || v === 'fichiers' || v === 'alertes' || v === 'aucune') p[k] = v; }
    else if (typeof v === 'boolean') (p[k] as boolean) = v;
  }
  // Anciennes versions : un seul interrupteur pour la note et les alertes.
  if (brut.accueilTuiles === false && brut.tuileGauche === undefined) { p.tuileGauche = 'aucune'; p.tuileDroite = 'aucune'; }
  if (brut.accueilAlertes === false && brut.tuileDroite === undefined) p.tuileDroite = 'aucune';
  return p;
}

export function lirePreferences(): Preferences {
  try {
    return nettoyer(JSON.parse(localStorage.getItem(CLE) ?? '{}'));
  } catch {
    return DEFAUT;
  }
}

function garder(p: Preferences): void {
  try { localStorage.setItem(CLE, JSON.stringify(p)); } catch { /* rien à faire */ }
}

export function changerPreferences(modif: Partial<Preferences>): Preferences {
  const p = { ...lirePreferences(), ...modif };
  garder(p);
  void fetch('/api/preferences', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(modif) }).catch(() => undefined);
  return p;
}

/** Reprend les préférences enregistrées sur le serveur (choisies sur un autre appareil). */
export async function synchroniserPreferences(): Promise<boolean> {
  try {
    const rep = await fetch('/api/preferences', { credentials: 'same-origin' });
    if (!rep.ok) return false;
    const { preferences } = (await rep.json()) as { preferences: Record<string, unknown> };
    const locales = JSON.parse(localStorage.getItem(CLE) ?? '{}') as Record<string, unknown>;
    if (!Object.keys(preferences).length) {
      // Premier appareil : on envoie ce qui est déjà choisi ici.
      if (Object.keys(locales).length) void fetch('/api/preferences', { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lirePreferences()) });
      return false;
    }
    const avant = JSON.stringify(lirePreferences());
    garder(nettoyer({ ...locales, ...preferences }));
    return JSON.stringify(lirePreferences()) !== avant;
  } catch {
    return false;
  }
}
