/**
 * Option « OneDrive » : copie des fichiers de cours, rangés par semestre, matière et type, dans le
 * OneDrive de l'élève (pratique pour les lire sur une liseuse reMarkable, par exemple).
 *
 * Connexion Microsoft par code d'appareil : l'élève tape un code sur microsoft.com/devicelogin, le
 * serveur ne voit jamais son mot de passe Microsoft. Le jeton de renouvellement est gardé chiffré
 * dans le dossier de l'élève. Les fichiers sont pris dans la copie chiffrée du serveur (≤ 60 Mo).
 */
import type { Depot } from './depot.js';
import type { SynchroCours } from './cours.js';
import { placer } from './rangement.js';

export interface EtatOneDrive {
  actif: boolean;
  /** Nom du compte Microsoft connecté. */
  compte: string | null;
  derniereSynchro: string | null;
  derniereTentative: string | null;
  erreur: string | null;
  echecs: number;
  /** Fichiers déjà copiés sur OneDrive. */
  copies: number;
  /** Fichiers restant à copier (au prochain passage). */
  restants: number;
}

export interface ConnexionEnCours {
  code: string;
  adresse: string;
  /** Instant (ms) où le code n'est plus valable. */
  expire: number;
}

export interface OptionsOneDrive {
  clientId: string;
  /** « common » : comptes d'école et comptes personnels. */
  tenant?: string;
  baseConnexion?: string;
  baseGraph?: string;
  maintenant?: () => Date;
  journal?: (m: string) => void;
  /** Fichiers copiés au plus par passage, pour ne pas bloquer la synchro. */
  parPassage?: number;
  /** Attente minimale entre deux interrogations de Microsoft pendant la connexion (tests). */
  pauseMin?: number;
}

const ETAT_VIDE: EtatOneDrive = { actif: false, compte: null, derniereSynchro: null, derniereTentative: null, erreur: null, echecs: 0, copies: 0, restants: 0 };
const PORTEE = 'Files.ReadWrite User.Read offline_access';
const PETIT = 4 * 1024 * 1024;
/** Morceaux d'envoi : multiple de 320 Kio, comme l'exige OneDrive. */
const MORCEAU = 320 * 1024 * 32;

export class ErreurOneDrive extends Error {}
class ErreurAutorisation extends ErreurOneDrive {}

interface Secret { renouvellement: string }

/** Fichiers vraiment copiés (« ! » marque ceux trop gros pour être copiés). */
const compter = (copies: Record<string, string>) => Object.values(copies).filter((c) => !c.startsWith('!')).length;

export class SynchroOneDrive {
  private connexions = new Map<string, ConnexionEnCours & { arret: () => void }>();
  private acces = new Map<string, { jeton: string; expire: number }>();
  private enCours = new Map<string, Promise<EtatOneDrive>>();
  private maintenant: () => Date;
  private login: string;
  private graph: string;

  constructor(private depot: Depot, private cours: SynchroCours, private options: OptionsOneDrive) {
    this.maintenant = options.maintenant ?? (() => new Date());
    this.login = `${options.baseConnexion ?? 'https://login.microsoftonline.com'}/${options.tenant ?? 'common'}/oauth2/v2.0`;
    this.graph = options.baseGraph ?? 'https://graph.microsoft.com/v1.0';
  }

  async etat(id: string): Promise<EtatOneDrive & { connexion: ConnexionEnCours | null }> {
    const etat = { ...ETAT_VIDE, ...(await this.depot.lire<EtatOneDrive>(id, 'onedrive')) };
    const c = this.connexions.get(id);
    return { ...etat, connexion: c ? { code: c.code, adresse: c.adresse, expire: c.expire } : null };
  }

  private async noter(id: string, modif: Partial<EtatOneDrive>): Promise<EtatOneDrive> {
    const etat = { ...ETAT_VIDE, ...(await this.depot.lire<EtatOneDrive>(id, 'onedrive')), ...modif };
    await this.depot.ecrire(id, 'onedrive', etat);
    return etat;
  }

