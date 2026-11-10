import { useMemo, useState } from 'preact/hooks';
import type { Cours, Donnees, ElementCours, Fichier } from '../types';
import { correspond, fichiersDe, nomCourt, parType, poleDe, semestreDe, sigle, taille, typeFichier } from '../cours';
import { affichageCours, choisirAffichage, type Affichage } from '../api';
import { ilYA } from '../dates';
import { Entete, Icone, Segments, Vide, type NomIcone } from '../composants';

interface Props {
  d: Donnees;
  maintenant: number;
  /** Clés des fichiers déjà vus sur cet appareil ; null la toute première fois (rien n'est « nouveau »). */
  vus: Set<string> | null;
  coursOuvert: number | null;
  surOuvrirCours: (id: number | null) => void;
}

export function CoursEcran({ d, maintenant, vus, coursOuvert, surOuvrirCours }: Props) {
  const cours = d.cours ?? [];
  const ouvert = coursOuvert !== null ? cours.find((c) => c.id === coursOuvert) : undefined;
  if (ouvert) return <DetailCours c={ouvert} vus={vus} surRetour={() => surOuvrirCours(null)} />;
  return <ListeCours d={d} maintenant={maintenant} vus={vus} surOuvrirCours={surOuvrirCours} />;
}

const estNouveau = (f: Fichier, vus: Set<string> | null) => vus !== null && !vus.has(f.cle);

function ListeCours({ d, maintenant, vus, surOuvrirCours }: { d: Donnees; maintenant: number; vus: Set<string> | null; surOuvrirCours: (id: number) => void }) {
  const cours = d.cours ?? [];
  const semestres = useMemo(() => [...new Set(cours.map(semestreDe))].sort(), [cours]);
  // Par défaut, le semestre qui a le plus de fichiers récents, sinon le premier.
  const [semestre, setSemestre] = useState(() => {
    const recents = semestres.map((s) => ({ s, n: cours.filter((c) => semestreDe(c) === s).flatMap(fichiersDe).filter((f) => f.modifie * 1000 > maintenant - 30 * 86_400_000).length }));
    return recents.sort((a, b) => b.n - a.n)[0]?.s ?? 'S5';
  });
  const [recherche, setRecherche] = useState('');

  if (d.cours === null) return (<><Entete titre="Cours" /><Vide icone="livre" titre="Bientôt disponible" texte="Le serveur ne gère pas encore les cours e-campus : il sera mis à jour automatiquement." /></>);

  const etat = d.etatCours;
  if (!cours.length) {
    return (
      <>
        <Entete surtitre="e-campus" titre="Cours" />
        <Vide icone="livre" titre={etat?.erreur ? 'Cours indisponibles' : 'Récupération en cours…'}
          texte={etat?.erreur ?? 'Le serveur copie tes cours et leurs fichiers depuis e-campus. Tire vers le bas dans une minute pour actualiser.'} />
      </>
    );
  }

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

function LigneFichier({ f, sous, nouveau }: { f: Fichier; sous?: string; nouveau: boolean }) {
  return (
    <a class="rangee" href={`/api/fichiers/${f.cle}`} target="_blank" rel="noopener">
      <span class="vignette c-examen petite" aria-hidden="true"><Icone nom="fichier" taille={18} /></span>
      <span class="rangee-texte">
        <strong>{f.nom}</strong>
        <span>{[sous, typeFichier(f), taille(f.taille)].filter(Boolean).join(' · ')}</span>
      </span>
      {nouveau && <span class="pastille-nouveau">NOUVEAU</span>}
    </a>
  );
}

const AFFICHAGES = [{ id: 'type', nom: 'Par type' }, { id: 'prof', nom: 'Rangement du prof' }] as const;

function DetailCours({ c, vus, surRetour }: { c: Cours; vus: Set<string> | null; surRetour: () => void }) {
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
      </header>
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
