/**
 * Lecteur de fichiers dans l'appli : PDF affichés page par page (pdf.js), images, et pour le reste
 * (diapos, Word…) les boutons pour les ouvrir dans une autre appli. Toujours avec un bouton « Fermer » :
 * sur iPhone, une appli installée n'a pas de bouton retour, et ouvrir le fichier directement y coinçait l'élève.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import type { Fichier } from '../types';
import { Icone } from '../composants';
import { taille, typeFichier } from '../cours';

/** Un fichier de cours, ou un document servi ailleurs (certificat MyCPE) quand `adresse` est donnée. */
export type FichierLu = Fichier & { adresse?: string };
export const adresseFichier = (f: FichierLu) => f.adresse ?? `/api/fichiers/${f.cle}`;

/** iPhone et iPad : « télécharger » ouvre le fichier au lieu de l'enregistrer ; on passe par le menu de partage. */
export const surIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const partageDisponible = () => typeof navigator.share === 'function' && typeof navigator.canShare === 'function';

/** Taille au-delà de laquelle on ne prépare pas le fichier d'avance (il n'est pas gardé sur le serveur). */
const PREPARATION_MAX = 60 * 1024 * 1024;

/**
 * Prépare le fichier pour le menu de partage du téléphone. Sur iPhone, le partage doit suivre
 * directement un appui : le fichier est donc chargé avant, dès l'ouverture du panneau ou du lecteur.
 */
export function usePartage(f: FichierLu) {
  const [fichier, setFichier] = useState<File | null>(null);
  const [etat, setEtat] = useState<'' | 'preparation' | 'erreur'>('');
  const preparer = async () => {
    setEtat('preparation');
    try {
      const rep = await fetch(adresseFichier(f), { credentials: 'same-origin' });
      if (!rep.ok) throw new Error();
      const blob = await rep.blob();
      const pret = new File([blob], f.nom, { type: blob.type || f.type || 'application/octet-stream' });
      setFichier(pret);
      setEtat('');
      return pret;
    } catch {
      setEtat('erreur');
      return null;
    }
  };
  // Un document généré à la demande (certificat) n'est préparé qu'au moment du partage.
  useEffect(() => { if (partageDisponible() && !f.adresse && f.taille <= PREPARATION_MAX) void preparer(); }, [f.cle]);

  const partager = async () => {
    const pret = fichier ?? (await preparer());
    if (!pret) return;
    if (!navigator.canShare({ files: [pret] })) { enregistrer(f); return; }
    try {
      await navigator.share({ files: [pret], title: f.nom });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setEtat('erreur');
    }
  };
  return { partager, etat, pret: !!fichier };
}

/** Téléchargement classique (ordinateur, Android). */
export function enregistrer(f: FichierLu): void {
  const a = document.createElement('a');
  a.href = f.adresse ?? `${adresseFichier(f)}?telecharger=1`;
  a.download = f.nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 4;
const borner = (z: number) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100));

/**
 * Zoom à deux doigts dans le lecteur, sans zoomer toute l'appli : pendant le geste, les pages sont
 * agrandies à l'image (rapide) ; au lâcher, elles sont redessinées nettes à la bonne taille et le point
 * entre les doigts reste en place.
 */
