/**
 * Client non officiel pour WebAurion (mycpe.cpe.fr), l'appli de scolarité de CPE.
 *
 * WebAurion est une appli JSF/PrimeFaces : pas d'API REST, chaque page est un formulaire
 * avec un jeton `javax.faces.ViewState` propre à la page. Ce client reproduit ce que fait
 * le navigateur : il garde les cookies, la page courante et son formulaire.
 * Détails des requêtes : docs/sources-cpe.md
 *
 * Chaque élève utilise SES identifiants ; rien n'est stocké ici (voir comptes.ts).
 */
import * as cheerio from 'cheerio';
import { extraireEvenements, lireEvenement, type Evenement } from './planning.js';

/** Entrées du menu latéral : libellé affiché, et numéro relevé le 10/11/2026 (secours). */
const MENU = {
  planning: { libelle: 'Planning', secours: '18' },
  notes: { libelle: 'Notes', secours: '19' },
  absences: { libelle: 'Absences', secours: '20' },
} as const;

export class ErreurAurion extends Error {}
/** Identifiant ou mot de passe refusé : ne pas réessayer en boucle (risque de blocage du compte). */
export class ErreurIdentifiants extends ErreurAurion {}

export interface Note {
  semestre: string;
  module: string;
  cours: string;
  epreuve: string;
  coefficient: number | null;
  note: number | null;
  motifAbsence: string;
}

export interface Absence {
  date: string;
  motif: string;
  duree: string;
  horaire: string;
  cours: string;
  intervenant: string;
  matiere: string;
}

