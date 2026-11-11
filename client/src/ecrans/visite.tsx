/**
 * Visite guidée : un mot de bienvenue, puis une bulle qui montre chaque élément de l'appli en vrai,
 * onglet après onglet. Proposée au premier lancement, rejouable depuis les réglages.
 */
import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import { Icone } from '../composants';
import { Boosters } from './boosters';
import type { Note } from '../types';

const EXEMPLES: Note[] = [
  { semestre: 'Exemple', module: 'Maths', cours: 'Algèbre linéaire', epreuve: 'Écrit 1', coefficient: 1, note: 16.5, motifAbsence: '' },
  { semestre: 'Exemple', module: 'Info', cours: 'Développement logiciel', epreuve: 'Projet', coefficient: 2, note: 13, motifAbsence: '' },
];

const CLE = 'campus-plus:visite-vue';

export function visiteAFaire(): boolean {
  try { return !localStorage.getItem(CLE); } catch { return false; }
}

function marquerVue(): void {
  try { localStorage.setItem(CLE, '1'); } catch { /* rien à faire */ }
}

export type OngletVisite = 'aujourdhui' | 'planning' | 'cours' | 'alertes' | 'scolarite';

interface Etape {
  onglet: OngletVisite;
  /** Élément montré ; s'il n'existe pas (planning vide…), on passe au repli, puis à la bulle seule. */
  cible: string[];
  titre: string;
  texte: string;
  /** Exemple à essayer pendant la visite. */
  exemple?: 'booster';
}

const ETAPES: Etape[] = [
  { onglet: 'aujourdhui', cible: ['.une'], titre: 'Ton prochain cours', texte: 'En grand, avec sa salle (même quand elle dépend de ton nom). Touche-le pour le détail ou pour y ajouter un devoir.' },
  { onglet: 'aujourdhui', cible: ['[aria-label="Examens à venir"]', '[aria-label="À faire"]'], titre: 'Examens et devoirs', texte: 'Les partiels dès qu’ils sont publiés sur MyCPE, puis tes devoirs e-campus et tes tâches. Coche quand c’est fait.' },
  { onglet: 'aujourdhui', cible: ['.tuiles'], titre: 'Tes widgets', texte: 'Notes, nouveaux fichiers ou alertes, au choix dans les réglages. Avec « Notes en boosters », chaque nouvelle note s’ouvre comme un paquet de cartes.', exemple: 'booster' },
  { onglet: 'planning', cible: ['.segments'], titre: 'Planning', texte: 'Jour, semaine ou mois. Les flèches font avancer ou reculer, et « Aujourd’hui » te ramène à la date du jour.' },
  { onglet: 'cours', cible: ['.bloc .carte.liste', '.onglets button:nth-child(3)'], titre: 'Cours', texte: 'Tous tes fichiers e-campus. Ouvre un cours : ils sont rangés par type (cours, TD, TP, annales), et tu peux y créer un devoir.' },
  { onglet: 'alertes', cible: ['.segments button:first-child', '.segments'], titre: 'Boîte : les alertes', texte: 'Tout ce qui change : salle, horaire, nouvelle note, nouveau fichier, examen. Les mêmes que les notifications.' },
  { onglet: 'alertes', cible: ['.segments button:nth-child(2)', '.segments'], titre: 'Boîte : tes mails', texte: 'Tes mails PARTAGE, triés : profs et école en premier, avec les salles, examens et devoirs repérés. À activer ici ; tu peux corriger un expéditeur mal classé.' },
  { onglet: 'scolarite', cible: ['.onglets button:nth-child(5)'], titre: 'Scolarité', texte: 'Tes notes, tes moyennes par matière et tes absences.' },
  { onglet: 'aujourdhui', cible: ['.avatar'], titre: 'Réglages', texte: 'Notifications, thème sombre, OneDrive… et cette visite, si tu veux la revoir. Bonne rentrée !' },
];

interface Cadre { haut: number; gauche: number; largeur: number; hauteur: number }

