import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { Donnees } from '../types';
import { ilYA, initialesDe } from '../dates';
import { Avatar, Icone, type NomIcone } from '../composants';
import { choisirTheme, lireTheme, type Theme } from '../theme';
import { Interrupteur, ReglagesNotifications } from './notifications';
import { changerPreferences, lirePreferences, type Preferences } from '../preferences';
import { ReglagesOneDrive } from './onedrive';

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
  const [prefs, setPrefs] = useState(lirePreferences);
  const lancer = (quoi: typeof occupe, action: () => Promise<void>) => {
    if (occupe) return;
    setOccupe(quoi);
    void action().finally(() => setOccupe(''));
  };
  const pref = (cle: keyof Preferences, libelle: string) => (
    <Interrupteur actif={prefs[cle]} libelle={libelle} surChange={(v) => setPrefs(changerPreferences({ [cle]: v }))} />
  );
  const { etat } = d.moi;
  const synchro = etat.derniereSynchro ? ilYA(maintenant - Date.parse(etat.derniereSynchro)) : 'jamais';
  const mailsActifs = d.mails?.etat.actif ?? false;

  return (
    <>
      <button type="button" class="retour" onClick={surRetour}><Icone nom="gauche" epaisseur={2.4} />Retour</button>
      <h1 class="titre-page">Réglages</h1>

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
          <Ligne icone="note" couleur="violet" libelle="Dernière note et alertes">{pref('accueilTuiles', 'Afficher la dernière note et les alertes sur l’accueil')}</Ligne>
          {prefs.accueilTuiles && (
            <Ligne icone="note" couleur="gris" libelle="Note en surprise">{pref('cacherNote', 'Note en surprise')}</Ligne>
          )}
        </div>
        <p class="petit-texte">{prefs.cacherNote && prefs.accueilTuiles ? 'Une nouvelle note s’annonce sans sa valeur : touche la tuile pour la découvrir.' : 'Choisis ce que l’accueil montre. Ces choix valent pour cet appareil.'}</p>
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
        <p class="petit-texte">Campus+ {__VERSION__} · projet étudiant non officiel, sans lien avec CPE Lyon.</p>
      </section>

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
