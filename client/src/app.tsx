/** Assemblage de l'appli : connexion, chargement des données, onglets. */
import { useCallback, useEffect, useState } from 'preact/hooks';
import type { Donnees, Evenement } from './types';
import * as api from './api';
import { Defilement, FicheEvenement, Icone, type NomIcone } from './composants';
import { Aujourdhui } from './ecrans/aujourdhui';
import { Planning } from './ecrans/planning';
import { Scolarite } from './ecrans/scolarite';
import { Alertes } from './ecrans/alertes';
import { Reglages } from './ecrans/reglages';
import { Connexion } from './ecrans/connexion';

const ONGLETS = [
  { id: 'aujourdhui', nom: "Aujourd'hui", icone: 'soleil' },
  { id: 'planning', nom: 'Planning', icone: 'calendrier' },
  { id: 'alertes', nom: 'Alertes', icone: 'cloche' },
  { id: 'scolarite', nom: 'Scolarité', icone: 'diplome' },
] as const satisfies readonly { id: string; nom: string; icone: NomIcone }[];
type Onglet = (typeof ONGLETS)[number]['id'];

const FRAICHEUR_MS = 2 * 60_000;

/** L'heure courante, rafraîchie régulièrement et au retour sur l'appli. */
function useMaintenant(): number {
  const [t, setT] = useState(Date.now);
  useEffect(() => {
    const maj = () => setT(Date.now());
    const minuteur = setInterval(maj, 20_000);
    document.addEventListener('visibilitychange', maj);
    return () => { clearInterval(minuteur); document.removeEventListener('visibilitychange', maj); };
  }, []);
  return t;
}