const nombre = (s = '') => {
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

const sansAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Lit un tableau PrimeFaces en s'appuyant sur les titres de colonnes (et non leur position) :
 * `colonnes` associe un nom de champ à un mot attendu dans l'en-tête.
 * Renvoie null si aucun tableau de la page n'a ces en-têtes.
 */
export function lireTableau<C extends string>(html: string, colonnes: Record<C, string>): Record<C, string>[] | null {
  const $ = cheerio.load(html);
  const champs = Object.keys(colonnes) as C[];
  // Un tableau PrimeFaces « défilant » sépare l'en-tête et le corps en deux <table> : on raisonne par bloc.
  const blocs = $('.ui-datatable').toArray();
  for (const bloc of blocs.length ? blocs : $('table').toArray()) {
    // Le titre est dans <span class="ui-column-title"> ; le <th> contient aussi le libellé du filtre.
    const entetes = $(bloc).find('thead').first().find('th').toArray()
      .map((th) => $(th).find('.ui-column-title').first().text() || $(th).text())
      .map((t) => sansAccents(t.replace(/\s+/g, ' ').trim()));
    if (!entetes.length) continue;
    const index = {} as Record<C, number>;
    for (const champ of champs) index[champ] = entetes.findIndex((e) => e.startsWith(sansAccents(colonnes[champ])));
    if (champs.some((c) => index[c] < 0)) continue;
    return $(bloc)
      .find('tbody tr')
      .toArray()
      .map((tr) => $(tr).children('td').toArray().map((td) => $(td).text().replace(/\s+/g, ' ').trim()))
      .filter((cellules) => cellules.length >= entetes.length) // écarte la ligne « Aucune … »
      .map((cellules) => {
        const ligne = {} as Record<C, string>;
        for (const champ of champs) ligne[champ] = cellules[index[champ]] ?? '';
        return ligne;
      });
  }
  return null;
}

export function lireNotes(html: string): Note[] | null {
  const lignes = lireTableau(html, {
    semestre: 'Semestre', module: 'Module', cours: 'Cours', epreuve: 'Epreuve',
    coefficient: 'Coefficient', note: 'Note', motifAbsence: 'Motif',
  });
  return lignes?.map((l) => ({ ...l, coefficient: nombre(l.coefficient), note: nombre(l.note) })) ?? null;
}

export function lireAbsences(html: string): Absence[] | null {
  return lireTableau(html, {
    date: 'Date', motif: 'Motif', duree: 'Duree', horaire: 'Horaire',
    cours: 'Cours', intervenant: 'Intervenant', matiere: 'Matiere',
  });
}

interface Page {
  url: string;
  html: string;
}

export class AurionClient {
  private cookies = new Map<string, string>();
  private page: Page | null = null;
  private viewStateAjax: string | null = null;
  /** « Prénom NOM », lu dans le titre de la page planning. */
  nomEleve = '';

  constructor(private base = 'https://mycpe.cpe.fr', private delaiMs = 20_000) {}

  /* ---------- HTTP avec cookies et redirections ---------- */

  private garderCookies(res: Response) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [paire] = c.split(';');
      const i = paire.indexOf('=');
      if (i > 0) this.cookies.set(paire.slice(0, i).trim(), paire.slice(i + 1).trim());
    }
  }

  private async requete(chemin: string, init: { method?: string; headers?: Record<string, string>; body?: URLSearchParams } = {}, sauts = 6): Promise<Page> {
    let res: Response;
    try {
      res = await fetch(new URL(chemin, this.base), {
        ...init,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.delaiMs),
        headers: {
          ...init.headers,
          Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
          'User-Agent': 'CampusPlus/0.1 (+https://github.com/thomas-pns/campus-plus)',
        },
      });
    } catch (e) {
      throw new ErreurAurion(`WebAurion injoignable (${(e as Error).name})`);
    }
    this.garderCookies(res);
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      if (sauts <= 0) throw new ErreurAurion('Trop de redirections');
      const cible = new URL(loc, new URL(chemin, this.base));
      if (cible.origin !== new URL(this.base).origin) throw new ErreurAurion('Redirection hors de WebAurion');
      return this.requete(cible.pathname + cible.search, {}, sauts - 1);
    }
    const html = await res.text();
    if (!res.ok) throw new ErreurAurion(`HTTP ${res.status} sur ${new URL(chemin, this.base).pathname}`);
    return { url: chemin, html };
  }

  private static estPageConnexion(p: Page) {
    return /Login\.xhtml/.test(p.url) || /id="formulaireSpring"/.test(p.html);
  }

  /* ---------- Connexion ---------- */

  async connexion(identifiant: string, motDePasse: string) {
    this.cookies.clear();
    this.page = null;
    this.viewStateAjax = null;
    await this.requete('/faces/Login.xhtml'); // pose le cookie de session
    const page = await this.requete('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: identifiant, password: motDePasse }),
    });
    if (AurionClient.estPageConnexion(page)) throw new ErreurIdentifiants('Identifiants refusés par WebAurion');
    if (!/name="javax\.faces\.ViewState"/.test(page.html)) throw new ErreurAurion('Page d’accueil inattendue après connexion');
    this.page = page;
    this.viewStateAjax = null;
  }

  /* ---------- Navigation par le menu latéral ---------- */

  /** Tous les champs du formulaire principal de la page courante, comme les enverrait le navigateur. */
  private formulaire(): { action: string; champs: URLSearchParams } {
    if (!this.page) throw new ErreurAurion('Pas connecté');
    const $ = cheerio.load(this.page.html);
    const form = $('form#form').first();
    const champs = new URLSearchParams();
    form.find('input[name]').each((_, e) => {
      const type = ($(e).attr('type') ?? 'text').toLowerCase();
      if (['submit', 'button', 'image', 'file', 'checkbox', 'radio'].includes(type)) return;
      champs.set($(e).attr('name')!, $(e).attr('value') ?? '');
    });
    if (!champs.has('form')) champs.set('form', 'form');
    // Une réponse AJAX peut avoir renouvelé le jeton de la page : il prime sur celui du HTML.
    const vs = this.viewStateAjax ?? champs.get('javax.faces.ViewState') ?? $('input[name="javax.faces.ViewState"]').first().attr('value');
    if (!vs) throw new ErreurAurion('Session WebAurion expirée');
    champs.set('javax.faces.ViewState', vs);
    return { action: form.attr('action') ?? this.page.url, champs };
  }

  /** Numéro de l'entrée de menu portant ce libellé dans la page courante (les numéros peuvent varier selon le profil). */
  private numeroMenu(entree: { libelle: string; secours: string }): string {
    const $ = cheerio.load(this.page!.html);
    for (const el of $('[onclick*="sidebar_menuid"]').toArray()) {
      if ($(el).text().replace(/\s+/g, ' ').trim() !== entree.libelle) continue;
      const m = ($(el).attr('onclick') ?? '').match(/sidebar_menuid'\s*:\s*'([^']+)'/);
      if (m) return m[1];
    }
    return entree.secours;
  }

  private async ouvrirMenu(entree: { libelle: string; secours: string }): Promise<Page> {
    const { action, champs } = this.formulaire();
    champs.set('form:sidebar', 'form:sidebar');
    champs.set('form:sidebar_menuid', this.numeroMenu(entree));
    const page = await this.requete(action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: champs,
    });
    if (AurionClient.estPageConnexion(page)) throw new ErreurAurion('Session WebAurion expirée');
    this.page = page;
    this.viewStateAjax = null;
    return page;
  }

  /* ---------- Planning ---------- */

  async planning(debut: Date, fin: Date): Promise<Evenement[]> {
    const page = await this.ouvrirMenu(MENU.planning);
    const $ = cheerio.load(page.html);
    // Dans la page : <div id="form:j_idt118" class="schedule"> ; l'id change selon les versions, on le lit.
    const idSchedule = $('div.schedule[id]').first().attr('id')
      ?? page.html.match(/["']Schedule["']\s*,\s*["']schedule["']\s*,\s*\{\s*id:\s*["']([^"']+)/)?.[1];
    if (!idSchedule) throw new ErreurAurion('Composant planning introuvable (session expirée ou page modifiée)');
    const nom = $('title').text().replace(/\s+/g, ' ').trim().match(/^Planning\s+(.+)$/)?.[1];
    if (nom) this.nomEleve = nom;

    const { action, champs } = this.formulaire();
    const corps = new URLSearchParams({
      'javax.faces.partial.ajax': 'true',
      'javax.faces.source': idSchedule,
      'javax.faces.partial.execute': idSchedule,
      'javax.faces.partial.render': idSchedule,
      [idSchedule]: idSchedule,
      [`${idSchedule}_start`]: String(debut.getTime()),
      [`${idSchedule}_end`]: String(fin.getTime()),
      form: 'form',
      'javax.faces.ViewState': champs.get('javax.faces.ViewState')!,
    });
    const reponse = await this.requete(action, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Faces-Request': 'partial/ajax',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: corps,
    });
    if (!reponse.html.includes('"events"')) throw new ErreurAurion('Réponse planning inattendue');
    const nouveau = reponse.html.match(/<update id="[^"]*javax\.faces\.ViewState[^"]*"><!\[CDATA\[([\s\S]*?)\]\]><\/update>/)?.[1];
    if (nouveau) this.viewStateAjax = nouveau;
    return extraireEvenements(reponse.html).map(lireEvenement);
  }

  /* ---------- Notes et absences ---------- */

  async notes(): Promise<Note[]> {
    const page = await this.ouvrirMenu(MENU.notes);
    const notes = lireNotes(page.html);
    if (!notes) throw new ErreurAurion('Tableau des notes introuvable');
    return notes;
  }

  async absences(): Promise<Absence[]> {
    const page = await this.ouvrirMenu(MENU.absences);
    const absences = lireAbsences(page.html);
    if (!absences) throw new ErreurAurion('Tableau des absences introuvable');
    return absences;
  }
}
