/**
 * Client e-campus (Moodle de CPE), par la même porte que l'appli Moodle officielle :
 *   1. connexion au CAS de l'école (auth.cpe.fr, Apereo CAS) avec les identifiants de l'élève ;
 *   2. ouverture de la session Moodle avec le ticket CAS ;
 *   3. `admin/tool/mobile/launch.php` donne un jeton pour le service « moodle_mobile_app » ;
 *   4. ensuite tout passe par l'API officielle `webservice/rest/server.php` avec ce jeton.
 * Le jeton dure longtemps : on ne repasse par le CAS que s'il est refusé.
 * Détails : docs/sources-cpe.md
 */
import { createHash, randomBytes } from 'node:crypto';
import * as cheerio from 'cheerio';

export class ErreurMoodle extends Error {}
/** Identifiants refusés par le CAS : ne pas réessayer en boucle. */
export class ErreurIdentifiantsMoodle extends ErreurMoodle {}
/** Jeton expiré ou révoqué : il faut en redemander un. */
export class ErreurJeton extends ErreurMoodle {}

export interface AdressesMoodle {
  moodle: string;
  cas: string;
}

export const ADRESSES_CPE: AdressesMoodle = { moodle: 'https://e-campus.cpe.fr', cas: 'https://auth.cpe.fr' };

/* ---------- Ce que renvoie l'API Moodle (champs utiles seulement) ---------- */

export interface CoursMoodle {
  id: number;
  fullname: string;
  shortname: string;
  /** Moodle ≥ 4 : nom de la catégorie. */
  categoryname?: string;
  hidden?: boolean;
  visible?: number;
}

interface ContenuMoodle {
  type: string;
  filename: string;
  filepath?: string;
  filesize?: number;
  fileurl?: string;
  timemodified?: number;
  mimetype?: string;
}

interface ModuleMoodle {
  id: number;
  name: string;
  modname: string;
  url?: string;
  visible?: number;
  uservisible?: boolean;
  contents?: ContenuMoodle[];
}

interface SectionMoodle {
  id: number;
  name: string;
  section?: number;
  visible?: number;
  uservisible?: boolean;
  modules: ModuleMoodle[];
}

/* ---------- Forme rangée pour Campus+ ---------- */

export interface Fichier {
  /** Clé stable du fichier (adresse + date de modification) : sert de nom dans le cache du serveur. */
  cle: string;
  nom: string;
  dossier: string;
  taille: number;
  modifie: number;
  type: string;
  /** Adresse de téléchargement Moodle, sans jeton. */
  adresse: string;
}

export interface Element {
  id: number;
  nom: string;
  /** resource, folder, url, forum, assign, page… */
  type: string;
  /** Lien vers la page e-campus de l'élément. */
  lien: string;
  fichiers: Fichier[];
}

export interface Section {
  nom: string;
  elements: Element[];
}

export interface Cours {
  id: number;
  nom: string;
  code: string;
  categorie: string;
  sections: Section[];
}

/** Types d'éléments dont on garde les fichiers. Les autres (forum, devoir…) restent de simples liens. */
const AVEC_FICHIERS = new Set(['resource', 'folder']);

/** « Algèbre linéaire (S5) * 26_27_3ETI_05_MSP_101_C » → « Algèbre linéaire (S5) ». */
export function nomPropre(nom: string): string {
  return decoderEntites(nom.replace(/\s*\*\s*\S+_\S+\s*$/, '').trim());
}

const decoderEntites = (s: string) => cheerio.load(`<p>${s}</p>`)('p').text();

export const cleFichier = (adresse: string, modifie: number) =>
  createHash('sha256').update(`${adresse}|${modifie}`).digest('hex').slice(0, 32);

/** Range le contenu brut d'un cours. */
export function rangerCours(c: CoursMoodle, sections: SectionMoodle[], base: string): Cours {
  return {
    id: c.id,
    nom: nomPropre(c.fullname),
    code: c.shortname,
    categorie: c.categoryname ?? '',
    sections: sections
      .filter((s) => s.uservisible !== false)
      .map((s) => ({
        nom: decoderEntites(s.name || (s.section === 0 ? 'Généralités' : `Section ${s.section ?? ''}`.trim())),
        elements: s.modules
          .filter((m) => m.uservisible !== false && m.modname !== 'label' && m.modname !== 'subsection')
          .map((m) => ({
            id: m.id,
            nom: decoderEntites(m.name),
            type: m.modname,
            lien: m.url ?? `${base}/mod/${m.modname}/view.php?id=${m.id}`,
            fichiers: AVEC_FICHIERS.has(m.modname)
              ? (m.contents ?? [])
                .filter((f) => f.type === 'file' && f.fileurl)
                .map((f) => {
                  const adresse = f.fileurl!.replace(/[?&]forcedownload=1/, '');
                  const modifie = f.timemodified ?? 0;
                  return {
                    cle: cleFichier(adresse, modifie),
                    nom: f.filename,
                    dossier: (f.filepath ?? '/').replace(/^\/|\/$/g, ''),
                    taille: f.filesize ?? 0,
                    modifie,
                    type: f.mimetype ?? '',
                    adresse,
                  };
                })
              : [],
          })),
      }))
      .filter((s) => s.elements.length > 0),
  };
}

