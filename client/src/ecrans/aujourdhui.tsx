import type { Donnees, Evenement, Note } from '../types';
import { useState } from 'preact/hooks';
import { ajouterJours, dans, heureDe, initialesDe, jourDe, jourEnToutesLettres, jourParis, prenomDe } from '../dates';
import { aLaUne, CATEGORIES, duJour, examensAVenir, prochainJourAvecCours, salleDe, salleDeduite, titreDe } from '../planning';
import { Avatar, Icone, LigneEvenement, LigneExamen, Vide } from '../composants';
import { lirePreferences } from '../preferences';
import { aVenir, lignes } from '../afaire';
import { LigneAFaire } from './devoirs';
import type { Ligne } from '../afaire';

interface Props {
  d: Donnees;
  maintenant: number;
  surOuvrir: (e: Evenement) => void;
  surReglages: () => void;
  surAller: (onglet: 'alertes' | 'scolarite') => void;
  surDevoirs: () => void;
  surCocher: (l: Ligne) => void;
}

const SEPT_JOURS = 7 * 86_400_000;

export function Aujourdhui({ d, maintenant, surOuvrir, surReglages, surAller, surDevoirs, surCocher }: Props) {
  const jour = jourParis(maintenant);
  const une = aLaUne(d.planning, maintenant);
  const liste = duJour(d.planning, jour);
  const resteAujourdhui = liste.some((e) => Date.parse(e.fin) > maintenant);
  const jourSuivant = resteAujourdhui ? null : prochainJourAvecCours(d.planning, jour);
  const prenom = prenomDe(d.moi.nom);

  const derniereNote = [...d.notes].reverse().find((n) => n.note !== null);
  const alertesRecentes = d.alertes.filter((a) => maintenant - Date.parse(a.date) < SEPT_JOURS);
  const examens = examensAVenir(d.planning, maintenant);
  const { cacherNote, accueilExamens, accueilAFaire, accueilTuiles, photo } = lirePreferences();
  const urgents = d.afaire ? aVenir(lignes(d.afaire.echeances, d.afaire.taches, maintenant), maintenant) : [];

  return (
    <>
      <header class="entete">
        <div class="entete-textes">
          <p class="surtitre">{jourEnToutesLettres(jour)}</p>
          <h1>{prenom ? `Bonjour ${prenom}` : 'Bonjour'}</h1>
        </div>
        <button type="button" class="avatar" onClick={surReglages} aria-label="Profil et réglages"><Avatar initiales={initialesDe(d.moi.nom)} photo={photo} /></button>
      </header>

      <div class="accueil">
      <div class="accueil-col">
      {une ? <Une e={une.evenement} enCours={une.enCours} jour={jour} maintenant={maintenant} surOuvrir={surOuvrir} /> : (
        <section class="une une-vide">
          <h2>Rien de prévu</h2>
          <p>Aucun cours à venir dans ton planning.</p>
        </section>
      )}

      <section class="bloc" aria-label="Cours du jour">
        {resteAujourdhui ? (
          <>
            <h2 class="titre-bloc">Aujourd'hui</h2>
            <div class="liste-evts">
              {liste.map((e) => <LigneEvenement key={e.cle} e={e} passe={Date.parse(e.fin) <= maintenant} surOuvrir={surOuvrir} />)}
            </div>
          </>
        ) : (
          <>
            <p class="fini">{liste.length ? 'Plus de cours aujourd’hui.' : 'Pas de cours aujourd’hui.'}</p>
            {jourSuivant && (
              <>
                <h2 class="titre-bloc">{jourSuivant === ajouterJours(jour, 1) ? 'Demain' : jourEnToutesLettres(jourSuivant)}</h2>
                <div class="liste-evts">
                  {duJour(d.planning, jourSuivant).map((e) => <LigneEvenement key={e.cle} e={e} surOuvrir={surOuvrir} />)}
                </div>
              </>
            )}
            {!jourSuivant && !une && <Vide icone="calendrier" titre="Planning vide" texte="Les prochains cours apparaîtront ici dès qu'ils seront publiés." />}
          </>
        )}
      </section>

      </div>
      <div class="accueil-col">
      {accueilExamens && examens.length > 0 && (
        <section class="bloc" aria-label="Examens à venir">
          <h2 class="titre-bloc">Examens à venir</h2>
          <ProchainExamen e={examens[0]} maintenant={maintenant} surOuvrir={surOuvrir} />
          {examens.length > 1 && (
            <div class="carte liste">
              {examens.slice(1, 3).map((e) => <LigneExamen e={e} maintenant={maintenant} surOuvrir={surOuvrir} />)}
            </div>
          )}
        </section>
      )}

      {accueilAFaire && d.afaire && (
        <section class="bloc" aria-label="À faire">
          <div class="titre-avec-lien">
            <h2 class="titre-bloc">À faire</h2>
            <button type="button" class="lien-bouton" onClick={surDevoirs}>Tous les devoirs</button>
          </div>
          {urgents.length ? (
            <div class="carte liste">
              {urgents.map((l) => <LigneAFaire l={l} maintenant={maintenant} surCocher={surCocher} />)}
            </div>
          ) : (
            <button type="button" class="carte vide-court" onClick={surDevoirs}>Rien d'urgent cette semaine · ajouter une tâche</button>
          )}
        </section>
      )}

      {accueilTuiles && <section class="tuiles" aria-label="Nouveautés">
        <TuileNote note={derniereNote} surprise={cacherNote} nouvelle={d.alertes.some((a) => a.type === 'note' && maintenant - Date.parse(a.date) < SEPT_JOURS)}
          surVoir={() => surAller('scolarite')} />
        <button type="button" class="tuile" onClick={() => surAller('alertes')}>
          <span class="tuile-titre">Alertes</span>
          <span class={`tuile-valeur ${alertesRecentes.length ? 'bleu' : ''}`}>{alertesRecentes.length}</span>
          <span class="tuile-texte">{alertesRecentes.length ? alertesRecentes[0].titre : 'Rien de neuf cette semaine'}</span>
        </button>
      </section>}
      </div>
      </div>
    </>
  );
}

