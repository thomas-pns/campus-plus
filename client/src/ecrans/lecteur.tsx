/**
 * Lecteur de fichiers dans l'appli : PDF affichés page par page (pdf.js), images, et pour le reste
 * (diapos, Word…) les boutons pour les ouvrir dans une autre appli. Toujours avec un bouton « Fermer » :
 * sur iPhone, une appli installée n'a pas de bouton retour, et ouvrir le fichier directement y coinçait l'élève.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import type { Fichier } from '../types';
import { Icone } from '../composants';
import { taille, typeFichier } from '../cours';

export const adresseFichier = (f: Fichier) => `/api/fichiers/${f.cle}`;

/** iPhone et iPad : « télécharger » ouvre le fichier au lieu de l'enregistrer ; on passe par le menu de partage. */
export const surIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const partageDisponible = () => typeof navigator.share === 'function' && typeof navigator.canShare === 'function';

/** Taille au-delà de laquelle on ne prépare pas le fichier d'avance (il n'est pas gardé sur le serveur). */
const PREPARATION_MAX = 60 * 1024 * 1024;

/**
 * Prépare le fichier pour le menu de partage du téléphone. Sur iPhone, le partage doit suivre
 * directement un appui : le fichier est donc chargé avant, dès l'ouverture du panneau ou du lecteur.
 */
export function usePartage(f: Fichier) {
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
  useEffect(() => { if (partageDisponible() && f.taille <= PREPARATION_MAX) void preparer(); }, [f.cle]);

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
export function enregistrer(f: Fichier): void {
  const a = document.createElement('a');
  a.href = `${adresseFichier(f)}?telecharger=1`;
  a.download = f.nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

const estPdf = (f: Fichier) => f.type === 'application/pdf' || /\.pdf$/i.test(f.nom);
const estImage = (f: Fichier) => /^image\/(png|jpe?g|gif|webp)$/.test(f.type) || /\.(png|jpe?g|gif|webp)$/i.test(f.nom);

export function Lecteur({ f, surFermer }: { f: Fichier; surFermer: () => void }) {
  const { partager, etat } = usePartage(f);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const touche = (ev: KeyboardEvent) => ev.key === 'Escape' && surFermer();
    document.addEventListener('keydown', touche);
    return () => document.removeEventListener('keydown', touche);
  }, []);
  const ios = surIOS();
  const pdf = estPdf(f);

  return createPortal(
    <div class="lecteur" role="dialog" aria-modal="true" aria-label={f.nom}>
      <header class="lecteur-haut">
        <button type="button" class="lecteur-bouton" onClick={surFermer}><Icone nom="gauche" taille={20} epaisseur={2.4} />Fermer</button>
        <span class="lecteur-titre">{f.nom}</span>
        {pdf && (
          <span class="lecteur-zoom">
            <button type="button" class="lecteur-bouton" aria-label="Dézoomer" disabled={zoom <= 1} onClick={() => setZoom(Math.max(1, zoom - 0.5))}>−</button>
            <button type="button" class="lecteur-bouton" aria-label="Zoomer" disabled={zoom >= 3} onClick={() => setZoom(Math.min(3, zoom + 0.5))}>+</button>
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
      <div class="lecteur-corps">
        {pdf ? <Pdf f={f} zoom={zoom} /> : estImage(f) ? (
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
function Pdf({ f, zoom }: { f: Fichier; zoom: number }) {
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
    <div class="pdf-pages" style={{ width: `${zoom * 100}%` }}>
      {formats.map((r, i) => <PagePdfVue doc={doc} n={i + 1} ratio={r} zoom={zoom} />)}
    </div>
  );
}

function PagePdfVue({ doc, n, ratio, zoom }: { doc: DocPdf; n: number; ratio: number; zoom: number }) {
  const boite = useRef<HTMLDivElement>(null);
  const toile = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = boite.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: '600px 0px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !toile.current || !boite.current) return;
    let tache: { cancel: () => void } | null = null;
    let annule = false;
    (async () => {
      const page = await doc.getPage(n);
      if (annule || !toile.current || !boite.current) return;
      const largeur = boite.current.clientWidth;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      const vue = page.getViewport({ scale: (largeur * dpr) / page.getViewport({ scale: 1 }).width });
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
