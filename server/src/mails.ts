/**
 * Mails PARTAGE, triés sans IA :
 *   - qui écrit : un prof du planning, l'école (scolarité, BDE…), ou autre (élèves, extérieur) ;
 *   - de quoi ça parle : étiquettes par mots-clés (salle, examen, devoir, cours, annulation) ;
 *   - pour quelle matière : celle du prof dans le planning.
 * Désactivé par défaut : l'élève l'active dans les réglages. Seuls les mails des profs et de l'école
 * sont lus en entier ; le serveur n'en garde qu'un extrait, chiffré.
 */
import { createHash } from 'node:crypto';
import type { Alerte } from './alertes.js';
import type { Comptes } from './comptes.js';
import type { Depot } from './depot.js';
import { normaliserNom, type Evenement } from './sources/planning.js';
import { ErreurIdentifiantsPartage, ErreurJetonPartage, type MailBrut, type PartageClient } from './sources/partage.js';

export type Categorie = 'prof' | 'ecole' | 'autre';
export type Etiquette = 'salle' | 'examen' | 'devoir' | 'cours' | 'annulation';

export interface Mail {
  id: string;
  date: number;
  sujet: string;
  /** Nom affiché de l'expéditeur. */
  de: string;
  adresse: string;
  categorie: Categorie;
  etiquettes: Etiquette[];
  /** Matière du prof dans le planning, sinon null. */
  matiere: string | null;
  /** Début du texte (au plus 240 caractères). */
  extrait: string;
  /** Ouvre le mail dans PARTAGE (si la session du navigateur est ouverte). */
  lien: string;
  nonLu: boolean;
}

export interface EtatMails {
  actif: boolean;
  derniereSynchro: string | null;
  derniereTentative: string | null;
  erreur: string | null;
  echecs: number;
}

const ETAT_VIDE: EtatMails = { actif: false, derniereSynchro: null, derniereTentative: null, erreur: null, echecs: 0 };
/** Comme annoncé dans l'appli : les trois dernières semaines. */
const JOURS_GARDES = 21;
const MAILS_MAX = 150;
const TAILLE_EXTRAIT = 240;
const ALERTES_MAX = 200;

const simple = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/* ---------- Tri (fonctions pures) ---------- */

/** Profs du planning : nom de famille normalisé (minuscules) → matières (la plus fréquente d'abord), plus leurs prénoms. */
export class Annuaire extends Map<string, string[]> {
  readonly prenoms = new Map<string, Set<string>>();
}

export function profsDuPlanning(planning: Evenement[]): Annuaire {
  const compte = new Map<string, Map<string, number>>();
  const annuaire = new Annuaire();
  for (const e of planning) {
    if (!e.matiere || /non p[ée]dagogique/i.test(e.matiere)) continue;
    for (const i of e.intervenants) {
      // WebAurion écrit « NOM Prénom » : le nom de famille est la partie en capitales.
      const mots = i.trim().split(/\s+/);
      const nom = mots.filter((m) => m.length > 1 && m === m.toUpperCase() && /\p{L}/u.test(m)).join(' ');
      if (!nom) continue;
      const cle = normaliserNom(nom).toLowerCase();
      const matieres = compte.get(cle) ?? new Map<string, number>();
      matieres.set(e.matiere, (matieres.get(e.matiere) ?? 0) + 1);
      compte.set(cle, matieres);
      const prenoms = annuaire.prenoms.get(cle) ?? new Set<string>();
      for (const p of mots.filter((m) => m !== m.toUpperCase())) for (const x of simple(p).split(/[^a-z]+/)) if (x) prenoms.add(x);
      annuaire.prenoms.set(cle, prenoms);
    }
  }
  for (const [nom, m] of compte) annuaire.set(nom, [...m].sort((a, b) => b[1] - a[1]).map(([x]) => x));
  return annuaire;
}

/**
 * Le prof qui a écrit (clé de `profsDuPlanning`), d'après le nom affiché ou l'adresse prenom.nom@…
 * Si l'expéditeur donne aussi un prénom, il doit être celui du prof : une élève qui porte le même nom
 * de famille qu'un prof n'est pas prise pour lui.
 */
