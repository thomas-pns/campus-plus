import type { Donnees, Evenement, Note } from '../types';
import { useState } from 'preact/hooks';
import { ajouterJours, dans, heureDe, initialesDe, jourDe, jourEnToutesLettres, jourParis, prenomDe } from '../dates';
import { aLaUne, CATEGORIES, duJour, examensAVenir, prochainJourAvecCours, salleDe, salleDeduite, titreDe } from '../planning';
import { Avatar, Icone, LigneEvenement, LigneExamen, Vide } from '../composants';
import { lirePreferences } from '../preferences';
import { Boosters, cleNote, notesOuvertes } from './boosters';
import { verdict } from '../branleur';
import { fichiersVus } from '../api';
import { fichiersDe, nomCourt } from '../cours';
import { aVenir, lignes } from '../afaire';
import { LigneAFaire } from './devoirs';
import type { Ligne } from '../afaire';

interface Props {
  d: Donnees;
  maintenant: number;
  surOuvrir: (e: Evenement) => void;
  surReglages: () => void;
  surAller: (onglet: 'alertes' | 'scolarite' | 'cours') => void;
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
  const { cacherNote, accueilExamens, accueilAFaire, tuileGauche, tuileDroite, photo } = lirePreferences();
  const [boosters, setBoosters] = useState<Note[] | null>(null);
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
      {une ? <Une e={une.evenement} enCours={une.enCours} jour={jour} maintenant={maintenant} surOuvrir={surOuvrir} conseil={lirePreferences().branleur ? verdict(une.evenement, d.planning)?.message : undefined} /> : (
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

      {(tuileGauche !== 'aucune' || tuileDroite !== 'aucune') && (
        <section class={`tuiles ${tuileGauche === 'aucune' || tuileDroite === 'aucune' ? 'seule' : ''}`} aria-label="Nouveautés">
          {[tuileGauche, tuileDroite].filter((t) => t !== 'aucune').map((t) => (
            t === 'note' ? <TuileNotes d={d} derniere={derniereNote} boosters={cacherNote} surVoir={() => surAller('scolarite')} surOuvrir={setBoosters} />
              : t === 'fichiers' ? <TuileFichiers d={d} surVoir={() => surAller('cours')} />
              : <TuileAlertes recentes={alertesRecentes} surVoir={() => surAller('alertes')} />
          ))}
        </section>
      )}
      {boosters && <Boosters notes={boosters} surFin={() => setBoosters(null)} />}
      </div>
      </div>
    </>
  );
}

function Une({ e, enCours, jour, maintenant, surOuvrir, conseil }: { e: Evenement; enCours: boolean; jour: string; maintenant: number; surOuvrir: (e: Evenement) => void; conseil?: string }) {
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
      {conseil && <span class="une-conseil">{conseil}</span>}
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

/** Notes : la dernière, ou en mode boosters, le nombre de nouvelles notes à ouvrir (sans leur valeur). */
function TuileNotes({ d, derniere, boosters, surVoir, surOuvrir }: { d: Donnees; derniere: Note | undefined; boosters: boolean; surVoir: () => void; surOuvrir: (n: Note[]) => void }) {
  if (boosters) {
    const ouvertes = notesOuvertes(d.notes);
    const nouvelles = d.notes.filter((n) => n.note !== null && !ouvertes.has(cleNote(n)));
    if (nouvelles.length) {
      return (
        <button type="button" class="tuile tuile-booster" onClick={() => surOuvrir(nouvelles)}>
          <span class="tuile-titre">{nouvelles.length > 1 ? 'Nouvelles notes' : 'Nouvelle note'}</span>
          <span class="tuile-valeur">{nouvelles.length}</span>
          <span class="tuile-cachee">Ouvrir {nouvelles.length > 1 ? 'les boosters' : 'le booster'}</span>
        </button>
      );
    }
    return (
      <button type="button" class="tuile" onClick={surVoir}>
        <span class="tuile-titre">Notes</span>
        <span class="tuile-valeur doux"><Icone nom="coche" taille={26} epaisseur={2.6} /></span>
        <span class="tuile-texte">Aucune nouvelle note</span>
      </button>
    );
  }
  return (
    <button type="button" class="tuile" onClick={surVoir}>
      <span class="tuile-titre">Dernière note</span>
      {derniere ? (
        <>
          <span class="tuile-valeur">{String(derniere.note).replace('.', ',')}<small>/20</small></span>
          <span class="tuile-texte">{derniere.cours} · {derniere.epreuve}</span>
        </>
      ) : <span class="tuile-texte">Aucune note publiée pour l'instant</span>}
    </button>
  );
}

function TuileAlertes({ recentes, surVoir }: { recentes: Donnees['alertes']; surVoir: () => void }) {
  return (
    <button type="button" class="tuile" onClick={surVoir}>
      <span class="tuile-titre">Alertes</span>
      <span class={`tuile-valeur ${recentes.length ? 'bleu' : ''}`}>{recentes.length}</span>
      <span class="tuile-texte">{recentes.length ? recentes[0].titre : 'Rien de neuf cette semaine'}</span>
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

/** Nouveaux fichiers de cours, depuis la dernière visite de l'onglet Cours sur cet appareil. */
function TuileFichiers({ d, surVoir }: { d: Donnees; surVoir: () => void }) {
  const vus = fichiersVus();
  const nouveaux = (d.cours ?? []).map((c) => ({ c, n: vus ? fichiersDe(c).filter((f) => !vus.has(f.cle)).length : 0 })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  const total = nouveaux.reduce((s, x) => s + x.n, 0);
  return (
    <button type="button" class="tuile" onClick={surVoir}>
      <span class="tuile-titre">Nouveaux fichiers</span>
      <span class={`tuile-valeur ${total ? 'bleu' : ''}`}>{total}</span>
      <span class="tuile-texte">{total ? nomCourt(nouveaux[0].c) + (nouveaux.length > 1 ? ` et ${nouveaux.length - 1} autre${nouveaux.length > 2 ? 's' : ''}` : '') : 'Rien de neuf dans tes cours'}</span>
    </button>
  );
}
