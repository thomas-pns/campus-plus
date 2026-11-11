import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { Donnees } from '../types';
import { ilYA, initialesDe } from '../dates';
import { Avatar, Icone, type NomIcone } from '../composants';
import { choisirTheme, lireTheme, type Theme } from '../theme';
import { Interrupteur, ReglagesNotifications } from './notifications';
import { changerPreferences, lirePreferences, type Preferences, type Tuile } from '../preferences';
import { ReglagesOneDrive } from './onedrive';
import { Boosters, EXEMPLES } from './boosters';

interface Props {
  d: Donnees;
  maintenant: number;
  horsLigne: boolean;
  surRetour: () => void;
  surActualiser: () => Promise<void>;
  surDeconnexion: () => Promise<void>;
  surSuppression: () => Promise<void>;
  surVisite: () => void;
  surMails: () => void;
}

/** Une rangée de réglage à la façon iOS : pastille colorée, libellé, puis valeur, chevron ou interrupteur. */
function Ligne({ icone, couleur, libelle, valeur, chevron, rouge, surClic, children }: {
  icone: NomIcone; couleur: string; libelle: string; valeur?: ComponentChildren; chevron?: boolean; rouge?: boolean;
  surClic?: () => void; children?: ComponentChildren;
}) {
  const contenu = (
    <>
      <span class={`icone-rangee ${couleur}`}><Icone nom={icone} taille={17} epaisseur={2.2} /></span>
      <span class={`rangee-libelle ${rouge ? 'rouge' : ''}`}>{libelle}</span>
      {valeur !== undefined && <span class="rangee-valeur">{valeur}{chevron && <Icone nom="droite" taille={14} epaisseur={2.4} />}</span>}
      {valeur === undefined && chevron && <span class="rangee-valeur"><Icone nom="droite" taille={14} epaisseur={2.4} /></span>}
      {children}
    </>
  );
  return surClic ? <button type="button" class="rangee" onClick={surClic}>{contenu}</button> : <div class="rangee">{contenu}</div>;
}

const TUILES: { id: Tuile; nom: string }[] = [
  { id: 'note', nom: 'Notes' },
  { id: 'fichiers', nom: 'Nouveaux fichiers' },
  { id: 'alertes', nom: 'Alertes' },
  { id: 'aucune', nom: 'Aucun' },
];

const THEMES: { id: Theme; nom: string; icone: NomIcone }[] = [
  { id: 'auto', nom: 'Automatique', icone: 'actualiser' },
  { id: 'clair', nom: 'Clair', icone: 'soleil' },
  { id: 'sombre', nom: 'Sombre', icone: 'lune' },
];

