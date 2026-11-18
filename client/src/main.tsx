import { render } from 'preact';
import { registerSW } from 'virtual:pwa-register';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/inter/latin-800.css';
import './style.css';
import { App } from './app';
import { appliquerTheme, suivreSysteme } from './theme';

// Appli installée sur l'écran d'accueil : la classe sert aux réglages d'affichage propres à ce mode.
if ((navigator as { standalone?: boolean }).standalone || matchMedia('(display-mode: standalone)').matches) {
  document.documentElement.classList.add('standalone');
}
// Comme une appli : pas de zoom de toute la page (pincement ou double appui) ; le lecteur PDF a son propre zoom.
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => { if (!(e.target as Element).closest?.('input, textarea')) e.preventDefault(); }, { passive: false });
appliquerTheme();
suivreSysteme();
registerSW({ immediate: true });
render(<App />, document.getElementById('app')!);

// iOS (appli installée) : après un passage paysage → portrait, la hauteur de l'écran reste parfois l'ancienne
// et la barre d'onglets remonte. On remesure la vraie hauteur, plusieurs fois car iOS la met à jour en retard.
function ajusterHauteur(): void {
  document.documentElement.style.setProperty('--hauteur-app', `${window.innerHeight}px`);
  if (window.scrollY || document.documentElement.scrollTop) window.scrollTo(0, 0);
}
ajusterHauteur();
window.addEventListener('resize', ajusterHauteur);
const apresRotation = () => { for (const t of [60, 250, 600, 1200]) setTimeout(ajusterHauteur, t); };
window.addEventListener('orientationchange', apresRotation);
screen.orientation?.addEventListener?.('change', apresRotation);
document.addEventListener('visibilitychange', () => { if (!document.hidden) apresRotation(); });
