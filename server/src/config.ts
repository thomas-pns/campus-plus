/** Réglages du serveur, lus dans les variables d'environnement (voir .env.example). */
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface Config {
  port: number;
  dossierDonnees: string;
  /** Clé de chiffrement des données au repos (32 octets). */
  cle: Buffer;
  /** Intervalle entre deux synchros automatiques d'un même élève. */
  minutesSynchro: number;
  /** Adresse de WebAurion (modifiable pour les tests). */
  aurionBase: string;
  /** Cookie de session réservé au HTTPS (à désactiver seulement en local). */
  cookieSecurise: boolean;
  /** Vrai derrière un proxy inversé : l'adresse du visiteur est lue dans X-Forwarded-For. */
  derriereProxy: boolean;
  /** Dossier de l'appli web compilée (client/dist), servi par le serveur s'il est indiqué. */
  dossierClient: string | null;
}

export function lireCle(valeur: string | undefined): Buffer {
  const cle = Buffer.from(valeur ?? '', 'base64');
  if (cle.length !== 32) {
    throw new Error('CAMPUS_SECRET_KEY manquante ou invalide : génère-la avec « openssl rand -base64 32 ».');
  }
  return cle;
}

/**
 * Clé de chiffrement : celle de CAMPUS_SECRET_KEY si elle est fournie ; sinon une clé est créée au
 * premier démarrage dans <DATA_DIR>/cle-secrete et relue ensuite. Plus simple à installer, mais la clé
 * est alors rangée à côté des données : qui copie tout le dossier peut les lire.
 */
export async function chargerCle(env: NodeJS.ProcessEnv, dossierDonnees: string): Promise<Buffer> {
  if (env.CAMPUS_SECRET_KEY) return lireCle(env.CAMPUS_SECRET_KEY);
  const fichier = join(dossierDonnees, 'cle-secrete');
  try {
    return lireCle((await readFile(fichier, 'utf8')).trim());
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`Clé illisible dans ${fichier} : ${(e as Error).message}`);
  }
  const cle = randomBytes(32);
  await mkdir(dossierDonnees, { recursive: true });
  // « wx » : ne jamais écraser une clé existante.
  await writeFile(fichier, cle.toString('base64') + '\n', { mode: 0o600, flag: 'wx' });
  return cle;
}

export async function lireConfig(env: NodeJS.ProcessEnv = process.env): Promise<Config> {
  const minutes = Number(env.SYNC_MINUTES ?? 15);
  const dossierDonnees = env.DATA_DIR ?? './data';
  return {
    port: Number(env.PORT ?? 8787),
    dossierDonnees,
    cle: await chargerCle(env, dossierDonnees),
    minutesSynchro: Number.isFinite(minutes) && minutes >= 5 ? minutes : 15,
    aurionBase: env.AURION_BASE ?? 'https://mycpe.cpe.fr',
    cookieSecurise: env.COOKIE_SECURE !== 'false',
    derriereProxy: env.TRUST_PROXY !== 'false',
    dossierClient: env.CLIENT_DIR || null,
  };
}
