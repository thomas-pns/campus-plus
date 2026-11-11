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
  infos: { libelle: 'Informations personnelles', secours: '1' },
  certificats: { libelle: 'Certificats de scolarité', secours: '13' },
  absence: { libelle: "Justificatif d'absence", secours: '11' },
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

  /**
   * Photo d'identité de l'élève (page « Informations personnelles »). L'adresse de l'image ne sert
   * qu'une fois : elle est lue juste après la page. Renvoie null s'il n'y en a pas.
   */
  async photo(): Promise<{ octets: Buffer; type: string } | null> {
    const page = await this.ouvrirMenu(MENU.infos);
    const $ = cheerio.load(page.html);
    const img = $('img[id$=":photo"], [id$=":photo"] img').first().attr('src')
      ?? $('img[src*="dynamiccontent.properties"]').first().attr('src');
    if (!img) return null;
    const fichier = await this.binaire(img).catch(() => null);
    if (!fichier || !/^image\/(jpeg|png|gif|webp)$/.test(fichier.type) || fichier.octets.length < 100 || fichier.octets.length > 2_000_000) return null;
    return fichier;
  }

  /** Fichier servi par WebAurion (image, PDF généré…), avec les cookies de la session. */
  private async binaire(chemin: string): Promise<{ octets: Buffer; type: string }> {
    let res: Response;
    try {
      res = await fetch(new URL(chemin, this.base), {
        signal: AbortSignal.timeout(this.delaiMs),
        headers: { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '), 'User-Agent': 'CampusPlus/0.1 (+https://github.com/thomas-pns/campus-plus)' },
      });
    } catch (e) {
      throw new ErreurAurion(`WebAurion injoignable (${(e as Error).name})`);
    }
    if (!res.ok) throw new ErreurAurion(`HTTP ${res.status} sur un fichier`);
    return { octets: Buffer.from(await res.arrayBuffer()), type: (res.headers.get('content-type') ?? '').split(';')[0].trim() };
  }

  /* ---------- Requêtes AJAX PrimeFaces (formulaires en plusieurs étapes) ---------- */

  /** Paramètres « s », « p » et « u » d'un appel PrimeFaces.ab(…) lu dans un onclick/onchange. */
  private static appelAjax(code: string | undefined): { source?: string; execute?: string; render?: string } {
    const lire = (cle: string) => code?.match(new RegExp(`[{,]${cle}:"([^"]*)"`))?.[1];
    return { source: lire('s'), execute: lire('p'), render: lire('u') };
  }

  /** Contenu HTML des mises à jour d'une réponse AJAX (pour y chercher les nouveaux champs). */
  private static misesAJour(xml: string): string {
    return [...xml.matchAll(/<update id="([^"]+)"><!\[CDATA\[([\s\S]*?)\]\]><\/update>/g)].filter((m) => !m[1].includes('ViewState')).map((m) => m[2]).join('\n');
  }

  private garderViewState(xml: string) {
    const nouveau = xml.match(/<update id="[^"]*javax\.faces\.ViewState[^"]*"><!\[CDATA\[([\s\S]*?)\]\]><\/update>/)?.[1];
    if (nouveau) this.viewStateAjax = nouveau;
  }

  private async ajax(source: string, champsEnPlus: Record<string, string>, options: { execute?: string; render?: string; evenement?: string } = {}): Promise<string> {
    const { action, champs } = this.formulaire();
    for (const [k, v] of Object.entries(champsEnPlus)) champs.set(k, v);
    champs.set('javax.faces.partial.ajax', 'true');
    champs.set('javax.faces.source', source);
    champs.set('javax.faces.partial.execute', options.execute ?? source);
    if (options.render) champs.set('javax.faces.partial.render', options.render);
    if (options.evenement) {
      champs.set('javax.faces.behavior.event', options.evenement);
      champs.set('javax.faces.partial.event', options.evenement);
    } else champs.set(source, source);
    const rep = await this.requete(action, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'Faces-Request': 'partial/ajax', 'X-Requested-With': 'XMLHttpRequest' },
      body: champs,
    });
    if (!rep.html.includes('<partial-response')) throw new ErreurAurion('Réponse AJAX inattendue (session expirée ?)');
    this.garderViewState(rep.html);
    return rep.html;
  }

  /* ---------- Certificat de scolarité (PDF généré par MyCPE) ---------- */

  async certificat(langue: 'FR' | 'EN' = 'FR'): Promise<Buffer> {
    const page = await this.ouvrirMenu(MENU.certificats);
    let $ = cheerio.load(page.html);
    const choixModele = $('select').toArray().find((e) => $(e).find('option').toArray().some((o) => /certificat scolarit/i.test($(o).text())));
    if (!choixModele) throw new ErreurAurion('Modèle de certificat introuvable');
    const idModele = $(choixModele).attr('id')!.replace(/_input$/, '');
    const modele = $(choixModele).find('option').toArray().find((o) => new RegExp(`certificat scolarit[ée] ${langue}\\b`, 'i').test($(o).text())) ?? $(choixModele).find('option').toArray().find((o) => $(o).attr('value'));
    const champs: Record<string, string> = { [`${idModele}_input`]: $(modele).attr('value') ?? '' };
    const a1 = AurionClient.appelAjax($(choixModele).attr('onchange'));
    let xml = await this.ajax(idModele, champs, { execute: a1.execute ?? idModele, render: a1.render, evenement: 'change' });

    // Deuxième liste (« Alimenter ce rapport avec ces données ») : remplie par la réponse.
    $ = cheerio.load(AurionClient.misesAJour(xml));
    const choixDonnees = $('select').toArray().find((e) => $(e).attr('id') !== `${idModele}_input` && $(e).find('option[value!=""]').length);
    if (!choixDonnees) throw new ErreurAurion('Données du certificat introuvables');
    const idDonnees = $(choixDonnees).attr('id')!.replace(/_input$/, '');
    champs[`${idDonnees}_input`] = $(choixDonnees).find('option[value!=""]').first().attr('value')!;
    const a2 = AurionClient.appelAjax($(choixDonnees).attr('onchange'));
    xml = await this.ajax(idDonnees, champs, { execute: a2.execute ?? idDonnees, render: a2.render, evenement: 'change' });

    // La ligne de l'élève, cochée, puis « Générer ».
    $ = cheerio.load(AurionClient.misesAJour(xml));
    const ligne = $('tr[data-rk]').first();
    const idTable = ligne.closest('tbody[id]').attr('id')?.replace(/_data$/, '');
    const bouton = $('button').toArray().find((b) => /g[ée]n[ée]rer/i.test($(b).text()));
    if (!ligne.length || !idTable || !bouton) throw new ErreurAurion('Ligne du certificat introuvable');
    champs[`${idTable}_selection`] = ligne.attr('data-rk')!;
    const a3 = AurionClient.appelAjax($(bouton).attr('onclick'));
    xml = await this.ajax($(bouton).attr('id')!, champs, { execute: a3.execute ?? '@all', render: a3.render });

    const lien = cheerio.load(AurionClient.misesAJour(xml))('object[data*="dynamiccontent"], iframe[src*="dynamiccontent"], a[href*="dynamiccontent"]').first();
    const adresse = lien.attr('data') ?? lien.attr('src') ?? lien.attr('href');
    if (!adresse) throw new ErreurAurion('MyCPE n’a pas généré le certificat');
    const pdf = await this.binaire(adresse);
    if (!pdf.octets.subarray(0, 5).toString().startsWith('%PDF')) throw new ErreurAurion('Le certificat reçu n’est pas un PDF');
    return pdf.octets;
  }

  /* ---------- Justificatif d'absence (envoyé seulement quand l'élève le demande) ---------- */

  /** Motifs proposés par le formulaire de MyCPE. */
  async motifsAbsence(): Promise<string[]> {
    const page = await this.ouvrirMenu(MENU.absence);
    const $ = cheerio.load(page.html);
    const id = $('label').toArray().find((l) => /motif/i.test($(l).text()))?.attribs.for;
    return $(`select[id="${id}_input"] option`).toArray().map((o) => $(o).text().trim()).filter(Boolean);
  }

  async justifierAbsence(j: { debut: string; fin: string; motif: string; fichier: { nom: string; type: string; octets: Buffer } }): Promise<string> {
    const page = await this.ouvrirMenu(MENU.absence);
    const $ = cheerio.load(page.html);
    const pour = (re: RegExp) => $('label').toArray().find((l) => re.test($(l).text()))?.attribs.for;
    const idDebut = pour(/d[ée]but/i), idFin = pour(/fin de l/i), idMotif = pour(/motif/i);
    const upload = $('input[type="file"]').first();
    const valider = $('button').toArray().find((b) => /valider/i.test($(b).text()));
    if (!idDebut || !idFin || !idMotif || !upload.length || !valider) throw new ErreurAurion('Formulaire de justificatif introuvable (page modifiée ?)');
    const option = $(`select[id="${idMotif}_input"] option`).toArray().find((o) => $(o).text().trim() === j.motif);
    if (!option) throw new ErreurAurion('Motif inconnu');
    const champs: Record<string, string> = {
      [`${idDebut}_input`]: j.debut, [`${idFin}_input`]: j.fin, [`${idMotif}_input`]: $(option).attr('value')!,
    };

    // 1. Le fichier, envoyé comme le fait le bouton « Ajouter… » de la page.
    const idUpload = upload.attr('id')!.replace(/_input$/, '');
    const { action, champs: base } = this.formulaire();
    const multipart = new FormData();
    for (const [k, v] of base) multipart.append(k, v);
    for (const [k, v] of Object.entries(champs)) multipart.set(k, v);
    multipart.append('javax.faces.partial.ajax', 'true');
    multipart.append('javax.faces.partial.execute', idUpload);
    multipart.append('javax.faces.source', idUpload);
    multipart.append('javax.faces.partial.render', 'form:docUpload');
    multipart.append(upload.attr('name')!, new Blob([new Uint8Array(j.fichier.octets)], { type: j.fichier.type }), j.fichier.nom);
    let res: Response;
    try {
      res = await fetch(new URL(action, this.base), {
        method: 'POST', body: multipart, redirect: 'manual', signal: AbortSignal.timeout(this.delaiMs * 2),
        headers: { Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '), 'Faces-Request': 'partial/ajax', 'X-Requested-With': 'XMLHttpRequest', 'User-Agent': 'CampusPlus/0.1 (+https://github.com/thomas-pns/campus-plus)' },
      });
    } catch (e) {
      throw new ErreurAurion(`WebAurion injoignable (${(e as Error).name})`);
    }
    this.garderCookies(res);
    const reponseUpload = await res.text();
    if (!res.ok || !reponseUpload.includes('<partial-response')) throw new ErreurAurion('MyCPE a refusé le fichier');
    this.garderViewState(reponseUpload);
    if (/ui-messages-error|Type de fichier invalide|trop grande/i.test(reponseUpload)) throw new ErreurAurion('MyCPE a refusé le fichier (type ou taille)');

    // 2. « Valider ma saisie ».
    const a = AurionClient.appelAjax($(valider).attr('onclick'));
    const xml = await this.ajax($(valider).attr('id')!, champs, { execute: a.execute ?? '@all', render: a.render ?? 'form:Center' });
    const $r = cheerio.load(AurionClient.misesAJour(xml));
    const erreurs = $r('.ui-messages-error-summary, .ui-messages-error-detail, .ui-message-error-detail').toArray().map((e) => $r(e).text().trim()).filter(Boolean);
    if (erreurs.length) throw new ErreurAurion(`MyCPE a refusé : ${[...new Set(erreurs)].join(' ')}`);
    const infos = $r('.ui-messages-info-summary, .ui-messages-info-detail').toArray().map((e) => $r(e).text().trim()).filter(Boolean);
    return [...new Set(infos)].join(' ') || 'Justificatif envoyé à MyCPE.';
  }

  async absences(): Promise<Absence[]> {
    const page = await this.ouvrirMenu(MENU.absences);
    const absences = lireAbsences(page.html);
    if (!absences) throw new ErreurAurion('Tableau des absences introuvable');
    return absences;
  }
}
