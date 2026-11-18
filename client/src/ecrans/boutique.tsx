/** Easter egg : trois actualisations d'affilée ouvrent la (future) boutique du BDE de CPE. */
import { useEffect, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { Icone } from '../composants';

type Rayon = 'tout' | 'soirees' | 'vetements' | 'goodies';

const ARTICLES: { nom: string; texte: string; emoji: string; rayon: Exclude<Rayon, 'tout'>; fond: string; nouveau?: boolean }[] = [
  { nom: 'Puff CPUFF', texte: 'L’édition officielle des soirées', emoji: '💨', rayon: 'soirees', fond: 'linear-gradient(135deg, #6A3CC0, #E05AB8)', nouveau: true },
  { nom: 'Place de soirée', texte: 'Ton billet direct dans l’appli', emoji: '🎟️', rayon: 'soirees', fond: 'linear-gradient(135deg, #F59E0B, #EF4444)' },
  { nom: 'Écocup CPE', texte: 'À collectionner, une par soirée', emoji: '🥤', rayon: 'soirees', fond: 'linear-gradient(135deg, #0EA5E9, #22C55E)' },
  { nom: 'Sweat CPE Lyon', texte: 'Brodé, bleu CPE évidemment', emoji: '🧥', rayon: 'vetements', fond: 'linear-gradient(135deg, #035899, #1F6FB5)' },
  { nom: 'T-shirt de promo', texte: 'Avec le nom de ta promo', emoji: '👕', rayon: 'vetements', fond: 'linear-gradient(135deg, #0B7468, #2DD4BF)' },
  { nom: 'Gourde CPE', texte: 'Pour survivre aux TP de 4 h', emoji: '🧴', rayon: 'goodies', fond: 'linear-gradient(135deg, #64748B, #94A3B8)' },
  { nom: 'Tote bag', texte: 'Le poly, la gourde, la puff', emoji: '👜', rayon: 'goodies', fond: 'linear-gradient(135deg, #A8480A, #F59E0B)' },
  { nom: 'Pack de stickers', texte: 'Pour le PC et la gourde', emoji: '✨', rayon: 'goodies', fond: 'linear-gradient(135deg, #DB2777, #8B5CF6)' },
];

const RAYONS: { id: Rayon; nom: string }[] = [
  { id: 'tout', nom: 'Tout' }, { id: 'soirees', nom: 'Soirées' }, { id: 'vetements', nom: 'Vêtements' }, { id: 'goodies', nom: 'Goodies' },
];

export function Boutique({ surFermer }: { surFermer: () => void }) {
  const [rayon, setRayon] = useState<Rayon>('tout');
  const [tente, setTente] = useState<string | null>(null);
  useEffect(() => {
    const touche = (ev: KeyboardEvent) => ev.key === 'Escape' && surFermer();
    document.addEventListener('keydown', touche);
    return () => document.removeEventListener('keydown', touche);
  }, []);
  useEffect(() => {
    if (!tente) return;
    const t = setTimeout(() => setTente(null), 1800);
    return () => clearTimeout(t);
  }, [tente]);
  const visibles = ARTICLES.filter((a) => rayon === 'tout' || a.rayon === rayon);

  return createPortal(
    <div class="boutique" role="dialog" aria-modal="true" aria-label="Boutique du BDE">
      <header class="boutique-haut">
        <button type="button" class="lecteur-bouton" onClick={surFermer}><Icone nom="gauche" taille={20} epaisseur={2.4} />Retour</button>
        <span class="boutique-panier" aria-label="Panier vide"><Icone nom="boite" taille={20} epaisseur={2.2} /><i>0</i></span>
      </header>
      <div class="boutique-corps">
        <p class="boutique-surtitre">🤫 Tu as trouvé le passage secret</p>
        <h1>La boutique du BDE</h1>
        <div class="boutique-banniere">
          <span class="boutique-soon">Bientôt 🔜</span>
          <strong>Commande tes goodies et ton matos de soirée, directement dans Campus+.</strong>
          <span>Sweats, places de soirée, écocups… et les puffs CPUFF. Le BDE prépare le stock.</span>
        </div>
        <div class="filtres" role="tablist" aria-label="Rayons">
          {RAYONS.map((r) => (
            <button type="button" role="tab" aria-selected={rayon === r.id} class={`puce ${rayon === r.id ? 'active' : ''}`} onClick={() => setRayon(r.id)}>{r.nom}</button>
          ))}
        </div>
        <div class="boutique-grille">
          {visibles.map((a) => (
            <article class="article">
              <div class="article-image" style={{ background: a.fond }}>
                <span aria-hidden="true">{a.emoji}</span>
                {a.nouveau && <i class="article-badge">Nouveau</i>}
              </div>
              <h2>{a.nom}</h2>
              <p>{a.texte}</p>
              <div class="article-bas">
                <span class="article-prix">—,— €</span>
                <button type="button" class="article-ajout" aria-label={`Ajouter ${a.nom} au panier`} onClick={() => setTente(a.nom)}>
                  <Icone nom="plus" taille={18} epaisseur={2.6} />
                </button>
              </div>
            </article>
          ))}
        </div>
        <p class="petit-texte boutique-pied">Une idée de goodies ? Dis-le au BDE 💙</p>
      </div>
      {tente && <div class="boutique-toast" role="status">« {tente} » arrive bientôt 🔜</div>}
    </div>,
    document.getElementById('app') ?? document.body,
  );
}
