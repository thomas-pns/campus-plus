/**
 * Notifications sur le téléphone (Web Push) quand une synchro trouve du nouveau.
 * Les clés VAPID sont créées au premier démarrage et rangées chiffrées dans DATA_DIR : rien à configurer.
 * Par élève : ses abonnements (un par appareil) et les types d'alertes qu'il veut recevoir.
 */
import * as webpushModule from 'web-push';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Coffre } from './coffre.js';
import type { Depot } from './depot.js';
import type { Alerte, TypeAlerte } from './alertes.js';
import type { Evenement } from './sources/planning.js';

export interface Abonnement {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export type Types = Record<TypeAlerte, boolean>;
export const TYPES_PAR_DEFAUT: Types = { salle: true, horaire: true, ajoute: true, supprime: true, note: true, fichier: true, devoir: true, mail: true, examen: true };

interface Reglages {
  abonnements: Abonnement[];
  types: Types;
  /** Rappel avant chaque créneau, en minutes (0 : pas de rappel). */
  rappel: number;
}

export const RAPPELS_POSSIBLES = [0, 5, 10, 15, 30, 60];

export interface Message {
  titre: string;
  corps: string;
  tag: string;
}

/** Envoi d'un message à un abonnement ; renvoie le code HTTP d'erreur éventuel (404/410 = abonnement mort). */
export type Envoyeur = (abonnement: Abonnement, message: Message) => Promise<void>;

// web-push est un module CommonJS : selon l'outil qui le charge, il arrive avec ou sans « default ».
const webpush = ((webpushModule as unknown as { default?: typeof webpushModule }).default ?? webpushModule) as typeof webpushModule;

const ABONNEMENTS_MAX = 10;
/** Au-delà, un seul message qui résume, pour ne pas faire vibrer le téléphone dix fois. */
const MESSAGES_MAX = 3;

export function abonnementValide(a: unknown): a is Abonnement {
  const x = a as Abonnement;
  return !!x && typeof x.endpoint === 'string' && /^https:\/\/[^\s]{8,}$/.test(x.endpoint) && x.endpoint.length < 1000
    && typeof x.keys?.p256dh === 'string' && typeof x.keys?.auth === 'string' && x.keys.p256dh.length < 200 && x.keys.auth.length < 100;
}

/** Ce qu'on envoie pour une série d'alertes. */
export function messagesPour(alertes: Alerte[]): Message[] {
  if (alertes.length <= MESSAGES_MAX) return alertes.map((a) => ({ titre: a.titre, corps: a.detail, tag: a.id }));
  return [{ titre: `${alertes.length} changements détectés`, corps: alertes.slice(0, 3).map((a) => a.titre).join(' · '), tag: 'resume' }];
}

export class Notifications {
  clePublique = '';

  constructor(private depot: Depot, private envoyeur: Envoyeur) {}

  /** Clés VAPID : relues dans DATA_DIR, ou créées au premier démarrage. Installe l'envoi réel par web-push. */
  static async demarrer(depot: Depot, coffre: Coffre, dossierDonnees: string, sujet = 'mailto:campus-plus@users.noreply.github.com'): Promise<Notifications> {
    const fichier = join(dossierDonnees, 'vapid.enc');
    let cles: { publicKey: string; privateKey: string };
    try {
      cles = JSON.parse(coffre.dechiffrer(await readFile(fichier, 'utf8')));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
      cles = webpush.generateVAPIDKeys();
      await mkdir(dossierDonnees, { recursive: true });
      await writeFile(fichier, coffre.chiffrer(JSON.stringify(cles)), { mode: 0o600, flag: 'wx' });
    }
    const n = new Notifications(depot, async (abonnement, message) => {
      await webpush.sendNotification(abonnement, JSON.stringify(message), { TTL: 6 * 3600, vapidDetails: { subject: sujet, ...cles } });
    });
    n.clePublique = cles.publicKey;
    return n;
  }

  async reglages(id: string): Promise<Reglages> {
    const r = await this.depot.lire<Partial<Reglages>>(id, 'notifications');
    return { abonnements: r?.abonnements ?? [], types: { ...TYPES_PAR_DEFAUT, ...r?.types }, rappel: r?.rappel ?? 0 };
  }

  async abonner(id: string, a: Abonnement): Promise<void> {
    const r = await this.reglages(id);
    const propre: Abonnement = { endpoint: a.endpoint, keys: { p256dh: a.keys.p256dh, auth: a.keys.auth } };
    const abonnements = [...r.abonnements.filter((x) => x.endpoint !== a.endpoint), propre].slice(-ABONNEMENTS_MAX);
    await this.depot.ecrire(id, 'notifications', { ...r, abonnements });
  }

