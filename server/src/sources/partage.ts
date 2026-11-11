/**
 * Lecture des mails PARTAGE (Zimbra de CPE, https://partage.cpe.fr) par l'API SOAP de Zimbra, en JSON.
 * Mêmes identifiants que MyCPE (adresse mail complète + mot de passe).
 * Lecture seule : rien n'est envoyé, déplacé ni marqué comme lu.
 */
import * as cheerio from 'cheerio';

export class ErreurPartage extends Error {}
export class ErreurIdentifiantsPartage extends ErreurPartage {}
/** Session expirée : se reconnecter. */
export class ErreurJetonPartage extends ErreurPartage {}

export interface MailBrut {
  id: string;
  /** Date de réception (ms). */
  date: number;
  sujet: string;
  /** Début du texte, fourni par PARTAGE dans la liste. */
  extrait: string;
  deNom: string;
  deAdresse: string;
  nonLu: boolean;
}

interface FauteZimbra { Fault?: { Reason?: { Text?: string }; Detail?: { Error?: { Code?: string } } } }

const TAILLE_TEXTE = 20_000;

/** Texte lisible d'un message HTML ou texte (balises, styles et scripts retirés, blancs resserrés). */
export function texteDe(contenu: string, html: boolean): string {
  let brut = contenu;
  if (html) {
    const $ = cheerio.load(contenu.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h\d)>/gi, '\n'));
    $('style, script, head').remove();
    brut = $.root().text();
  }
  return brut.replace(/\r/g, '').replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export class PartageClient {
  private jeton: string | null = null;

  constructor(private base = 'https://partage.cpe.fr', private delaiMs = 20_000) {}

  private async soap<T>(nom: string, requete: object): Promise<T> {
    const corps = {
      Header: { context: { _jsns: 'urn:zimbra', ...(this.jeton ? { authToken: { _content: this.jeton } } : {}), userAgent: { name: 'CampusPlus' } } },
      Body: { [nom]: requete },
    };
    let res: Response;
    try {
      res = await fetch(`${this.base}/service/soap/${nom}`, {
        method: 'POST', body: JSON.stringify(corps), signal: AbortSignal.timeout(this.delaiMs),
        headers: { 'Content-Type': 'application/json', 'User-Agent': 'CampusPlus/0.1' },
      });
    } catch (e) {
      throw new ErreurPartage(`PARTAGE injoignable (${(e as Error).name})`);
    }
    const json = (await res.json().catch(() => null)) as { Body?: Record<string, unknown> & FauteZimbra } | null;
    const faute = json?.Body?.Fault;
    if (faute) {
      const code = faute.Detail?.Error?.Code ?? '';
      if (code === 'account.AUTH_FAILED') throw new ErreurIdentifiantsPartage('PARTAGE refuse ton mot de passe');
      if (code === 'service.AUTH_EXPIRED' || code === 'service.AUTH_REQUIRED') throw new ErreurJetonPartage('Session PARTAGE expirée');
      throw new ErreurPartage(`PARTAGE : ${faute.Reason?.Text ?? code}`);
    }
    const reponse = json?.Body?.[nom.replace(/Request$/, 'Response')];
    if (!res.ok || !reponse) throw new ErreurPartage(`Réponse PARTAGE inattendue (HTTP ${res.status})`);
    return reponse as T;
  }

  async connexion(adresse: string, motDePasse: string): Promise<void> {
    this.jeton = null;
    const r = await this.soap<{ authToken?: { _content: string }[] }>('AuthRequest', {
      _jsns: 'urn:zimbraAccount', account: { by: 'name', _content: adresse }, password: { _content: motDePasse },
    });
    const jeton = r.authToken?.[0]?._content;
    if (!jeton) throw new ErreurPartage('PARTAGE n’a pas ouvert de session');
    this.jeton = jeton;
  }

  /** Les derniers mails de la boîte de réception, du plus récent au plus ancien (en-têtes et début du texte). */
  async boite(max = 100): Promise<MailBrut[]> {
    // Pas de filtre de date dans la requête : son format dépend de la langue du compte. L'appelant filtre.
    const r = await this.soap<{ m?: { id: string; d: number; su?: string; fr?: string; f?: string; e?: { a: string; p?: string; d?: string; t: string }[] }[] }>('SearchRequest', {
      _jsns: 'urn:zimbraMail', types: 'message', query: 'in:inbox', sortBy: 'dateDesc', limit: max, fetch: 'none',
    });
    return (r.m ?? []).map((m) => {
      const de = m.e?.find((e) => e.t === 'f');
      return {
        id: String(m.id), date: m.d, sujet: m.su || '(sans objet)', extrait: m.fr ?? '',
        deNom: de?.p ?? de?.d ?? de?.a ?? '', deAdresse: (de?.a ?? '').toLowerCase(),
        nonLu: (m.f ?? '').includes('u'),
      };
    });
  }

  /** Texte complet d'un mail, sans le marquer comme lu. */
  async texte(id: string): Promise<string> {
    type Partie = { ct?: string; content?: string; body?: boolean; mp?: Partie[] };
    const r = await this.soap<{ m?: { mp?: Partie[] }[] }>('GetMsgRequest', {
      _jsns: 'urn:zimbraMail', m: { id, html: 1, max: TAILLE_TEXTE, read: 0, neuter: 1 },
    });
    const parties: Partie[] = [];
    const parcourir = (p: Partie[] = []) => { for (const x of p) { parties.push(x); parcourir(x.mp); } };
    parcourir(r.m?.[0]?.mp);
    const corps = parties.find((p) => p.body && p.content)
      ?? parties.find((p) => p.ct === 'text/plain' && p.content)
      ?? parties.find((p) => p.ct === 'text/html' && p.content);
    return corps?.content ? texteDe(corps.content, corps.ct === 'text/html').slice(0, TAILLE_TEXTE) : '';
  }
}