export function Reglages({ d, maintenant, horsLigne, surRetour, surActualiser, surDeconnexion, surSuppression, surVisite, surMails }: Props) {
  const [occupe, setOccupe] = useState<'' | 'actualiser' | 'deconnexion' | 'suppression'>('');
  const [confirmer, setConfirmer] = useState(false);
  const [theme, setTheme] = useState<Theme>(lireTheme);
  const [choixTheme, setChoixTheme] = useState(false);
  const [essai, setEssai] = useState(false);
  const [choixTuile, setChoixTuile] = useState<'tuileGauche' | 'tuileDroite' | null>(null);
  const [prefs, setPrefs] = useState(lirePreferences);
  const lancer = (quoi: typeof occupe, action: () => Promise<void>) => {
    if (occupe) return;
    setOccupe(quoi);
    void action().finally(() => setOccupe(''));
  };
  const pref = (cle: Exclude<keyof Preferences, 'tuileGauche' | 'tuileDroite'>, libelle: string) => (
    <Interrupteur actif={prefs[cle]} libelle={libelle} surChange={(v) => setPrefs(changerPreferences({ [cle]: v }))} />
  );
  // Sept appuis sur la version débloquent le mode branleur, comme les options cachées d'Android.
  const [appuis, setAppuis] = useState(0);
  const [indice, setIndice] = useState('');
  const toucherVersion = () => {
    if (prefs.branleurDebloque) return;
    const n = appuis + 1;
    setAppuis(n);
    if (n >= 7) { setPrefs(changerPreferences({ branleurDebloque: true })); setIndice('🤫 Mode branleur débloqué : regarde un peu plus bas.'); }
    else if (n >= 4) setIndice(`Encore ${7 - n}…`);
  };
  const { etat } = d.moi;
  const synchro = etat.derniereSynchro ? ilYA(maintenant - Date.parse(etat.derniereSynchro)) : 'jamais';
  const mailsActifs = d.mails?.etat.actif ?? false;

  return (
    <>
      <button type="button" class="retour" onClick={surRetour}><Icone nom="gauche" epaisseur={2.4} />Retour</button>
      <h1 class="titre-page">Réglages</h1>
      {essai && <Boosters demo notes={EXEMPLES} surFin={() => setEssai(false)} />}

      <div class="carte profil">
        <span class="avatar grand" aria-hidden="true"><Avatar initiales={initialesDe(d.moi.nom)} photo={prefs.photo} grand /></span>
        <span class="rangee-texte">
          <strong>{d.moi.nom || 'Compte CPE'}</strong>
          <span>Compte CPE connecté</span>
        </span>
      </div>

      <section class="bloc">
        <h2 class="titre-groupe">Serveur</h2>
        <div class="carte liste">
          <Ligne icone="serveur" couleur="vert" libelle="Statut du serveur" valeur={<span class={horsLigne ? 'rouge' : 'vert'}>{horsLigne ? 'Injoignable' : 'En ligne'}</span>} />
          <Ligne icone="actualiser" couleur="bleu" libelle="Dernière synchro" valeur={synchro} />
          {etat.erreur && <p class="rangee-note rouge">La dernière tentative a échoué : {etat.erreur}</p>}
          <button type="button" class="rangee" disabled={!!occupe || horsLigne} onClick={() => lancer('actualiser', surActualiser)}>
            <span class="icone-rangee gris"><Icone nom="actualiser" taille={17} epaisseur={2.2} /></span>
            <span class="rangee-libelle lien">{occupe === 'actualiser' ? 'Actualisation…' : 'Actualiser maintenant'}</span>
          </button>
        </div>
      </section>

      <ReglagesOneDrive horsLigne={horsLigne} maintenant={maintenant} avant={
        <Ligne icone="mail" couleur="sarcelle" libelle="Mails PARTAGE triés" valeur={mailsActifs ? 'Activés' : 'Désactivés'} chevron surClic={surMails} />
      } />

      <ReglagesNotifications horsLigne={horsLigne} />

      <section class="bloc">
        <h2 class="titre-groupe">Apparence</h2>
        <div class="carte liste">
          <Ligne icone="lune" couleur="ardoise" libelle="Thème" valeur={THEMES.find((t) => t.id === theme)!.nom} surClic={() => setChoixTheme(!choixTheme)}>
            <span class="rangee-valeur"><Icone nom={choixTheme ? 'bas' : 'droite'} taille={14} epaisseur={2.4} /></span>
          </Ligne>
          {choixTheme && THEMES.map((t) => (
            <button type="button" class="rangee sous-rangee" role="radio" aria-checked={theme === t.id} onClick={() => { setTheme(t.id); choisirTheme(t.id); }}>
              <span class="rangee-libelle">{t.nom}</span>
              {theme === t.id && <span class="rangee-valeur bleu"><Icone nom="coche" taille={18} epaisseur={2.6} /></span>}
            </button>
          ))}
          <Ligne icone="personne" couleur="bleu-fonce" libelle="Ma photo MyCPE en avatar">{pref('photo', 'Ma photo MyCPE en avatar')}</Ligne>
        </div>
        {choixTheme && <p class="petit-texte">« Automatique » suit le réglage clair ou sombre de ton téléphone.</p>}
      </section>

      <section class="bloc">
        <h2 class="titre-groupe">Accueil</h2>
        <div class="carte liste">
          <Ligne icone="calendrier" couleur="rouge" libelle="Examens à venir">{pref('accueilExamens', 'Afficher les examens à venir sur l’accueil')}</Ligne>
          <Ligne icone="liste" couleur="sarcelle" libelle="À faire">{pref('accueilAFaire', 'Afficher « À faire » sur l’accueil')}</Ligne>
          {(['tuileGauche', 'tuileDroite'] as const).map((cote) => (
            <>
              <Ligne icone="note" couleur={cote === 'tuileGauche' ? 'violet' : 'bleu'} libelle={cote === 'tuileGauche' ? 'Widget de gauche' : 'Widget de droite'}
                valeur={TUILES.find((t) => t.id === prefs[cote])!.nom} surClic={() => setChoixTuile(choixTuile === cote ? null : cote)}>
                <span class="rangee-valeur"><Icone nom={choixTuile === cote ? 'bas' : 'droite'} taille={14} epaisseur={2.4} /></span>
              </Ligne>
              {choixTuile === cote && TUILES.map((t) => (
                <button type="button" class="rangee sous-rangee" role="radio" aria-checked={prefs[cote] === t.id} onClick={() => setPrefs(changerPreferences({ [cote]: t.id }))}>
                  <span class="rangee-libelle">{t.nom}</span>
                  {prefs[cote] === t.id && <span class="rangee-valeur bleu"><Icone nom="coche" taille={18} epaisseur={2.6} /></span>}
                </button>
              ))}
            </>
          ))}
          {(prefs.tuileGauche === 'note' || prefs.tuileDroite === 'note') && (
            <Ligne icone="note" couleur="orange" libelle="Notes en boosters">{pref('cacherNote', 'Notes en boosters')}</Ligne>
          )}
          <Ligne icone="plus" couleur="violet" libelle="Essayer les boosters" chevron surClic={() => setEssai(true)} />
        </div>
        <p class="petit-texte">{prefs.cacherNote && (prefs.tuileGauche === 'note' || prefs.tuileDroite === 'note') ? 'Le widget ne montre pas ta note : chaque nouvelle note s’ouvre comme un booster.' : 'Choisis ce que l’accueil montre. Ces choix te suivent sur tous tes appareils.'}</p>
      </section>

      <section class="bloc">
        <h2 class="titre-groupe">Aide</h2>
        <div class="carte liste">
          <Ligne icone="soleil" couleur="bleu" libelle="Revoir la visite guidée" chevron surClic={surVisite} />
          <a class="rangee" href="https://github.com/thomas-pns/campus-plus" target="_blank" rel="noopener noreferrer">
            <span class="icone-rangee noir"><Icone nom="code" taille={17} epaisseur={2.2} /></span>
            <span class="rangee-libelle">Code source sur GitHub</span>
            <span class="rangee-valeur"><Icone nom="droite" taille={14} epaisseur={2.4} /></span>
          </a>
        </div>
        <p class="petit-texte" onClick={toucherVersion}>Campus+ {__VERSION__} · projet étudiant non officiel, sans lien avec CPE Lyon.</p>
        {indice && <p class="petit-texte bleu" role="status">{indice}</p>}
      </section>

      {prefs.branleurDebloque && (
        <section class="bloc">
          <h2 class="titre-groupe">Secret 🤫</h2>
          <div class="carte liste">
            <Ligne icone="lune" couleur="violet" libelle="Mode branleur">{pref('branleur', 'Mode branleur')}</Ligne>
          </div>
          <p class="petit-texte">Pour rire : les cours magistraux facultatifs sont marqués « 😴 Facultatif », avec un conseil douteux. Les TD, TP, langues, examens et le sport ne sont jamais proposés. À tes risques et périls pour les partiels.</p>
        </section>
      )}

      <section class="bloc">
        <h2 class="titre-groupe">Compte</h2>
        <div class="carte liste">
          <Ligne icone="sortie" couleur="gris" libelle={occupe === 'deconnexion' ? 'Déconnexion…' : 'Se déconnecter de cet appareil'} surClic={() => lancer('deconnexion', surDeconnexion)} />
          <Ligne icone="corbeille" couleur="rouge" libelle="Supprimer mon compte du serveur" rouge surClic={() => setConfirmer(true)} />
        </div>
        {confirmer && (
          <div class="carte confirmation" role="alertdialog" aria-label="Confirmer la suppression">
            <p><strong>Tout effacer ?</strong> Tes identifiants, ton planning, tes notes et tes alertes seront supprimés du serveur. Tu pourras te reconnecter plus tard.</p>
            <div class="confirmation-actions">
              <button type="button" class="bouton secondaire" onClick={() => setConfirmer(false)}>Annuler</button>
              <button type="button" class="bouton danger" disabled={!!occupe} onClick={() => lancer('suppression', surSuppression)}>{occupe === 'suppression' ? 'Suppression…' : 'Tout supprimer'}</button>
            </div>
          </div>
        )}
        <p class="petit-texte">Ton mot de passe CPE est gardé chiffré sur le serveur : il lui sert à récupérer ton planning et tes notes à ta place.</p>
      </section>
    </>
  );
}
