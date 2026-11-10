/**
 * Faux WebAurion pour les tests : reproduit le parcours observé sur le vrai site
 * (cookie de session, /login, menu latéral, jeton ViewState propre à chaque page,
 * réponse AJAX du planning, tableaux PrimeFaces), avec des données inventées.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';

export interface EvenementFaux { id?: string; title: string; start: string; end: string; className: string }
export interface DonneesFausses {
  identifiant: string;
  motDePasse: string;
  nom: string;
  evenements: EvenementFaux[];
  /** Lignes du tableau des notes : semestre, module, cours, épreuve, coefficient, note, motif. */
  notes: string[][];
  /** Lignes du tableau des absences (7 colonnes + 1 vide). */
  absences: string[][];
}

interface Session { connecte: boolean; vues: Map<string, string>; page: string }

const PAGES = ['/faces/Planning.xhtml', '/faces/ChoixDonnee.xhtml', '/faces/MesAbsences.xhtml'];
const ID_SCHEDULE = 'form:j_idt118';

export class FauxAurion {
  private serveur: Server;
  private sessions = new Map<string, Session>();
  /** Compteurs utiles aux tests. */
  connexionsReussies = 0;
  tentatives = 0;
  enPanne = false;
  /** Numéro de la première entrée du menu : sur le vrai site, « Planning » porte le 18. */
  premierNumero = 17;

  constructor(public donnees: DonneesFausses) {
    this.serveur = createServer((req, res) => void this.traiter(req, res).catch(() => { res.statusCode = 500; res.end(); }));
  }

  async demarrer(): Promise<string> {
    await new Promise<void>((ok) => this.serveur.listen(0, '127.0.0.1', ok));
    return `http://127.0.0.1:${(this.serveur.address() as AddressInfo).port}`;
  }

  arreter(): Promise<void> {
    return new Promise((ok) => this.serveur.close(() => ok()));
  }

  /* ---------- Rendu des pages ---------- */

  private menu() {
    const entrees = ['____Données à consulter____', 'Planning', 'Notes', 'Absences', 'Historique Placements'];
    return entrees.map((libelle, i) => `<li><a href="#" onclick="PF('modalePatientez').show();PrimeFaces.addSubmitParam('form',{'form:sidebar':'form:sidebar','form:sidebar_menuid':'${this.premierNumero + i}'}).submit('form');return false;"><span class="ui-menuitem-text">${libelle}</span></a></li>`).join('');
  }

  private page(s: Session, chemin: string, titre: string, champs: string, contenu: string): string {
    const vs = randomBytes(8).toString('hex');
    s.vues.set(vs, chemin);
    s.page = chemin;
    return `<!DOCTYPE html><html lang="fr"><head><title>
            ${titre}</title></head><body>
<form id="form" name="form" method="post" action="${chemin}" enctype="application/x-www-form-urlencoded">
<input type="hidden" name="form" value="form" /><input type="hidden" name="form:largeurDivCenter" value="" />
<input type="hidden" name="form:idInit" value="webscolaapp.Test" />${champs}
<div id="form:sidebar" class="ui-menu"><ul>${this.menu()}</ul></div>
<div id="form:Center" class="center">${contenu}</div>
<input type="hidden" name="javax.faces.ViewState" id="j_id1:javax.faces.ViewState:0" value="${vs}" autocomplete="off" />
</form></body></html>`;
  }

  private tableau(id: string, entetes: string[], lignes: string[][], vide: string): string {
    const th = entetes.map((e) => `<th class="ui-state-default"><span class="ui-column-title">${e}</span>${e ? `<label class="ui-helper-hidden">Filter by ${e}</label>` : ''}</th>`).join('');
    const corps = lignes.length
      ? lignes.map((l) => `<tr class="ui-widget-content">${l.map((c) => `<td role="gridcell">${c ? `<span class="preformatted ">${c}</span>` : ''}</td>`).join('')}</tr>`).join('')
      : `<tr class="ui-widget-content ui-datatable-empty-message"><td colspan="${entetes.length}">${vide}</td></tr>`;
    return `<div id="${id}" class="ui-datatable ui-widget ui-datatable-reflow"><div class="ui-datatable-tablewrapper"><table role="grid"><thead><tr>${th}</tr></thead><tbody class="ui-datatable-data ui-widget-content">${corps}</tbody></table></div></div>`;
  }

  private rendre(s: Session, chemin: string): string {
    switch (chemin) {
      case '/faces/Planning.xhtml':
        return this.page(s, chemin, `Planning ${this.donnees.nom}`,
          `<input type="text" name="form:date_input" value="09/11/2026" /><input type="hidden" name="${ID_SCHEDULE}_view" value="agendaWeek" />`,
          `<div id="${ID_SCHEDULE}" class="schedule"></div><script id="${ID_SCHEDULE}_s">$(function(){PrimeFaces.cw("Schedule","schedule",{id:"${ID_SCHEDULE}",defaultView:"agendaWeek"});});</script>`);
      case '/faces/ChoixDonnee.xhtml':
        return this.page(s, chemin, 'Notes', '<input type="text" name="form:search-texte" value="" />',
          this.tableau('form:j_idt181', ['Semestre ', 'Module / Domaine', 'Cours', 'Epreuve', 'Coefficient', 'Note', "Motif d'absence"], this.donnees.notes, 'Aucune note.'));
      case '/faces/MesAbsences.xhtml':
        return this.page(s, chemin, 'Absences', '',
          this.tableau('form:table', ['Date', "Motif d'absence", 'Durée', 'Horaire', 'Cours', 'Intervenant', 'Matière', ''], this.donnees.absences, 'Aucune absence.'));
      default:
        return this.page(s, '/faces/MainMenuPage.xhtml', "Page d'accueil", '', '<p>Accueil</p>');
    }
  }