function usePincement(ref: { current: HTMLDivElement | null }, actif: boolean, zoom: number, setZoom: (z: number) => void, surGlisser?: (sens: 1 | -1) => void) {
  const glisser = useRef(surGlisser);
  glisser.current = surGlisser;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const ancre = useRef<{ x: number; y: number; z: number } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !actif) return;
    let depart: { d: number; x: number; y: number } | null = null;
    let echelle = 1;
    const pages = () => el.querySelector<HTMLElement>('.pdf-pages');
    const distance = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    let unDoigt: { x: number; y: number; t: number } | null = null;
    let dernierAppui = 0;
    const debut = (ev: TouchEvent) => {
      if (ev.touches.length === 1) unDoigt = { x: ev.touches[0].clientX, y: ev.touches[0].clientY, t: Date.now() };
      if (ev.touches.length !== 2) return;
      unDoigt = null;
      const r = el.getBoundingClientRect();
      depart = { d: distance(ev.touches), x: (ev.touches[0].clientX + ev.touches[1].clientX) / 2 - r.left, y: (ev.touches[0].clientY + ev.touches[1].clientY) / 2 - r.top };
      echelle = 1;
    };
    const bouge = (ev: TouchEvent) => {
      if (!depart || ev.touches.length !== 2) return;
      ev.preventDefault();
      echelle = borner(zoomRef.current * (distance(ev.touches) / depart.d)) / zoomRef.current;
      const p = pages();
      if (p) {
        p.style.transformOrigin = `${el.scrollLeft + depart.x}px ${el.scrollTop + depart.y}px`;
        p.style.transform = `scale(${echelle})`;
      }
    };
    const fin = (ev?: TouchEvent) => {
      if (!depart) {
        // Un doigt : double appui pour zoomer ×2 (ou revenir), glissement horizontal pour tourner la page.
        const t = ev?.changedTouches?.[0];
        if (unDoigt && t) {
          const dx = t.clientX - unDoigt.x, dy = t.clientY - unDoigt.y;
          if (Math.abs(dx) < 10 && Math.abs(dy) < 10 && Date.now() - unDoigt.t < 250) {
            if (Date.now() - dernierAppui < 320) { setZoom(zoomRef.current > 1 ? 1 : 2); dernierAppui = 0; }
            else dernierAppui = Date.now();
          } else if (glisser.current && zoomRef.current === 1 && Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) {
            glisser.current(dx < 0 ? 1 : -1);
          }
        }
        unDoigt = null;
        return;
      }
      const p = pages();
      if (p) { p.style.transform = ''; p.style.transformOrigin = ''; }
      const nouveau = borner(zoomRef.current * echelle);
      if (nouveau !== zoomRef.current) {
        // Point du document sous les doigts, à remettre au même endroit après le nouveau rendu.
        ancre.current = { x: (el.scrollLeft + depart.x) * (nouveau / zoomRef.current) - depart.x, y: (el.scrollTop + depart.y) * (nouveau / zoomRef.current) - depart.y, z: nouveau };
        setZoom(nouveau);
      }
      depart = null;
    };
    // Safari : empêche le zoom de toute la page pendant le geste.
    const geste = (ev: Event) => ev.preventDefault();
    el.addEventListener('touchstart', debut, { passive: true });
    el.addEventListener('touchmove', bouge, { passive: false });
    el.addEventListener('touchend', fin);
    el.addEventListener('touchcancel', fin);
    el.addEventListener('gesturestart', geste);
    el.addEventListener('gesturechange', geste);
    return () => {
      el.removeEventListener('touchstart', debut);
      el.removeEventListener('touchmove', bouge);
      el.removeEventListener('touchend', fin);
      el.removeEventListener('touchcancel', fin);
      el.removeEventListener('gesturestart', geste);
      el.removeEventListener('gesturechange', geste);
    };
  }, [actif]);

  useLayoutEffect(() => {
    const a = ancre.current;
    const el = ref.current;
    if (!a || !el || a.z !== zoom) return;
    el.scrollLeft = a.x;
    el.scrollTop = a.y;
    ancre.current = null;
  }, [zoom]);
}

const estPdf = (f: Fichier) => f.type === 'application/pdf' || /\.pdf$/i.test(f.nom);
const estImage = (f: Fichier) => /^image\/(png|jpe?g|gif|webp)$/.test(f.type) || /\.(png|jpe?g|gif|webp)$/i.test(f.nom);

