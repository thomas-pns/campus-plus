/** Faux PARTAGE (API SOAP JSON de Zimbra) avec des mails inventés. */
import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';

export interface MailFaux { id: string; date: number; sujet: string; texte: string; deNom: string; deAdresse: string; html?: boolean }

export class FauxPartage {
  private serveur: Server;
  base = '';
  adresse = 'camille.bernard';
  motDePasse = 'mot-de-passe-de-test';
  mails: MailFaux[] = [];
  connexions = 0;
  lectures = 0;
  private jetons = new Set<string>();

  constructor() {
    this.serveur = createServer((req, res) => {
      let corps = '';
      req.on('data', (d) => (corps += d));
      req.on('end', () => {
        const json = (v: unknown, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
        const faute = (code: string) => json({ Body: { Fault: { Reason: { Text: code }, Detail: { Error: { Code: code } } } } }, 500);
        const requete = (req.url ?? '').replace('/service/soap/', '');
        const env = JSON.parse(corps || '{}');
        const r = env.Body?.[requete] ?? {};
        if (requete === 'AuthRequest') {
          if (r.account?._content !== this.adresse || r.password?._content !== this.motDePasse) return faute('account.AUTH_FAILED');
          this.connexions++;
          const j = randomBytes(8).toString('hex');
          this.jetons.add(j);
          return json({ Body: { AuthResponse: { authToken: [{ _content: j }], lifetime: 172800000 } } });
        }
        if (!this.jetons.has(env.Header?.context?.authToken?._content)) return faute('service.AUTH_REQUIRED');
        if (requete === 'SearchRequest') {
          const liste = [...this.mails].sort((a, b) => b.date - a.date).slice(0, r.limit ?? 100);
          return json({ Body: { SearchResponse: { m: liste.map((m) => ({ id: m.id, d: m.date, su: m.sujet, fr: m.texte.slice(0, 100), e: [{ t: 'f', a: m.deAdresse, p: m.deNom }] })) } } });
        }
        if (requete === 'GetMsgRequest') {
          const m = this.mails.find((x) => x.id === r.m?.id);
          if (!m) return faute('mail.NO_SUCH_MSG');
          this.lectures++;
          const partie = m.html ? { ct: 'text/html', content: `<html><style>p{}</style><p>${m.texte}</p></html>` } : { ct: 'text/plain', content: m.texte };
          return json({ Body: { GetMsgResponse: { m: [{ id: m.id, mp: [{ ct: 'multipart/alternative', mp: [partie] }] }] } } });
        }
        return faute('service.UNKNOWN_DOCUMENT');
      });
    });
  }

  async demarrer() {
    await new Promise<void>((ok) => this.serveur.listen(0, '127.0.0.1', ok));
    this.base = `http://127.0.0.1:${(this.serveur.address() as AddressInfo).port}`;
    return this.base;
  }

  arreter() { return new Promise<void>((ok) => this.serveur.close(() => ok())); }
}

export function mailsFaux(maintenant: number): MailFaux[] {
  const h = 3600_000;
  return [
    { id: '101', date: maintenant - 2 * h, sujet: 'Nouvelle version du cours', texte: 'Bonjour, je viens de poster une nouvelle version du cours avec la démonstration corrigée de la propriété 3.', deNom: 'Alice DUPONT', deAdresse: 'alice.dupont@cpe.fr' },
    { id: '102', date: maintenant - 5 * h, sujet: 'TD de jeudi', texte: 'Cette semaine nous corrigerons les exercices 10, 14, 15 et 16. Merci de les préparer.', deNom: 'DUPONT Alice', deAdresse: 'alice.dupont@cpe.fr', html: true },
    { id: '103', date: maintenant - 8 * h, sujet: 'Partiel de physique : changement de salle', texte: 'Les étudiants de Hugo Abadie à Zoé Leroy passeront en salle F008 au lieu de F004.', deNom: 'Scolarité 3ETI', deAdresse: 'scolarite3eti@cpe.fr' },
    { id: '104', date: maintenant - 20 * h, sujet: 'Soirée du BDE vendredi !', texte: 'Venez nombreux, places limitées.', deNom: 'Bureau des élèves', deAdresse: 'bde@asso.cpe.fr' },
    { id: '105', date: maintenant - 30 * h, sujet: 'Re: projet', texte: 'Salut, on se voit en salle de TP demain ?', deNom: 'Nina Petit', deAdresse: 'nina.petit@cpe.fr' },
    { id: '106', date: maintenant - 40 * h, sujet: 'Votre colis arrive', texte: 'Suivez votre livraison.', deNom: 'Boutique', deAdresse: 'noreply@boutique.example' },
  ];
}
