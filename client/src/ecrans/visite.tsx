/** Visite guidée : montrée au premier lancement, et rejouable depuis les réglages. */
import { useState } from 'preact/hooks';
import { Icone, type NomIcone } from '../composants';

const CLE = 'campus-plus:visite-vue';

export function visiteAFaire(): boolean {
  try { return !localStorage.getItem(CLE); } catch { return false; }
}

function marquerVue(): void {
  try { localStorage.setItem(CLE, '1'); } catch { /* rien à faire */ }
}

const ETAPES: { icone: NomIcone; titre: string; texte: string }[] = [
  { icone: 'soleil', titre: 'Bienvenue sur Campus+', texte: 'Ton planning, tes notes, tes cours et tes mails de CPE au même endroit. Voici le tour en 30 secondes.' },
  { icone: 'soleil', titre: 'Aujourd’hui', texte: 'Ton prochain cours en grand, avec sa salle, puis la suite de la journée et tes devoirs. Tire l’écran vers le bas pour actualiser.' },
  { icone: 'calendrier', titre: 'Planning', texte: 'En jour, en semaine ou en mois. Touche un créneau pour voir le détail ou lui ajouter un devoir.' },
  { icone: 'livre', titre: 'Cours', texte: 'Les fichiers e-campus de chaque matière, rangés par type : cours, TD, TP, examens. Les nouveaux sont signalés.' },
  { icone: 'boite', titre: 'Boîte', texte: 'Changements de salle, nouvelles notes, nouveaux fichiers. Tes mails PARTAGE peuvent aussi y être triés, si tu les actives.' },
  { icone: 'cloche', titre: 'Notifications', texte: 'Active-les dans les réglages (touche ton avatar) pour être prévenu même appli fermée. Sur iPhone, ajoute d’abord Campus+ à l’écran d’accueil.' },
];

export function Visite({ surFin }: { surFin: () => void }) {
  const [i, setI] = useState(0);
  const etape = ETAPES[i];
  const derniere = i === ETAPES.length - 1;
  const finir = () => { marquerVue(); surFin(); };
  return (
    <div class="voile centre" role="dialog" aria-modal="true" aria-labelledby="visite-titre">
      <div class="visite">
        <span class="visite-icone"><Icone nom={etape.icone} taille={30} epaisseur={2} /></span>
        <h2 id="visite-titre">{etape.titre}</h2>
        <p>{etape.texte}</p>
        <div class="visite-points" aria-label={`Étape ${i + 1} sur ${ETAPES.length}`}>
          {ETAPES.map((_, k) => <i class={k === i ? 'actif' : ''} />)}
        </div>
        <button type="button" class="bouton" onClick={derniere ? finir : () => setI(i + 1)}>{derniere ? 'C’est parti' : 'Suivant'}</button>
        {!derniere && <button type="button" class="lien-bouton" onClick={finir}>Passer</button>}
      </div>
    </div>
  );
}