export function profDe(de: { deNom: string; deAdresse: string }, profs: Map<string, string[]>): string | null {
  const motsNom = normaliserNom(de.deNom).toLowerCase().split(' ').filter(Boolean);
  const motsAdresse = simple(de.deAdresse.split('@')[0] ?? '').split(/[^a-z]+/).filter(Boolean);
  const titres = new Set(['m', 'mr', 'mme', 'mlle', 'monsieur', 'madame', 'dr', 'pr', 'prof']);
  for (const nom of profs.keys()) {
    const parties = nom.split(' ');
    for (const mots of [motsNom, motsAdresse]) {
      if (!parties.every((p) => mots.includes(p))) continue;
      const autres = mots.filter((m) => !parties.includes(m) && !titres.has(m) && m.length > 1);
      const prenoms = profs instanceof Annuaire ? profs.prenoms.get(nom) : undefined;
      if (!autres.length || !prenoms?.size || autres.some((m) => prenoms.has(m))) return nom;
    }
  }
  return null;
}

/** École : adresses en …cpe.fr qui ressemblent à un service (scolarité, BDE…), pas à une personne. */
const SERVICES = /scolarit|planning|etudes|examens?|direction|secretariat|admissions?|relations?|international|stages?|bde|bds|asso|cpe ?lyon|noreply|ne-pas-repondre|info/;

export function categorieDe(de: { deNom: string; deAdresse: string }, prof: string | null): Categorie {
  if (prof) return 'prof';
  const [local = '', domaine = ''] = de.deAdresse.toLowerCase().split('@');
  if (!/(^|\.)cpe\.fr$/.test(domaine)) return 'autre';
  return SERVICES.test(simple(`${de.deNom} ${local} ${domaine}`)) ? 'ecole' : 'autre';
}

const REGLES: [Etiquette, RegExp][] = [
  ['salle', /changement de salle|\bsalles?\b|\bamphi\b|\ben [a-j]\d{3}\b/],
  ['examen', /partiel|examen|\bds\d*\b|controle|interro|epreuve|\bqcm\b|rattrapage/],
  ['devoir', /exercices?|\bexos?\b|a rendre|\brendre\b|a faire pour|preparer|devoirs?\b|deadline|date limite|pour (lundi|mardi|mercredi|jeudi|vendredi|demain|la prochaine seance|la semaine prochaine)/],
  ['cours', /nouvelle version|version corrigee|\bpoly\b|support de cours|diapos?|slides?|\bposte\b|depose|mis en ligne|sur e-?campus/],
  ['annulation', /annule|annulation|reporte|n.aura pas lieu|pas (de )?cours|ne pourrai pas assurer|absent/],
];

/** Étiquettes d'un texte (sujet + début du mail, sans la signature ni l'historique). */
export function etiquettesDe(texte: string): Etiquette[] {
  const utile = texte.split(/\n--\s*\n|\nle .{5,100} a [ée]crit\s?:|-{3,}\s*message d.origine/i)[0].slice(0, 4000);
  const t = simple(utile);
  return REGLES.filter(([, re]) => re.test(t)).map(([e]) => e);
}

const extraitDe = (texte: string) => {
  const t = texte.replace(/\s+/g, ' ').trim();
  return t.length > TAILLE_EXTRAIT ? `${t.slice(0, TAILLE_EXTRAIT - 1).trimEnd()}…` : t;
};

/* ---------- Synchro ---------- */

export interface OptionsMails {
  /** Adresse de PARTAGE, pour les liens vers les mails. */
  base?: string;
  maintenant?: () => Date;
  journal?: (m: string) => void;
  surNouvellesAlertes?: (id: string, alertes: Alerte[]) => Promise<void>;
}

export class SynchroMails {
  private enCours = new Map<string, Promise<EtatMails>>();
  private maintenant: () => Date;
  private base: string;

  constructor(private depot: Depot, private comptes: Comptes, private fabrique: () => PartageClient, private options: OptionsMails = {}) {
    this.maintenant = options.maintenant ?? (() => new Date());
    this.base = options.base ?? 'https://partage.cpe.fr';
  }

  async etat(id: string): Promise<EtatMails> {
    return { ...ETAT_VIDE, ...(await this.depot.lire<EtatMails>(id, 'etatmails')) };
  }

  async mails(id: string): Promise<Mail[]> {
    return (await this.etat(id)).actif ? ((await this.depot.lire<Mail[]>(id, 'mails')) ?? []) : [];
  }

  /** Active ou désactive la lecture des mails ; désactiver efface les mails gardés. */
  async activer(id: string, actif: boolean): Promise<void> {
    const etat = await this.etat(id);
    if (!actif) await this.depot.ecrire(id, 'mails', []);
    await this.depot.ecrire(id, 'etatmails', { ...etat, actif, erreur: null, echecs: 0, derniereTentative: actif ? null : etat.derniereTentative });
  }

