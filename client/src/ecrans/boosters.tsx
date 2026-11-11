/**
 * Notes en boosters : chaque nouvelle note arrive dans un paquet scellé qu'on ouvre d'un appui,
 * et la copie en sort. Plusieurs nouvelles notes : un paquet par note, l'un après l'autre.
 */
import { useEffect, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import type { Note } from '../types';

const CLE = 'campus-plus:notes-ouvertes';
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
    setI(i + 1);
  };
  const p = palier(note.note);

  return createPortal(
    <div class={`boosters palier-${p} ${ouvert ? 'ouvert' : ''}`} role="dialog" aria-modal="true" aria-label="Nouvelle note">
      <button type="button" class="boosters-fermer" onClick={surFin} aria-label="Fermer">Fermer</button>
      {notes.length > 1 && <p class="boosters-compte">{i + 1} / {notes.length}</p>}
      <div class="booster-scene" key={i}>
        <span class="booster-rayons" aria-hidden="true" />
        <button type="button" class="booster" onClick={ouvrir} disabled={ouvert} aria-label={`Ouvrir la note de ${note.cours}`}>
          <span class="booster-haut" aria-hidden="true"><span class="booster-dents" /></span>
          <span class="booster-corps" aria-hidden="true">
            <span class="booster-holo" />
            <span class="booster-embleme">C+</span>
            <span class="booster-logo">Campus+</span>
            <span class="booster-titre">Nouvelle note</span>
            <span class="booster-cours">{note.cours}</span>
            <span class="booster-reflet" />
          </span>
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
          : <p class="boosters-aide">Touche le paquet pour l’ouvrir</p>}
      </div>
    </div>,
    document.getElementById('app') ?? document.body,
  );
}
