import { useState } from 'preact/hooks';
import type { Donnees, Evenement } from '../types';
import { ajouterJours, grilleMois, jourEnToutesLettres, moisDecale, jourParis, libelleJour, lundiDe, numeroSemaine, rangDansSemaine } from '../dates';
import { CATEGORIES, duJour, salleDe, semaineDe, titreDe, type Bloc } from '../planning';
import { Entete, Icone, LigneEvenement, Segments, Vide } from '../composants';

const VUES = [{ id: 'jour', nom: 'Jour' }, { id: 'semaine', nom: 'Semaine' }, { id: 'mois', nom: 'Mois' }] as const;
type Vue = (typeof VUES)[number]['id'];
const PX_PAR_HEURE = 58;
const LEGENDE = ['cours', 'td', 'tp', 'langues', 'fhes', 'examen'] as const;

interface Props {
  d: Donnees;
  maintenant: number;
  surOuvrir: (e: Evenement) => void;
}

export function Planning({ d, maintenant, surOuvrir }: Props) {
  const aujourdhui = jourParis(maintenant);
  const [vue, setVue] = useState<Vue>('semaine');
  // Le week-end, on ouvre sur la semaine qui arrive.
  const [jour, setJour] = useState(() => (rangDansSemaine(aujourdhui) >= 5 && !duJour(d.planning, aujourdhui).length ? ajouterJours(lundiDe(aujourdhui), 7) : aujourdhui));
  const lundi = lundiDe(jour);
  const semaine = semaineDe(d.planning, lundi);
  const mois = libelleJour(vue === 'mois' ? jour : ajouterJours(lundi, 3), { month: 'long', year: 'numeric' });
  const decaler = (n: number) => setJour(vue === 'jour' ? ajouterJours(jour, n) : vue === 'mois' ? moisDecale(jour, n) : ajouterJours(lundi, 7 * n));
  const pas = vue === 'jour' ? 'Jour' : vue === 'mois' ? 'Mois' : 'Semaine';
  const ailleurs = vue === 'mois' ? jour.slice(0, 7) !== aujourdhui.slice(0, 7) : lundiDe(aujourdhui) !== lundi || (vue === 'jour' && jour !== aujourdhui);

  return (
    <>
      <Entete surtitre={vue === 'mois' ? 'Planning' : `Semaine ${numeroSemaine(lundi)}`} titre={mois.charAt(0).toUpperCase() + mois.slice(1)}>
        <button type="button" class="rond" onClick={() => decaler(-1)} aria-label={`${pas} précédent${pas === 'Semaine' ? 'e' : ''}`}><Icone nom="gauche" epaisseur={2.4} taille={20} /></button>
        <button type="button" class="rond" onClick={() => decaler(1)} aria-label={`${pas} suivant${pas === 'Semaine' ? 'e' : ''}`}><Icone nom="droite" epaisseur={2.4} taille={20} /></button>
      </Entete>

      <div class="barre-vue">
        <Segments options={VUES} valeur={vue} surChoix={setVue} etiquette="Vue" />
        {ailleurs ? (
          <button type="button" class="lien-bouton" onClick={() => setJour(aujourdhui)}>Aujourd'hui</button>
        ) : null}
      </div>

      {vue === 'mois' ? (
        <Mois d={d} jour={jour} aujourdhui={aujourdhui} surChoix={(j) => { setJour(j); setVue('jour'); }} />
      ) : <>
      <div class={`jours ${vue === 'semaine' ? 'avec-marge' : ''}`} style={{ '--colonnes': semaine.jours.length }}>
        {semaine.jours.map((j, i) => (
          <button type="button" class={`jour ${j === aujourdhui ? 'aujourdhui' : ''} ${vue === 'jour' && j === jour ? 'choisi' : ''}`}
            onClick={() => { setJour(j); setVue('jour'); }} aria-label={jourEnToutesLettres(j)} aria-current={j === aujourdhui ? 'date' : undefined}>
            <span>{libelleJour(j, { weekday: 'short' }).replace('.', '')}</span>
            <strong>{Number(j.slice(8))}</strong>
            <i class={semaine.colonnes[i].length ? 'point' : 'point sans'} />
          </button>
        ))}
      </div>

      {vue === 'semaine' ? (
        <>
          <Grille semaine={semaine} aujourdhui={aujourdhui} maintenant={maintenant} surOuvrir={surOuvrir} />
          <ul class="legende" aria-label="Légende">
            {LEGENDE.map((c) => <li><i class={CATEGORIES[c].classe} />{CATEGORIES[c].nom}</li>)}
          </ul>
        </>
      ) : (
        <section class="bloc">
          <h2 class="titre-bloc">{jourEnToutesLettres(jour)}</h2>
          {duJour(d.planning, jour).length ? (
            <div class="liste-evts">
              {duJour(d.planning, jour).map((e) => <LigneEvenement key={e.cle} e={e} passe={Date.parse(e.fin) <= maintenant} surOuvrir={surOuvrir} />)}
            </div>
          ) : <Vide icone="calendrier" titre="Pas de cours ce jour-là" />}
        </section>
      )}
      </>}
    </>
  );
}