  synchroniser(id: string): Promise<EtatMails> {
    const deja = this.enCours.get(id);
    if (deja) return deja;
    const tache = this.executer(id).finally(() => this.enCours.delete(id));
    this.enCours.set(id, tache);
    return tache;
  }

  private async executer(id: string): Promise<EtatMails> {
    const precedent = await this.etat(id);
    if (!precedent.actif) return precedent;
    const t = this.maintenant();
    try {
      const compte = await this.comptes.lire(id);
      if (!compte) throw new Error('Compte introuvable');
      const client = this.fabrique();
      await client.connexion(compte.identifiant, compte.motDePasse);
      const limite = t.getTime() - JOURS_GARDES * 86_400_000;
      const boite = (await client.boite()).filter((m) => m.date >= limite).slice(0, MAILS_MAX);

      const [anciens, planning] = await Promise.all([
        this.depot.lire<Mail[]>(id, 'mails'),
        this.depot.lire<Evenement[]>(id, 'planning'),
      ]);
      // Liste vide après une désactivation : on repart de zéro, comme une première lecture.
      const premiere = !anciens?.length;
      const connus = new Map((anciens ?? []).map((m) => [m.id, m]));
      const profs = profsDuPlanning(planning ?? []);
      const resultat: Mail[] = [];
      const nouveaux: Mail[] = [];
      for (const brut of boite) {
        const deja = connus.get(brut.id);
        if (deja) {
          resultat.push({ ...deja, nonLu: brut.nonLu });
          continue;
        }
        const mail = await this.trier(brut, profs, client);
        resultat.push(mail);
        nouveaux.push(mail);
      }

      // Première lecture : pas d'alerte, sinon tous les anciens mails sonneraient d'un coup.
      if (!premiere) {
        const alertes = nouveaux.filter((m) => m.categorie !== 'autre').map((m): Alerte => ({
          id: createHash('sha256').update(`mail|${m.id}`).digest('hex').slice(0, 16),
          type: 'mail', date: t.toISOString(),
          titre: `${m.de} : ${m.sujet}`,
          detail: m.extrait.slice(0, 200),
        }));
        if (alertes.length) {
          const existantes = (await this.depot.lire<Alerte[]>(id, 'alertes')) ?? [];
          const ids = new Set(existantes.map((a) => a.id));
          const inedites = alertes.filter((a) => !ids.has(a.id));
          await this.depot.ecrire(id, 'alertes', [...inedites, ...existantes].slice(0, ALERTES_MAX));
          if (inedites.length) await this.options.surNouvellesAlertes?.(id, inedites).catch((e) => this.options.journal?.(`Notifications en échec : ${(e as Error).message}`));
        }
      }

      await this.depot.ecrire(id, 'mails', resultat);
      const etat: EtatMails = { actif: true, derniereSynchro: t.toISOString(), derniereTentative: t.toISOString(), erreur: null, echecs: 0 };
      await this.depot.ecrire(id, 'etatmails', etat);
      return etat;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Erreur inconnue';
      this.options.journal?.(`Mails en échec pour ${id.slice(0, 6)}… : ${message}`);
      // Mot de passe refusé : on désactive, pour ne pas bloquer le compte à force d'essais.
      const refuse = e instanceof ErreurIdentifiantsPartage;
      const etat: EtatMails = { ...precedent, actif: refuse ? false : precedent.actif, derniereTentative: t.toISOString(), erreur: message, echecs: precedent.echecs + 1 };
      if (await this.comptes.lire(id)) await this.depot.ecrire(id, 'etatmails', etat);
      return etat;
    }
  }

  /** Trie un mail ; ne lit le texte complet que pour les mails des profs et de l'école. */
  private async trier(m: MailBrut, profs: Map<string, string[]>, client: PartageClient): Promise<Mail> {
    const prof = profDe(m, profs);
    const categorie = categorieDe(m, prof);
    let texte = m.extrait;
    if (categorie !== 'autre') {
      try {
        texte = (await client.texte(m.id)) || m.extrait;
      } catch (e) {
        if (e instanceof ErreurJetonPartage) throw e;
      }
    }
    return {
      id: m.id, date: m.date, sujet: m.sujet, de: m.deNom || m.deAdresse, adresse: m.deAdresse, categorie,
      etiquettes: categorie === 'autre' ? [] : etiquettesDe(`${m.sujet}\n${texte}`),
      matiere: prof ? profs.get(prof)![0] ?? null : null,
      extrait: extraitDe(texte),
      lien: `${this.base}/h/search?action=view&id=${encodeURIComponent(m.id)}`,
      nonLu: m.nonLu,
    };
  }
}
