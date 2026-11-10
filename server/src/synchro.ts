/**
 * Synchronisation : pour chaque élève, le serveur se connecte à WebAurion, récupère planning,
 * notes et absences, les compare à la synchro précédente (alertes) et range le tout, chiffré.
 */
import { AurionClient, ErreurIdentifiants, type Absence, type Note } from './sources/aurion.js';
import type { Evenement } from './sources/planning.js';
import { comparerNotes, comparerPlanning, type Alerte } from './alertes.js';
import type { Comptes } from './comptes.js';
import type { Depot } from './depot.js';

export interface Etat {
  /** Dernière synchro réussie. */
  derniereSynchro: string | null;
  derniereTentative: string | null;
  /** Message de la dernière erreur, null si la dernière tentative a réussi. */
  erreur: string | null;
  echecs: number;
}

const ETAT_VIDE: Etat = { derniereSynchro: null, derniereTentative: null, erreur: null, echecs: 0 };
const ALERTES_MAX = 200;
const ATTENTE_MAX_MIN = 120;

/** Année scolaire en cours : du 20 août au 31 juillet. */
export function anneeScolaire(maintenant: Date): { debut: Date; fin: Date } {
  const annee = maintenant.getMonth() >= 7 ? maintenant.getFullYear() : maintenant.getFullYear() - 1;
  return { debut: new Date(annee, 7, 20), fin: new Date(annee + 1, 6, 31, 23, 59) };
}

export interface OptionsSynchro {
  minutes: number;
  maintenant?: () => Date;
  journal?: (message: string) => void;
}

export class Synchro {
  private enCours = new Map<string, Promise<Etat>>();
  private minuteur: NodeJS.Timeout | undefined;
  private tourEnCours = false;
  private maintenant: () => Date;

  constructor(
    private depot: Depot,
    private comptes: Comptes,
    private fabrique: () => AurionClient,
    private options: OptionsSynchro,
  ) {
    this.maintenant = options.maintenant ?? (() => new Date());
  }

  async etat(id: string): Promise<Etat> {
    return (await this.depot.lire<Etat>(id, 'etat')) ?? ETAT_VIDE;
  }

  /**
   * Lance une synchro pour cet élève (une seule à la fois par élève).
   * `client` : un client déjà connecté, pour éviter une deuxième connexion juste après le login.
   */
  synchroniser(id: string, client?: AurionClient): Promise<Etat> {
    const deja = this.enCours.get(id);
    if (deja) return deja;
    const tache = this.executer(id, client).finally(() => this.enCours.delete(id));
    this.enCours.set(id, tache);
    return tache;
  }

  private async executer(id: string, clientConnecte?: AurionClient): Promise<Etat> {
    const precedent = await this.etat(id);
    const t = this.maintenant();
    try {
      const compte = await this.comptes.lire(id);
      if (!compte) throw new Error('Compte introuvable');
      let client = clientConnecte;
      if (!client) {
        client = this.fabrique();
        await client.connexion(compte.identifiant, compte.motDePasse);
      }
      const { debut, fin } = anneeScolaire(t);
      // L'une après l'autre : WebAurion garde la page courante en session.
      const planning = await client.planning(debut, fin);
      const notes = await client.notes();
      const absences = await client.absences();
      if (client.nomEleve && client.nomEleve !== compte.nom) await this.comptes.changer(id, { nom: client.nomEleve });

      const [ancienPlanning, anciennesNotes] = await Promise.all([
        this.depot.lire<Evenement[]>(id, 'planning'),
        this.depot.lire<Note[]>(id, 'notes'),
      ]);
      // Première synchro : rien à comparer, donc aucune alerte.
      const nouvelles: Alerte[] = [
        ...(ancienPlanning ? comparerPlanning(ancienPlanning, planning, t) : []),
        ...(anciennesNotes ? comparerNotes(anciennesNotes, notes, t) : []),
      ];
      if (nouvelles.length) {
        const anciennes = (await this.depot.lire<Alerte[]>(id, 'alertes')) ?? [];
        const connues = new Set(anciennes.map((a) => a.id));
        await this.depot.ecrire(id, 'alertes', [...nouvelles.filter((a) => !connues.has(a.id)), ...anciennes].slice(0, ALERTES_MAX));
      }
      await this.depot.ecrire(id, 'planning', planning);
      await this.depot.ecrire(id, 'notes', notes);
      await this.depot.ecrire(id, 'absences', absences satisfies Absence[]);

      const etat: Etat = { derniereSynchro: t.toISOString(), derniereTentative: t.toISOString(), erreur: null, echecs: 0 };
      await this.depot.ecrire(id, 'etat', etat);
      return etat;
    } catch (e) {
      if (e instanceof ErreurIdentifiants) await this.comptes.changer(id, { aReconnecter: true });
      const message = e instanceof Error ? e.message : 'Erreur inconnue';
      this.options.journal?.(`Synchro en échec pour ${id.slice(0, 6)}… : ${message}`);
      const etat: Etat = { ...precedent, derniereTentative: t.toISOString(), erreur: message, echecs: precedent.echecs + 1 };
      if (await this.comptes.lire(id)) await this.depot.ecrire(id, 'etat', etat);
      return etat;
    }
  }

  /** Vrai si c'est le moment de resynchroniser (l'attente double après chaque échec, jusqu'à 2 h). */
  private aSynchroniser(etat: Etat): boolean {
    if (!etat.derniereTentative) return true;
    const attente = Math.min(this.options.minutes * 2 ** Math.min(etat.echecs, 6), Math.max(ATTENTE_MAX_MIN, this.options.minutes));
    return this.maintenant().getTime() - Date.parse(etat.derniereTentative) >= attente * 60_000;
  }

  /** Un tour : synchronise, un par un, les élèves dont c'est le moment. */
  async tour(): Promise<void> {
    if (this.tourEnCours) return;
    this.tourEnCours = true;
    try {
      for (const id of await this.comptes.lister()) {
        const compte = await this.comptes.lire(id);
        if (!compte || compte.aReconnecter) continue;
        if (this.aSynchroniser(await this.etat(id))) await this.synchroniser(id);
      }
    } catch (e) {
      this.options.journal?.(`Tour de synchro interrompu : ${(e as Error).message}`);
    } finally {
      this.tourEnCours = false;
    }
  }

  demarrer(): void {
    if (this.minuteur) return;
    this.minuteur = setInterval(() => void this.tour(), 60_000);
    this.minuteur.unref();
    void this.tour();
  }

  arreter(): void {
    clearInterval(this.minuteur);
    this.minuteur = undefined;
  }
}
