/** Répartition des notes d'un cours, saisie par l'élève, et ce qu'il faut viser au prochain partiel. */
import { useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import type { Note } from '../types';
import { Icone } from '../composants';
import { bilan, noteDe, type Repartition } from '../moyenne';

const fr = (n: number) => String(Math.round(n * 100) / 100).replace('.', ',');
const nombre = (v: string) => { const x = Number(v.replace(',', '.')); return v.trim() === '' || Number.isNaN(x) ? null : x; };

/** Phrase de résultat, à afficher dans la carte du cours comme dans le panneau. */
export function resume(r: Repartition, epreuves: Note[]): { texte: string; ton: '' | 'vert' | 'rouge' } | null {
  const b = bilan(r, epreuves);
  if (!b.totalPoids) return null;
  if (b.finale !== null) return { texte: `Moyenne du cours : ${fr(b.finale)}`, ton: b.finale >= r.objectif ? 'vert' : 'rouge' };
  if (b.aViser === null) return null;
  if (b.aViser <= 0) return { texte: `Objectif ${fr(r.objectif)} déjà atteint, quoi qu’il arrive 🎉`, ton: 'vert' };
  if (b.aViser > 20) return { texte: `${fr(r.objectif)} hors d’atteinte sur la suite (il faudrait ${fr(b.aViser)})`, ton: 'rouge' };
  return { texte: `Il te faut ${fr(b.aViser)} de moyenne sur la suite pour ${fr(r.objectif)}`, ton: b.aViser > 14 ? 'rouge' : '' };
}

export function Simulation({ cours, epreuves, depart, surEnregistrer, surFermer }: {
  cours: string; epreuves: Note[]; depart: Repartition; surEnregistrer: (r: Repartition | null) => Promise<void>; surFermer: () => void;
}) {
  const [r, setR] = useState<Repartition>(depart);
  const [occupe, setOccupe] = useState(false);
  const b = bilan(r, epreuves);
  const res = resume(r, epreuves);
  const changer = (i: number, modif: Partial<Repartition['parties'][number]>) =>
    setR({ ...r, parties: r.parties.map((p, k) => (k === i ? { ...p, ...modif } : p)) });

  return createPortal(
    <div class="voile" onClick={(ev) => ev.target === ev.currentTarget && surFermer()}>
      <section class="feuille" role="dialog" aria-modal="true" aria-label={`Simuler ma moyenne en ${cours}`}>
        <div class="feuille-haut">
          <span class="pastille c-langues">Simulation</span>
          <button type="button" class="rond" onClick={surFermer} aria-label="Fermer"><Icone nom="fermer" taille={18} epaisseur={2.4} /></button>
        </div>
        <h2>{cours}</h2>
        <p class="petit-texte">Recopie la répartition annoncée par le prof (souvent au premier cours). Les notes de MyCPE se remplissent toutes seules.</p>

        <div class="simulation">
          <div class="simulation-entete"><span>Partie</span><span>%</span><span>Note</span><span /></div>
          {r.parties.map((p, i) => {
            const liee = p.epreuve ? epreuves.find((n) => n.epreuve === p.epreuve) : undefined;
            const n = noteDe(p, epreuves);
            return (
              <div class="simulation-ligne">
                <input aria-label="Nom de la partie" value={p.nom} onInput={(e) => changer(i, { nom: (e.target as HTMLInputElement).value })} />
                <input aria-label={`Poids de ${p.nom} en %`} inputMode="decimal" value={String(p.poids)} onInput={(e) => changer(i, { poids: Math.max(0, Math.min(100, nombre((e.target as HTMLInputElement).value) ?? 0)) })} />
                {liee?.note != null
                  ? <span class="simulation-note" title="Note de MyCPE">{fr(liee.note)}</span>
                  : <input aria-label={`Note de ${p.nom} (vide si à venir)`} inputMode="decimal" placeholder="à venir" value={n === null ? '' : String(n).replace('.', ',')}
                      onInput={(e) => { const v = nombre((e.target as HTMLInputElement).value); changer(i, { note: v === null ? null : Math.max(0, Math.min(20, v)) }); }} />}
                <button type="button" class="simulation-retirer" aria-label={`Retirer ${p.nom}`} onClick={() => setR({ ...r, parties: r.parties.filter((_, k) => k !== i) })}><Icone nom="fermer" taille={14} epaisseur={2.6} /></button>
              </div>
            );
          })}
          <button type="button" class="lien-bouton" onClick={() => setR({ ...r, parties: [...r.parties, { nom: r.parties.length ? 'Écrit final' : 'TP', poids: 0, note: null }] })}>+ Ajouter une partie (TP, écrit final…)</button>
        </div>

        <div class="simulation-objectif">
          <span>Objectif</span>
          {[10, 12, 14, 16].map((o) => (
            <button type="button" class={r.objectif === o ? 'actif' : ''} onClick={() => setR({ ...r, objectif: o })}>{o}</button>
          ))}
        </div>

        {b.totalPoids !== 100 && b.totalPoids > 0 && <p class="petit-texte rouge">Les parties font {fr(b.totalPoids)} % au lieu de 100 % : le calcul se fait quand même au prorata.</p>}
        {b.actuelle !== null && b.finale === null && <p class="simulation-actuelle">Moyenne sur ce qui est noté : <strong>{fr(b.actuelle)}</strong> ({fr(100 - (100 * b.poidsRestant) / (b.totalPoids || 1))} % du cours)</p>}
        {res && <p class={`simulation-resultat ${res.ton}`}>{res.texte}</p>}

        <button type="button" class="bouton large" disabled={occupe} onClick={() => { setOccupe(true); void surEnregistrer(r).finally(() => { setOccupe(false); surFermer(); }); }}>Enregistrer</button>
        <button type="button" class="lien-bouton" disabled={occupe} onClick={() => { setOccupe(true); void surEnregistrer(null).finally(() => { setOccupe(false); surFermer(); }); }}>Effacer cette répartition</button>
      </section>
    </div>,
    document.getElementById('app') ?? document.body,
  );
}
