import { useEffect, useRef, useState } from 'preact/hooks';
import * as api from '../api';
import type { Tache } from '../types';
import { Icone } from '../composants';
import { jourEnToutesLettres } from '../dates';

export interface Brouillon {
  matiere: string;
  cours: number | null;
  /** Date proposée « AAAA-MM-JJ » (prochaine séance), ou vide. */
  date: string;
  /** Texte proposé (depuis un mail), facultatif. */
  titre?: string;
}

/** Panneau « Nouveau devoir » rattaché à une matière, ouvert depuis un créneau ou un cours. */
export function AjoutDevoir({ b, surFermer, surAjout }: { b: Brouillon; surFermer: () => void; surAjout: (t: Tache) => void }) {
  const [titre, setTitre] = useState(b.titre ?? '');
  const [date, setDate] = useState(b.date);
  const [erreur, setErreur] = useState('');
  const [occupe, setOccupe] = useState(false);
  const champ = useRef<HTMLInputElement>(null);
  useEffect(() => {
    champ.current?.focus();
    const touche = (ev: KeyboardEvent) => ev.key === 'Escape' && surFermer();
    document.addEventListener('keydown', touche);
    return () => document.removeEventListener('keydown', touche);
  }, [surFermer]);

  const envoyer = async (ev: Event) => {
    ev.preventDefault();
    if (!titre.trim() || occupe) return;
    setOccupe(true);
    setErreur('');
    try {
      const { tache } = await api.ajouterTache({ titre: titre.trim(), echeance: date || null, cours: b.cours, matiere: b.matiere });
      surAjout(tache);
    } catch (e) {
      setErreur((e as Error).message);
      setOccupe(false);
    }
  };

  return (
    <div class="voile" onClick={(ev) => ev.target === ev.currentTarget && surFermer()}>
      <section class="feuille" role="dialog" aria-modal="true" aria-label={`Nouveau devoir : ${b.matiere}`}>
      <form class="feuille-formulaire" onSubmit={envoyer}>
        <div class="feuille-haut">
          <span class="pastille c-tp"><Icone nom="liste" taille={14} epaisseur={2.2} />Nouveau devoir</span>
          <button type="button" class="rond" onClick={surFermer} aria-label="Fermer"><Icone nom="fermer" taille={18} epaisseur={2.4} /></button>
        </div>
        <h2>{b.matiere}</h2>
        <label class="etiquette" for="devoir-titre">À faire</label>
        <input id="devoir-titre" ref={champ} class="champ" type="text" maxLength={200} placeholder="Ex. : exercices 10, 14, 15 et 16"
          value={titre} onInput={(e) => setTitre((e.target as HTMLInputElement).value)} />
        <label class="etiquette" for="devoir-date">Pour le</label>
        <input id="devoir-date" class="champ" type="date" value={date} onInput={(e) => setDate((e.target as HTMLInputElement).value)} />
        {b.date && date === b.date && <p class="petit-texte">Prochaine séance : {jourEnToutesLettres(b.date)}</p>}
        {erreur && <p class="erreur" role="alert">{erreur}</p>}
        <button type="submit" class="bouton large" disabled={!titre.trim() || occupe}>{occupe ? 'Ajout…' : 'Ajouter aux devoirs'}</button>
      </form>
      </section>
    </div>
  );
}
