/** Préférences d'affichage gardées sur l'appareil. */
export interface Preferences {
  /** Cache la valeur de la dernière note sur l'accueil (pas de spoil). */
  cacherNote: boolean;
}

const CLE = 'campus-plus:preferences';
const DEFAUT: Preferences = { cacherNote: false };

export function lirePreferences(): Preferences {
  try {
    return { ...DEFAUT, ...JSON.parse(localStorage.getItem(CLE) ?? '{}') };
  } catch {
    return DEFAUT;
  }
}

export function changerPreferences(modif: Partial<Preferences>): Preferences {
  const p = { ...lirePreferences(), ...modif };
  try { localStorage.setItem(CLE, JSON.stringify(p)); } catch { /* rien à faire */ }
  return p;
}
