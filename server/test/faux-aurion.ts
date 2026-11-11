/**
 * Faux WebAurion pour les tests : reproduit le parcours observé sur le vrai site
 * (cookie de session, /login, menu latéral, jeton ViewState propre à chaque page,
 * réponse AJAX du planning, tableaux PrimeFaces), avec des données inventées.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { PDF_DEMO } from './pdf-demo.js';
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

interface Session { connecte: boolean; vues: Map<string, string>; page: string; fichier?: { nom: string; taille: number } }

const PAGES = ['/faces/Planning.xhtml', '/faces/ChoixDonnee.xhtml', '/faces/MesAbsences.xhtml', '/faces/Historique.xhtml', '/faces/JasperReports.xhtml', '/faces/FormulaireIndisponibilite.xhtml'];
const AB = (s: string, u: string, e = '') => `PrimeFaces.ab({s:&quot;${s}&quot;,${e ? `e:&quot;${e}&quot;,p:&quot;${s}&quot;,` : ''}u:&quot;${u}&quot;,onst:function(cfg){},onco:function(xhr,status,args){}});`;
const ID_SCHEDULE = 'form:j_idt118';

export class FauxAurion {
  private serveur: Server;
  private sessions = new Map<string, Session>();
  /** Compteurs utiles aux tests. */
  connexionsReussies = 0;
  tentatives = 0;
  enPanne = false;
  /** Justificatifs reçus (tests). */
  justificatifs: { debut: string; fin: string; motif: string; fichier: string; taille: number }[] = [];
  /** PDF à servir une seule fois, comme les « dynamiccontent » de PrimeFaces. */
  private ressources = new Map<string, Buffer>();
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
    const entrees = ['____Données à consulter____', 'Planning', 'Notes', 'Absences', 'Historique Placements', 'Certificats de scolarité', "Justificatif d'absence"];
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
      case '/faces/JasperReports.xhtml':
        return this.page(s, chemin, 'Certificats de scolarité', '',
          `<table><tr><td><label>Sélectionner un modèle de rapport :</label></td><td><div id="form:j_idt107" class="ui-selectonemenu"><select id="form:j_idt107_input" name="form:j_idt107_input" onchange="${AB('form:j_idt107', 'form:listFavoris form:jasperReportsId', 'change')}"><option value=""></option><option value="8494808">CPE - Certificat Scolarité EN</option><option value="28631885">CPE - Certificat Scolarité FR</option></select></div></td></tr></table><div id="form:jasperReportsId"></div><div id="form:jasperSearch"></div><div id="form:rapports"></div>`);
      case '/faces/FormulaireIndisponibilite.xhtml':
        return this.page(s, chemin, "Formulaire d'indisponibilité", '<input id="form:tabPanelPrincipalFormulaireSupport:composant_0_0_input" name="form:tabPanelPrincipalFormulaireSupport:composant_0_0_input" type="text" value="" /><input id="form:tabPanelPrincipalFormulaireSupport:dateFin_indispo_input" name="form:tabPanelPrincipalFormulaireSupport:dateFin_indispo_input" type="text" value="" />',
          `<label for="form:tabPanelPrincipalFormulaireSupport:composant_0_0">Début de l'absence</label><label for="form:tabPanelPrincipalFormulaireSupport:dateFin_indispo">Fin de l'absence</label><label for="form:tabPanelPrincipalFormulaireSupport:composant_0_2">Motif d'indisponibilité</label>
<select id="form:tabPanelPrincipalFormulaireSupport:composant_0_2_input" name="form:tabPanelPrincipalFormulaireSupport:composant_0_2_input"><option value=""></option><option value="190706">Absence pour autre motif</option><option value="190705">Absence pour maladie</option></select>
<div id="form:docUpload"><input id="form:docUpload:0:ajouterDocument_input" name="form:docUpload:0:ajouterDocument_input" type="file" /></div>
<button id="form:j_idt218" name="form:j_idt218" type="submit" onclick="${AB('form:j_idt218', 'form:Center')}return false;"><span>Valider ma saisie</span></button><div id="form:messages"></div>`);
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
    const brut = req.method === 'POST' ? await new Promise<Buffer>((ok) => {
      const morceaux: Buffer[] = [];
      req.on('data', (d: Buffer) => morceaux.push(d));
      req.on('end', () => ok(Buffer.concat(morceaux)));
    }) : Buffer.alloc(0);
    const multipart = /multipart\/form-data/.test(req.headers['content-type'] ?? '');
    const corps = multipart ? champsMultipart(brut, req.headers['content-type']!) : new URLSearchParams(brut.toString('utf8'));
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
      if (url.pathname.includes('dynamiccontent')) {
        const id = url.searchParams.get('pfdrid') ?? '';
        const pdf = this.ressources.get(id);
        this.ressources.delete(id);
        if (!pdf) { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(''); return; }
        res.writeHead(200, { 'Content-Type': 'application/pdf' }); res.end(pdf); return;
      }
      // Comme sur le vrai site : une page ne s'affiche que si on y arrive par le menu.
      return html(s.page === url.pathname ? this.rendre(s, url.pathname) : this.coquille());
    }

    // POST : le jeton doit être celui de la page visée, sinon la vue est considérée comme expirée.
    if (s.vues.get(corps.get('javax.faces.ViewState') ?? '') !== url.pathname) return rediriger('/faces/Login.xhtml');

    if (corps.get('javax.faces.partial.ajax') === 'true' && url.pathname !== '/faces/Planning.xhtml') {
      const source = corps.get('javax.faces.source') ?? '';
      s.vues.delete(corps.get('javax.faces.ViewState')!);
      const vs = randomBytes(8).toString('hex');
      s.vues.set(vs, url.pathname);
      const reponse = (maj: Record<string, string>) => html(`<?xml version='1.0' encoding='UTF-8'?>\n<partial-response id="j_id1"><changes>${Object.entries(maj).map(([id, h]) => `<update id="${id}"><![CDATA[${h}]]></update>`).join('')}<update id="j_id1:javax.faces.ViewState:0"><![CDATA[${vs}]]></update></changes></partial-response>`, 'text/xml;charset=UTF-8');
      if (source === 'form:j_idt107' && corps.get('form:j_idt107_input') === '28631885') {
        return reponse({ 'form:jasperReportsId': `<div id="form:jasperReportsId"><div id="form:j_idt110" class="ui-selectonemenu"><select id="form:j_idt110_input" name="form:j_idt110_input" onchange="${AB('form:j_idt110', 'form:jasperReportsId form:jasperSearch', 'change')}"><option value="202981">Web DA : INSCRIPTION groupe PROMO - ANNEE_EN_COURS</option></select></div></div>` });
      }
      if (source === 'form:j_idt110' && corps.get('form:j_idt110_input') === '202981' && corps.get('form:j_idt107_input') === '28631885') {
        return reponse({ 'form:jasperSearch': `<div id="form:jasperSearch"><div id="form:j_idt152" class="ui-datatable"><table><tbody id="form:j_idt152_data"><tr data-ri="0" data-rk="28948835"><td>${this.donnees.nom}</td></tr></tbody></table></div><button id="form:j_idt155" name="form:j_idt155" onclick="${AB('form:j_idt155', 'form:rapports')}return false;"><span>Générer</span></button><button id="form:j_idt156"><span>Télécharger</span></button></div>` });
      }
      if (source === 'form:j_idt155' && corps.get('form:j_idt152_selection') === '28948835') {
        const id = randomBytes(6).toString('hex');
        this.ressources.set(id, Buffer.from(PDF_DEMO));
        return reponse({ 'form:rapports': `<div id="form:rapports"><object type="application/pdf" data="/faces/javax.faces.resource/dynamiccontent.properties?ln=primefaces&amp;pfdrid=${id}&amp;pfdrt=sc"></object></div>` });
      }
      if (source === 'form:docUpload:0:ajouterDocument' && multipart) {
        const fichier = fichierMultipart(brut, req.headers['content-type']!, 'form:docUpload:0:ajouterDocument_input');
        if (!fichier) return reponse({ 'form:docUpload': '<div id="form:docUpload"><div class="ui-messages-error">Type de fichier invalide</div></div>' });
        s.fichier = fichier;
        return reponse({ 'form:docUpload': `<div id="form:docUpload"><span>${fichier.nom}</span></div>` });
      }
      if (source === 'form:j_idt218') {
        const debut = corps.get('form:tabPanelPrincipalFormulaireSupport:composant_0_0_input') ?? '';
        const fin = corps.get('form:tabPanelPrincipalFormulaireSupport:dateFin_indispo_input') ?? '';
        const motif = corps.get('form:tabPanelPrincipalFormulaireSupport:composant_0_2_input') ?? '';
        const date = /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/;
        if (!date.test(debut) || !date.test(fin) || !motif || !s.fichier) {
          return reponse({ 'form:Center': '<div id="form:messages"><div class="ui-messages-error"><span class="ui-messages-error-summary">Saisie incomplète.</span></div></div>' });
        }
        this.justificatifs.push({ debut, fin, motif, fichier: s.fichier.nom, taille: s.fichier.taille });
        s.fichier = undefined;
        return reponse({ 'form:Center': '<div id="form:messages"><div class="ui-messages-info"><span class="ui-messages-info-summary">Votre demande a bien été enregistrée.</span></div></div>' });
      }
      res.writeHead(400); res.end(); return;
    }

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

