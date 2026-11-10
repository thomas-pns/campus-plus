/**
 * Client non officiel pour WebAurion (mycpe.cpe.fr), l'appli de scolarité de CPE.
 *
 * WebAurion est une appli JSF/PrimeFaces : pas d'API REST, chaque page est un formulaire
 * avec un jeton `javax.faces.ViewState`. Ce client reproduit ce que fait le navigateur.
 * Détails des requêtes : docs/sources-cpe.md
 *
 * Chaque élève utilise SES identifiants ; rien n'est stocké ici (le stockage chiffré est géré ailleurs).
 */
import * as cheerio from 'cheerio';
import { extraireEvenements, lireEvenement, type Evenement } from './planning.js';

const BASE = 'https://mycpe.cpe.fr';
const MENU = { planning: '18', notes: '19', absences: '20' } as const;

export class ErreurAurion extends Error {}

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

const nombre = (s: string) => {
  const n = parseFloat(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};

export class AurionClient {
  private cookies = new Map<string, string>();
  private viewState = '';
  private page = '';

  /* ---------- HTTP avec cookies ---------- */

  private enteteCookies() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private garderCookies(res: Response) {
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [paire] = c.split(';');
      const i = paire.indexOf('=');
      if (i > 0) this.cookies.set(paire.slice(0, i).trim(), paire.slice(i + 1).trim());
    }
  }

  private async requete(chemin: string, init: RequestInit = {}, sauts = 5): Promise<{ url: string; texte: string }> {
    const res = await fetch(BASE + chemin, {
      ...init,
      redirect: 'manual',
      headers: { ...(init.headers as Record<string, string>), Cookie: this.enteteCookies(), 'User-Agent': 'CampusPlus/0.1' },
    });
    this.garderCookies(res);
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc && sauts > 0) {
      const suivant = loc.startsWith('http') ? new URL(loc).pathname + new URL(loc).search : loc;
      return this.requete(suivant, {}, sauts - 1);
    }
    const texte = await res.text();
    if (!res.ok) throw new ErreurAurion(`HTTP ${res.status} sur ${chemin}`);
    return { url: chemin, texte };
  }

  private memoriserPage(url: string, html: string) {
    this.page = url;
    const vs = cheerio.load(html)('input[name="javax.faces.ViewState"]').attr('value');
    if (vs) this.viewState = vs;
  }

  /* ---------- Connexion ---------- */

  async connexion(identifiant: string, motDePasse: string) {
    await this.requete('/faces/Login.xhtml'); // pose le cookie de session
    const corps = new URLSearchParams({ username: identifiant, password: motDePasse });
    const { url, texte } = await this.requete('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: corps,
    });
    if (/Login\.xhtml/.test(url) || /formulaireSpring/.test(texte)) {
      throw new ErreurAurion('Identifiants refusés par WebAurion');
    }
    this.memoriserPage(url, texte);
  }

  /** Ouvre une entrée du menu latéral (Planning, Notes, Absences). */
  private async ouvrirMenu(id: string) {
    if (!this.viewState) throw new ErreurAurion('Pas connecté');
    const corps = new URLSearchParams({
      form: 'form',
      'form:sidebar': 'form:sidebar',
      'form:sidebar_menuid': id,
      'javax.faces.ViewState': this.viewState,
    });
    const { url, texte } = await this.requete('/faces/MainMenuPage.xhtml', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: corps,
    });
    this.memoriserPage(url, texte);
    return texte;
  }

  /* ---------- Planning ---------- */

  async planning(debut: Date, fin: Date): Promise<Evenement[]> {
    const html = await this.ouvrirMenu(MENU.planning);
    const $ = cheerio.load(html);
    // L'id du composant « schedule » change d'une version à l'autre : on le lit dans la page.
    // Dans la page : <div id="form:j_idt118" class="schedule"> (relevé le 10/11/2026).
    const idSchedule = $('div.schedule[id]').first().attr('id')
      ?? html.match(/["']Schedule["']\s*,\s*["']schedule["']\s*,\s*\{\s*id:\s*["']([^"']+)/)?.[1];
    if (!idSchedule) throw new ErreurAurion('Composant planning introuvable');

    const corps = new URLSearchParams({
      'javax.faces.partial.ajax': 'true',
      'javax.faces.source': idSchedule,
      'javax.faces.partial.execute': idSchedule,
      'javax.faces.partial.render': idSchedule,
      [idSchedule]: idSchedule,
      [`${idSchedule}_start`]: String(debut.getTime()),
      [`${idSchedule}_end`]: String(fin.getTime()),
      form: 'form',
      'javax.faces.ViewState': this.viewState,
    });
    const { texte } = await this.requete('/faces/Planning.xhtml', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'Faces-Request': 'partial/ajax',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: corps,
    });
    return extraireEvenements(texte).map(lireEvenement);
  }

  /* ---------- Notes et absences ---------- */

  private static lignes(html: string): string[][] {
    const $ = cheerio.load(html);
    return $('table tbody tr')
      .toArray()
      .map((tr) => $(tr).find('td').toArray().map((td) => $(td).text().replace(/\s+/g, ' ').trim()))
      .filter((cells) => cells.length > 1);
  }

  async notes(): Promise<Note[]> {
    const html = await this.ouvrirMenu(MENU.notes);
    return AurionClient.lignes(html).map(([semestre, module, cours, epreuve, coef, note, motif]) => ({
      semestre, module, cours, epreuve,
      coefficient: nombre(coef ?? ''),
      note: nombre(note ?? ''),
      motifAbsence: motif ?? '',
    }));
  }

  async absences(): Promise<Absence[]> {
    const html = await this.ouvrirMenu(MENU.absences);
    return AurionClient.lignes(html)
      .filter((c) => !/aucune absence/i.test(c.join(' ')))
      .map(([date, motif, duree, horaire, cours, intervenant, matiere]) => ({
        date, motif, duree, horaire, cours, intervenant, matiere,
      }));
  }
}
