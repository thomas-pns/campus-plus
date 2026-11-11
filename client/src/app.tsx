/** Assemblage de l'appli : connexion, chargement des données, onglets. */
import { useCallback, useEffect, useState } from 'preact/hooks';
import type { Donnees, Evenement } from './types';
import * as api from './api';
import { synchroniserPreferences } from './preferences';
import { retenirPlanning } from './branleur';
import { Defilement, FicheEvenement, Icone, type NomIcone } from './composants';
import { Aujourdhui } from './ecrans/aujourdhui';
import { Planning } from './ecrans/planning';
import { Scolarite } from './ecrans/scolarite';
import { Alertes } from './ecrans/alertes';
import { Reglages } from './ecrans/reglages';
import { Visite, visiteAFaire } from './ecrans/visite';
import { Connexion } from './ecrans/connexion';
import { CoursEcran } from './ecrans/cours';
import { fichiersDe } from './cours';
import { Devoirs, basculer } from './ecrans/devoirs';
import { memeMatiere, type Ligne } from './afaire';
import { AjoutDevoir, type Brouillon } from './ecrans/ajout-devoir';
import { nomCourt } from './cours';
import { jourDe } from './dates';
import type { Cours, Mail } from './types';

const ONGLETS = [
  { id: 'aujourdhui', nom: "Aujourd'hui", icone: 'soleil' },
  { id: 'planning', nom: 'Planning', icone: 'calendrier' },
  { id: 'cours', nom: 'Cours', icone: 'livre' },
  { id: 'alertes', nom: 'Boîte', icone: 'boite' },
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
  /** Page ouverte par-dessus les onglets (depuis Aujourd'hui). */
  const [page, setPage] = useState<'reglages' | 'devoirs' | null>(null);
  const reglages = page === 'reglages';
  const setReglages = (oui: boolean) => setPage(oui ? 'reglages' : null);
  const [fiche, setFiche] = useState<Evenement | null>(null);
  const [visite, setVisite] = useState(visiteAFaire);
  const [brouillon, setBrouillon] = useState<Brouillon | null>(null);
  const [vuesJusqua, setVuesJusqua] = useState(api.alertesVuesJusqua);
  const [coursOuvert, setCoursOuvert] = useState<number | null>(null);
  const [fichiersVus, setFichiersVus] = useState(api.fichiersVus);
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
      const [d] = await Promise.all([api.chargerTout(), synchroniserPreferences()]);
      api.ecrireCopie(d);
      retenirPlanning(d.planning);
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

  /** Mise à jour locale de la liste « à faire » (après une coche ou un ajout), gardée aussi hors ligne. */
  const changerAFaire = (afaire: NonNullable<Donnees['afaire']>) => {
    setDonnees((d) => {
      if (!d) return d;
      const nouveau = { ...d, afaire };
      api.ecrireCopie(nouveau);
      return nouveau;
    });
  };
  /** Prochaine séance d'une matière (à partir de demain), pour proposer une date au devoir. */
  const prochaineSeance = (matiere: string, apres: number) =>
    donnees?.planning
      .filter((e) => memeMatiere(e.matiere, matiere) && Date.parse(e.debut) > apres && !['examen'].includes(e.categorie))
      .sort((a, b) => a.debut.localeCompare(b.debut))[0];

  const devoirDepuisCreneau = (e: Evenement) => {
    setFiche(null);
    // Un devoir donné pendant ce créneau est en général pour la séance suivante de la matière.
    const suivante = prochaineSeance(e.matiere, Date.parse(e.fin));
    const cours = donnees?.cours?.find((c) => memeMatiere(nomCourt(c), e.matiere));
    setBrouillon({ matiere: e.matiere, cours: cours?.id ?? null, date: suivante ? jourDe(suivante.debut) : jourDe(e.debut) });
  };

  const devoirDepuisCours = (c: Cours) => {
    const suivante = prochaineSeance(nomCourt(c), Date.now());
    setBrouillon({ matiere: nomCourt(c), cours: c.id, date: suivante ? jourDe(suivante.debut) : '' });
  };

  const fermerBrouillon = useCallback(() => setBrouillon(null), []);

  const devoirDepuisMail = (m: Mail) => {
    const matiere = m.matiere ?? '';
    const suivante = matiere ? prochaineSeance(matiere, Date.now()) : undefined;
    const cours = matiere ? donnees?.cours?.find((c) => memeMatiere(nomCourt(c), matiere)) : undefined;
    setBrouillon({ matiere: matiere || m.de, cours: cours?.id ?? null, date: suivante ? jourDe(suivante.debut) : '', titre: m.sujet });
  };

  const changerMails = (mails: NonNullable<Donnees['mails']>) => {
    setDonnees((d) => {
      if (!d) return d;
      const nouveau = { ...d, mails };
      api.ecrireCopie(nouveau);
      return nouveau;
    });
  };

  const cocher = (l: Ligne) => {
    if (donnees?.afaire) void basculer(l, donnees.afaire).then(changerAFaire).catch(() => undefined);
  };

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

  /** En quittant l'onglet Cours, les fichiers affichés cessent d'être « nouveaux » (au prochain passage). */
  const quitterCours = () => {
    if (onglet !== 'cours' || !donnees?.cours) return;
    api.marquerFichiersVus(donnees.cours.flatMap(fichiersDe).map((f) => f.cle));
    setFichiersVus(api.fichiersVus());
  };

  const ouvrirCours = (id: number) => {
    setReglages(false);
    setFiche(null);
    setOnglet('cours');
    setCoursOuvert(id);
  };

  const choisir = (o: Onglet) => {
    if (o !== onglet) quitterCours();
    if (o === 'cours' && onglet === 'cours') setCoursOuvert(null);
    if (o === 'cours' && fichiersVus === null && donnees?.cours?.length) {
      // Toute première visite : rien n'est « nouveau », on part de ce qui existe.
      api.marquerFichiersVus(donnees.cours.flatMap(fichiersDe).map((f) => f.cle));
      setFichiersVus(api.fichiersVus());
    }
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
  retenirPlanning(d.planning);
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

      <Defilement cle={page ?? `${onglet}-${coursOuvert ?? ''}`} surActualiser={reglages ? undefined : actualiser}>
        {page === 'devoirs' ? (
          <Devoirs d={d} maintenant={maintenant} horsLigne={horsLigne} surRetour={() => setPage(null)} surChange={changerAFaire} />
        ) : reglages ? (
          <Reglages d={d} maintenant={maintenant} horsLigne={horsLigne} surRetour={() => setReglages(false)} surActualiser={actualiser}
            surDeconnexion={async () => { await api.deconnexion().catch(() => undefined); versConnexion(); }}
            surSuppression={async () => { await api.supprimerCompte(); versConnexion(); }}
            surVisite={() => { setReglages(false); setOnglet('aujourdhui'); setVisite(true); }}
            surMails={() => { try { sessionStorage.setItem('campus-plus:boite', 'mails'); } catch { /* rien */ } setReglages(false); choisir('alertes'); }} />
        ) : onglet === 'aujourdhui' ? (
          <Aujourdhui d={d} maintenant={maintenant} surOuvrir={setFiche} surReglages={() => setReglages(true)} surAller={choisir}
            surDevoirs={() => setPage('devoirs')} surCocher={cocher} />
        ) : onglet === 'planning' ? (
          <Planning d={d} maintenant={maintenant} surOuvrir={setFiche} />
        ) : onglet === 'cours' ? (
          <CoursEcran d={d} maintenant={maintenant} vus={fichiersVus} coursOuvert={coursOuvert} surOuvrirCours={setCoursOuvert} surAjouterDevoir={devoirDepuisCours} surOuvrir={setFiche} surRecharger={recharger} />
        ) : onglet === 'alertes' ? (
          <Alertes d={d} maintenant={maintenant} vuesJusqua={vuesJusqua} surOuvrir={setFiche} surAller={choisir} surOuvrirCours={ouvrirCours}
            surDevoirs={() => { setOnglet('aujourdhui'); setPage('devoirs'); }}
            horsLigne={horsLigne} surChangeMails={changerMails} surCreerDevoir={devoirDepuisMail} />
        ) : (
          <Scolarite d={d} horsLigne={horsLigne} />
        )}
      </Defilement>

      <nav class="onglets" aria-label="Navigation principale">
        {ONGLETS.map((o) => (
          <button type="button" class={!page && o.id === onglet ? 'actif' : ''} aria-current={!page && o.id === onglet ? 'page' : undefined} onClick={() => choisir(o.id)}>
            <span class="onglet-icone">
              <Icone nom={o.icone} taille={25} epaisseur={1.9} />
              {o.id === 'alertes' && nouvelles > 0 && <span class="badge" aria-label={`${nouvelles} nouvelles`}>{nouvelles}</span>}
            </span>
            <span>{o.nom}</span>
          </button>
        ))}
      </nav>

      {visite && <Visite surFin={() => setVisite(false)} surAller={(o) => { setPage(null); choisir(o); }} />}
      {fiche && <FicheEvenement e={fiche} planning={d.planning} surFermer={fermerFiche} surAjouterDevoir={d.afaire && !horsLigne ? devoirDepuisCreneau : undefined} />}
      {brouillon && d.afaire && (
        <AjoutDevoir b={brouillon} surFermer={fermerBrouillon}
          surAjout={(t) => { changerAFaire({ ...d.afaire!, taches: [...d.afaire!.taches, t] }); setBrouillon(null); }} />
      )}
    </>
  );
}
