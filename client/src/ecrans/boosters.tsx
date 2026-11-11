/**
 * Notes en boosters : chaque nouvelle note arrive dans un paquet scellé qu'on ouvre d'un appui,
 * et la copie en sort. Plusieurs nouvelles notes : un paquet par note, l'un après l'autre.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icone } from '../composants';
import { createPortal } from 'preact/compat';
import type { Note } from '../types';

const CLE = 'campus-plus:notes-ouvertes';

/** Notes d'exemple (visite guidée, essai depuis les réglages) : une de chaque couleur. */
export const EXEMPLES: Note[] = [
  { semestre: 'Semestre 5', module: 'Maths', cours: 'Algèbre linéaire', epreuve: 'Écrit 1', coefficient: 1, note: 16.5, motifAbsence: '' },
  { semestre: 'Semestre 5', module: 'Info', cours: 'Développement logiciel', epreuve: 'Projet', coefficient: 2, note: 13, motifAbsence: '' },
  { semestre: 'Semestre 5', module: 'Physique', cours: 'Physique des semi-conducteurs', epreuve: 'Écrit 1', coefficient: 1, note: 8.5, motifAbsence: '' },
];
export const cleNote = (n: Note) => `${n.semestre}|${n.cours}|${n.epreuve}|${n.note}`;

/** Notes déjà ouvertes sur cet appareil. La première fois, toutes les notes existantes le sont. */
export function notesOuvertes(notes: Note[]): Set<string> {
  try {
    const brut = localStorage.getItem(CLE);
    if (brut === null) {
      const toutes = notes.filter((n) => n.note !== null).map(cleNote);
      localStorage.setItem(CLE, JSON.stringify(toutes));
      return new Set(toutes);
    }
    return new Set(JSON.parse(brut) as string[]);
  } catch {
    return new Set(notes.map(cleNote));
  }
}

export function marquerOuverte(n: Note): void {
  try {
    const deja = new Set(JSON.parse(localStorage.getItem(CLE) ?? '[]') as string[]);
    deja.add(cleNote(n));
    localStorage.setItem(CLE, JSON.stringify([...deja].slice(-500)));
  } catch { /* rien à faire */ }
}

const fr = (n: number) => String(n).replace('.', ',');
/** Couleur du paquet et de la lumière selon la note : discrète en dessous de 10. */
const palier = (n: number) => (n >= 16 ? 'or' : n >= 12 ? 'vert' : n >= 10 ? 'bleu' : 'sobre');

