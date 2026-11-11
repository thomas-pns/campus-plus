import { useState } from 'preact/hooks';
import type { Donnees, EtiquetteMail, Mail } from '../types';
import * as api from '../api';
import { ilYA } from '../dates';
import { Icone, Vide } from '../composants';

const ETIQUETTES: Record<EtiquetteMail, { nom: string; classe: string }> = {
  salle: { nom: 'Salle', classe: 'c-examen' },
  annulation: { nom: 'Annulation', classe: 'c-examen' },
  examen: { nom: 'Examen', classe: 'c-langues' },
  devoir: { nom: 'Devoir', classe: 'c-td' },
  cours: { nom: 'Cours', classe: 'c-cours' },
};

const FILTRES = [
  { id: 'importants', nom: 'Importants', garde: (m: Mail) => m.categorie !== 'autre' },
  { id: 'profs', nom: 'Profs', garde: (m: Mail) => m.categorie === 'prof' },
  { id: 'salles', nom: 'Salles', garde: (m: Mail) => m.etiquettes.includes('salle') || m.etiquettes.includes('annulation') },
  { id: 'devoirs', nom: 'Devoirs', garde: (m: Mail) => m.etiquettes.includes('devoir') },
  { id: 'tous', nom: 'Tous', garde: () => true },
] as const;
type Filtre = (typeof FILTRES)[number]['id'];

interface Props {
  d: Donnees;
  maintenant: number;
  horsLigne: boolean;
  surChange: (mails: NonNullable<Donnees['mails']>) => void;
  surCreerDevoir: (m: Mail) => void;
}

export function Mails({ d, maintenant, horsLigne, surChange, surCreerDevoir }: Props) {
  const [filtre, setFiltre] = useState<Filtre>('importants');
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState('');
  const donnees = d.mails!;

  const activer = async (actif: boolean) => {
    setOccupe(true);
    setErreur('');
    try {
      const r = await api.activerMails(actif);
      surChange(r);
      if (actif && r.etat.erreur) setErreur(r.etat.erreur);
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setOccupe(false);
    }
  };

  if (!donnees.etat.actif) {
    return (
      <div class="carte activation">
        <span class="vignette c-cours grande" aria-hidden="true"><Icone nom="mail" taille={26} /></span>
        <h2>Tes mails PARTAGE, triés</h2>
        <p>Les mails de tes profs et de l'école remontent ici, avec une étiquette quand ils parlent d'une salle, d'un devoir, d'un examen ou d'une nouvelle version du cours.</p>
        <p class="petit-texte">Le serveur se connecte à PARTAGE avec tes identifiants CPE, en lecture seule (rien n'est envoyé ni marqué comme lu). Il ne garde que l'expéditeur, l'objet et un court extrait, chiffrés. Tu peux couper quand tu veux.</p>
        {(erreur || donnees.etat.erreur) && <p class="erreur" role="alert">{erreur || donnees.etat.erreur}</p>}
        <button type="button" class="bouton large" disabled={occupe || horsLigne} onClick={() => void activer(true)}>{occupe ? 'Lecture de tes mails…' : 'Activer'}</button>
      </div>
    );
  }

  const garde = FILTRES.find((f) => f.id === filtre)!.garde;
  const liste = donnees.mails.filter(garde);

  return (
    <>
      <div class="filtres" role="tablist" aria-label="Filtres">
        {FILTRES.map((f) => (
          <button type="button" role="tab" aria-selected={f.id === filtre} class={f.id === filtre ? 'actif' : ''} onClick={() => setFiltre(f.id)}>{f.nom}</button>
        ))}
      </div>
      {liste.length ? (
        <div class="liste-alertes">
          {liste.map((m) => (
            <article class="carte alerte mail">
              <div class="alerte-haut">
                <span class="pastilles">
                  {m.categorie === 'prof' && <span class="pastille c-cours">Prof{m.matiere ? ` · ${m.matiere}` : ''}</span>}
                  {m.categorie === 'ecole' && <span class="pastille c-neutre">École</span>}
                  {m.etiquettes.map((e) => <span class={`pastille ${ETIQUETTES[e].classe}`}>{ETIQUETTES[e].nom}</span>)}
                </span>
                <span class="alerte-date">{ilYA(maintenant - m.date)}</span>
              </div>
              <h2>{m.sujet}</h2>
              <p class="mail-de">{m.de}</p>
              {m.extrait && <p class="mail-extrait">{m.extrait}</p>}
              <div class="actions">
                {m.categorie === 'prof' && <button type="button" class={`bouton petit ${m.etiquettes.includes('devoir') ? '' : 'secondaire'}`} onClick={() => surCreerDevoir(m)}>Créer un devoir</button>}
                <a class="bouton petit secondaire" href={m.lien} target="_blank" rel="noopener noreferrer">Voir le mail</a>
              </div>
            </article>
          ))}
        </div>
      ) : <Vide icone="mail" titre="Aucun mail ici" texte="Rien sur les trois dernières semaines dans cette catégorie." />}
      <p class="petit-texte">
        Mails des 3 dernières semaines{donnees.etat.derniereSynchro ? `, relus ${ilYA(maintenant - Date.parse(donnees.etat.derniereSynchro))}` : ''}.
        {donnees.etat.erreur ? ` Dernière tentative en échec : ${donnees.etat.erreur}` : ''}{' '}
        <button type="button" class="lien-texte" disabled={occupe || horsLigne} onClick={() => void activer(false)}>Ne plus lire mes mails</button>
      </p>
    </>
  );
}
