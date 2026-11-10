/**
 * Rangement des données sur le disque : un dossier par élève, chaque fichier chiffré par le coffre.
 *   <DATA_DIR>/eleves/<id>/compte.enc, planning.enc, notes.enc, absences.enc, alertes.enc, etat.enc
 */
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Coffre } from './coffre.js';

const ID_VALIDE = /^[0-9a-f]{24}$/;
const NOM_VALIDE = /^[a-z]+$/;

export class Depot {
  constructor(private racine: string, private coffre: Coffre) {}

  private dossier(id: string) {
    if (!ID_VALIDE.test(id)) throw new Error('Identifiant de dossier invalide');
    return join(this.racine, 'eleves', id);
  }

  private fichier(id: string, nom: string) {
    if (!NOM_VALIDE.test(nom)) throw new Error('Nom de fichier invalide');
    return join(this.dossier(id), `${nom}.enc`);
  }

  async lire<T>(id: string, nom: string): Promise<T | null> {
    let paquet: string;
    try {
      paquet = await readFile(this.fichier(id, nom), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
    return JSON.parse(this.coffre.dechiffrer(paquet)) as T;
  }

  /** Écriture atomique : fichier temporaire puis renommage, pour ne jamais laisser un fichier à moitié écrit. */
  async ecrire(id: string, nom: string, valeur: unknown): Promise<void> {
    const cible = this.fichier(id, nom);
    await mkdir(this.dossier(id), { recursive: true, mode: 0o700 });
    const tmp = `${cible}.${randomBytes(4).toString('hex')}.tmp`;
    await writeFile(tmp, this.coffre.chiffrer(JSON.stringify(valeur)), { mode: 0o600 });
    await rename(tmp, cible);
  }

  async lister(): Promise<string[]> {
    try {
      return (await readdir(join(this.racine, 'eleves'))).filter((n) => ID_VALIDE.test(n));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
  }

  async supprimer(id: string): Promise<void> {
    await rm(this.dossier(id), { recursive: true, force: true });
  }
}
