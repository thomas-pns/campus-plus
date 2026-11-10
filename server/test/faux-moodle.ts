/**
 * Faux e-campus + faux CAS pour les tests : même parcours que le vrai (relevé le 10/11/2026),
 * avec des cours et des fichiers inventés. Un seul serveur répond pour les deux sites,
 * distingués par leur chemin : /cas/… pour le CAS, le reste pour Moodle.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';

export interface FichierFaux { nom: string; contenu: string; modifie: number; dossier?: string }
export interface ElementFaux { id: number; nom: string; type: string; fichiers?: FichierFaux[] }
export interface CoursFaux { id: number; fullname: string; shortname: string; categoryname: string; sections: { nom: string; elements: ElementFaux[] }[] }

export interface EcheanceFausse { id: number; nom: string; module: string; cours: number; date: number; enRetard?: boolean }

export class FauxMoodle {
  private serveur: Server;
  echeances: EcheanceFausse[] = [];
  base = '';
  identifiant = 'camille.bernard@cpe.test';
  motDePasse = 'mot-de-passe-de-test';
  cours: CoursFaux[] = [];
  private jetons = new Set<string>();
  private sessionsMoodle = new Set<string>();
  private tickets = new Set<string>();
  private executions = new Set<string>();
  connexionsCas = 0;
  telechargements = 0;
  /** Simule l'expiration de tous les jetons. */
  revoquerJetons() { this.jetons.clear(); }

  constructor() {
    this.serveur = createServer((req, res) => void this.traiter(req, res).catch(() => { res.statusCode = 500; res.end(); }));
  }

  async demarrer() {
    await new Promise<void>((ok) => this.serveur.listen(0, '127.0.0.1', ok));
    this.base = `http://127.0.0.1:${(this.serveur.address() as AddressInfo).port}`;
    return { moodle: this.base, cas: this.base };
  }

  arreter() { return new Promise<void>((ok) => this.serveur.close(() => ok())); }

  private async traiter(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', this.base);
    const corps = new URLSearchParams(req.method === 'POST' ? await new Promise<string>((ok) => { let t = ''; req.on('data', (d) => (t += d)); req.on('end', () => ok(t)); }) : '');
    const cookie = (n: string) => new RegExp(`${n}=([^;]+)`).exec(req.headers.cookie ?? '')?.[1];
    const rediriger = (vers: string, cookies: string[] = []) => { res.writeHead(303, { Location: vers, ...(cookies.length ? { 'Set-Cookie': cookies } : {}) }); res.end(); };
    const json = (v: unknown) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
    const service = `${this.base}/login/index.php`;

    // ----- CAS -----
    if (url.pathname === '/cas/login' && req.method === 'GET') {
      const ex = randomBytes(24).toString('hex');
      this.executions.add(ex);
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(`<html><head><title>CPE Lyon Connexion</title></head><body><form id="fm1" action="login" method="post">
        <input type="text" name="username"><input type="password" name="password"><button type="button">Afficher</button>
        <input type="hidden" name="execution" value="${ex}"><input type="hidden" name="_eventId" value="submit">
        <input type="hidden" name="geolocation" value=""><input type="hidden" name="deviceFingerprint" value="">
        <input type="submit" name="submitBtn" value="Se connecter"></form></body></html>`);
    }
    if (url.pathname === '/cas/login' && req.method === 'POST') {
      const ok = this.executions.delete(corps.get('execution') ?? '') && corps.get('_eventId') === 'submit'
        && corps.get('username') === this.identifiant && corps.get('password') === this.motDePasse;
      if (!ok || url.searchParams.get('service') !== service) { res.writeHead(401, { 'Content-Type': 'text/html' }); return res.end('<html><form id="fm1" action="login"><input name="execution" value="x"></form>Identifiants invalides</html>'); }
      this.connexionsCas++;
      const ticket = `ST-${randomBytes(8).toString('hex')}`;
      this.tickets.add(ticket);
      return rediriger(`${service}?ticket=${ticket}`);
    }

    // ----- Moodle -----
    if (url.pathname === '/login/index.php') {
      if (url.searchParams.get('authCAS') === 'CAS') return rediriger(`${this.base}/cas/login?service=${encodeURIComponent(service)}`);
      const ticket = url.searchParams.get('ticket');
      if (ticket && this.tickets.delete(ticket)) {
        const s = randomBytes(8).toString('hex');
        this.sessionsMoodle.add(s);
        return rediriger(`${this.base}/my/`, [`MoodleSession=${s}; path=/; HttpOnly`]);
      }
      res.writeHead(200); return res.end('<html>Connexion</html>');
    }
    if (url.pathname === '/my/') { res.writeHead(200); return res.end('<html>Tableau de bord</html>'); }
    if (url.pathname === '/admin/tool/mobile/launch.php') {
      if (!this.sessionsMoodle.has(cookie('MoodleSession') ?? '')) return rediriger(`${this.base}/login/index.php`);
      const passeport = url.searchParams.get('passport') ?? '';
      const jeton = randomBytes(16).toString('hex');
      this.jetons.add(jeton);
      const signature = createHash('md5').update(this.base + passeport).digest('hex');
      return rediriger(`moodlemobile://token=${Buffer.from(`${signature}:::${jeton}:::prive`).toString('base64')}`);
    }
    if (url.pathname === '/webservice/rest/server.php') {
      if (!this.jetons.has(corps.get('wstoken') ?? '')) return json({ exception: 'moodle_exception', errorcode: 'invalidtoken', message: 'Invalid token' });
      switch (corps.get('wsfunction')) {
        case 'core_webservice_get_site_info': return json({ userid: 42, sitename: 'Faux e-campus' });
        case 'core_enrol_get_users_courses': return json(this.cours.map(({ sections: _, ...c }) => ({ ...c, visible: 1, hidden: false })));
        case 'core_course_get_contents': {
          const c = this.cours.find((x) => x.id === Number(corps.get('courseid')));
          if (!c) return json({ exception: 'moodle_exception', errorcode: 'invalidrecord', message: 'Cours introuvable' });
          return json(c.sections.map((s, i) => ({
            id: i + 1, name: s.nom, section: i, uservisible: true,
            modules: s.elements.map((e) => ({
              id: e.id, name: e.nom, modname: e.type, uservisible: true, url: `${this.base}/mod/${e.type}/view.php?id=${e.id}`,
              contents: (e.fichiers ?? []).map((f) => ({
                type: 'file', filename: f.nom, filepath: f.dossier ? `/${f.dossier}/` : '/', filesize: Buffer.byteLength(f.contenu),
                fileurl: `${this.base}/webservice/pluginfile.php/1/mod_${e.type}/content/0/${encodeURIComponent(f.nom)}?forcedownload=1`,
                timemodified: f.modifie, mimetype: 'application/pdf',
              })),
            })),
          })));
        }
        case 'core_calendar_get_action_events_by_timesort': {
          const de = Number(corps.get('timesortfrom')), a = Number(corps.get('timesortto')), max = Number(corps.get('limitnum'));
          const apres = Number(corps.get('aftereventid') ?? 0);
          const liste = this.echeances.filter((e) => e.date >= de && e.date <= a).sort((x, y) => x.date - y.date || x.id - y.id);
          const debut = apres ? liste.findIndex((e) => e.id === apres) + 1 : 0;
          return json({ events: liste.slice(debut, debut + max).map((e) => {
            const c = this.cours.find((x) => x.id === e.cours);
            return {
              id: e.id, name: `${e.nom} est à remettre`, activityname: e.nom, modulename: e.module, timesort: e.date, overdue: !!e.enRetard,
              url: `${this.base}/mod/${e.module}/view.php?id=${e.id}`, course: { id: e.cours, fullname: c?.fullname ?? '' },
              action: { name: e.module === 'quiz' ? 'Tenter le test' : 'Remettre un travail', url: `${this.base}/mod/${e.module}/view.php?id=${e.id}&action=editsubmission`, actionable: true },
            };
          }) });
        }
        default: return json({ exception: 'webservice_access_exception', errorcode: 'accessexception', message: 'Fonction non autorisée' });
      }
    }
    if (url.pathname.startsWith('/webservice/pluginfile.php/')) {
      if (!this.jetons.has(url.searchParams.get('token') ?? '')) return json({ error: 'Invalid token', errorcode: 'invalidtoken' });
      const nom = decodeURIComponent(url.pathname.split('/').pop()!);
      const f = this.cours.flatMap((c) => c.sections.flatMap((s) => s.elements.flatMap((e) => e.fichiers ?? []))).find((x) => x.nom === nom);
      if (!f) { res.writeHead(404); return res.end(); }
      this.telechargements++;
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': Buffer.byteLength(f.contenu) });
      return res.end(f.contenu);
    }
    res.writeHead(404); res.end();
  }
}