  private async formulaire(chemin: string, champs: Record<string, string>) {
    const rep = await fetch(`${this.login}/${chemin}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.options.clientId, ...champs }),
    });
    return { ok: rep.ok, json: (await rep.json().catch(() => ({}))) as Record<string, unknown> };
  }

  /** Demande un code d'appareil à Microsoft, puis attend en arrière-plan que l'élève le saisisse. */
  async demarrerConnexion(id: string): Promise<ConnexionEnCours> {
    this.connexions.get(id)?.arret();
    const { ok, json } = await this.formulaire('devicecode', { scope: PORTEE });
    if (!ok || typeof json.device_code !== 'string') {
      throw new ErreurOneDrive(`Microsoft refuse la connexion : ${String(json.error_description ?? json.error ?? 'réponse inattendue').split('\n')[0]}`);
    }
    const expire = Date.now() + Number(json.expires_in ?? 900) * 1000;
    let pause = Math.max(Number(json.interval ?? 5) * 1000, this.options.pauseMin ?? 0);
    let arrete = false;
    let minuteur: NodeJS.Timeout | undefined;
    const connexion = {
      code: String(json.user_code), adresse: String(json.verification_uri ?? 'https://microsoft.com/devicelogin'), expire,
      arret: () => { arrete = true; clearTimeout(minuteur); this.connexions.delete(id); },
    };
    this.connexions.set(id, connexion);

    const interroger = async () => {
      if (arrete) return;
      if (Date.now() > expire) return connexion.arret();
      const r = await this.formulaire('token', { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: String(json.device_code) }).catch(() => null);
      if (arrete) return;
      // L'état est écrit avant de retirer la connexion en cours, pour que l'appli ne voie pas d'entre-deux.
      if (r?.ok && typeof r.json.refresh_token === 'string') {
        arrete = true;
        await this.connecte(id, r.json).catch((e) => this.options.journal?.(`Connexion OneDrive inachevée : ${(e as Error).message}`));
        return connexion.arret();
      }
      const erreur = r?.json.error;
      if (erreur === 'slow_down') pause += 5000;
      else if (erreur && erreur !== 'authorization_pending') {
        arrete = true;
        await this.noter(id, { erreur: erreur === 'access_denied' ? 'Connexion Microsoft annulée' : `Connexion Microsoft refusée : ${String(r.json.error_description ?? erreur).split('\n')[0]}` });
        return connexion.arret();
      }
      minuteur = setTimeout(() => void interroger(), pause);
    };
    minuteur = setTimeout(() => void interroger(), pause);
    return { code: connexion.code, adresse: connexion.adresse, expire };
  }

  private async connecte(id: string, jetons: Record<string, unknown>) {
    await this.depot.ecrire(id, 'onedrivejeton', { renouvellement: String(jetons.refresh_token) } satisfies Secret);
    this.acces.set(id, { jeton: String(jetons.access_token), expire: Date.now() + (Number(jetons.expires_in ?? 3600) - 120) * 1000 });
    const moi = await this.appel(id, '/me?$select=displayName,mail,userPrincipalName').then((r) => r.json() as Promise<Record<string, string>>).catch(() => ({} as Record<string, string>));
    await this.depot.ecrire(id, 'onedrivecopies', {});
    await this.noter(id, { ...ETAT_VIDE, actif: true, compte: moi.mail || moi.userPrincipalName || moi.displayName || 'Compte Microsoft' });
    void this.synchroniser(id);
  }

  annulerConnexion(id: string): void {
    this.connexions.get(id)?.arret();
  }

  /** Oublie le compte Microsoft. Les fichiers déjà copiés restent sur OneDrive. */
  async deconnecter(id: string): Promise<EtatOneDrive> {
    this.annulerConnexion(id);
    this.acces.delete(id);
    await this.depot.ecrire(id, 'onedrivejeton', null);
    await this.depot.ecrire(id, 'onedrivecopies', {});
    return this.noter(id, { ...ETAT_VIDE });
  }

  private async jeton(id: string): Promise<string> {
    const a = this.acces.get(id);
    if (a && a.expire > Date.now()) return a.jeton;
    const secret = await this.depot.lire<Secret>(id, 'onedrivejeton');
    if (!secret?.renouvellement) throw new ErreurAutorisation('OneDrive n’est plus connecté : reconnecte-le dans les réglages');
    const { ok, json } = await this.formulaire('token', { grant_type: 'refresh_token', refresh_token: secret.renouvellement, scope: PORTEE });
    if (!ok || typeof json.access_token !== 'string') {
      if (json.error === 'invalid_grant' || json.error === 'interaction_required') throw new ErreurAutorisation('Microsoft a mis fin à l’accès : reconnecte OneDrive dans les réglages');
      throw new ErreurOneDrive(`Microsoft injoignable (${String(json.error ?? 'réponse inattendue')})`);
    }
    // Microsoft remplace le jeton de renouvellement à chaque usage.
    if (typeof json.refresh_token === 'string') await this.depot.ecrire(id, 'onedrivejeton', { renouvellement: json.refresh_token } satisfies Secret);
    this.acces.set(id, { jeton: json.access_token, expire: Date.now() + (Number(json.expires_in ?? 3600) - 120) * 1000 });
    return json.access_token;
  }

  private async appel(id: string, chemin: string, init: RequestInit = {}): Promise<Response> {
    const envoyer = async () => fetch(`${this.graph}${chemin}`, { ...init, headers: { ...init.headers, Authorization: `Bearer ${await this.jeton(id)}` } });
    let rep = await envoyer();
    if (rep.status === 401) {
      this.acces.delete(id);
      rep = await envoyer();
    }
    if (rep.status === 401 || rep.status === 403) throw new ErreurAutorisation('OneDrive refuse l’accès : reconnecte-le dans les réglages');
    if (rep.status === 429 || rep.status === 507) throw new ErreurOneDrive(rep.status === 507 ? 'OneDrive est plein' : 'OneDrive demande de ralentir : la suite au prochain passage');
    return rep;
  }

  private async envoyer(id: string, chemin: string, octets: Buffer): Promise<void> {
    const adresse = `/me/drive/root:/${chemin.split('/').map(encodeURIComponent).join('/')}:`;
    if (octets.length <= PETIT) {
      const rep = await this.appel(id, `${adresse}/content?@microsoft.graph.conflictBehavior=replace`, {
        method: 'PUT', headers: { 'Content-Type': 'application/octet-stream' }, body: new Uint8Array(octets),
      });
      if (!rep.ok) throw new Error(`envoi refusé (${rep.status})`);
      return;
    }
    const session = await this.appel(id, `${adresse}/createUploadSession`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }),
    });
    const { uploadUrl } = (await session.json().catch(() => ({}))) as { uploadUrl?: string };
    if (!session.ok || !uploadUrl) throw new Error(`session d’envoi refusée (${session.status})`);
    for (let debut = 0; debut < octets.length; debut += MORCEAU) {
      const morceau = octets.subarray(debut, Math.min(debut + MORCEAU, octets.length));
      // L'adresse de session porte sa propre autorisation : pas de jeton à joindre.
      const rep = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Range': `bytes ${debut}-${debut + morceau.length - 1}/${octets.length}` },
        body: new Uint8Array(morceau),
      });
      if (!rep.ok) throw new Error(`morceau refusé (${rep.status})`);
    }
  }

  synchroniser(id: string): Promise<EtatOneDrive> {
    const deja = this.enCours.get(id);
    if (deja) return deja;
    const tache = this.executer(id).finally(() => this.enCours.delete(id));
    this.enCours.set(id, tache);
    return tache;
  }

  private async executer(id: string): Promise<EtatOneDrive> {
    const t = this.maintenant().toISOString();
    const precedent = await this.etat(id);
    if (!precedent.actif) return precedent;
    const copies = (await this.depot.lire<Record<string, string>>(id, 'onedrivecopies')) ?? {};
    const aFaire = placer(await this.cours.cours(id)).filter((p) => copies[p.fichier.cle] !== p.chemin && copies[p.fichier.cle] !== `!${p.chemin}`);
    let faits = 0;
    let ignores = 0;
    try {
      for (const p of aFaire.slice(0, this.options.parPassage ?? 40)) {
        const octets = await this.cours.octetsEnCache(p.fichier.cle);
        // Pas de copie sur le serveur (trop gros) : on n'essaie pas à chaque passage.
        if (!octets) { ignores++; copies[p.fichier.cle] = `!${p.chemin}`; continue; }
        try {
          await this.envoyer(id, p.chemin, octets);
          copies[p.fichier.cle] = p.chemin;
          faits++;
        } catch (e) {
          if (e instanceof ErreurOneDrive) throw e;
          this.options.journal?.(`Fichier non copié sur OneDrive (${p.fichier.nom}) : ${(e as Error).message}`);
        }
      }
      await this.depot.ecrire(id, 'onedrivecopies', copies);
      return await this.noter(id, {
        derniereSynchro: t, derniereTentative: t, erreur: null, echecs: 0,
        copies: compter(copies), restants: Math.max(aFaire.length - faits - ignores, 0),
      });
    } catch (e) {
      await this.depot.ecrire(id, 'onedrivecopies', copies);
      const message = (e as Error).message;
      this.options.journal?.(`OneDrive en échec pour ${id.slice(0, 6)}… : ${message}`);
      return this.noter(id, {
        derniereTentative: t, erreur: message, echecs: precedent.echecs + 1,
        copies: compter(copies), restants: aFaire.length - faits,
        ...(e instanceof ErreurAutorisation ? { actif: false } : {}),
      });
    }
  }
}