/** Champs texte d'un envoi multipart (ce que fait le bouton « Ajouter… » de PrimeFaces). */
function partiesMultipart(brut: Buffer, type: string): { nom: string; fichier?: string; contenu: Buffer }[] {
  const limite = type.match(/boundary=(?:"([^"]+)"|([^;]+))/)!;
  const sep = Buffer.from(`--${limite[1] ?? limite[2]}`);
  const parties: { nom: string; fichier?: string; contenu: Buffer }[] = [];
  let i = brut.indexOf(sep);
  while (i !== -1) {
    const suivant = brut.indexOf(sep, i + sep.length);
    if (suivant === -1) break;
    const bloc = brut.subarray(i + sep.length + 2, suivant - 2);
    const finEntetes = bloc.indexOf('\r\n\r\n');
    const entetes = bloc.subarray(0, finEntetes).toString('utf8');
    const nom = entetes.match(/name="([^"]*)"/)?.[1] ?? '';
    const fichier = entetes.match(/filename="([^"]*)"/)?.[1];
    parties.push({ nom, fichier, contenu: bloc.subarray(finEntetes + 4) });
    i = suivant;
  }
  return parties;
}

function champsMultipart(brut: Buffer, type: string): URLSearchParams {
  const p = new URLSearchParams();
  for (const x of partiesMultipart(brut, type)) if (x.fichier === undefined) p.append(x.nom, x.contenu.toString('utf8'));
  return p;
}

function fichierMultipart(brut: Buffer, type: string, champ: string): { nom: string; taille: number } | null {
  const x = partiesMultipart(brut, type).find((p) => p.nom === champ && p.fichier);
  return x && /\.(pdf|docx|png|jpe?g)$/i.test(x.fichier!) ? { nom: x.fichier!, taille: x.contenu.length } : null;
}
