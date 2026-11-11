/** Section « OneDrive » des réglages : copie des cours, rangés, dans le OneDrive de l'élève. */
import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import * as api from '../api';
import { ilYA } from '../dates';
import { Icone } from '../composants';
import { Interrupteur } from './notifications';

export function ReglagesOneDrive({ horsLigne, maintenant, avant }: { horsLigne: boolean; maintenant: number; avant?: ComponentChildren }) {
  const [disponible, setDisponible] = useState(false);
  const [etat, setEtat] = useState<api.EtatOneDrive | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState('');
  const [copie, setCopie] = useState(false);

  const relire = () => api.lireOneDrive().then((r) => { setDisponible(r.disponible); setEtat(r.etat); }).catch(() => undefined);
  useEffect(() => { if (!horsLigne) void relire(); }, [horsLigne]);

  // Pendant la connexion Microsoft ou une copie en cours, on regarde où en est le serveur.
  const attente = !!etat?.connexion || (!!etat?.actif && etat.restants > 0);
  useEffect(() => {
    if (!attente || horsLigne) return;
    const minuteur = setInterval(() => void relire(), 3000);
    return () => clearInterval(minuteur);
  }, [attente, horsLigne]);

  const agir = async (action: () => Promise<unknown>) => {
    if (occupe) return;
    setOccupe(true);
    setMessage('');
    try {
      await action();
      await relire();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setOccupe(false);
    }
  };

  if (horsLigne || !disponible || !etat) {
    return avant ? <section class="bloc"><h2 class="titre-groupe">Intégrations</h2><div class="carte liste">{avant}</div></section> : null;
  }
  const c = etat.connexion;

  return (
    <section class="bloc">
      <h2 class="titre-groupe">Intégrations</h2>
      {avant && <div class="carte liste">{avant}</div>}
      {c ? (
        <div class="carte connexion-od">
          <p>Sur la page Microsoft, tape ce code puis connecte-toi avec ton compte CPE (ou un compte Microsoft perso) :</p>
          <strong class="code-od" aria-label={`Code : ${c.code.split('').join(' ')}`}>{c.code}</strong>
          <button type="button" class="bouton large" onClick={() => {
            void navigator.clipboard?.writeText(c.code).then(() => setCopie(true)).catch(() => undefined);
            window.open(c.adresse, '_blank', 'noopener');
          }}>{copie ? 'Code copié · ouvrir Microsoft' : 'Copier le code et ouvrir Microsoft'}</button>
          <button type="button" class="lien-bouton" disabled={occupe} onClick={() => void agir(api.annulerOneDrive)}>Annuler</button>
          <p class="petit-texte">Cette page se met à jour toute seule une fois connecté. Le code expire à {new Date(c.expire).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.</p>
        </div>
      ) : (
        <div class="carte liste">
          <div class="rangee">
            <span class="icone-rangee bleu"><Icone nom="nuage" taille={17} epaisseur={2.2} /></span>
            <span class="rangee-texte">
              <strong>Copier mes cours sur OneDrive</strong>
              {etat.actif && <span>{etat.compte}</span>}
            </span>
            <Interrupteur actif={etat.actif} libelle="Copier mes cours sur OneDrive" desactive={occupe}
              surChange={(oui) => void agir(oui ? () => { setCopie(false); return api.connecterOneDrive(); } : api.deconnecterOneDrive)} />
          </div>
          {etat.actif && (
            <div class="rangee">
              <span class="rangee-libelle">
                {etat.restants > 0 ? `Copie en cours · ${etat.copies} faits, ${etat.restants} à venir`
                  : `${etat.copies} fichier${etat.copies > 1 ? 's' : ''} copié${etat.copies > 1 ? 's' : ''}`}
              </span>
              <span class="rangee-valeur">{etat.derniereSynchro ? ilYA(maintenant - Date.parse(etat.derniereSynchro)) : ''}</span>
            </div>
          )}
          {etat.actif && (
            <button type="button" class="rangee" disabled={occupe} onClick={() => void agir(api.copierOneDrive)}>
              <span class="rangee-libelle lien">Copier maintenant</span>
            </button>
          )}
        </div>
      )}
      {(message || etat.erreur) && <p class="petit-texte rouge">{message || etat.erreur}</p>}
      {!c && (
        <p class="petit-texte">
          {etat.actif
            ? 'Les nouveaux fichiers sont copiés à chaque synchro, dans le dossier « Cours CPE » de ton OneDrive. Couper l’option ne supprime rien sur OneDrive.'
            : 'Tes fichiers de cours, rangés par semestre, matière et type (Cours, TD, TP, annales…), dans un dossier « Cours CPE » de ton OneDrive. Pratique pour les lire sur une liseuse comme la reMarkable.'}
        </p>
      )}
    </section>
  );
}
