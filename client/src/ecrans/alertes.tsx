import type { Alerte, Donnees, Evenement } from '../types';
import { ilYA } from '../dates';
import { Entete, Icone, Vide, type NomIcone } from '../composants';

const TYPES: Record<Alerte['type'], { nom: string; classe: string; icone: NomIcone }> = {
  salle: { nom: 'Salle', classe: 'c-examen', icone: 'lieu' },
  horaire: { nom: 'Horaire', classe: 'c-tp', icone: 'horloge' },
  supprime: { nom: 'Créneau retiré', classe: 'c-neutre', icone: 'calendrier' },
  ajoute: { nom: 'Nouveau créneau', classe: 'c-cours', icone: 'calendrier' },
  note: { nom: 'Note', classe: 'c-langues', icone: 'note' },
  fichier: { nom: 'Cours', classe: 'c-td', icone: 'fichier' },
};

interface Props {
  d: Donnees;
  maintenant: number;
  /** Date (ISO) jusqu'à laquelle les alertes ont déjà été vues. */
  vuesJusqua: string;
  surOuvrir: (e: Evenement) => void;
  surAller: (onglet: 'scolarite') => void;
  surOuvrirCours: (id: number) => void;
}

export function Alertes({ d, maintenant, vuesJusqua, surOuvrir, surAller, surOuvrirCours }: Props) {
  return (
    <>
      <Entete surtitre="Changements détectés" titre="Alertes" />
      {d.alertes.length ? (
        <div class="liste-alertes">
          {d.alertes.map((a) => {
            const t = TYPES[a.type];
            const evenement = a.cleEvenement ? d.planning.find((e) => e.cle === a.cleEvenement) : undefined;
            const action = a.type === 'note' ? () => surAller('scolarite')
              : a.type === 'fichier' && a.cours !== undefined ? () => surOuvrirCours(a.cours!)
              : evenement ? () => surOuvrir(evenement) : undefined;
            return (
              <article class={`carte alerte ${a.date > vuesJusqua ? 'nouvelle' : ''}`}>
                <div class="alerte-haut">
                  <span class={`pastille ${t.classe}`}><Icone nom={t.icone} taille={14} epaisseur={2.2} />{t.nom}</span>
                  <span class="alerte-date">{ilYA(maintenant - Date.parse(a.date))}</span>
                </div>
                <h2>{a.titre}</h2>
                <p>{a.detail}</p>
                {action && <button type="button" class="bouton petit" onClick={action}>{a.type === 'note' ? 'Voir mes notes' : a.type === 'fichier' ? 'Ouvrir le cours' : 'Voir le créneau'}</button>}
              </article>
            );
          })}
        </div>
      ) : (
        <Vide icone="cloche" titre="Rien de neuf" texte="Changements de salle ou d'horaire dans les deux semaines à venir, créneaux ajoutés ou retirés, nouvelles notes, nouveaux fichiers de cours : tout apparaîtra ici." />
      )}
    </>
  );
}