/** Attend que l'élément visé soit affiché (changement d'onglet), puis le fait défiler à l'écran. */
function useCible(etape: Etape | null, cle: number): Cadre | null {
  const [cadre, setCadre] = useState<Cadre | null>(null);
  useLayoutEffect(() => {
    setCadre(null);
    if (!etape) return;
    let element: Element | null = null;
    let fini = false;
    const mesurer = () => {
      const app = document.getElementById('app');
      if (!element || !app || !element.isConnected) return;
      const a = app.getBoundingClientRect();
      const r = element.getBoundingClientRect();
      setCadre({ haut: r.top - a.top, gauche: r.left - a.left, largeur: r.width, hauteur: r.height });
    };
    let essais = 0;
    const chercher = () => {
      if (fini) return;
      element = etape.cible.map((c) => document.querySelector(`#app ${c}`)).find((e) => e && e.getBoundingClientRect().height > 0) ?? null;
      if (!element && essais++ < 30) { setTimeout(chercher, 50); return; }
      if (!element) return;
      element.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
      requestAnimationFrame(mesurer);
    };
    chercher();
    window.addEventListener('resize', mesurer);
    document.addEventListener('scroll', mesurer, true);
    return () => {
      fini = true;
      window.removeEventListener('resize', mesurer);
      document.removeEventListener('scroll', mesurer, true);
    };
  }, [etape, cle]);
  return cadre;
}

export function Visite({ surFin, surAller }: { surFin: () => void; surAller: (o: OngletVisite) => void }) {
  // -1 : mot de bienvenue ; ensuite, index de l'étape.
  const [i, setI] = useState(-1);
  const [exemple, setExemple] = useState(false);
  const etape = i >= 0 ? ETAPES[i] : null;
  const cadre = useCible(etape, i);
  const finir = () => { marquerVue(); surAller('aujourdhui'); surFin(); };

  useEffect(() => { if (etape) surAller(etape.onglet); }, [i]);
  useEffect(() => {
    const touche = (ev: KeyboardEvent) => { if (ev.key === 'Escape') finir(); };
    window.addEventListener('keydown', touche);
    return () => window.removeEventListener('keydown', touche);
  }, []);

  if (!etape) {
    return (
      <div class="voile centre" role="dialog" aria-modal="true" aria-labelledby="visite-titre">
        <div class="visite">
          <span class="visite-icone"><Icone nom="soleil" taille={30} epaisseur={2} /></span>
          <h2 id="visite-titre">Bienvenue sur Campus+</h2>
          <p>Ton planning, tes notes, tes cours et tes mails de CPE au même endroit. On fait le tour en 30 secondes ?</p>
          <button type="button" class="bouton" onClick={() => setI(0)}>Commencer la visite</button>
          <button type="button" class="lien-bouton" onClick={finir}>Plus tard</button>
        </div>
      </div>
    );
  }

  const derniere = i === ETAPES.length - 1;
  const marge = 6;
  // Bulle sous l'élément s'il est dans la moitié haute de l'écran, au-dessus sinon.
  const hauteurApp = document.getElementById('app')?.clientHeight ?? window.innerHeight;
  const dessous = !cadre || cadre.haut + cadre.hauteur / 2 < hauteurApp / 2;
  const styleBulle = !cadre ? { top: '50%', transform: 'translateY(-50%)' }
    : dessous ? { top: `${Math.min(cadre.haut + cadre.hauteur + marge + 10, hauteurApp - 220)}px` }
    : { bottom: `${Math.max(hauteurApp - cadre.haut + marge + 10, 12)}px` };

  return (
    <div class="visite-calque" role="dialog" aria-modal="true" aria-labelledby="visite-titre" aria-describedby="visite-texte">
      {cadre ? (
        <div class="visite-trou" style={{ top: `${cadre.haut - marge}px`, left: `${cadre.gauche - marge}px`, width: `${cadre.largeur + 2 * marge}px`, height: `${cadre.hauteur + 2 * marge}px` }} />
      ) : <div class="visite-fond" />}
      {exemple && <Boosters demo notes={EXEMPLES} surFin={() => setExemple(false)} />}
      <div class="visite-bulle" style={styleBulle} key={i}>
        <p class="visite-etape">{i + 1} / {ETAPES.length}</p>
        <h2 id="visite-titre">{etape.titre}</h2>
        <p id="visite-texte">{etape.texte}</p>
        <div class="visite-actions">
          {!derniere && <button type="button" class="lien-bouton" onClick={finir}>Passer</button>}
          {etape.exemple === 'booster' && <button type="button" class="bouton secondaire petit" onClick={() => setExemple(true)}>Voir un exemple</button>}
          {i > 0 && !etape.exemple && <button type="button" class="bouton secondaire petit" onClick={() => setI(i - 1)}>Retour</button>}
          <button type="button" class="bouton petit" onClick={derniere ? finir : () => setI(i + 1)}>{derniere ? 'Terminer' : 'Suivant'}</button>
        </div>
      </div>
    </div>
  );
}
