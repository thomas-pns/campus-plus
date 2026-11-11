/** Faux Microsoft : connexion par code d'appareil et dépôt de fichiers OneDrive (Graph). */
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';

export class FauxMicrosoft {
  private serveur: Server;
  base = '';
  /** Fichiers reçus : chemin → contenu. */
  fichiers = new Map<string, Buffer>();
  /** Vrai quand l'élève a saisi le code. */
  valide = false;
  refuse = false;
  renouvellementsRefuses = false;
  private acces = new Set<string>();
  private renouvellement = 'r-0';
  private sessions = new Map<string, { chemin: string; morceaux: Buffer[] }>();
  morceaux = 0;

  constructor() {
    this.serveur = createServer((req, res) => {
      const morceaux: Buffer[] = [];
      req.on('data', (d: Buffer) => morceaux.push(d));
      req.on('end', () => {
        const corps = Buffer.concat(morceaux);
        const json = (v: unknown, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
        const url = new URL(req.url ?? '/', 'http://x');
        const jetons = () => {
          const acces = `a-${randomBytes(6).toString('hex')}`;
          this.acces.add(acces);
          this.renouvellement = `r-${randomBytes(6).toString('hex')}`;
          return json({ access_token: acces, refresh_token: this.renouvellement, expires_in: 3600 });
        };
        if (url.pathname.endsWith('/oauth2/v2.0/devicecode')) {
          return json({ device_code: 'appareil', user_code: 'ABCD-EFGH', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 0 });
        }
        if (url.pathname.endsWith('/oauth2/v2.0/token')) {
          const f = new URLSearchParams(corps.toString());
          if (f.get('grant_type') === 'refresh_token') {
            if (this.renouvellementsRefuses || f.get('refresh_token') !== this.renouvellement) return json({ error: 'invalid_grant' }, 400);
            return jetons();
          }
          if (this.refuse) return json({ error: 'access_denied' }, 400);
          if (!this.valide) return json({ error: 'authorization_pending' }, 400);
          return jetons();
        }
        if (url.pathname.startsWith('/session/')) {
          const s = this.sessions.get(url.pathname.slice(9));
          if (!s) return json({}, 404);
          s.morceaux.push(corps);
          this.morceaux++;
          const [, fin, total] = /bytes \d+-(\d+)\/(\d+)/.exec(String(req.headers['content-range'])) ?? [];
          if (Number(fin) + 1 === Number(total)) { this.fichiers.set(s.chemin, Buffer.concat(s.morceaux)); return json({ id: 'x' }, 201); }
          return json({ nextExpectedRanges: [`${Number(fin) + 1}-`] }, 202);
        }
        const jeton = String(req.headers.authorization ?? '').replace('Bearer ', '');
        if (!this.acces.has(jeton)) return json({ error: { code: 'InvalidAuthenticationToken' } }, 401);
        if (url.pathname === '/v1.0/me') return json({ displayName: 'Camille Bernard', mail: 'camille.bernard@exemple.fr' });
        const m = /^\/v1\.0\/me\/drive\/root:\/(.+):\/(content|createUploadSession)$/.exec(url.pathname);
        if (m) {
          const chemin = decodeURIComponent(m[1]);
          if (m[2] === 'content') { this.fichiers.set(chemin, corps); return json({ id: 'x' }, 201); }
          const sid = randomBytes(4).toString('hex');
          this.sessions.set(sid, { chemin, morceaux: [] });
          return json({ uploadUrl: `${this.base}/session/${sid}` });
        }
        json({}, 404);
      });
    });
  }

  async demarrer(): Promise<string> {
    await new Promise<void>((r) => this.serveur.listen(0, '127.0.0.1', r));
    this.base = `http://127.0.0.1:${(this.serveur.address() as AddressInfo).port}`;
    return this.base;
  }

  arreter(): Promise<void> {
    return new Promise((r) => this.serveur.close(() => r()));
  }
}
