/** Réglages du serveur, lus dans les variables d'environnement (voir .env.example). */
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
}

export function lireCle(valeur: string | undefined): Buffer {
  const cle = Buffer.from(valeur ?? '', 'base64');
  if (cle.length !== 32) {
    throw new Error('CAMPUS_SECRET_KEY manquante ou invalide : génère-la avec « openssl rand -base64 32 ».');
  }
  return cle;
}

export function lireConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const minutes = Number(env.SYNC_MINUTES ?? 15);
  return {
    port: Number(env.PORT ?? 8787),
    dossierDonnees: env.DATA_DIR ?? './data',
    cle: lireCle(env.CAMPUS_SECRET_KEY),
    minutesSynchro: Number.isFinite(minutes) && minutes >= 5 ? minutes : 15,
    aurionBase: env.AURION_BASE ?? 'https://mycpe.cpe.fr',
    cookieSecurise: env.COOKIE_SECURE !== 'false',
  };
}