  async desabonner(id: string, endpoint: string): Promise<void> {
    const r = await this.reglages(id);
    await this.depot.ecrire(id, 'notifications', { ...r, abonnements: r.abonnements.filter((x) => x.endpoint !== endpoint) });
  }

  async changerTypes(id: string, types: Partial<Types>): Promise<Types> {
    const r = await this.reglages(id);
    const nouveaux = { ...r.types };
    for (const t of Object.keys(TYPES_PAR_DEFAUT) as TypeAlerte[]) if (typeof types[t] === 'boolean') nouveaux[t] = types[t]!;
    await this.depot.ecrire(id, 'notifications', { ...r, types: nouveaux });
    return nouveaux;
  }

  async changerRappel(id: string, minutes: number): Promise<number> {
    const r = await this.reglages(id);
    const rappel = RAPPELS_POSSIBLES.includes(minutes) ? minutes : 0;
    await this.depot.ecrire(id, 'notifications', { ...r, rappel });
    return rappel;
  }

  /** Envoie à tous les appareils de l'élève ; oublie les abonnements que le service push déclare morts. */
  async envoyer(id: string, messages: Message[]): Promise<number> {
    const r = await this.reglages(id);
    if (!r.abonnements.length || !messages.length) return 0;
    const morts = new Set<string>();
    let envoyes = 0;
    for (const a of r.abonnements) {
      for (const m of messages) {
        try {
          await this.envoyeur(a, m);
          envoyes++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) { morts.add(a.endpoint); break; }
        }
      }
    }
    if (morts.size) {
      const actuel = await this.reglages(id);
      await this.depot.ecrire(id, 'notifications', { ...actuel, abonnements: actuel.abonnements.filter((x) => !morts.has(x.endpoint)) });
    }
    return envoyes;
  }

  /** Appelé par la synchro avec les alertes qui viennent d'apparaître. */
  async alertes(id: string, alertes: Alerte[]): Promise<void> {
    const { types } = await this.reglages(id);
    await this.envoyer(id, messagesPour(alertes.filter((a) => types[a.type])));
  }
}

/** Créneaux à rappeler maintenant : ceux qui commencent dans `minutes`, à la minute près. */
export function creneauxARappeler(planning: Evenement[], maintenant: number, minutes: number): Evenement[] {
  const de = maintenant + (minutes - 1) * 60_000;
  const a = maintenant + minutes * 60_000;
  const vus = new Set<string>();
  return planning.filter((e) => {
    const t = Date.parse(e.debut);
    if (t <= de || t > a || !e.matiere || vus.has(e.cle)) return false;
    vus.add(e.cle);
    return true;
  });
}

export function messageRappel(e: Evenement, minutes: number): Message {
  const heure = (iso: string) => iso.slice(11, 16);
  const quoi = e.type && e.type.trim() && e.type.trim() !== e.matiere ? `${e.matiere} (${e.type.trim()})` : e.matiere;
  return {
    titre: `${minutes >= 60 ? 'Dans 1 h' : `Dans ${minutes} min`} : ${quoi}`,
    corps: [e.salles.length ? `Salle ${e.salles.join(' / ')}` : null, `${heure(e.debut)} – ${heure(e.fin)}`].filter(Boolean).join(' · '),
    tag: `rappel-${e.cle}`,
  };
}

/**
 * Rappels avant les cours : chaque minute, pour les élèves qui l'ont demandé, envoie un rappel pour les
 * créneaux qui commencent bientôt. Le planning vient de la dernière synchro (déjà sur le serveur).
 */
export class RappelsCours {
  private envoyes = new Map<string, number>();

  constructor(private depot: Depot, private notifications: Notifications, private eleves: () => Promise<string[]>, private maintenant = () => Date.now()) {}

  async tour(): Promise<number> {
    const t = this.maintenant();
    let total = 0;
    for (const [cle, quand] of this.envoyes) if (t - quand > 2 * 3600_000) this.envoyes.delete(cle);
    for (const id of await this.eleves()) {
      try {
        const r = await this.notifications.reglages(id);
        if (!r.rappel || !r.abonnements.length) continue;
        const planning = (await this.depot.lire<Evenement[]>(id, 'planning')) ?? [];
        const aEnvoyer = creneauxARappeler(planning, t, r.rappel).filter((e) => !this.envoyes.has(`${id}|${e.cle}`));
        for (const e of aEnvoyer) this.envoyes.set(`${id}|${e.cle}`, t);
        if (aEnvoyer.length) total += await this.notifications.envoyer(id, aEnvoyer.map((e) => messageRappel(e, r.rappel)));
      } catch { /* un élève en erreur ne bloque pas les autres */ }
    }
    return total;
  }

  demarrer(): () => void {
    const minuteur = setInterval(() => void this.tour(), 60_000);
    minuteur.unref?.();
    return () => clearInterval(minuteur);
  }
}