  /** Page renvoyée sans session valide : même coquille que le vrai site, sans planning ni menu. */
  private coquille(): string {
    return '<!DOCTYPE html><html><head><title>\n            </title></head><body><form id="form" action="/faces/Planning.xhtml"><div id="form:Center" class="center"></div><input type="hidden" name="javax.faces.ViewState" value="coquille" /></form></body></html>';
  }

  private pageConnexion(): string {
    return '<!DOCTYPE html><html><head><title>Page de connexion</title></head><body><form id="formulaireSpring" action="/login" method="post"><input type="text" name="username" /><input type="password" name="password" /></form><form id="j_idt29" action="/faces/Login.xhtml"><input type="hidden" name="javax.faces.ViewState" value="login" /></form></body></html>';
  }

  /* ---------- Requêtes ---------- */

  private async traiter(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://x');
    const corps = new URLSearchParams(req.method === 'POST' ? await new Promise<string>((ok) => {
      let t = '';
      req.on('data', (d) => (t += d));
      req.on('end', () => ok(t));
    }) : '');
    const html = (texte: string, type = 'text/html;charset=UTF-8') => { res.writeHead(200, { 'Content-Type': type }); res.end(texte); };
    const rediriger = (vers: string) => { res.writeHead(302, { Location: vers }); res.end(); };
    if (this.enPanne) { res.writeHead(503); res.end('Maintenance'); return; }

    let cle = /JSESSIONID=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
    let s = cle ? this.sessions.get(cle) : undefined;
    if (!s) {
      cle = randomBytes(8).toString('hex');
      s = { connecte: false, vues: new Map(), page: '' };
      this.sessions.set(cle, s);
      res.setHeader('Set-Cookie', `JSESSIONID=${cle}; Path=/; HttpOnly`);
    }

    if (url.pathname === '/faces/Login.xhtml') return html(this.pageConnexion());
    if (url.pathname === '/login' && req.method === 'POST') {
      this.tentatives++;
      if (corps.get('username') === this.donnees.identifiant && corps.get('password') === this.donnees.motDePasse) {
        s.connecte = true;
        this.connexionsReussies++;
        return rediriger('/');
      }
      return rediriger('/faces/Login.xhtml?error');
    }
    if (!s.connecte) return url.pathname === '/faces/Planning.xhtml' ? html(this.coquille()) : rediriger('/faces/Login.xhtml');

    if (req.method === 'GET') {
      if (url.pathname === '/') return html(this.rendre(s, '/faces/MainMenuPage.xhtml'));
      // Comme sur le vrai site : une page ne s'affiche que si on y arrive par le menu.
      return html(s.page === url.pathname ? this.rendre(s, url.pathname) : this.coquille());
    }

    // POST : le jeton doit être celui de la page visée, sinon la vue est considérée comme expirée.
    if (s.vues.get(corps.get('javax.faces.ViewState') ?? '') !== url.pathname) return rediriger('/faces/Login.xhtml');

    if (corps.get('javax.faces.partial.ajax') === 'true') {
      const source = corps.get('javax.faces.source');
      const debut = Number(corps.get(`${source}_start`));
      const fin = Number(corps.get(`${source}_end`));
      if (url.pathname !== '/faces/Planning.xhtml' || source !== ID_SCHEDULE || !debut || !fin) { res.writeHead(400); res.end(); return; }
      const events = this.donnees.evenements
        .filter((e) => Date.parse(e.end) >= debut && Date.parse(e.start) <= fin)
        .map((e) => ({ id: randomBytes(6).toString('hex'), allDay: false, editable: true, ...e }));
      // Le jeton est renouvelé par la réponse AJAX, l'ancien n'est plus accepté.
      s.vues.delete(corps.get('javax.faces.ViewState')!);
      const vs = randomBytes(8).toString('hex');
      s.vues.set(vs, url.pathname);
      return html(`<?xml version='1.0' encoding='UTF-8'?>\n<partial-response id="j_id1"><changes><update id="form:messages"><![CDATA[<div id="form:messages"></div>]]></update><update id="${ID_SCHEDULE}"><![CDATA[{"events" : ${JSON.stringify(events)}}]]></update><update id="j_id1:javax.faces.ViewState:0"><![CDATA[${vs}]]></update></changes></partial-response>`, 'text/xml;charset=UTF-8');
    }

    const cible = PAGES[Number(corps.get('form:sidebar_menuid')) - this.premierNumero - 1];
    if (corps.get('form:sidebar') !== 'form:sidebar' || !cible || corps.get('form') !== 'form') { res.writeHead(400); res.end(); return; }
    s.page = cible;
    return rediriger(cible);
  }
}
