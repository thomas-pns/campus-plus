import { useEffect, useState } from 'preact/hooks';
import * as api from '../api';
import type { Alerte } from '../types';
import { Icone } from '../composants';

const LIBELLES: Record<Alerte['type'], string> = {
  salle: 'Changements de salle',
  horaire: "Changements d'horaire",
  ajoute: 'Créneaux ajoutés (examens…)',
  supprime: 'Créneaux retirés',
  note: 'Nouvelles notes',
  fichier: 'Nouveaux fichiers de cours',
};

function Interrupteur({ actif, libelle, surChange, desactive }: { actif: boolean; libelle: string; surChange: (v: boolean) => void; desactive?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={actif} aria-label={libelle} class={`interrupteur ${actif ? 'actif' : ''}`} disabled={desactive} onClick={() => surChange(!actif)}>
      <span />
    </button>
  );
}

/** Section « Notifications » des réglages. */
export function ReglagesNotifications({ horsLigne }: { horsLigne: boolean }) {
  const [reglages, setReglages] = useState<api.ReglagesNotifications | null>(null);
  const [etat, setEtat] = useState<api.EtatAppareil | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (horsLigne) return;
    void api.lireNotifications().then(setReglages).catch(() => setMessage('Réglages des notifications indisponibles.'));
    void api.etatAppareil().then(setEtat);
  }, [horsLigne]);

  const basculer = async (oui: boolean) => {
    if (!reglages || occupe) return;
    setOccupe(true);
    setMessage('');
    try {
      const e = oui ? await api.activerNotifications(reglages.cle) : await api.desactiverNotifications();
      setEtat(e);
      if (e === 'refusees') setMessage("Notifications refusées : autorise-les pour Campus+ dans les réglages de ton téléphone.");
      setReglages(await api.lireNotifications());
    } catch (err) {
      setMessage((err as Error).message || 'Impossible d’activer les notifications.');
    } finally {
      setOccupe(false);
    }
  };

  const changerType = async (type: Alerte['type'], valeur: boolean) => {
    if (!reglages) return;
    setReglages({ ...reglages, types: { ...reglages.types, [type]: valeur } });
    try {
      const { types } = await api.changerTypes({ [type]: valeur });
      setReglages((r) => (r ? { ...r, types } : r));
    } catch {
      setReglages((r) => (r ? { ...r, types: { ...r.types, [type]: !valeur } } : r));
    }
  };

  const essayer = async () => {
    setOccupe(true);
    setMessage('');
    try {
      const { envoyes } = await api.essaiNotification();
      setMessage(envoyes ? 'Notification envoyée : elle doit arriver dans quelques secondes.' : "Aucun appareil abonné : active d'abord les notifications.");
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setOccupe(false);
    }
  };

  if (horsLigne) return null;
  const actives = etat === 'actives';

  return (
    <section class="bloc">
      <h2 class="titre-groupe">Notifications</h2>
      {etat === 'installer' ? (
        <div class="carte explication">
          <Icone nom="cloche" taille={22} />
          <p>Sur iPhone, les notifications ne marchent que dans l'appli installée : dans Safari, touche <strong>Partager</strong> puis <strong>Sur l'écran d'accueil</strong>, et ouvre Campus+ depuis son icône.</p>
        </div>
      ) : etat === 'impossible' ? (
        <p class="petit-texte">Ce navigateur ne gère pas les notifications.</p>
      ) : (
        <>
          <div class="carte liste">
            <div class="rangee">
              <span class="icone-rangee rouge"><Icone nom="cloche" taille={17} epaisseur={2.2} /></span>
              <span class="rangee-libelle">Sur cet appareil</span>
              <Interrupteur actif={actives} libelle="Notifications sur cet appareil" desactive={occupe || !reglages || etat === null} surChange={(v) => void basculer(v)} />
            </div>
            {actives && reglages && (Object.keys(LIBELLES) as Alerte['type'][]).map((t) => (
              <div class="rangee sous-rangee">
                <span class="rangee-libelle">{LIBELLES[t]}</span>
                <Interrupteur actif={reglages.types[t]} libelle={LIBELLES[t]} surChange={(v) => void changerType(t, v)} />
              </div>
            ))}
          </div>
          {actives && <button type="button" class="bouton secondaire large" disabled={occupe} onClick={() => void essayer()}>Envoyer une notification d'essai</button>}
          <p class="petit-texte">{actives
            ? 'Tu es prévenu dès que le serveur voit un changement sur MyCPE (il regarde toutes les 15 minutes). Les choix par type valent pour tous tes appareils.'
            : 'Active-les pour être prévenu d’un changement de salle ou d’une nouvelle note, même appli fermée.'}</p>
        </>
      )}
      {message && <p class="petit-texte" role="status">{message}</p>}
    </section>
  );
}
