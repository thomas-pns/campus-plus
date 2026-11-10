/**
 * Synchro des cours e-campus : liste des cours, sections et fichiers, puis copie des fichiers sur le serveur.
 *
 * Les fichiers sont rangés une seule fois même si plusieurs élèves suivent le même cours :
 *   <DATA_DIR>/fichiers/<clé>.enc   (chiffrés, clé = adresse + date de modification)
 * Chaque élève a son propre index (chiffré, dans son dossier) : un élève n'accède qu'aux fichiers de ses cours.
 */
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { comparerCours, comparerEcheances, type Alerte } from './alertes.js';
import type { Coffre } from './coffre.js';
import type { Comptes } from './comptes.js';
import type { Depot } from './depot.js';
import { ErreurIdentifiantsMoodle, ErreurJeton, type Cours, type Echeance, type Fichier, type MoodleClient } from './sources/moodle.js';

export interface EtatCours {
  derniereSynchro: string | null;
  derniereTentative: string | null;
  erreur: string | null;
  echecs: number;
  /** Fichiers trop gros ou refusés : listés, mais pas copiés. */
  ignores: number;
}

interface Acces {
  jeton: string | null;
  /** Vrai si le CAS a refusé les identifiants : on attend la prochaine connexion à l'appli. */
  bloque: boolean;
}

const ETAT_VIDE: EtatCours = { derniereSynchro: null, derniereTentative: null, erreur: null, echecs: 0, ignores: 0 };
const ALERTES_MAX = 200;
export const TAILLE_MAX = 60 * 1024 * 1024;
const CLE_VALIDE = /^[0-9a-f]{32}$/;

export interface OptionsCours {
  maintenant?: () => Date;
  journal?: (m: string) => void;
  surNouvellesAlertes?: (id: string, alertes: Alerte[]) => Promise<void>;
  tailleMax?: number;
}

export class SynchroCours {
  private enCours = new Map<string, Promise<EtatCours>>();
  private maintenant: () => Date;

  constructor(
    private depot: Depot,
    private comptes: Comptes,
    private coffre: Coffre,
    private dossierDonnees: string,
    private fabrique: () => MoodleClient,
    private options: OptionsCours = {},
  ) {
    this.maintenant = options.maintenant ?? (() => new Date());
  }

  private cheminFichier(cle: string) {
    if (!CLE_VALIDE.test(cle)) throw new Error('Clé de fichier invalide');
    return join(this.dossierDonnees, 'fichiers', `${cle}.enc`);
  }

  private async existe(cle: string) {
    try {
      await stat(this.cheminFichier(cle));
      return true;
    } catch {
      return false;
    }
  }

  async etat(id: string): Promise<EtatCours> {
    return { ...ETAT_VIDE, ...(await this.depot.lire<EtatCours>(id, 'etatcours')) };
  }

  async echeances(id: string): Promise<Echeance[]> {
    return (await this.depot.lire<Echeance[]>(id, 'echeances')) ?? [];
  }

  async cours(id: string): Promise<Cours[]> {
    return (await this.depot.lire<Cours[]>(id, 'cours')) ?? [];
  }

  /** À appeler quand l'élève se reconnecte à l'appli : débloque après un refus du CAS. */
  async debloquer(id: string): Promise<void> {
    const acces = await this.depot.lire<Acces>(id, 'moodle');
    if (acces?.bloque) await this.depot.ecrire(id, 'moodle', { jeton: null, bloque: false });
  }

  synchroniser(id: string): Promise<EtatCours> {
    const deja = this.enCours.get(id);
    if (deja) return deja;
    const tache = this.executer(id).finally(() => this.enCours.delete(id));
    this.enCours.set(id, tache);
    return tache;
  }

  private async jeton(id: string, client: MoodleClient, neuf: boolean): Promise<string | null> {
    const acces = (await this.depot.lire<Acces>(id, 'moodle')) ?? { jeton: null, bloque: false };
    if (acces.bloque) return null;
    if (acces.jeton && !neuf) return acces.jeton;
    const compte = await this.comptes.lire(id);
    if (!compte) throw new Error('Compte introuvable');
    try {
      const jeton = await client.obtenirJeton(compte.identifiant, compte.motDePasse);
      await this.depot.ecrire(id, 'moodle', { jeton, bloque: false });
      return jeton;
    } catch (e) {
      if (e instanceof ErreurIdentifiantsMoodle) await this.depot.ecrire(id, 'moodle', { jeton: null, bloque: true });
      throw e;
    }
  }