export function Boosters({ notes, surFin, demo }: { notes: Note[]; surFin: () => void; demo?: boolean }) {
  const [i, setI] = useState(0);
  const [ouvert, setOuvert] = useState(false);
  const [coupe, setCoupe] = useState(0);
  // Comme dans les jeux de cartes : on présente le paquet, « Ouvrir », puis on trace une ligne pour le découper.
  const decoupe = true;
  const [depuisDroite, setDepuisDroite] = useState(false);
  // Étincelles qui jaillissent de la découpe, là où passe le doigt.
  const [eclats, setEclats] = useState<{ id: number; x: number; a: number }[]>([]);
  const dernierEclat = useRef(0);
  const [secoue, setSecoue] = useState(false);
  const geste = useRef<{ x: number; largeur: number; bouge: boolean } | null>(null);
  const note = notes[i];

  useEffect(() => {
    const touche = (ev: KeyboardEvent) => { if (ev.key === 'Escape') surFin(); };
    document.addEventListener('keydown', touche);
    return () => document.removeEventListener('keydown', touche);
  }, []);

  if (!note || note.note === null) return null;
  const ouvrir = () => {
    if (ouvert) return;
    if (!demo) marquerOuverte(note);
    setOuvert(true);
    navigator.vibrate?.(30);
  };
  const suivante = () => {
    if (i + 1 >= notes.length) return surFin();
    setOuvert(false);
    setCoupe(0);
    setEclats([]);
    dernierEclat.current = 0;
    setI(i + 1);
  };
  // Comme dans les jeux de cartes : on glisse le doigt le long du haut du paquet pour le découper.
  const appui = (ev: PointerEvent) => {
    if (ouvert || !decoupe) return;
    const el = ev.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    geste.current = { x: ev.clientX, largeur: r.width, bouge: false };
    // Le paquet se redresse doucement (au lieu de rester figé penché) pendant qu'on découpe.
    el.style.transform = getComputedStyle(el).transform;
    el.style.animation = 'none';
    requestAnimationFrame(() => { el.style.transition = 'transform .3s ease-out'; el.style.transform = 'none'; });
    (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
  };
  const glisse = (ev: PointerEvent) => {
    const g = geste.current;
    if (!g || ouvert) return;
    const p = Math.max(0, Math.min(1, Math.abs(ev.clientX - g.x) / (g.largeur * 0.8)));
    if (p > 0.04 && !g.bouge) { g.bouge = true; setDepuisDroite(ev.clientX < g.x); }
    if (p - dernierEclat.current > 0.05) {
      dernierEclat.current = p;
      const x = ev.clientX < g.x ? 100 - p * 100 : p * 100;
      const id = Date.now() + Math.random();
      setEclats((e) => [...e.slice(-24), ...[0, 1, 2].map((k) => ({ id: id + k, x, a: -150 + Math.random() * 120 }))]);
      navigator.vibrate?.(4);
    }
    setCoupe(p);
    if (p >= 1) { geste.current = null; ouvrir(); }
  };
  const relacher = (el: HTMLElement | null) => {
    if (!el) return;
    el.style.transition = '';
    el.style.transform = '';
    el.style.animation = '';
  };
  const lache = (ev?: PointerEvent) => {
    const g = geste.current;
    const el = (ev?.currentTarget as HTMLElement | undefined) ?? null;
    geste.current = null;
    if (ouvert) return;
    if (g && coupe > 0.6) return ouvrir();
    relacher(el);
    dernierEclat.current = 0;
    setCoupe(0);
    if (g && !g.bouge) { setSecoue(true); setTimeout(() => setSecoue(false), 400); }
  };
  const p = palier(note.note);

  return createPortal(
    <div class={`boosters palier-${p} ${ouvert ? 'ouvert' : ''} ${depuisDroite ? 'depuis-droite' : ''}`} role="dialog" aria-modal="true" aria-label="Nouvelle note" style={{ '--coupe': coupe }}>
      <button type="button" class="boosters-fermer" onClick={surFin} aria-label="Fermer">Fermer</button>
      {notes.length > 1 && <p class="boosters-compte">{i + 1} / {notes.length}</p>}
      {!ouvert && <p class="boosters-consigne">{coupe > 0 ? 'Continue jusqu’au bout…' : 'Trace une ligne pour ouvrir'}</p>}
      <div class="booster-scene" key={i}>
        <span class="booster-rayons" aria-hidden="true" />
        <button type="button" class={`booster ${secoue ? 'secoue' : ''} ${coupe > 0 ? 'en-coupe' : ''}`} disabled={ouvert} aria-label={`Ouvrir la note de ${note.cours}`}
          onPointerDown={appui} onPointerMove={glisse} onPointerUp={lache} onPointerCancel={lache}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ouvrir(); } }}>
          <span class="booster-haut" aria-hidden="true">
            <span class="sertissage" />
            <span class="booster-motif" />
            <span class="booster-marque"><span>Campus<b>+</b></span><small>Collection notes</small></span>
            <span class="booster-code">{note.semestre.match(/semestre\s*(\d+)/i)?.[1] ? `S${note.semestre.match(/semestre\s*(\d+)/i)![1]}` : 'CPE'}</span>
            <span class="booster-ligne" />
            {eclats.map((e) => <i key={e.id} class="eclat-coupe" style={{ left: `${e.x}%`, '--a': `${e.a}deg` }} />)}
          </span>
          <span class="booster-corps" aria-hidden="true">
            <span class="booster-art"><i /><i /><i /><i /></span>
            <span class="booster-holo" />
            <span class="booster-medaillon"><Icone nom="diplome" taille={58} epaisseur={1.6} /></span>
            <span class="booster-bas">
              <span class="booster-cours">{note.cours}</span>
              <span class="booster-titre">{note.epreuve}</span>
            </span>
            <span class="booster-reflet" />
          </span>
          <span class="booster-pied" aria-hidden="true"><span class="sertissage" /><span class="booster-motif" /></span>
        </button>
        {ouvert && <span class="booster-flash" aria-hidden="true" />}
        {ouvert && (
          <span class="etincelles" aria-hidden="true">
            {Array.from({ length: 14 }, (_, k) => <i style={{ '--a': `${(360 / 14) * k}deg`, '--d': `${110 + (k % 4) * 28}px`, '--t': `${(k % 5) * 40}ms` }} />)}
          </span>
        )}
        <div class="copie" aria-hidden={!ouvert}>
          <span class="copie-epreuve">{note.epreuve}</span>
          <span class="copie-note">{fr(note.note)}<small>/20</small></span>
          <span class="copie-cours">{note.cours}</span>
          {note.coefficient !== null && <span class="copie-coef">Coefficient {fr(note.coefficient)}</span>}
        </div>
      </div>
      <div class="boosters-bas">
        {ouvert
          ? <button type="button" class="bouton" onClick={suivante}>{i + 1 < notes.length ? 'Note suivante' : demo ? 'Fermer l’exemple' : 'Terminer'}</button>
          : null}
      </div>
    </div>,
    document.getElementById('app') ?? document.body,
  );
}