function Une({ e, enCours, jour, maintenant, surOuvrir }: { e: Evenement; enCours: boolean; jour: string; maintenant: number; surOuvrir: (e: Evenement) => void }) {
  const cat = CATEGORIES[e.categorie];
  const autreJour = jourDe(e.debut) !== jour;
  const quand = [autreJour ? jourEnToutesLettres(jourDe(e.debut)) : null, `${heureDe(e.debut)} – ${heureDe(e.fin)}`].filter(Boolean).join(' · ');
  const salle = salleDe(e);
  return (
    <button type="button" class="une" onClick={() => surOuvrir(e)}>
      <span class="une-haut">
        <span class={`pastille sur-bleu ${e.categorie === 'examen' ? 'examen' : ''}`}>{(e.type.trim() || cat.nom).toUpperCase()}</span>
        <span class="une-quand">{enCours ? `En cours · fin à ${heureDe(e.fin)}` : dans(Date.parse(e.debut) - maintenant)}</span>
      </span>
      <span class="une-titre">{titreDe(e)}</span>
      <span class="une-sous">{[quand, e.intervenants.join(', ')].filter(Boolean).join(' · ')}</span>
      <span class="une-cases">
        <span class="une-case">
          <small>{salleDeduite(e) ? 'Ta salle' : 'Salle'}</small>
          <strong>{salle || '—'}</strong>
        </span>
        <span class="une-case large">
          {salleDeduite(e) ? <><small>Répartition par nom</small><span>parmi {e.salles.join(' / ')}</span></> : <><small>Groupe</small><span>{e.groupe || '—'}</span></>}
        </span>
      </span>
    </button>
  );
}

const CLE_NOTE_VUE = 'campus-plus:note-decouverte';
const cleNote = (n: Note) => `${n.cours}|${n.epreuve}|${n.note}`;

/**
 * Tuile de la dernière note. En « surprise », une note pas encore découverte s'annonce sans sa
 * valeur ; un appui la révèle sur place, un second ouvre la Scolarité.
 */
function TuileNote({ note, surprise, nouvelle, surVoir }: { note: Note | undefined; surprise: boolean; nouvelle: boolean; surVoir: () => void }) {
  const [vue, setVue] = useState(() => {
    try { return !!note && localStorage.getItem(CLE_NOTE_VUE) === cleNote(note); } catch { return false; }
  });
  const cachee = !!note && surprise && !vue;
  const decouvrir = () => {
    if (!note) return;
    try { localStorage.setItem(CLE_NOTE_VUE, cleNote(note)); } catch { /* rien */ }
    setVue(true);
  };
  return (
    <button type="button" class={`tuile ${cachee ? 'tuile-surprise' : ''}`} onClick={cachee ? decouvrir : surVoir}
      aria-label={cachee ? `${nouvelle ? 'Nouvelle note' : 'Dernière note'} en ${note!.cours} : toucher pour la découvrir` : undefined}>
      <span class="tuile-titre">{nouvelle ? 'Nouvelle note' : 'Dernière note'}</span>
      {!note ? <span class="tuile-texte">Aucune note publiée pour l'instant</span> : cachee ? (
        <>
          <span class="tuile-cachee"><Icone nom="note" taille={16} epaisseur={2.4} />Découvrir</span>
          <span class="tuile-texte">{note.cours} · {note.epreuve}</span>
        </>
      ) : (
        <>
          <span class={`tuile-valeur ${surprise ? 'revele' : ''}`}>{String(note.note).replace('.', ',')}<small>/20</small></span>
          <span class="tuile-texte">{note.cours} · {note.epreuve}</span>
        </>
      )}
    </button>
  );
}

/** Le prochain examen, mis en avant : compte à rebours, date, heure et salle. */
function ProchainExamen({ e, maintenant, surOuvrir }: { e: Evenement; maintenant: number; surOuvrir: (e: Evenement) => void }) {
  const jours = Math.round((Date.parse(jourDe(e.debut)) - Date.parse(jourParis(maintenant))) / 86_400_000);
  const salle = salleDe(e);
  return (
    <button type="button" class="examen-une" onClick={() => surOuvrir(e)}>
      <span class="examen-une-haut">
        <span class="examen-etiquette">Prochain examen</span>
        <span class="examen-compte">{jours <= 0 ? 'Aujourd’hui' : jours === 1 ? 'Demain' : `dans ${jours} jours`}</span>
      </span>
      <span class="examen-titre">{titreDe(e)}</span>
      <span class="examen-cases">
        <span class="examen-case"><small>Date</small><strong>{jourEnToutesLettres(jourDe(e.debut))}</strong></span>
        <span class="examen-case"><small>Heure</small><strong>{heureDe(e.debut)}</strong></span>
        <span class="examen-case"><small>{salleDeduite(e) ? 'Ta salle' : 'Salle'}</small><strong>{salle || '—'}</strong></span>
      </span>
    </button>
  );
}
