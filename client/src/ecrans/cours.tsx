import { useEffect, useMemo, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { enregistrer, Lecteur, partageDisponible, surIOS, usePartage } from './lecteur';
import type { Cours, Donnees, ElementCours, Evenement, Fichier } from '../types';
import { correspond, fichiersDe, nomCourt, parType, poleDe, semestreDe, sigle, taille, trierSemestres, typeFichier } from '../cours';
import { affichageCours, choisirAffichage, type Affichage } from '../api';
import { ilYA } from '../dates';
import { Entete, Icone, LigneExamen, Segments, Vide, type NomIcone } from '../composants';
import { examensAVenir } from '../planning';
import { memeMatiere } from '../afaire';

interface Props {
  d: Donnees;
  maintenant: number;
  /** Clés des fichiers déjà vus sur cet appareil ; null la toute première fois (rien n'est « nouveau »). */
  vus: Set<string> | null;
  coursOuvert: number | null;
  surOuvrirCours: (id: number | null) => void;
  surAjouterDevoir: (c: Cours) => void;
  surOuvrir: (e: Evenement) => void;
  surRecharger: () => Promise<void>;
}

export function CoursEcran({ d, maintenant, vus, coursOuvert, surOuvrirCours, surAjouterDevoir, surOuvrir, surRecharger }: Props) {
  const cours = d.cours ?? [];
  const ouvert = coursOuvert !== null ? cours.find((c) => c.id === coursOuvert) : undefined;
  if (ouvert) {
    const examens = examensAVenir(d.planning, maintenant, 120).filter((e) => memeMatiere(e.matiere, ouvert.nom));
    return <DetailCours c={ouvert} vus={vus} examens={examens} maintenant={maintenant} surOuvrir={surOuvrir} surRetour={() => surOuvrirCours(null)} surAjouterDevoir={() => surAjouterDevoir(ouvert)} />;
  }
  return <ListeCours d={d} maintenant={maintenant} vus={vus} surOuvrirCours={surOuvrirCours} surRecharger={surRecharger} />;
}

const estNouveau = (f: Fichier, vus: Set<string> | null) => vus !== null && !vus.has(f.cle);

function ListeCours({ d, maintenant, vus, surOuvrirCours, surRecharger }: { d: Donnees; maintenant: number; vus: Set<string> | null; surOuvrirCours: (id: number) => void; surRecharger: () => Promise<void> }) {
  const cours = d.cours ?? [];
  const semestres = useMemo(() => trierSemestres(cours.map(semestreDe)), [cours]);
  // Par défaut, le semestre qui a le plus de fichiers récents, sinon le premier.
  const [semestre, setSemestre] = useState(() => {
    const recents = semestres.filter((s) => s !== 'Ressources')
      .map((s) => ({ s, n: cours.filter((c) => semestreDe(c) === s).flatMap(fichiersDe).filter((f) => f.modifie * 1000 > maintenant - 30 * 86_400_000).length }));
    return recents.sort((a, b) => b.n - a.n)[0]?.s ?? semestres[0] ?? 'S5';
  });
  const [recherche, setRecherche] = useState('');

  if (d.cours === null) return (<><Entete titre="Cours" /><Vide icone="livre" titre="Bientôt disponible" texte="Le serveur ne gère pas encore les cours e-campus : il sera mis à jour automatiquement." /></>);

  const etat = d.etatCours;
  if (!cours.length) return <Recuperation etat={etat} surRecharger={surRecharger} />;

  if (recherche.trim()) {
    const resultats = cours.flatMap((c) => c.sections.flatMap((s) => s.elements.flatMap((e) => {
      const fichiers = e.fichiers.filter((f) => correspond(`${f.nom} ${e.nom} ${nomCourt(c)}`, recherche));
      if (fichiers.length) return fichiers.map((f) => ({ c, e, f }));
      return correspond(`${e.nom} ${nomCourt(c)} ${s.nom}`, recherche) ? [{ c, e, f: null as Fichier | null }] : [];
    })));
    return (
      <>
        <Entete surtitre="e-campus" titre="Cours" />
        <Recherche valeur={recherche} surChange={setRecherche} />
        {resultats.length ? (
          <div class="carte liste">
            {resultats.slice(0, 80).map(({ c, e, f }) => f
              ? <LigneFichier f={f} sous={`${nomCourt(c)} · ${e.nom}`} nouveau={estNouveau(f, vus)} />
              : <LigneElement e={e} sous={nomCourt(c)} />)}
          </div>
        ) : <Vide icone="loupe" titre="Aucun résultat" />}
      </>
    );
  }

  const duSemestre = cours.filter((c) => semestreDe(c) === semestre);
  const parPole = new Map<string, Cours[]>();
  for (const c of duSemestre) parPole.set(poleDe(c).nom, [...(parPole.get(poleDe(c).nom) ?? []), c]);

  return (
    <>
      <Entete surtitre="e-campus" titre="Cours" />
      <Recherche valeur={recherche} surChange={setRecherche} />
      {semestres.length > 1 && <Segments options={semestres.map((s) => ({ id: s, nom: s }))} valeur={semestre} surChoix={setSemestre} etiquette="Semestre" />}
      {[...parPole].map(([pole, liste]) => (
        <section class="bloc">
          <h2 class="titre-groupe">{pole}</h2>
          <div class="carte liste">
            {liste.map((c) => {
              const nouveaux = fichiersDe(c).filter((f) => estNouveau(f, vus)).length;
              return (
                <button type="button" class="rangee" onClick={() => surOuvrirCours(c.id)}>
                  <span class={`vignette ${poleDe(c).classe}`} aria-hidden="true">{sigle(c)}</span>
                  <span class="rangee-texte">
                    <strong>{nomCourt(c)}</strong>
                    <span>{fichiersDe(c).length} fichier{fichiersDe(c).length > 1 ? 's' : ''}</span>
                  </span>
                  {nouveaux > 0 && <span class="badge-bleu" aria-label={`${nouveaux} nouveaux`}>{nouveaux}</span>}
                  <span class="chevron"><Icone nom="droite" taille={16} epaisseur={2.4} /></span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
      <p class="petit-texte">
        Copiés sur le serveur {etat?.derniereSynchro ? ilYA(maintenant - Date.parse(etat.derniereSynchro)) : ''}.
        {etat?.ignores ? ` ${etat.ignores} fichier${etat.ignores > 1 ? 's' : ''} trop gros ${etat.ignores > 1 ? 'sont pris' : 'est pris'} directement sur e-campus quand tu l'ouvres.` : ''}
        {etat?.erreur ? ` Dernière tentative en échec : ${etat.erreur}` : ''}
      </p>
    </>
  );
}

function Recherche({ valeur, surChange }: { valeur: string; surChange: (v: string) => void }) {
  return (
    <label class="recherche">
      <Icone nom="loupe" taille={18} epaisseur={2.2} />
      <span class="masque">Rechercher un cours ou un fichier</span>
      <input type="search" placeholder="Rechercher un cours, un fichier…" value={valeur} onInput={(e) => surChange((e.target as HTMLInputElement).value)} />
    </label>
  );
}

const ICONES_ELEMENT: Record<string, NomIcone> = { forum: 'bulle', url: 'lien', resource: 'fichier', folder: 'fichier' };

function LigneElement({ e, sous }: { e: ElementCours; sous?: string }) {
  return (
    <a class="rangee" href={e.lien} target="_blank" rel="noopener noreferrer">
      <span class="vignette c-neutre petite" aria-hidden="true"><Icone nom={ICONES_ELEMENT[e.type] ?? 'lien'} taille={18} /></span>
      <span class="rangee-texte">
        <strong>{e.nom}</strong>
        <span>{sous ? `${sous} · ` : ''}sur e-campus</span>
      </span>
      <span class="chevron"><Icone nom="droite" taille={16} epaisseur={2.4} /></span>
    </a>
  );
}

/** Première copie des cours : barre de progression, et l'écran se met à jour tout seul. */
function Recuperation({ etat, surRecharger }: { etat: Donnees['etatCours']; surRecharger: () => Promise<void> }) {
  const p = etat?.progression;
  useEffect(() => {
    if (etat?.erreur) return;
    const minuteur = setInterval(() => void surRecharger().catch(() => undefined), 5000);
    return () => clearInterval(minuteur);
  }, [etat?.erreur]);
  if (etat?.erreur) {
    return (<><Entete surtitre="e-campus" titre="Cours" /><Vide icone="livre" titre="Cours indisponibles" texte={etat.erreur} /></>);
  }
  const part = p && p.total ? Math.round((100 * p.faits) / p.total) : null;
  return (
    <>
      <Entete surtitre="e-campus" titre="Cours" />
      <Vide icone="livre" titre="Récupération en cours…"
        texte={p ? `Copie des fichiers depuis e-campus : ${p.faits} sur ${p.total}. Ça peut prendre quelques minutes la première fois.` : 'Le serveur se connecte à e-campus et liste tes cours.'} />
      <div class="progression" role="progressbar" aria-label="Copie des cours" aria-valuemin={0} aria-valuemax={100} aria-valuenow={part ?? undefined}>
        <span class={part === null ? 'indetermine' : ''} style={part === null ? undefined : { width: `${Math.max(part, 3)}%` }} />
      </div>
    </>
  );
}

function LigneFichier({ f, sous, nouveau }: { f: Fichier; sous?: string; nouveau: boolean }) {
  const [vue, setVue] = useState<'' | 'lecteur' | 'actions'>('');
  return (
    <div class="rangee rangee-fichier">
      <button type="button" class="rangee-lien" onClick={() => setVue('lecteur')}>
        <span class="vignette c-examen petite" aria-hidden="true"><Icone nom="fichier" taille={18} /></span>
        <span class="rangee-texte">
          <strong>{f.nom}</strong>
          <span>{[sous, typeFichier(f), taille(f.taille)].filter(Boolean).join(' · ')}</span>
        </span>
        {nouveau && <span class="pastille-nouveau">NOUVEAU</span>}
      </button>
      <button type="button" class="action-fichier" aria-label={`Partager ou enregistrer ${f.nom}`} onClick={() => setVue('actions')}>
        <Icone nom="partager" taille={19} epaisseur={2.2} />
      </button>
      {vue === 'lecteur' && <Lecteur f={f} surFermer={() => setVue('')} />}
      {vue === 'actions' && <FicheFichier f={f} surOuvrir={() => setVue('lecteur')} surFermer={() => setVue('')} />}
    </div>
  );
}

/** Panneau d'un fichier : l'ouvrir, le partager (AirDrop, Fichiers, applis de notes…) ou l'enregistrer. */
function FicheFichier({ f, surOuvrir, surFermer }: { f: Fichier; surOuvrir: () => void; surFermer: () => void }) {
  const { partager, etat } = usePartage(f);
  const ios = surIOS();
  const partageable = partageDisponible();
  useEffect(() => {
    const touche = (ev: KeyboardEvent) => ev.key === 'Escape' && surFermer();
    document.addEventListener('keydown', touche);
    return () => document.removeEventListener('keydown', touche);
  }, []);

  return createPortal(
    <div class="voile" onClick={(ev) => ev.target === ev.currentTarget && surFermer()}>
      <section class="feuille" role="dialog" aria-modal="true" aria-label={f.nom}>
        <div class="feuille-haut">
          <span class="pastille c-examen">{typeFichier(f) || 'Fichier'} · {taille(f.taille)}</span>
          <button type="button" class="rond" onClick={surFermer} aria-label="Fermer"><Icone nom="fermer" taille={18} epaisseur={2.4} /></button>
        </div>
        <h2 class="nom-fichier">{f.nom}</h2>
        <div class="actions-fichier">
          <button type="button" class="bouton large" onClick={surOuvrir}><Icone nom="fichier" taille={18} epaisseur={2.4} />&nbsp;Ouvrir</button>
          {partageable && (
            <button type="button" class="bouton secondaire large" disabled={etat === 'preparation'} onClick={() => void partager()}>
              <Icone nom="partager" taille={18} epaisseur={2.4} />&nbsp;{etat === 'preparation' ? 'Préparation…' : ios ? 'Partager ou enregistrer…' : 'Partager…'}
            </button>
          )}
          {!(ios && partageable) && (
            <button type="button" class="bouton secondaire large" onClick={() => enregistrer(f)}>
              <Icone nom="telecharger" taille={18} epaisseur={2.4} />&nbsp;Enregistrer sur l’appareil
            </button>
          )}
        </div>
        <p class="petit-texte">
          {etat === 'erreur' ? 'Le fichier n’a pas pu être préparé : réessaie dans un instant.'
            : ios && partageable ? 'Choisis « Enregistrer dans Fichiers » pour le garder sur ton iPhone ou iPad, ou AirDrop, ou une appli de notes.'
            : partageable ? '« Partager » ouvre le menu de l’appareil : AirDrop, Fichiers, applis de notes…'
            : '« Enregistrer » le met dans tes téléchargements.'}
        </p>
      </section>
    </div>,
    document.getElementById('app') ?? document.body,
  );
}

const AFFICHAGES = [{ id: 'type', nom: 'Par type' }, { id: 'prof', nom: 'Rangement du prof' }] as const;

interface PropsDetail {
  c: Cours;
  vus: Set<string> | null;
  examens: Evenement[];
  maintenant: number;
  surOuvrir: (e: Evenement) => void;
  surRetour: () => void;
  surAjouterDevoir: () => void;
}

function DetailCours({ c, vus, examens, maintenant, surOuvrir, surRetour, surAjouterDevoir }: PropsDetail) {
  const pole = poleDe(c);
  const [affichage, setAffichage] = useState<Affichage>(() => affichageCours(c.id));
  const changer = (a: Affichage) => { setAffichage(a); choisirAffichage(c.id, a); };
  const liens = c.sections.flatMap((s) => s.elements.filter((e) => !e.fichiers.length));
  const aDesFichiers = c.sections.some((s) => s.elements.some((e) => e.fichiers.length));

  return (
    <>
      <button type="button" class="retour" onClick={surRetour}><Icone nom="gauche" epaisseur={2.4} />Cours</button>
      <header class="entete-cours">
        <span class={`vignette grande ${pole.classe}`} aria-hidden="true">{sigle(c)}</span>
        <h1>{nomCourt(c)}</h1>
        <div class="pastilles">
          <span class="pastille c-neutre">{semestreDe(c)} · {pole.nom}</span>
        </div>
        <button type="button" class="bouton secondaire petit" onClick={surAjouterDevoir}>
          <Icone nom="plus" taille={16} epaisseur={2.6} />&nbsp;Devoir pour ce cours
        </button>
      </header>
      {examens.length > 0 && (
        <section class="bloc" aria-label="Examens à venir">
          <h2 class="titre-groupe rouge">{examens.length > 1 ? 'Examens à venir' : 'Examen à venir'}</h2>
          <div class="carte liste">
            {examens.map((e) => <LigneExamen e={e} maintenant={maintenant} surOuvrir={surOuvrir} />)}
          </div>
        </section>
      )}
      {aDesFichiers && <Segments options={AFFICHAGES} valeur={affichage} surChoix={changer} etiquette="Affichage des fichiers" />}

      {affichage === 'type' && aDesFichiers ? (
        <>
          {parType(c).map(({ type, fichiers }) => (
            <section class="bloc">
              <h2 class="titre-groupe">{type.nom} <span class="compte">{fichiers.length}</span></h2>
              <div class="carte liste">
                {fichiers.map(({ f, element, section }) => (
                  <LigneFichier f={f} sous={[...new Set([section, element, f.dossier].filter(Boolean))].join(' / ')} nouveau={estNouveau(f, vus)} />
                ))}
              </div>
            </section>
          ))}
          {liens.length > 0 && (
            <section class="bloc">
              <h2 class="titre-groupe">Sur e-campus</h2>
              <div class="carte liste">{liens.map((e) => <LigneElement e={e} />)}</div>
            </section>
          )}
          <p class="petit-texte">Rangement deviné d'après le nom des fichiers et des sections. Pour retrouver l'organisation du prof, choisis « Rangement du prof ».</p>
        </>
      ) : (
        c.sections.map((s) => (
          <section class="bloc">
            <h2 class="titre-groupe">{s.nom}</h2>
            <div class="carte liste">
              {s.elements.map((e) => e.fichiers.length
                ? e.fichiers.map((f) => <LigneFichier f={f} sous={e.type === 'folder' ? [...new Set([e.nom, f.dossier].filter(Boolean))].join(' / ') : undefined} nouveau={estNouveau(f, vus)} />)
                : <LigneElement e={e} />)}
            </div>
          </section>
        ))
      )}
      {!c.sections.length && <Vide icone="livre" titre="Ce cours est vide pour l'instant" />}
    </>
  );
}
