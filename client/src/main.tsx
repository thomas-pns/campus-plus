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
appliquerTheme();
suivreSysteme();
registerSW({ immediate: true });
render(<App />, document.getElementById('app')!);
