import type { Donnees, Evenement } from '../types';
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
          <div class="carte liste">
            {examens.slice(0, 3).map((e) => <LigneExamen e={e} maintenant={maintenant} surOuvrir={surOuvrir} />)}
          </div>
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
        <button type="button" class="tuile" onClick={() => surAller('scolarite')}>
          <span class="tuile-titre">Dernière note</span>
          {derniereNote && cacherNote ? (
            <>
              <span class="tuile-valeur">••<small>/20</small></span>
              <span class="tuile-texte">{derniereNote.cours} · touche pour voir</span>
            </>
          ) : derniereNote ? (
            <>
              <span class="tuile-valeur">{String(derniereNote.note).replace('.', ',')}<small>/20</small></span>
              <span class="tuile-texte">{derniereNote.cours} · {derniereNote.epreuve}</span>
            </>
          ) : <span class="tuile-texte">Aucune note publiée pour l'instant</span>}
        </button>
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
