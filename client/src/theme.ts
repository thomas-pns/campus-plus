/** Thème de l'appli : automatique (réglage du téléphone), clair ou sombre. Gardé sur l'appareil. */
export type Theme = 'auto' | 'clair' | 'sombre';
const CLE = 'campus-plus:theme';

export function lireTheme(): Theme {
  try {
    const t = localStorage.getItem(CLE);
    return t === 'clair' || t === 'sombre' ? t : 'auto';
  } catch {
    return 'auto';
  }
}

/** Applique le thème à la page, y compris la couleur de la barre d'état. */
export function appliquerTheme(t: Theme = lireTheme()): void {
  const racine = document.documentElement;
  if (t === 'auto') delete racine.dataset.theme;
  else racine.dataset.theme = t;
  const sombre = t === 'sombre' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', sombre ? '#0E1218' : '#F2F4F8');
}

export function choisirTheme(t: Theme): void {
  try {
    if (t === 'auto') localStorage.removeItem(CLE);
    else localStorage.setItem(CLE, t);
  } catch { /* rien à faire */ }
  appliquerTheme(t);
}

/** Suit les changements du réglage du téléphone quand le thème est automatique. */
export function suivreSysteme(): void {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => appliquerTheme());
}
