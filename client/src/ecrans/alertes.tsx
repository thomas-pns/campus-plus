import type { Alerte, Donnees, Evenement } from '../types';
import { ilYA } from '../dates';
import { useState } from 'preact/hooks';
import { Entete, Icone, Segments, Vide, type NomIcone } from '../composants';
import { Mails } from './mails';
import type { Mail } from '../types';

const TYPES: Record<Alerte['type'], { nom: string; classe: string; icone: NomIcone }> = {
  salle: { nom: 'Salle', classe: 'c-examen', icone: 'lieu' },
  horaire: { nom: 'Horaire', classe: 'c-tp', icone: 'horloge' },
  supprime: { nom: 'Créneau retiré', classe: 'c-neutre', icone: 'calendrier' },
  ajoute: { nom: 'Nouveau créneau', classe: 'c-cours', icone: 'calendrier' },
  note: { nom: 'Note', classe: 'c-langues', icone: 'note' },
  fichier: { nom: 'Cours', classe: 'c-td', icone: 'fichier' },
  devoir: { nom: 'Devoir', classe: 'c-tp', icone: 'liste' },
  mail: { nom: 'Mail', classe: 'c-cours', icone: 'mail' },
  examen: { nom: 'Examen', classe: 'c-examen', icone: 'calendrier' },
};

interface Props {
  d: Donnees;
  maintenant: number;
  /** Date (ISO) jusqu'à laquelle les alertes ont déjà été vues. */
  vuesJusqua: string;
  surOuvrir: (e: Evenement) => void;
  surAller: (onglet: 'scolarite') => void;
  surOuvrirCours: (id: number) => void;
  surDevoirs: () => void;
  horsLigne: boolean;
  surChangeMails: (m: NonNullable<Donnees['mails']>) => void;
  surCreerDevoir: (m: Mail) => void;
}

const RUBRIQUES = [{ id: 'alertes', nom: 'Alertes' }, { id: 'mails', nom: 'Mails' }] as const;

export function Alertes({ d, maintenant, vuesJusqua, surOuvrir, surAller, surOuvrirCours, surDevoirs, horsLigne, surChangeMails, surCreerDevoir }: Props) {
  const [rubrique, setRubrique] = useState<'alertes' | 'mails'>('alertes');
  return (
    <>
      <Entete surtitre={rubrique === 'mails' ? 'PARTAGE, triés' : 'Changements détectés'} titre="Boîte" />
      {d.mails && <Segments options={RUBRIQUES} valeur={rubrique} surChoix={setRubrique} etiquette="Rubrique" />}
      {rubrique === 'mails' && d.mails ? (
        <Mails d={d} maintenant={maintenant} horsLigne={horsLigne} surChange={surChangeMails} surCreerDevoir={surCreerDevoir} />
      ) : d.alertes.length ? (
        <div class="liste-alertes">
          {d.alertes.map((a) => {
            const t = TYPES[a.type];
            const evenement = a.cleEvenement ? d.planning.find((e) => e.cle === a.cleEvenement) : undefined;
            const action = a.type === 'note' ? () => surAller('scolarite')
              : a.type === 'mail' ? () => setRubrique('mails')
              : a.type === 'devoir' ? surDevoirs
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
                {action && <button type="button" class="bouton petit" onClick={action}>{a.type === 'note' ? 'Voir mes notes' : a.type === 'fichier' ? 'Ouvrir le cours' : a.type === 'devoir' ? 'Voir mes devoirs' : a.type === 'mail' ? 'Voir les mails' : 'Voir le créneau'}</button>}
              </article>
            );
          })}
        </div>
      ) : (
        <Vide icone="cloche" titre="Rien de neuf" texte="Changements de salle ou d'horaire dans les deux semaines à venir, créneaux ajoutés ou retirés, nouvelles notes, nouveaux fichiers et devoirs : tout apparaîtra ici." />
      )}
    </>
  );
}