  private async executer(id: string): Promise<EtatCours> {
    const precedent = await this.etat(id);
    const t = this.maintenant();
    const client = this.fabrique();
    try {
      let jeton = await this.jeton(id, client, false);
      if (!jeton) throw new ErreurIdentifiantsMoodle('Identifiants refusés par e-campus : reconnecte-toi à l’appli');
      let cours: Cours[];
      try {
        cours = await client.cours(jeton);
      } catch (e) {
        if (!(e instanceof ErreurJeton)) throw e;
        jeton = (await this.jeton(id, client, true))!;
        cours = await client.cours(jeton);
      }

      const ignores = await this.copierFichiers(cours, client, jeton);
      // Les échéances ne bloquent pas le reste si e-campus refuse cette fonction.
      const echeances = await client.echeances(jeton, t.getTime()).catch((e) => {
        this.options.journal?.(`Échéances indisponibles : ${(e as Error).message}`);
        return null;
      });

      const [ancien, anciennesEcheances] = await Promise.all([
        this.depot.lire<Cours[]>(id, 'cours'),
        this.depot.lire<Echeance[]>(id, 'echeances'),
      ]);
      // Première synchro : rien à comparer, donc pas d'alerte.
      const nouvelles = [
        ...(ancien ? comparerCours(ancien, cours, t) : []),
        ...(anciennesEcheances && echeances ? comparerEcheances(anciennesEcheances, echeances, t) : []),
      ];
      if (nouvelles.length) {
        const anciennes = (await this.depot.lire<Alerte[]>(id, 'alertes')) ?? [];
        const connues = new Set(anciennes.map((a) => a.id));
        const inedites = nouvelles.filter((a) => !connues.has(a.id));
        await this.depot.ecrire(id, 'alertes', [...inedites, ...anciennes].slice(0, ALERTES_MAX));
        if (inedites.length) await this.options.surNouvellesAlertes?.(id, inedites).catch((e) => this.options.journal?.(`Notifications en échec : ${(e as Error).message}`));
      }
      await this.depot.ecrire(id, 'cours', cours);
      if (echeances) await this.depot.ecrire(id, 'echeances', echeances);
      const etat: EtatCours = { derniereSynchro: t.toISOString(), derniereTentative: t.toISOString(), erreur: null, echecs: 0, ignores };
      await this.depot.ecrire(id, 'etatcours', etat);
      return etat;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Erreur inconnue';
      this.options.journal?.(`Synchro des cours en échec pour ${id.slice(0, 6)}… : ${message}`);
      const etat: EtatCours = { ...precedent, derniereTentative: t.toISOString(), erreur: message, echecs: precedent.echecs + 1 };
      if (await this.comptes.lire(id)) await this.depot.ecrire(id, 'etatcours', etat);
      return etat;
    }
  }

  /** Copie les fichiers absents du cache ; renvoie le nombre de fichiers ignorés (trop gros ou refusés). */
  private async copierFichiers(cours: Cours[], client: MoodleClient, jeton: string): Promise<number> {
    const max = this.options.tailleMax ?? TAILLE_MAX;
    await mkdir(join(this.dossierDonnees, 'fichiers'), { recursive: true, mode: 0o700 });
    let ignores = 0;
    const vus = new Set<string>();
    for (const c of cours) {
      for (const s of c.sections) {
        for (const e of s.elements) {
          for (const f of e.fichiers) {
            if (vus.has(f.cle)) continue;
            vus.add(f.cle);
            if (f.taille > max) { ignores++; continue; }
            if (await this.existe(f.cle)) continue;
            try {
              const octets = await client.telecharger(jeton, f.adresse, max);
              const cible = this.cheminFichier(f.cle);
              const tmp = `${cible}.${randomBytes(4).toString('hex')}.tmp`;
              await writeFile(tmp, this.coffre.chiffrerOctets(octets), { mode: 0o600 });
              await rename(tmp, cible);
            } catch (err) {
              if (err instanceof ErreurJeton) throw err;
              ignores++;
              this.options.journal?.(`Fichier non copié (${f.nom}) : ${(err as Error).message}`);
            }
          }
        }
      }
    }
    return ignores;
  }

  /** Le fichier demandé, seulement s'il fait partie des cours de cet élève. */
  async fichier(id: string, cle: string): Promise<{ fichier: Fichier; octets: Buffer } | { fichier: Fichier; flux: Response } | null> {
    if (!CLE_VALIDE.test(cle)) return null;
    let fichier: Fichier | undefined;
    for (const c of await this.cours(id)) {
      for (const s of c.sections) {
        for (const e of s.elements) fichier ??= e.fichiers.find((f) => f.cle === cle);
      }
    }
    if (!fichier) return null;
    try {
      return { fichier, octets: this.coffre.dechiffrerOctets(await readFile(this.cheminFichier(cle))) };
    } catch {
      // Pas de copie sur le serveur (trop gros, ou pas encore copié) : on le prend sur e-campus à la volée.
    }
    const client = this.fabrique();
    const ouvrir = async (neuf: boolean) => {
      const jeton = await this.jeton(id, client, neuf);
      if (!jeton) return null;
      return client.ouvrir(jeton, fichier!.adresse);
    };
    try {
      const flux = await ouvrir(false).catch((e) => (e instanceof ErreurJeton ? ouvrir(true) : Promise.reject(e)));
      return flux ? { fichier, flux } : null;
    } catch (e) {
      this.options.journal?.(`Fichier non transmis (${fichier.nom}) : ${(e as Error).message}`);
      return null;
    }
  }
}