export function App() {
  const [donnees, setDonnees] = useState<Donnees | null>(api.lireCopie);
  const [phase, setPhase] = useState<'demarrage' | 'connexion' | 'appli'>(donnees ? 'appli' : 'demarrage');
  const [horsLigne, setHorsLigne] = useState(false);
  // Ouverture depuis une notification : l'adresse se termine par #alertes.
  const [onglet, setOnglet] = useState<Onglet>(() => (location.hash === '#alertes' ? 'alertes' : 'aujourdhui'));
  const [reglages, setReglages] = useState(false);
  const [fiche, setFiche] = useState<Evenement | null>(null);
  const [vuesJusqua, setVuesJusqua] = useState(api.alertesVuesJusqua);
  const maintenant = useMaintenant();

  const versConnexion = useCallback(() => {
    api.viderCopie();
    setDonnees(null);
    setReglages(false);
    setFiche(null);
    setOnglet('aujourdhui');
    setPhase('connexion');
  }, []);

  const recharger = useCallback(async () => {
    try {
      const d = await api.chargerTout();
      api.ecrireCopie(d);
      setDonnees(d);
      setHorsLigne(false);
      setPhase('appli');
    } catch (e) {
      if (e instanceof api.ErreurApi && e.code === 401) return versConnexion();
      // Serveur injoignable : on garde ce qui est déjà sur l'appareil.
      setHorsLigne(true);
      setPhase((p) => (p === 'demarrage' ? 'connexion' : p));
    }
  }, [versConnexion]);

  useEffect(() => {
    void recharger();
    const retour = () => {
      const copie = api.lireCopie();
      if (document.visibilityState === 'visible' && copie && Date.now() - copie.recuLe > FRAICHEUR_MS) void recharger();
    };
    document.addEventListener('visibilitychange', retour);
    window.addEventListener('online', retour);
    return () => { document.removeEventListener('visibilitychange', retour); window.removeEventListener('online', retour); };
  }, [recharger]);

  /** « Tirer pour actualiser » : demande au serveur de réinterroger MyCPE, puis recharge. */
  const actualiser = useCallback(async () => {
    await api.synchroniser().catch(() => undefined);
    await recharger();
  }, [recharger]);

  const fermerFiche = useCallback(() => setFiche(null), []);

  // Notification touchée alors que l'appli était déjà ouverte : aller aux alertes, données à jour.
  useEffect(() => {
    if (location.hash) history.replaceState(null, '', location.pathname);
    const recu = (ev: MessageEvent) => {
      if (ev.data?.type !== 'ouvrir-alertes') return;
      setReglages(false);
      setFiche(null);
      setOnglet('alertes');
      void recharger();
    };
    navigator.serviceWorker?.addEventListener('message', recu);
    return () => navigator.serviceWorker?.removeEventListener('message', recu);
  }, [recharger]);

  const choisir = (o: Onglet) => {
    setOnglet(o);
    setReglages(false);
    if (o === 'alertes' && donnees?.alertes.length) {
      // Les alertes restent marquées « nouvelles » pendant cette visite, puis plus ensuite.
      api.marquerAlertesVues(donnees.alertes.reduce((max, a) => (a.date > max ? a.date : max), ''));
    } else if (onglet === 'alertes') {
      setVuesJusqua(api.alertesVuesJusqua());
    }
  };

  if (phase === 'demarrage') return <main class="ecran demarrage"><span class="tourne"><Icone nom="actualiser" taille={28} /></span></main>;
  if (phase === 'connexion' || !donnees) return <Connexion surReussite={recharger} />;

  const d = donnees;
  const nouvelles = d.alertes.filter((a) => a.date > vuesJusqua).length;

  return (
    <>
      {(horsLigne || d.moi.aReconnecter) && (
        <div class={`bandeau ${d.moi.aReconnecter ? 'alerte' : ''}`} role="status">
          {d.moi.aReconnecter ? (
            <>
              <span>MyCPE a refusé ton mot de passe : les données ne se mettent plus à jour.</span>
              <button type="button" onClick={versConnexion}>Me reconnecter</button>
            </>
          ) : (
            <><Icone nom="horsLigne" taille={16} /><span>Hors ligne · données du {new Date(d.recuLe).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span></>
          )}
        </div>
      )}

      <Defilement cle={reglages ? 'reglages' : onglet} surActualiser={reglages ? undefined : actualiser}>
        {reglages ? (
          <Reglages d={d} maintenant={maintenant} horsLigne={horsLigne} surRetour={() => setReglages(false)} surActualiser={actualiser}
            surDeconnexion={async () => { await api.deconnexion().catch(() => undefined); versConnexion(); }}
            surSuppression={async () => { await api.supprimerCompte(); versConnexion(); }} />
        ) : onglet === 'aujourdhui' ? (
          <Aujourdhui d={d} maintenant={maintenant} surOuvrir={setFiche} surReglages={() => setReglages(true)} surAller={choisir} />
        ) : onglet === 'planning' ? (
          <Planning d={d} maintenant={maintenant} surOuvrir={setFiche} />
        ) : onglet === 'alertes' ? (
          <Alertes d={d} maintenant={maintenant} vuesJusqua={vuesJusqua} surOuvrir={setFiche} surAller={choisir} />
        ) : (
          <Scolarite d={d} />
        )}
      </Defilement>

      <nav class="onglets" aria-label="Navigation principale">
        {ONGLETS.map((o) => (
          <button type="button" class={!reglages && o.id === onglet ? 'actif' : ''} aria-current={!reglages && o.id === onglet ? 'page' : undefined} onClick={() => choisir(o.id)}>
            <span class="onglet-icone">
              <Icone nom={o.icone} taille={25} epaisseur={1.9} />
              {o.id === 'alertes' && nouvelles > 0 && <span class="badge" aria-label={`${nouvelles} nouvelles`}>{nouvelles}</span>}
            </span>
            <span>{o.nom}</span>
          </button>
        ))}
      </nav>

      {fiche && <FicheEvenement e={fiche} surFermer={fermerFiche} />}
    </>
  );
}
