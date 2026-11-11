import { useState } from 'preact/hooks';
import type { Donnees } from '../types';
import { ilYA, initialesDe } from '../dates';
import { Icone, Segments } from '../composants';
import { choisirTheme, lireTheme, type Theme } from '../theme';
import { Interrupteur, ReglagesNotifications } from './notifications';
import { changerPreferences, lirePreferences } from '../preferences';
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
}

export function Reglages({ d, maintenant, horsLigne, surRetour, surActualiser, surDeconnexion, surSuppression, surVisite }: Props) {
  const [occupe, setOccupe] = useState<'' | 'actualiser' | 'deconnexion' | 'suppression'>('');
  const [confirmer, setConfirmer] = useState(false);
  const [theme, setTheme] = useState<Theme>(lireTheme);
  const [prefs, setPrefs] = useState(lirePreferences);
  const lancer = (quoi: typeof occupe, action: () => Promise<void>) => {
    if (occupe) return;
    setOccupe(quoi);
    void action().finally(() => setOccupe(''));
  };
  const { etat } = d.moi;
  const synchro = etat.derniereSynchro ? ilYA(maintenant - Date.parse(etat.derniereSynchro)) : 'jamais';

  return (
    <>
      <button type="button" class="retour" onClick={surRetour}><Icone nom="gauche" epaisseur={2.4} />Retour</button>
      <h1 class="titre-page">Réglages</h1>

      <div class="carte profil">
        <span class="avatar grand" aria-hidden="true">{initialesDe(d.moi.nom)}</span>
        <span class="rangee-texte">
          <strong>{d.moi.nom || 'Compte CPE'}</strong>
          <span>Compte CPE connecté</span>
        </span>
      </div>

      <section class="bloc">
        <h2 class="titre-groupe">Apparence et accueil</h2>
        <Segments options={[{ id: 'auto', nom: 'Auto' }, { id: 'clair', nom: 'Clair' }, { id: 'sombre', nom: 'Sombre' }] as const}
          valeur={theme} etiquette="Thème" surChoix={(t) => { setTheme(t); choisirTheme(t); }} />
        <h3 class="sous-titre-groupe">Sur l’accueil</h3>
        <div class="carte liste">
          {([
            ['accueilExamens', 'Examens à venir'],
            ['accueilAFaire', 'À faire'],
            ['accueilTuiles', 'Dernière note et alertes'],
          ] as const).map(([cle, nom]) => (
            <div class="rangee">
              <span class="rangee-libelle">{nom}</span>
              <Interrupteur actif={prefs[cle]} libelle={`Afficher « ${nom} » sur l’accueil`} surChange={(v) => setPrefs(changerPreferences({ [cle]: v }))} />
            </div>
          ))}
          {prefs.accueilTuiles && (
            <div class="rangee sous-rangee">
              <span class="rangee-libelle">Masquer la valeur de la note</span>
              <Interrupteur actif={prefs.cacherNote} libelle="Masquer la valeur de la dernière note" surChange={(v) => setPrefs(changerPreferences({ cacherNote: v }))} />
            </div>
          )}
        </div>
        <p class="petit-texte">« Auto » suit le réglage de ton téléphone. Ces choix valent pour cet appareil.</p>
      </section>

      <ReglagesNotifications horsLigne={horsLigne} />

      <ReglagesOneDrive horsLigne={horsLigne} maintenant={maintenant} />

      <section class="bloc">
        <h2 class="titre-groupe">Serveur</h2>
        <div class="carte liste">
          <div class="rangee">
            <span class="icone-rangee vert"><Icone nom="serveur" taille={17} epaisseur={2.2} /></span>
            <span class="rangee-libelle">Statut</span>
            <span class={`rangee-valeur ${horsLigne ? 'rouge' : 'vert'}`}>{horsLigne ? 'Injoignable' : 'En ligne'}</span>
          </div>
          <div class="rangee">
            <span class="icone-rangee bleu"><Icone nom="actualiser" taille={17} epaisseur={2.2} /></span>
            <span class="rangee-libelle">Dernière synchro avec MyCPE</span>
            <span class="rangee-valeur">{synchro}</span>
          </div>
          {etat.erreur && (
            <p class="rangee-note rouge">La dernière tentative a échoué : {etat.erreur}</p>
          )}
        </div>
        <button type="button" class="bouton secondaire large" disabled={!!occupe || horsLigne} onClick={() => lancer('actualiser', surActualiser)}>
          {occupe === 'actualiser' ? 'Actualisation…' : 'Actualiser maintenant'}
        </button>
      </section>

      <section class="bloc">
        <h2 class="titre-groupe">Aide et à propos</h2>
        <div class="carte liste">
          <button type="button" class="rangee" onClick={surVisite}>
            <span class="icone-rangee bleu"><Icone nom="soleil" taille={17} epaisseur={2.2} /></span>
            <span class="rangee-libelle">Revoir la visite guidée</span>
            <span class="rangee-valeur"><Icone nom="droite" taille={14} epaisseur={2.4} /></span>
          </button>
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
          <button type="button" class="rangee" disabled={!!occupe} onClick={() => lancer('deconnexion', surDeconnexion)}>
            <span class="icone-rangee gris"><Icone nom="sortie" taille={17} epaisseur={2.2} /></span>
            <span class="rangee-libelle">{occupe === 'deconnexion' ? 'Déconnexion…' : 'Se déconnecter de cet appareil'}</span>
          </button>
          <button type="button" class="rangee" disabled={!!occupe} onClick={() => setConfirmer(true)}>
            <span class="icone-rangee rouge"><Icone nom="corbeille" taille={17} epaisseur={2.2} /></span>
            <span class="rangee-libelle rouge">Supprimer mon compte du serveur</span>
          </button>
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
