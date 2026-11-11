import { useEffect, useRef, useState } from 'preact/hooks';
import type { Donnees, EtiquetteMail, Mail } from '../types';
import * as api from '../api';
import { ilYA } from '../dates';
import { Icone, Segments, Vide } from '../composants';

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
  const [ouvert, setOuvert] = useState<Mail | null>(null);
  const donnees = d.mails!;

  const [copie, setCopie] = useState('');
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
            <button type="button" class={`carte alerte mail ${m.nonLu ? 'non-lu' : ''}`} onClick={() => setOuvert(m)}>
              <span class="alerte-haut">
                <span class="pastilles">
                  {m.categorie === 'prof' && <span class="pastille c-cours">Prof{m.matiere ? ` · ${m.matiere}` : ''}</span>}
                  {m.categorie === 'ecole' && <span class="pastille c-neutre">École</span>}
                  {m.etiquettes.map((e) => <span class={`pastille ${ETIQUETTES[e].classe}`}>{ETIQUETTES[e].nom}</span>)}
                </span>
                <span class="alerte-date">{ilYA(maintenant - m.date)}</span>
              </span>
              <span class="mail-sujet">{m.sujet}</span>
              <span class="mail-de">{m.de}</span>
              {m.extrait && <span class="mail-extrait">{m.extrait}</span>}
            </button>
          ))}
        </div>
      ) : <Vide icone="mail" titre="Aucun mail ici" texte="Rien sur les trois dernières semaines dans cette catégorie." />}
      {ouvert && (
        <FicheMail m={donnees.mails.find((x) => x.adresse === ouvert.adresse && x.date === ouvert.date) ?? ouvert} horsLigne={horsLigne}
          surFermer={() => setOuvert(null)}
          surCreerDevoir={(m) => { setOuvert(null); surCreerDevoir(m); }}
          surCorriger={async (m, categorie) => {
            const r = await api.corrigerExpediteur(m.adresse, categorie);
            surChange(r);
          }} />
      )}
      <p class="petit-texte">
        Mails des 3 dernières semaines{donnees.etat.derniereSynchro ? `, relus ${ilYA(maintenant - Date.parse(donnees.etat.derniereSynchro))}` : ''}.
        {donnees.etat.erreur ? ` Dernière tentative en échec : ${donnees.etat.erreur}` : ''}{' '}
        <button type="button" class="lien-texte" disabled={occupe || horsLigne} onClick={() => void activer(false)}>Ne plus lire mes mails</button>
      </p>
      <p class="petit-texte">
        <button type="button" class="lien-texte" onClick={() => void copierPourLeTri(donnees.mails).then(setCopie)}>{copie || 'Copier la liste pour améliorer le tri'}</button>
        {' '}(expéditeur, objet et classement seulement : pas le texte des mails).
      </p>
    </>
  );
}

const CATEGORIES = [{ id: 'prof', nom: 'Prof' }, { id: 'ecole', nom: 'École' }, { id: 'autre', nom: 'Autre' }] as const;

/** Un mail ouvert : texte complet, actions, et correction de la catégorie de l'expéditeur. */
function FicheMail({ m, horsLigne, surFermer, surCreerDevoir, surCorriger }: {
  m: Mail; horsLigne: boolean; surFermer: () => void; surCreerDevoir: (m: Mail) => void;
  surCorriger: (m: Mail, categorie: Mail['categorie'] | null) => Promise<void>;
}) {
  const fermer = useRef<HTMLButtonElement>(null);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState('');
  useEffect(() => {
    fermer.current?.focus();
    const touche = (ev: KeyboardEvent) => ev.key === 'Escape' && surFermer();
    document.addEventListener('keydown', touche);
    return () => document.removeEventListener('keydown', touche);
  }, [surFermer]);

  const corriger = async (categorie: Mail['categorie'] | null) => {
    setOccupe(true);
    setErreur('');
    try {
      await surCorriger(m, categorie);
    } catch (e) {
      setErreur((e as Error).message);
    } finally {
      setOccupe(false);
    }
  };

  const date = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(m.date);
  return (
    <div class="voile" onClick={(ev) => ev.target === ev.currentTarget && surFermer()}>
      <section class="feuille" role="dialog" aria-modal="true" aria-label={m.sujet}>
        <div class="feuille-haut">
          <span class="pastilles">
            {m.categorie === 'prof' && <span class="pastille c-cours">Prof{m.matiere ? ` · ${m.matiere}` : ''}</span>}
            {m.categorie === 'ecole' && <span class="pastille c-neutre">École</span>}
            {m.etiquettes.map((e) => <span class={`pastille ${ETIQUETTES[e].classe}`}>{ETIQUETTES[e].nom}</span>)}
          </span>
          <button type="button" class="rond" ref={fermer} onClick={surFermer} aria-label="Fermer"><Icone nom="fermer" taille={18} epaisseur={2.4} /></button>
        </div>
        <h2>{m.sujet}</h2>
        <p class="mail-meta"><strong>{m.de}</strong><br />{m.adresse} · {date}</p>
        <div class="mail-texte">{m.texte || m.extrait || 'Pas de texte.'}</div>
        {!m.texte && m.categorie === 'autre' && <p class="petit-texte">Seul le début des mails « Autre » est gardé. Classe l'expéditeur en Prof ou École pour lire ses mails en entier ici.</p>}

        <div class="mail-actions">
          {m.categorie === 'prof' && <button type="button" class="bouton petit" onClick={() => surCreerDevoir(m)}>Créer un devoir</button>}
          <a class="bouton petit secondaire" href={m.lien} target="_blank" rel="noopener noreferrer">Ouvrir PARTAGE</a>
        </div>

        <div class="correction">
          <p class="etiquette">Cet expéditeur est</p>
          <Segments options={CATEGORIES} valeur={m.categorie} etiquette="Catégorie de l'expéditeur"
            surChoix={(c) => { if (!occupe && !horsLigne && c !== m.categorie) void corriger(c); }} />
          <p class="petit-texte">
            {m.corrige ? 'Choisi par toi : appliqué à tous ses mails. ' : 'Deviné automatiquement. Ton choix s’appliquera à tous ses mails. '}
            {m.corrige && <button type="button" class="lien-texte" disabled={occupe || horsLigne} onClick={() => void corriger(null)}>Revenir au tri automatique</button>}
          </p>
          {erreur && <p class="erreur" role="alert">{erreur}</p>}
        </div>
      </section>
    </div>
  );
}

/** Résumé des mails à coller dans une discussion pour améliorer les règles de tri, sans leur contenu. */
async function copierPourLeTri(mails: Mail[]): Promise<string> {
  const lignes = mails.map((m) => [
    m.categorie + (m.corrige ? ' (corrigé)' : ''),
    m.de,
    m.adresse.replace(/^[^@]*/, '…'),
    m.sujet,
    m.etiquettes.join(',') || '-',
    m.matiere ?? '-',
  ].join(' | '));
  const texte = ['catégorie | expéditeur | domaine | objet | étiquettes | matière', ...lignes].join('\n');
  try {
    await navigator.clipboard.writeText(texte);
    return `${mails.length} mails copiés : colle-les dans la discussion`;
  } catch {
    return 'Copie impossible sur ce navigateur';
  }
}