export function coursFaux(): CoursFaux[] {
  return [
    {
      id: 4268, fullname: 'Bases de la physique quantique et des semi-conducteurs (S5) * 26_27_3ETI_05_ELPH_011_C', shortname: '26_27_3ETI_05_ELPH_011_C', categoryname: '3ETI_05_ELPH',
      sections: [
        { nom: 'Généralités', elements: [{ id: 1, nom: 'Annonces', type: 'forum' }] },
        { nom: 'Docs', elements: [{ id: 2, nom: 'Cours_MQ', type: 'resource', fichiers: [{ nom: 'cours-mq.pdf', contenu: '%PDF-1.4 cours MQ', modifie: 1_790_000_000 }] }] },
        { nom: 'Nouvelle section', elements: [] },
        { nom: 'TD &amp; corrigés', elements: [{ id: 3, nom: 'TD', type: 'folder', fichiers: [{ nom: 'td1.pdf', contenu: '%PDF-1.4 TD1', modifie: 1_790_000_000, dossier: 'TD' }, { nom: 'td2.pdf', contenu: '%PDF-1.4 TD2', modifie: 1_790_000_000, dossier: 'TD' }] }] },
      ],
    },
    {
      id: 4280, fullname: 'Alg&egrave;bre lin&eacute;aire (S5) * 26_27_3ETI_05_MSP_101_C', shortname: '26_27_3ETI_05_MSP_101_C', categoryname: '3ETI_05_MSP',
      sections: [{ nom: 'Cours', elements: [{ id: 10, nom: 'Poly', type: 'resource', fichiers: [{ nom: 'poly-algebre.pdf', contenu: '%PDF-1.4 poly', modifie: 1_790_000_000 }] }, { id: 11, nom: 'Site du prof', type: 'url' }] }],
    },
  ];
}