/* ---------- Client ---------- */

export class MoodleClient {
  private cookies = new Map<string, Map<string, string>>();

  constructor(private adresses: AdressesMoodle = ADRESSES_CPE, private delaiMs = 30_000) {}

  private enteteCookies(url: URL) {
    return [...(this.cookies.get(url.host) ?? [])].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private garderCookies(url: URL, res: Response) {
    const pot = this.cookies.get(url.host) ?? new Map<string, string>();
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [paire] = c.split(';');
      const i = paire.indexOf('=');
      if (i > 0) pot.set(paire.slice(0, i).trim(), paire.slice(i + 1).trim());
    }
    this.cookies.set(url.host, pot);
  }

  private hoteAutorise(url: URL) {
    return [this.adresses.moodle, this.adresses.cas].some((b) => new URL(b).origin === url.origin);
  }

  /**
   * Requête avec cookies par site et redirections suivies à la main.
   * S'arrête (sans la suivre) sur une redirection vers une adresse « moodlemobile:// » et la renvoie.
   */
  private async requete(adresse: string, init: { method?: string; body?: URLSearchParams } = {}, sauts = 10): Promise<{ url: URL; html: string; schemaMobile?: string }> {
    const url = new URL(adresse);
    if (!this.hoteAutorise(url)) throw new ErreurMoodle(`Adresse inattendue : ${url.origin}`);
    let res: Response;
    try {
      res = await fetch(url, {
        method: init.method ?? 'GET',
        body: init.body,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.delaiMs),
        headers: {
          Cookie: this.enteteCookies(url),
          'User-Agent': 'CampusPlus/0.1 (+https://github.com/thomas-pns/campus-plus)',
          ...(init.body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
      });
    } catch (e) {
      throw new ErreurMoodle(`e-campus injoignable (${(e as Error).name})`);
    }
    this.garderCookies(url, res);
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      if (/^moodlemobile:/i.test(loc)) return { url, html: '', schemaMobile: loc };
      if (sauts <= 0) throw new ErreurMoodle('Trop de redirections');
      return this.requete(new URL(loc, url).toString(), {}, sauts - 1);
    }
    const html = await res.text();
    if (!res.ok && res.status !== 401) throw new ErreurMoodle(`HTTP ${res.status} sur ${url.host}${url.pathname}`);
    return { url, html };
  }

