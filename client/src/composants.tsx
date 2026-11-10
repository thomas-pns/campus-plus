/** Briques d'interface partagées par les écrans. */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Evenement } from './types';
import { heureDe, jourEnToutesLettres, jourDe } from './dates';
import { CATEGORIES, salleDe, salleDeduite, titreDe } from './planning';

/* ---------- Icônes (traits simples, dessinées pour l'appli) ---------- */

const TRACES = {
  soleil: 'M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 8a4 4 0 1 0 0 8a4 4 0 0 0 0-8z',
  calendrier: 'M7 3v3M17 3v3M4 8h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z',
  cloche: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4l2-2zM10 21h4',
  diplome: 'M2 9l10-5l10 5l-10 5L2 9zM6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5',
  gauche: 'M15 6l-6 6l6 6',
  droite: 'M9 6l6 6l-6 6',
  actualiser: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  fermer: 'M6 6l12 12M18 6L6 18',
  lieu: 'M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11zM12 8a2 2 0 1 0 0 4a2 2 0 0 0 0-4z',
  personne: 'M12 12a4 4 0 1 0 0-8a4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  horloge: 'M12 21a9 9 0 1 0 0-18a9 9 0 0 0 0 18zM12 7v5l3 2',
  groupe: 'M9 11a3 3 0 1 0 0-6a3 3 0 0 0 0 6zM3 20a6 6 0 0 1 12 0M16 5.2a3 3 0 0 1 0 5.6M18 14.5a6 6 0 0 1 3 5.5',
  note: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  serveur: 'M4 5h16v6H4zM4 13h16v6H4zM8 8h.01M8 16h.01',
  sortie: 'M10 4H5v16h5M14 8l4 4l-4 4M18 12H9',
  corbeille: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  code: 'M8 8l-4 4l4 4M16 8l4 4l-4 4',
  horsLigne: 'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 4-2.6M19 13a10 10 0 0 0-5-2.8M2 9.5a15 15 0 0 1 4.5-3M22 9.5A15 15 0 0 0 11 6M12 20h.01',
} as const;

export type NomIcone = keyof typeof TRACES;

export function Icone({ nom, taille = 22, epaisseur = 2 }: { nom: NomIcone; taille?: number; epaisseur?: number }) {
  return (
    <svg width={taille} height={taille} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={epaisseur} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={TRACES[nom]} />
    </svg>
  );
}

/* ---------- En-tête d'écran ---------- */

export function Entete({ surtitre, titre, children }: { surtitre?: string; titre: string; children?: ComponentChildren }) {
  return (
    <header class="entete">
      <div class="entete-textes">
        {surtitre && <p class="surtitre">{surtitre}</p>}
        <h1>{titre}</h1>
      </div>
      {children && <div class="entete-actions">{children}</div>}
    </header>
  );
}

/* ---------- Sélecteur à segments ---------- */

export function Segments<T extends string>({ options, valeur, surChoix, etiquette }: { options: readonly { id: T; nom: string }[]; valeur: T; surChoix: (v: T) => void; etiquette: string }) {
  return (
    <div class="segments" role="tablist" aria-label={etiquette} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button type="button" role="tab" aria-selected={o.id === valeur} class={o.id === valeur ? 'actif' : ''} onClick={() => surChoix(o.id)}>
          {o.nom}
        </button>
      ))}
    </div>
  );
}

/* ---------- Un créneau dans une liste (vue jour) ---------- */

export function LigneEvenement({ e, passe, surOuvrir }: { e: Evenement; passe?: boolean; surOuvrir: (e: Evenement) => void }) {
  const cat = CATEGORIES[e.categorie];
  const sousTitre = [e.intervenants.join(', '), e.groupe].filter(Boolean).join(' · ');
  return (
    <button type="button" class={`ligne-evt ${passe ? 'passe' : ''}`} onClick={() => surOuvrir(e)}>
      <span class="ligne-heures">
        <strong>{heureDe(e.debut)}</strong>
        <span>{heureDe(e.fin)}</span>
      </span>
      <span class={`ligne-carte ${cat.classe}`}>
        <span class="ligne-haut">
          <span class="ligne-type">{e.type.trim() || cat.nom}</span>
          <span class="ligne-salle">{salleDe(e)}</span>
        </span>
        <span class="ligne-titre">{titreDe(e)}</span>
        {sousTitre && <span class="ligne-sous">{sousTitre}</span>}
      </span>
    </button>
  );
}

/* ---------- Fiche d'un créneau (panneau qui monte du bas) ---------- */

