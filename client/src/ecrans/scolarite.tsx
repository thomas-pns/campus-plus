import { useState } from 'preact/hooks';
import type { Donnees, Note } from '../types';
import { Entete, Icone, Segments, Vide, type NomIcone } from '../composants';

const RUBRIQUES = [{ id: 'notes', nom: 'Notes' }, { id: 'absences', nom: 'Absences' }, { id: 'liens', nom: 'Liens' }] as const;
type Rubrique = (typeof RUBRIQUES)[number]['id'];

/** Sites de l'école utiles mais qu'on n'intègre pas dans l'appli (connexion propre à chaque site). */
const LIENS: { nom: string; texte: string; adresse: string; icone: NomIcone; couleur: string }[] = [
  { nom: 'MyCPE', texte: 'Certificats de scolarité, bulletins, justificatifs d’absence', adresse: 'https://mycpe.cpe.fr/', icone: 'diplome', couleur: 'bleu' },
  { nom: 'e-campus', texte: 'Cours, dépôts de devoirs, forums', adresse: 'https://e-campus.cpe.fr/', icone: 'livre', couleur: 'sarcelle' },
  { nom: 'PARTAGE', texte: 'Messagerie de l’école', adresse: 'https://partage.cpe.fr/', icone: 'mail', couleur: 'bleu-fonce' },
  { nom: 'FileSender', texte: 'Envoyer de gros fichiers (connexion CPE)', adresse: 'https://filesender.renater.fr/', icone: 'partager', couleur: 'violet' },
  { nom: 'Support informatique', texte: 'Compte, mot de passe, Wi-Fi', adresse: 'https://support.cpe.fr/', icone: 'serveur', couleur: 'gris' },
];

const fr = (n: number) => String(n).replace('.', ',');

/** Regroupe en gardant l'ordre d'arrivée. */
function grouper<T>(elements: T[], cle: (e: T) => string): [string, T[]][] {
  const groupes = new Map<string, T[]>();
  for (const e of elements) groupes.set(cle(e), [...(groupes.get(cle(e)) ?? []), e]);
  return [...groupes];
}

export function Scolarite({ d }: { d: Donnees }) {
  const [rubrique, setRubrique] = useState<Rubrique>('notes');
  const publiees = d.notes.filter((n) => n.note !== null).length;
  const semestres = grouper(d.notes, (n) => n.semestre);

  return (
    <>
      <Entete surtitre="Notes et absences" titre="Scolarité" />
      <Segments options={RUBRIQUES} valeur={rubrique} surChoix={setRubrique} etiquette="Rubrique" />

      <section class="tuiles" aria-label="Résumé">
        <div class="tuile pleine">
          <span class="tuile-titre">Notes publiées</span>
          <span class="tuile-valeur">{publiees}</span>
          <span class="tuile-texte">provisoires jusqu'au jury</span>
        </div>
        <div class="tuile">
          <span class="tuile-titre">Absences</span>
          <span class={`tuile-valeur ${d.absences.length ? '' : 'vert'}`}>{d.absences.length}</span>
          <span class="tuile-texte">{d.absences.length ? 'enregistrées' : 'aucune enregistrée'}</span>
        </div>
      </section>

      {rubrique === 'liens' ? (
        <section class="bloc">
          <div class="carte liste">
            {LIENS.map((l) => (
              <a class="rangee" href={l.adresse} target="_blank" rel="noopener noreferrer">
                <span class={`icone-rangee ${l.couleur}`}><Icone nom={l.icone} taille={17} epaisseur={2.2} /></span>
                <span class="rangee-texte"><strong>{l.nom}</strong><span>{l.texte}</span></span>
                <span class="rangee-valeur"><Icone nom="droite" taille={14} epaisseur={2.4} /></span>
              </a>
            ))}
          </div>
          <p class="petit-texte">Ces sites s’ouvrent dans le navigateur, avec leur propre connexion.</p>
        </section>
      ) : rubrique === 'notes' ? (
        d.notes.length ? semestres.map(([semestre, notes]) => (
          <div>
            {semestres.length > 1 && <h2 class="titre-bloc semestre">{semestre}</h2>}
            {grouper(notes, (n) => n.module).map(([module, duModule]) => (
              <section class="bloc">
                <h3 class="titre-groupe">{module || 'Autres'}</h3>
                {grouper(duModule, (n) => n.cours).map(([cours, epreuves]) => (
                  <CarteCours cours={cours} epreuves={epreuves} moyenne={d.moyennes.find((m) => m.semestre === semestre && m.module === module && m.cours === cours)?.moyenne ?? null} />
                ))}
              </section>
            ))}
          </div>
        )) : <Vide icone="note" titre="Aucune note pour l'instant" texte="Elles apparaîtront ici dès leur publication sur MyCPE." />
      ) : d.absences.length ? (
        <section class="bloc">
          <div class="carte liste">
            {d.absences.map((a) => (
              <div class="rangee">
                <span class="rangee-texte">
                  <strong>{a.matiere || a.cours}</strong>
                  <span>{[a.date, a.horaire, a.duree].filter(Boolean).join(' · ')}</span>
                  {a.intervenant && <span>{a.intervenant}</span>}
                </span>
                <span class={`pastille ${/non|inj/i.test(a.motif) ? 'c-examen' : 'c-neutre'}`}>{a.motif || 'Sans motif'}</span>
              </div>
            ))}
          </div>
        </section>
      ) : <Vide icone="diplome" titre="Aucune absence" texte="Rien n'est enregistré sur MyCPE." />}
    </>
  );
}

function CarteCours({ cours, epreuves, moyenne }: { cours: string; epreuves: Note[]; moyenne: number | null }) {
  return (
    <div class="carte cours-notes">
      <div class="cours-haut">
        <strong>{cours}</strong>
        {moyenne !== null && epreuves.length > 1 && <span class="moyenne">moy. {fr(moyenne)}</span>}
      </div>
      {epreuves.map((n) => (
        <div class="epreuve">
          <div class="epreuve-ligne">
            <span class="rangee-texte">
              <strong>{n.epreuve}</strong>
              <span>{n.coefficient !== null ? `Coefficient ${fr(n.coefficient)}` : 'Sans coefficient'}{n.motifAbsence ? ` · ${n.motifAbsence}` : ''}</span>
            </span>
            {n.note !== null ? <span class={`valeur-note ${n.note < 10 ? 'basse' : ''}`}>{fr(n.note)}</span> : <span class="valeur-note attente">—</span>}
          </div>
          {n.note !== null && (
            <div class="jauge" role="img" aria-label={`${fr(n.note)} sur 20`}>
              <i class={n.note < 10 ? 'basse' : ''} style={{ width: `${Math.max(0, Math.min(100, n.note * 5))}%` }} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