  /** Connexion CAS puis demande d'un jeton mobile. Renvoie le jeton (à garder chiffré). */
  async obtenirJeton(identifiant: string, motDePasse: string): Promise<string> {
    this.cookies.clear();
    const { moodle, cas } = this.adresses;
    // 1. Moodle renvoie vers la page de connexion du CAS.
    const pageCas = await this.requete(`${moodle}/login/index.php?authCAS=CAS`);
    if (new URL(cas).origin !== pageCas.url.origin) throw new ErreurMoodle('Page de connexion CAS introuvable');
    const $ = cheerio.load(pageCas.html);
    const form = $('form#fm1, form:has(input[name="execution"])').first();
    const execution = form.find('input[name="execution"]').attr('value');
    if (!execution) throw new ErreurMoodle('Formulaire CAS inattendu');
    const champs = new URLSearchParams();
    form.find('input[name]').each((_, e) => {
      const type = ($(e).attr('type') ?? 'text').toLowerCase();
      if (['submit', 'button', 'checkbox', 'radio'].includes(type)) return;
      champs.set($(e).attr('name')!, $(e).attr('value') ?? '');
    });
    champs.set('username', identifiant);
    champs.set('password', motDePasse);
    champs.set('_eventId', champs.get('_eventId') || 'submit');
    // 2. Envoi du formulaire : succès = retour sur Moodle avec un ticket, puis session ouverte.
    const action = new URL(form.attr('action') ?? 'login', pageCas.url);
    action.search = action.search || pageCas.url.search;
    const apres = await this.requete(action.toString(), { method: 'POST', body: champs });
    // Refus : le CAS réaffiche son formulaire. Succès : on finit sur une page de Moodle.
    if (/name=["']?execution/.test(apres.html)) throw new ErreurIdentifiantsMoodle('Identifiants refusés par le CAS de l’école');
    if (apres.url.origin !== new URL(moodle).origin) throw new ErreurMoodle('Connexion CAS inattendue (page intermédiaire ?)');
    // 3. Jeton mobile.
    const passeport = randomBytes(8).toString('hex');
    const lancement = await this.requete(`${moodle}/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=${passeport}&urlscheme=moodlemobile`);
    if (!lancement.schemaMobile) throw new ErreurMoodle('e-campus n’a pas fourni de jeton (session non ouverte ?)');
    return MoodleClient.lireJeton(lancement.schemaMobile, moodle, passeport);
  }

  /**
   * `moodlemobile://token=<base64>` ; le base64 contient « signature:::jeton[:::jeton privé] »,
   * où signature = md5(adresse du site + passeport) : on la vérifie.
   */
  static lireJeton(schema: string, moodle: string, passeport: string): string {
    const brut = schema.replace(/^moodlemobile:\/\/token=/i, '');
    const [signature, jeton] = Buffer.from(decodeURIComponent(brut), 'base64').toString('utf8').split(':::');
    const attendue = createHash('md5').update(moodle + passeport).digest('hex');
    if (signature !== attendue || !/^[0-9a-f]{32}$/i.test(jeton ?? '')) throw new ErreurMoodle('Jeton e-campus illisible');
    return jeton;
  }

  /* ---------- API officielle ---------- */

  private async api<T>(jeton: string, fonction: string, params: Record<string, string | number> = {}): Promise<T> {
    const corps = new URLSearchParams({ wstoken: jeton, wsfunction: fonction, moodlewsrestformat: 'json' });
    for (const [k, v] of Object.entries(params)) corps.set(k, String(v));
    let res: Response;
    try {
      res = await fetch(`${this.adresses.moodle}/webservice/rest/server.php`, {
        method: 'POST', body: corps, signal: AbortSignal.timeout(this.delaiMs),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'CampusPlus/0.1' },
      });
    } catch (e) {
      throw new ErreurMoodle(`e-campus injoignable (${(e as Error).name})`);
    }
    if (!res.ok) throw new ErreurMoodle(`HTTP ${res.status} sur l’API e-campus`);
    const json = (await res.json()) as T & { exception?: string; errorcode?: string; message?: string };
    if (json && typeof json === 'object' && 'exception' in json && json.exception) {
      if (['invalidtoken', 'accessexception'].includes(json.errorcode ?? '')) throw new ErreurJeton('Jeton e-campus refusé');
      throw new ErreurMoodle(`e-campus : ${json.message ?? json.errorcode}`);
    }
    return json;
  }

  async cours(jeton: string): Promise<Cours[]> {
    const site = await this.api<{ userid: number }>(jeton, 'core_webservice_get_site_info');
    const liste = await this.api<CoursMoodle[]>(jeton, 'core_enrol_get_users_courses', { userid: site.userid });
    const visibles = liste.filter((c) => !c.hidden && c.visible !== 0);
    const resultat: Cours[] = [];
    // Un cours à la fois : on reste discret avec le serveur de l'école.
    for (const c of visibles) {
      const sections = await this.api<SectionMoodle[]>(jeton, 'core_course_get_contents', { courseid: c.id });
      resultat.push(rangerCours(c, sections, this.adresses.moodle));
    }
    return resultat;
  }

  /** Télécharge un fichier (adresse webservice/pluginfile.php) ; refuse au-delà de `max` octets. */
  async telecharger(jeton: string, adresse: string, max: number): Promise<Buffer> {
    const url = new URL(adresse);
    if (url.origin !== new URL(this.adresses.moodle).origin) throw new ErreurMoodle('Fichier hors d’e-campus');
    url.searchParams.set('token', jeton);
    let res: Response;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(this.delaiMs * 4), headers: { 'User-Agent': 'CampusPlus/0.1' } });
    } catch (e) {
      throw new ErreurMoodle(`Téléchargement impossible (${(e as Error).name})`);
    }
    if (!res.ok) throw new ErreurMoodle(`HTTP ${res.status} au téléchargement`);
    if ((res.headers.get('content-type') ?? '').includes('application/json')) {
      const json = (await res.json()) as { errorcode?: string };
      if (json.errorcode === 'invalidtoken') throw new ErreurJeton('Jeton e-campus refusé');
      throw new ErreurMoodle(`Fichier refusé par e-campus (${json.errorcode ?? 'erreur'})`);
    }
    if (Number(res.headers.get('content-length') ?? 0) > max) throw new ErreurMoodle('Fichier trop gros');
    const morceaux: Buffer[] = [];
    let total = 0;
    for await (const m of res.body as unknown as AsyncIterable<Uint8Array>) {
      total += m.length;
      if (total > max) throw new ErreurMoodle('Fichier trop gros');
      morceaux.push(Buffer.from(m));
    }
    return Buffer.concat(morceaux);
  }
}