export function FicheEvenement({ e, surFermer }: { e: Evenement; surFermer: () => void }) {
  const cat = CATEGORIES[e.categorie];
  const fermer = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    fermer.current?.focus();
    const touche = (ev: KeyboardEvent) => ev.key === 'Escape' && surFermer();
    document.addEventListener('keydown', touche);
    return () => document.removeEventListener('keydown', touche);
  }, [surFermer]);
  return (
    <div class="voile" onClick={(ev) => ev.target === ev.currentTarget && surFermer()}>
      <section class="feuille" role="dialog" aria-modal="true" aria-label={titreDe(e)}>
        <div class="feuille-haut">
          <span class={`pastille ${cat.classe}`}>{e.type.trim() || cat.nom}</span>
          <button type="button" class="rond" ref={fermer} onClick={surFermer} aria-label="Fermer"><Icone nom="fermer" taille={18} epaisseur={2.4} /></button>
        </div>
        <h2>{titreDe(e)}</h2>
        <ul class="details">
          <li><Icone nom="horloge" taille={20} /><span>{jourEnToutesLettres(jourDe(e.debut))}<br /><strong>{heureDe(e.debut)} – {heureDe(e.fin)}</strong></span></li>
          {(e.salles.length > 0 || e.salleExamen) && (
            <li>
              <Icone nom="lieu" taille={20} />
              <span>
                {salleDeduite(e) ? <>Ta salle : <strong>{salleDe(e)}</strong><br /><small>d'après la répartition par nom ; salles de l'examen : {e.salles.join(' / ')}</small></> : <strong>{e.salles.join(' / ')}</strong>}
              </span>
            </li>
          )}
          {e.intervenants.length > 0 && <li><Icone nom="personne" taille={20} /><span>{e.intervenants.join(', ')}</span></li>}
          {e.groupe && <li><Icone nom="groupe" taille={20} /><span>{e.groupe}</span></li>}
        </ul>
        {e.remarques.length > 0 && (
          <div class="remarques">
            {e.remarques.map((r) => <p>{r}</p>)}
          </div>
        )}
      </section>
    </div>
  );
}

/* ---------- Zone qui défile, avec « tirer pour actualiser » ---------- */

const SEUIL = 72;

export function Defilement({ children, surActualiser, cle }: { children: ComponentChildren; surActualiser?: () => Promise<void>; cle: string }) {
  const zone = useRef<HTMLElement>(null);
  const depart = useRef<number | null>(null);
  const [tire, setTire] = useState(0);
  const [enCours, setEnCours] = useState(false);

  // Revenir en haut quand on change d'écran.
  useEffect(() => { zone.current?.scrollTo(0, 0); }, [cle]);

  const debut = (ev: TouchEvent) => {
    depart.current = surActualiser && !enCours && (zone.current?.scrollTop ?? 1) <= 0 ? ev.touches[0].clientY : null;
  };
  const bouge = (ev: TouchEvent) => {
    if (depart.current === null) return;
    const dy = ev.touches[0].clientY - depart.current;
    setTire(dy > 0 && (zone.current?.scrollTop ?? 1) <= 0 ? Math.min(dy * 0.5, 110) : 0);
  };
  const fin = () => {
    const declenche = tire >= SEUIL;
    depart.current = null;
    setTire(0);
    if (declenche && surActualiser) {
      setEnCours(true);
      void surActualiser().finally(() => setEnCours(false));
    }
  };

  const hauteur = enCours ? 44 : tire;
  return (
    <main class="ecran" ref={zone} onTouchStart={debut} onTouchMove={bouge} onTouchEnd={fin} onTouchCancel={fin}>
      <div class="tirer" style={{ height: `${hauteur}px` }} aria-hidden={!enCours}>
        <span class={enCours ? 'tourne' : ''} style={{ transform: enCours ? undefined : `rotate(${tire * 3}deg)`, opacity: enCours ? 1 : Math.min(tire / SEUIL, 1) }}>
          <Icone nom="actualiser" taille={20} epaisseur={2.4} />
        </span>
        {enCours && <span role="status">Actualisation…</span>}
      </div>
      <div class="contenu">{children}</div>
    </main>
  );
}

/* ---------- État vide ---------- */

export function Vide({ icone, titre, texte }: { icone: NomIcone; titre: string; texte?: string }) {
  return (
    <div class="vide">
      <span class="vide-icone"><Icone nom={icone} taille={28} /></span>
      <strong>{titre}</strong>
      {texte && <p>{texte}</p>}
    </div>
  );
}
