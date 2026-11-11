import { useState } from 'preact/hooks';
import { connexion, ErreurApi } from '../api';
import { visiteObligatoire } from './visite';

export function Connexion({ surReussite, message }: { surReussite: () => Promise<void>; message?: string }) {
  const [identifiant, setIdentifiant] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [erreur, setErreur] = useState(message ?? '');
  const [occupe, setOccupe] = useState(false);

  const envoyer = async (ev: Event) => {
    ev.preventDefault();
    if (occupe || !identifiant.trim() || !motDePasse) return;
    setOccupe(true);
    setErreur('');
    try {
      const r = await connexion(identifiant.trim(), motDePasse);
      if (r.nouveau) visiteObligatoire();
      setMotDePasse('');
      await surReussite();
    } catch (e) {
      setErreur(e instanceof ErreurApi && e.code === 0 ? 'Le serveur Campus+ ne répond pas. Vérifie ta connexion.' : (e as Error).message);
    } finally {
      setOccupe(false);
    }
  };

  return (
    <main class="ecran connexion">
      <div class="contenu">
        <div class="logo" aria-hidden="true"><img src="/icone.svg" alt="" width="72" height="72" /></div>
        <h1>Campus+</h1>
        <p class="accroche">Ton planning, tes notes et tes alertes CPE, au même endroit.</p>

        <form class="carte formulaire" onSubmit={envoyer}>
          <label for="identifiant">Identifiant CPE</label>
          <input id="identifiant" name="username" type="text" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck={false}
            value={identifiant} onInput={(e) => setIdentifiant((e.target as HTMLInputElement).value)} required />
          <label for="mot-de-passe">Mot de passe</label>
          <input id="mot-de-passe" name="password" type="password" autocomplete="current-password"
            value={motDePasse} onInput={(e) => setMotDePasse((e.target as HTMLInputElement).value)} required />
          {erreur && <p class="erreur" role="alert">{erreur}</p>}
          <button type="submit" class="bouton large" disabled={occupe}>{occupe ? 'Connexion à MyCPE…' : 'Se connecter'}</button>
        </form>

        <p class="petit-texte centre">Ce sont les mêmes identifiants que sur MyCPE. Ils sont vérifiés auprès de MyCPE puis gardés chiffrés sur le serveur, qui s'en sert pour récupérer tes données.</p>
        <p class="petit-texte centre">Projet étudiant non officiel, sans lien avec CPE Lyon.</p>
      </div>
    </main>
  );
}