export function Lecteur({ f, surFermer }: { f: FichierLu; surFermer: () => void }) {
  const { partager, etat } = usePartage(f);
  const [zoom, setZoom] = useState(1);
  // « Défiler » : toutes les pages à la suite ; « Page » : une page à la fois, on glisse pour tourner.
  const [parPage, setParPage] = useState(() => { try { return localStorage.getItem('campus-plus:lecteur') === 'page'; } catch { return false; } });
  const [pageCourante, setPageCourante] = useState(0);
  const changerMode = () => {
    const v = !parPage;
    setParPage(v);
    setZoom(1);
    if (page) setPageCourante(page.n - 1);
    try { localStorage.setItem('campus-plus:lecteur', v ? 'page' : 'defiler'); } catch { /* rien */ }
  };
  useEffect(() => {
    const touche = (ev: KeyboardEvent) => ev.key === 'Escape' && surFermer();
    document.addEventListener('keydown', touche);
    return () => document.removeEventListener('keydown', touche);
  }, []);
  const ios = surIOS();
  const pdf = estPdf(f);
  const corps = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState<{ n: number; total: number } | null>(null);
  usePincement(corps, pdf, zoom, setZoom, parPage ? (sens) => setPageCourante((n) => Math.max(0, Math.min((page?.total ?? 1) - 1, n + sens))) : undefined);

  return createPortal(
    <div class="lecteur" role="dialog" aria-modal="true" aria-label={f.nom}>
      <header class="lecteur-haut">
        <button type="button" class="lecteur-bouton" onClick={surFermer}><Icone nom="gauche" taille={20} epaisseur={2.4} />Fermer</button>
        <span class="lecteur-titre">{f.nom}</span>
        {pdf && (
          <button type="button" class="lecteur-bouton petit-texte-bouton" onClick={changerMode} aria-label={parPage ? 'Afficher toutes les pages à la suite' : 'Afficher page par page'}>
            {parPage ? 'Défiler' : 'Pages'}
          </button>
        )}
        {pdf && (
          <span class="lecteur-zoom">
            <button type="button" class="lecteur-bouton" aria-label="Dézoomer" disabled={zoom <= ZOOM_MIN} onClick={() => setZoom(borner(zoom / 1.5))}>−</button>
            <button type="button" class="lecteur-bouton" aria-label="Zoomer" disabled={zoom >= ZOOM_MAX} onClick={() => setZoom(borner(zoom * 1.5))}>+</button>
          </span>
        )}
        {partageDisponible() ? (
          <button type="button" class="lecteur-bouton" aria-label="Partager ou enregistrer" disabled={etat === 'preparation'} onClick={() => void partager()}>
            <Icone nom="partager" taille={20} epaisseur={2.2} />
          </button>
        ) : (
          <button type="button" class="lecteur-bouton" aria-label="Enregistrer" onClick={() => enregistrer(f)}>
            <Icone nom="telecharger" taille={20} epaisseur={2.2} />
          </button>
        )}
      </header>
      <div class="lecteur-corps" ref={corps}>
        {pdf ? <Pdf f={f} zoom={zoom} surPage={setPage} parPage={parPage} pageCourante={pageCourante} surTourner={setPageCourante} /> : estImage(f) ? (
          <img class="lecteur-image" src={adresseFichier(f)} alt={f.nom} />
        ) : (
          <div class="lecteur-autre">
            <span class="vignette grande c-examen" aria-hidden="true"><Icone nom="fichier" taille={30} /></span>
            <h2>{f.nom}</h2>
            <p>{typeFichier(f) || 'Fichier'} · {taille(f.taille)}</p>
            <p class="petit-texte">Pas d’aperçu dans Campus+ pour ce type de fichier. {partageDisponible() ? '« Ouvrir avec… » le propose à PowerPoint, Word, Keynote, Fichiers…' : ''}</p>
            {partageDisponible() && (
              <button type="button" class="bouton large" disabled={etat === 'preparation'} onClick={() => void partager()}>
                <Icone nom="partager" taille={18} epaisseur={2.4} />&nbsp;{etat === 'preparation' ? 'Préparation…' : 'Ouvrir avec…'}
              </button>
            )}
            {!ios && <button type="button" class="bouton secondaire large" onClick={() => enregistrer(f)}><Icone nom="telecharger" taille={18} epaisseur={2.4} />&nbsp;Enregistrer</button>}
          </div>
        )}
      </div>
      {pdf && page && page.total > 1 && <span class="lecteur-page" aria-live="polite">{page.n} / {page.total}</span>}
      {etat === 'erreur' && <p class="lecteur-erreur">Le fichier n’a pas pu être préparé : réessaie, ou vérifie ta connexion.</p>}
    </div>,
    document.getElementById('app') ?? document.body,
  );
}

type DocPdf = { numPages: number; getPage: (n: number) => Promise<PagePdf>; destroy: () => Promise<void> };
type PagePdf = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }) => { promise: Promise<void>; cancel: () => void };
};

