/**
 * Comptes des élèves et sessions de l'appli.
 *
 * Le mot de passe CPE est conservé (chiffré par le coffre) parce que le serveur doit pouvoir
 * se reconnecter seul à WebAurion pour les synchros. Supprimer le compte efface tout.
 * Les jetons de session ne sont jamais stockés : seulement leur empreinte.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Coffre } from './coffre.js';
import type { Depot } from './depot.js';

const DUREE_SESSION_MS = 60 * 24 * 3600 * 1000;
const SESSIONS_MAX = 10;

export interface Compte {
  id: string;
  identifiant: string;
  motDePasse: string;
  nom: string;
  creeLe: string;
  /** Vrai si WebAurion a refusé les identifiants : on arrête les synchros jusqu'à la prochaine connexion. */
  aReconnecter: boolean;
  sessions: { empreinte: string; expire: number }[];
}

export class Comptes {
  private verrous = new Map<string, Promise<unknown>>();

  constructor(private depot: Depot, private coffre: Coffre, private maintenant: () => number = Date.now) {}

  /** Identifiant de dossier : empreinte de l'identifiant CPE, pour ne pas l'écrire en clair sur le disque. */
  idPour(identifiant: string): string {
    return this.coffre.empreinte(identifiant.trim().toLowerCase());
  }

  /** Une seule modification à la fois par compte (lecture, changement, écriture). */
  private async modifier<T>(id: string, action: (c: Compte | null) => Promise<{ compte: Compte | null; resultat: T }>): Promise<T> {
    const precedent = this.verrous.get(id) ?? Promise.resolve();
    const suivant = precedent.catch(() => {}).then(async () => {
      const { compte, resultat } = await action(await this.depot.lire<Compte>(id, 'compte'));
      if (compte) await this.depot.ecrire(id, 'compte', compte);
      return resultat;
    });
    this.verrous.set(id, suivant);
    try {
      return await suivant;
    } finally {
      if (this.verrous.get(id) === suivant) this.verrous.delete(id);
    }
  }

  lire(id: string): Promise<Compte | null> {
    return this.depot.lire<Compte>(id, 'compte');
  }

  lister(): Promise<string[]> {
    return this.depot.lister();
  }

  /** Crée le compte, ou met à jour le mot de passe d'un compte existant. À n'appeler qu'après une connexion WebAurion réussie. */
  enregistrer(identifiant: string, motDePasse: string): Promise<Compte> {
    const id = this.idPour(identifiant);
    return this.modifier(id, async (existant) => {
      const compte: Compte = existant
        ? { ...existant, motDePasse, aReconnecter: false }
        : { id, identifiant: identifiant.trim(), motDePasse, nom: '', creeLe: new Date(this.maintenant()).toISOString(), aReconnecter: false, sessions: [] };
      return { compte, resultat: compte };
    });
  }

  changer(id: string, champs: Partial<Pick<Compte, 'nom' | 'aReconnecter'>>): Promise<void> {
    return this.modifier(id, async (c) => ({ compte: c ? { ...c, ...champs } : null, resultat: undefined }));
  }

  async supprimer(id: string): Promise<void> {
    await this.modifier(id, async () => ({ compte: null, resultat: undefined }));
    await this.depot.supprimer(id);
  }

  /* ---------- Sessions ---------- */

  /** Renvoie le jeton à mettre dans le cookie : « <id>.<secret> ». */
  ouvrirSession(id: string): Promise<string> {
    const secret = randomBytes(32).toString('base64url');
    return this.modifier(id, async (c) => {
      if (!c) throw new Error('Compte introuvable');
      const t = this.maintenant();
      const sessions = [...c.sessions.filter((s) => s.expire > t), { empreinte: this.coffre.empreinte(secret, 64), expire: t + DUREE_SESSION_MS }]
        .slice(-SESSIONS_MAX);
      return { compte: { ...c, sessions }, resultat: `${id}.${secret}` };
    });
  }

  private static decouper(jeton: string | undefined): { id: string; secret: string } | null {
    const m = /^([0-9a-f]{24})\.([A-Za-z0-9_-]{20,})$/.exec(jeton ?? '');
    return m ? { id: m[1], secret: m[2] } : null;
  }

  async verifierSession(jeton: string | undefined): Promise<Compte | null> {
    const j = Comptes.decouper(jeton);
    if (!j) return null;
    const compte = await this.lire(j.id);
    if (!compte) return null;
    const attendu = Buffer.from(this.coffre.empreinte(j.secret, 64));
    const t = this.maintenant();
    const ok = compte.sessions.some((s) => s.expire > t && s.empreinte.length === attendu.length && timingSafeEqual(Buffer.from(s.empreinte), attendu));
    return ok ? compte : null;
  }

  async fermerSession(jeton: string | undefined): Promise<void> {
    const j = Comptes.decouper(jeton);
    if (!j) return;
    const empreinte = this.coffre.empreinte(j.secret, 64);
    await this.modifier(j.id, async (c) => ({
      compte: c ? { ...c, sessions: c.sessions.filter((s) => s.empreinte !== empreinte) } : null,
      resultat: undefined,
    }));
  }
}