/** Vue du mois : une pastille par type de cours dans la journée ; un appui ouvre la journée. */
function Mois({ d, jour, aujourdhui, surChoix }: { d: Donnees; jour: string; aujourdhui: string; surChoix: (j: string) => void }) {
  const mois = jour.slice(0, 7);
  const jours = grilleMois(jour);
  return (
    <>
      <div class="mois" role="grid" aria-label="Mois">
        {['lun', 'mar', 'mer', 'jeu', 'ven', 'sam', 'dim'].map((n) => <span class="mois-entete">{n}</span>)}
        {jours.map((j) => {
          const evts = duJour(d.planning, j);
          const cats = [...new Set(evts.map((e) => e.categorie))].slice(0, 4);
          return (
            <button type="button" class={`mois-jour ${j.slice(0, 7) !== mois ? 'hors' : ''} ${j === aujourdhui ? 'aujourdhui' : ''}`}
              onClick={() => surChoix(j)} aria-current={j === aujourdhui ? 'date' : undefined}
              aria-label={`${jourEnToutesLettres(j)}, ${evts.length ? `${evts.length} cours` : 'aucun cours'}`}>
              <strong>{Number(j.slice(8))}</strong>
              <span class="mois-points">{cats.map((c) => <i class={CATEGORIES[c].classe} />)}</span>
            </button>
          );
        })}
      </div>
      <ul class="legende" aria-label="Légende">
        {LEGENDE.map((c) => <li><i class={CATEGORIES[c].classe} />{CATEGORIES[c].nom}</li>)}
      </ul>
    </>
  );
}

function Grille({ semaine, aujourdhui, maintenant, surOuvrir }: { semaine: ReturnType<typeof semaineDe>; aujourdhui: string; maintenant: number; surOuvrir: (e: Evenement) => void }) {
  const { heureDebut, heureFin, jours, colonnes } = semaine;
  const heures = Array.from({ length: heureFin - heureDebut + 1 }, (_, i) => heureDebut + i);
  const y = (minutes: number) => ((minutes - heureDebut * 60) / 60) * PX_PAR_HEURE;
  // Position du trait « maintenant », en minutes à Paris.
  const heureParis = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(maintenant);
  const minutesMaintenant = Number(heureParis.slice(0, 2)) * 60 + Number(heureParis.slice(3, 5));
  const traitVisible = minutesMaintenant >= heureDebut * 60 && minutesMaintenant <= heureFin * 60;

  return (
    <div class="grille" style={{ '--colonnes': jours.length, height: `${(heureFin - heureDebut) * PX_PAR_HEURE}px` }}>
      <div class="grille-heures" aria-hidden="true">
        {heures.filter((h) => (h - heureDebut) % 2 === 0).map((h) => <span style={{ top: `${y(h * 60)}px` }}>{h} h</span>)}
      </div>
      {colonnes.map((blocs, i) => (
        <div class="grille-jour">
          {heures.slice(1, -1).map((h) => <i class="trait-heure" style={{ top: `${y(h * 60)}px` }} />)}
          {blocs.map((b) => <BlocSemaine b={b} y={y} surOuvrir={surOuvrir} />)}
          {jours[i] === aujourdhui && traitVisible && <i class="trait-maintenant" style={{ top: `${y(minutesMaintenant)}px` }} />}
        </div>
      ))}
    </div>
  );
}

function BlocSemaine({ b, y, surOuvrir }: { b: Bloc; y: (m: number) => number; surOuvrir: (e: Evenement) => void }) {
  const e = b.evenement;
  const cat = CATEGORIES[e.categorie];
  const hauteur = y(b.finMin) - y(b.debutMin) - 3;
  return (
    <button type="button" class={`bloc-semaine ${cat.classe} ${e.categorie === 'examen' ? 'cercle' : ''}`}
      style={{ top: `${y(b.debutMin) + 1.5}px`, height: `${hauteur}px`, left: `calc(${(b.voie / b.voies) * 100}% + 2px)`, width: `calc(${100 / b.voies}% - 4px)` }}
      onClick={() => surOuvrir(e)} aria-label={`${titreDe(e)}, ${e.type.trim() || cat.nom}, salle ${salleDe(e) || 'non précisée'}`}>
      <span class="bloc-salle">{salleDe(e)}</span>
      <span class="bloc-titre">{titreDe(e)}</span>
    </button>
  );
}
