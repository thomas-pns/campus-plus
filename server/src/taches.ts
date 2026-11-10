/**
 * À faire de l'élève : ses tâches perso (titre, échéance facultative) et les devoirs e-campus
 * qu'il a cochés comme faits. Rangé chiffré dans son dossier.
 */
import { randomBytes } from 'node:crypto';
import type { Depot } from './depot.js';

export interface Tache {
  id: string;
  titre: string;
  /** Jour « AAAA-MM-JJ », facultatif. */
  echeance: string | null;
  /** Cours e-campus associé, facultatif. */
  cours: number | null;
  /** Matière affichée (« Algèbre linéaire »), facultative. */
  matiere: string | null;
  fait: boolean;
  creeLe: string;
}

interface Donnees {
  taches: Tache[];
  /** Identifiants des échéances e-campus marquées faites. */
  echeancesFaites: number[];
}

const MAX_TACHES = 300;
const MAX_FAITES = 500;

export class Taches {
  private verrous = new Map<string, Promise<unknown>>();

  constructor(private depot: Depot, private maintenant: () => Date = () => new Date()) {}

  async lire(id: string): Promise<Donnees> {
    const d = await this.depot.lire<Partial<Donnees>>(id, 'taches');
    return { taches: d?.taches ?? [], echeancesFaites: d?.echeancesFaites ?? [] };
  }

  private modifier<T>(id: string, action: (d: Donnees) => { d: Donnees; r: T }): Promise<T> {
    const avant = this.verrous.get(id) ?? Promise.resolve();
    const suite = avant.catch(() => {}).then(async () => {
      const { d, r } = action(await this.lire(id));
      await this.depot.ecrire(id, 'taches', d);
      return r;
    });
    this.verrous.set(id, suite);
    return suite.finally(() => { if (this.verrous.get(id) === suite) this.verrous.delete(id); });
  }

  ajouter(id: string, t: { titre: string; echeance?: string | null; cours?: number | null; matiere?: string | null }): Promise<Tache> {
    return this.modifier(id, (d) => {
      if (d.taches.length >= MAX_TACHES) throw Object.assign(new Error('Trop de tâches'), { statusCode: 400 });
      const tache: Tache = {
        id: randomBytes(8).toString('hex'), titre: t.titre.trim(), echeance: t.echeance ?? null,
        cours: t.cours ?? null, matiere: t.matiere?.trim() || null, fait: false, creeLe: this.maintenant().toISOString(),
      };
      return { d: { ...d, taches: [...d.taches, tache] }, r: tache };
    });
  }

  changer(id: string, tacheId: string, champs: Partial<Pick<Tache, 'titre' | 'echeance' | 'fait'>>): Promise<Tache | null> {
    return this.modifier(id, (d) => {
      let trouvee: Tache | null = null;
      const taches = d.taches.map((t) => (t.id === tacheId ? (trouvee = { ...t, ...champs, titre: (champs.titre ?? t.titre).trim() }) : t));
      return { d: { ...d, taches }, r: trouvee };
    });
  }

  supprimer(id: string, tacheId: string): Promise<boolean> {
    return this.modifier(id, (d) => {
      const taches = d.taches.filter((t) => t.id !== tacheId);
      return { d: { ...d, taches }, r: taches.length !== d.taches.length };
    });
  }

  marquerEcheance(id: string, echeance: number, faite: boolean): Promise<number[]> {
    return this.modifier(id, (d) => {
      const reste = d.echeancesFaites.filter((x) => x !== echeance);
      const echeancesFaites = (faite ? [...reste, echeance] : reste).slice(-MAX_FAITES);
      return { d: { ...d, echeancesFaites }, r: echeancesFaites };
    });
  }
}
