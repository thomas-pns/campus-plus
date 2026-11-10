import { useRef, useState } from 'preact/hooks';
import type { Donnees, Echeance, Tache } from '../types';
import * as api from '../api';
import { ajouterJours, jourParis, libelleJour } from '../dates';
import { grouper, lignes, NOMS_GROUPES, type Ligne } from '../afaire';
import { Icone, Vide } from '../composants';

/** « mer. 12 nov. » ; « aujourd'hui », « demain » quand c'est plus parlant. */
export function quand(l: Ligne, maintenant: number): string {
  if (!l.jour) return '';
  const auj = jourParis(maintenant);
  const jour = l.jour === auj ? "aujourd'hui" : l.jour === ajouterJours(auj, 1) ? 'demain' : libelleJour(l.jour, { weekday: 'short', day: 'numeric', month: 'short' });
  return l.heure ? `${jour} à ${l.heure.replace(':', 'h')}` : jour;
}

interface PropsLigne { l: Ligne; maintenant: number; surCocher: (l: Ligne) => void; surSupprimer?: (l: Ligne) => void }

export function LigneAFaire({ l, maintenant, surCocher, surSupprimer }: PropsLigne) {
  const echeance = l.source.type === 'echeance' ? l.source.e : null;
  return (
    <div class={`rangee afaire ${l.fait ? 'fait' : ''}`}>
      <button type="button" role="checkbox" aria-checked={l.fait} aria-label={l.fait ? `Marquer « ${l.titre} » comme à faire` : `Marquer « ${l.titre} » comme fait`}
        class={`case ${l.fait ? 'cochee' : ''}`} onClick={() => surCocher(l)}>
        {l.fait && <Icone nom="coche" taille={14} epaisseur={3.2} />}
      </button>
      <span class="rangee-texte">
        <strong>{l.titre}</strong>
        <span>{l.sous}{l.jour ? ' · ' : ''}<span class={l.enRetard ? 'rouge' : ''}>{quand(l, maintenant)}</span></span>
      </span>
      {echeance && (
        <a class="lien-rond" href={echeance.lien} target="_blank" rel="noopener noreferrer" aria-label={`Ouvrir « ${l.titre} » sur e-campus`}>
          <Icone nom="lien" taille={17} />
        </a>
      )}
      {surSupprimer && l.source.type === 'tache' && (
        <button type="button" class="lien-rond" onClick={() => surSupprimer(l)} aria-label={`Supprimer « ${l.titre} »`}><Icone nom="corbeille" taille={17} /></button>
      )}
    </div>
  );
}

/** Coche ou décoche, côté serveur, puis renvoie les données à jour. */
export async function basculer(l: Ligne, afaire: { echeances: Echeance[]; taches: Tache[] }) {
  if (l.source.type === 'echeance') {
    const id = l.source.e.id;
    const { echeancesFaites } = await api.marquerEcheance(id, !l.fait);
    return { ...afaire, echeances: afaire.echeances.map((e) => ({ ...e, fait: echeancesFaites.includes(e.id) })) };
  }
  const { tache } = await api.changerTache(l.source.t.id, { fait: !l.fait });
  return { ...afaire, taches: afaire.taches.map((t) => (t.id === tache.id ? tache : t)) };
}

interface Props {
  d: Donnees;
  maintenant: number;
  horsLigne: boolean;
  surRetour: () => void;
  surChange: (afaire: NonNullable<Donnees['afaire']>) => void;
}

export function Devoirs({ d, maintenant, horsLigne, surRetour, surChange }: Props) {
  const afaire = d.afaire ?? { echeances: [], taches: [] };
  const [titre, setTitre] = useState('');
  const [echeance, setEcheance] = useState('');
  const [erreur, setErreur] = useState('');
  const [occupe, setOccupe] = useState(false);
  const champ = useRef<HTMLInputElement>(null);
  const liste = lignes(afaire.echeances, afaire.taches, maintenant);
  const restants = liste.filter((l) => !l.fait).length;

  const agir = async (action: () => Promise<NonNullable<Donnees['afaire']>>) => {
    setErreur('');
    try {
      surChange(await action());
    } catch (e) {
      setErreur((e as Error).message);
    }
  };

  const ajouter = async (ev: Event) => {
    ev.preventDefault();
    if (!titre.trim() || occupe) return;
    setOccupe(true);
    await agir(async () => {
      const { tache } = await api.ajouterTache({ titre: titre.trim(), echeance: echeance || null });
      setTitre('');
      setEcheance('');
      champ.current?.focus();
      return { ...afaire, taches: [...afaire.taches, tache] };
    });
    setOccupe(false);
  };

  return (
    <>
      <button type="button" class="retour" onClick={surRetour}><Icone nom="gauche" epaisseur={2.4} />Aujourd'hui</button>
      <header class="entete">
        <div class="entete-textes">
          <p class="surtitre">{restants} à faire</p>
          <h1>Devoirs</h1>
        </div>
      </header>

      <form class="carte ajout" onSubmit={ajouter}>
        <label class="masque" for="nouvelle-tache">Nouvelle tâche</label>
        <input id="nouvelle-tache" ref={champ} type="text" placeholder="Ajouter une tâche…" maxLength={200} value={titre}
          disabled={horsLigne} onInput={(e) => setTitre((e.target as HTMLInputElement).value)} />
        <label class="masque" for="echeance-tache">Échéance (facultative)</label>
        <input id="echeance-tache" type="date" value={echeance} disabled={horsLigne} onInput={(e) => setEcheance((e.target as HTMLInputElement).value)} />
        <button type="submit" class="rond plein" disabled={!titre.trim() || occupe || horsLigne} aria-label="Ajouter"><Icone nom="plus" taille={20} epaisseur={2.6} /></button>
      </form>
      {erreur && <p class="erreur" role="alert">{erreur}</p>}

      {liste.length ? grouper(liste, maintenant).map(([g, lignesGroupe]) => (
        <section class="bloc">
          <h2 class={`titre-groupe ${g === 'retard' ? 'rouge' : ''}`}>{NOMS_GROUPES[g]} <span class="compte">{lignesGroupe.length}</span></h2>
          <div class="carte liste">
            {lignesGroupe.map((l) => (
              <LigneAFaire l={l} maintenant={maintenant}
                surCocher={(x) => void agir(() => basculer(x, afaire))}
                surSupprimer={(x) => void agir(async () => {
                  await api.supprimerTache((x.source as { t: Tache }).t.id);
                  return { ...afaire, taches: afaire.taches.filter((t) => t.id !== (x.source as { t: Tache }).t.id) };
                })} />
            ))}
          </div>
        </section>
      )) : <Vide icone="liste" titre="Rien à faire" texte="Les devoirs et tests d'e-campus apparaîtront ici avec leur date limite. Tu peux aussi ajouter tes propres tâches." />}

      <p class="petit-texte">Les devoirs e-campus viennent du bloc « Chronologie » d'e-campus : ils disparaissent quand tu les as rendus sur e-campus. Les cocher ici ne les rend pas.</p>
    </>
  );
}