/** PDF page par page : chaque page n'est dessinée que lorsqu'elle approche de l'écran. */
function Pdf({ f, zoom, surPage, parPage, pageCourante, surTourner }: { f: FichierLu; zoom: number; surPage: (p: { n: number; total: number }) => void; parPage: boolean; pageCourante: number; surTourner: (n: number) => void }) {
  const [doc, setDoc] = useState<DocPdf | null>(null);
  const [formats, setFormats] = useState<number[]>([]);
  const [erreur, setErreur] = useState(false);

  useEffect(() => {
    let annule = false;
    let charge: DocPdf | null = null;
    (async () => {
      const pdfjs = await import('pdfjs-dist');
      const { default: worker } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = worker;
      charge = (await pdfjs.getDocument({ url: adresseFichier(f), withCredentials: true, isEvalSupported: false }).promise) as unknown as DocPdf;
      if (annule) return void charge.destroy();
      // Format de chaque page (hauteur / largeur), pour réserver la place avant de dessiner.
      const f2: number[] = [];
      for (let n = 1; n <= charge.numPages; n++) {
        const v = (await charge.getPage(n)).getViewport({ scale: 1 });
        f2.push(v.height / v.width);
      }
      if (annule) return;
      setFormats(f2);
      setDoc(charge);
    })().catch(() => !annule && setErreur(true));
    return () => { annule = true; void charge?.destroy(); };
  }, [f.cle]);

  if (erreur) return <p class="lecteur-message">Ce PDF n’a pas pu être affiché. Utilise le bouton de partage pour l’ouvrir dans une autre appli.</p>;
  if (!doc) return <div class="lecteur-message"><div class="progression"><span class="indetermine" /></div><p>Ouverture du PDF…</p></div>;
  return (
    parPage ? (
      <div class="pdf-pages pdf-une-page" style={{ width: `${zoom * 100}%` }}>
        {(() => {
          const i = Math.min(pageCourante, formats.length - 1);
          return <PagePdfVue key={i} doc={doc} n={i + 1} ratio={formats[i]} zoom={zoom} surVue={() => surPage({ n: i + 1, total: formats.length })} />;
        })()}
        <div class="pdf-tourner">
          <button type="button" class="rond" aria-label="Page précédente" disabled={pageCourante <= 0} onClick={() => surTourner(pageCourante - 1)}><Icone nom="gauche" taille={20} epaisseur={2.4} /></button>
          <button type="button" class="rond" aria-label="Page suivante" disabled={pageCourante >= formats.length - 1} onClick={() => surTourner(pageCourante + 1)}><Icone nom="droite" taille={20} epaisseur={2.4} /></button>
        </div>
      </div>
    ) :
    <div class="pdf-pages" style={{ width: `${zoom * 100}%` }}>
      {formats.map((r, i) => <PagePdfVue doc={doc} n={i + 1} ratio={r} zoom={zoom} surVue={() => surPage({ n: i + 1, total: formats.length })} />)}
    </div>
  );
}

function PagePdfVue({ doc, n, ratio, zoom, surVue }: { doc: DocPdf; n: number; ratio: number; zoom: number; surVue: () => void }) {
  const boite = useRef<HTMLDivElement>(null);
  const toile = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = boite.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '600px 0px' });
    obs.observe(el);
    // Numéro de page affiché : celle qui occupe le milieu de l'écran.
    const milieu = new IntersectionObserver(([e]) => { if (e.isIntersecting) surVue(); }, { rootMargin: '-50% 0px -50% 0px' });
    milieu.observe(el);
    return () => { obs.disconnect(); milieu.disconnect(); };
  }, []);

  useEffect(() => {
    if (!visible || !toile.current || !boite.current) return;
    let tache: { cancel: () => void } | null = null;
    let annule = false;
    (async () => {
      const page = await doc.getPage(n);
      if (annule || !toile.current || !boite.current) return;
      const largeur = boite.current.clientWidth;
      const base = page.getViewport({ scale: 1 });
      // Netteté de l'écran, sans dépasser ~8 millions de pixels par page (limite des iPhone).
      const echelle = Math.min((largeur * Math.min(window.devicePixelRatio || 1, 3)) / base.width, Math.sqrt(8e6 / (base.width * base.height)));
      const vue = page.getViewport({ scale: echelle });
      const c = toile.current;
      c.width = Math.floor(vue.width);
      c.height = Math.floor(vue.height);
      const r = page.render({ canvasContext: c.getContext('2d')!, viewport: vue });
      tache = r;
      await r.promise.catch(() => undefined);
    })();
    return () => {
      annule = true;
      tache?.cancel();
      // Libère la mémoire des pages éloignées (gros PDF sur téléphone).
      if (toile.current) { toile.current.width = 0; toile.current.height = 0; }
    };
  }, [visible, zoom]);

  return (
    <div class="pdf-page" ref={boite} style={{ aspectRatio: `1 / ${ratio}` }}>
      <canvas ref={toile} aria-label={`Page ${n}`} />
    </div>
  );
}
