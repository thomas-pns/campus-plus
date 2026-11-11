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
  /** Texte du mail, sans la signature ni l'historique (profs et école seulement, au plus 4 000 caractères). */
  texte: string;
  /** Ouvre PARTAGE (la boîte de réception). */
  lien: string;
  /** Clé de l'expéditeur pour les corrections (adresse, ou adresse#nom pour les mails d'e-campus). */
  expediteur?: string;
  /** Vrai si la catégorie vient d'un choix de l'élève pour cet expéditeur. */
  corrige?: boolean;
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
const TAILLE_TEXTE = 4000;
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
/** Listes de diffusion de l'école, en tête d'objet : [3eti], [eti], [eleves]… */
const LISTE = /^\s*(re|tr|fwd?)?\s*:?\s*\[(\d?[a-z]{2,6}|eleves|etudiants|tout-cpe)\]/;
/** Communication, événements et offres : utiles parfois, jamais urgents. */
const ANNONCES = /webinaire|conference|forum|salons?\b|battle ?dev|erasmus|concours|sondage|cotisation|diplomes|ambassadeur|evenements? a venir|newsletter|\[news\]|point info com|portes ouvertes|i-factory|entrepreneuriat|girls can code|volontaires? pour|career center|jobteaser|double diplome|presentation aux etudiants/;

/** Mail envoyé par e-campus (Moodle) au nom d'un prof ou automatiquement. */
export const viaCampus = (deNom: string) => /\(via cpe-campus\)/i.test(deNom);
const nomSansVia = (deNom: string) => deNom.replace(/\s*\(via cpe-campus\)\s*/i, '').trim();

/**
 * Clé d'un expéditeur pour les corrections : e-campus envoie tout depuis la même adresse, au nom de
 * chaque prof ; on distingue donc ces mails par le nom affiché.
 */
export const cleExpediteur = (de: { deNom: string; deAdresse: string }) =>
  viaCampus(de.deNom) ? `${de.deAdresse.toLowerCase()}#${simple(nomSansVia(de.deNom))}` : de.deAdresse.toLowerCase();

export function categorieDe(de: { deNom: string; deAdresse: string; sujet?: string }, prof: string | null): Categorie {
  const sujet = simple(de.sujet ?? '');
  if (viaCampus(de.deNom)) {
    // Rappels automatiques (« À rendre le… », « En retard ») et « Nouveau contenu » : déjà dans l'appli.
    if (/^merci de ne pas repondre/i.test(simple(de.deNom)) || /nouveau contenu de/.test(sujet)) return 'autre';
    // Annonce d'un forum de cours : c'est un prof qui écrit.
    return 'prof';
  }
  if (ANNONCES.test(sujet)) return 'autre';
  if (prof) return 'prof';
  const [local = '', domaine = ''] = de.deAdresse.toLowerCase().split('@');
  if (!/(^|\.)cpe\.fr$/.test(domaine)) return 'autre';
  if (LISTE.test(sujet)) return 'ecole';
  return SERVICES.test(simple(`${de.deNom} ${local} ${domaine}`)) ? 'ecole' : 'autre';
}

/** Matière citée par un mail d'e-campus : « … du cours Logique Numérique (S5) * 26_27_… ». */
export function matiereCampus(texte: string): string | null {
  const m = texte.match(/(?:dans le cours|du cours|contenu de)\s+(.+?)\s*\(S\d+\)/i);
  return m ? m[1].trim() : null;
}

const REGLES: [Etiquette, RegExp][] = [
  ['salle', /changement de salle|\bsalles?\b|\bamphi\b|\ben [a-j]\d{3}\b/],
  ['examen', /partiel|examen|\bds\d*\b|controle|interro|epreuve|\bqcm\b|rattrapage|evaluation|vous etes attendus|modalites/],
  ['devoir', /exercices?|\bexos?\b|a rendre|\brendre\b|en retard :|a faire pour|preparer|devoirs?\b|deadline|date limite|pour (lundi|mardi|mercredi|jeudi|vendredi|demain|la prochaine seance|la semaine prochaine)/],
  ['cours', /nouvelle version|version corrigee|nouveau contenu|\bpoly\b|support de cours|diapos?|slides?|\bposte\b|depose|mis en ligne|sur e-?campus/],
  ['annulation', /annule|annulation|reporte|n.aura pas lieu|pas (de )?cours|ne pourrai pas assurer|absent|en greve|\bgreve\b/],
];

/** Le mail sans la signature ni l'historique des réponses. */
export const sansHistorique = (texte: string) =>
  texte.split(/\n--\s*\n|\nle .{5,100} a [ée]crit\s?:|-{3,}\s*message d.origine|\n_{5,}\s*\nde ?:/i)[0].trim();

/** Étiquettes d'un texte (sujet + début du mail, sans la signature ni l'historique). */
export function etiquettesDe(texte: string): Etiquette[] {
  const t = simple(sansHistorique(texte).slice(0, TAILLE_TEXTE));
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

  /** Choix de l'élève : adresse d'expéditeur → catégorie imposée. */
  async expediteurs(id: string): Promise<Record<string, Categorie>> {
    return (await this.depot.lire<Record<string, Categorie>>(id, 'expediteurs')) ?? {};
  }

  /**
   * Impose (ou retire, avec null) la catégorie d'un expéditeur, et l'applique tout de suite aux mails gardés.
   * Un mail passé en « prof » ou « école » sans texte gardé sera relu à la prochaine synchro.
   */
  async corriger(id: string, adresse: string, categorie: Categorie | null): Promise<Mail[]> {
    const cle = adresse.trim().toLowerCase();
    const choix = await this.expediteurs(id);
    if (categorie) choix[cle] = categorie;
    else delete choix[cle];
    await this.depot.ecrire(id, 'expediteurs', choix);
    const planning = (await this.depot.lire<Evenement[]>(id, 'planning')) ?? [];
    const profs = profsDuPlanning(planning);
    const mails = ((await this.depot.lire<Mail[]>(id, 'mails')) ?? []).map((m) => {
      if ((m.expediteur ?? m.adresse.toLowerCase()) !== cle) return m;
      const prof = profDe({ deNom: m.de, deAdresse: m.adresse }, profs);
      const cat = categorie ?? (cle.includes('#') ? (m.de === 'e-campus' ? 'autre' : 'prof') : categorieDe({ deNom: m.de, deAdresse: m.adresse, sujet: m.sujet }, prof));
      const aLire = cat !== 'autre' && !m.texte;
      return {
        ...m, categorie: cat, corrige: !!categorie,
        etiquettes: cat !== 'autre' || cle.includes('#') ? etiquettesDe(`${m.sujet}\n${m.texte || m.extrait}`) : [],
        matiere: prof ? profs.get(prof)?.[0] ?? null : m.matiere,
        // Sans texte : on l'oublie pour qu'il soit relu (et son texte gardé) à la prochaine synchro.
        ...(aLire ? { id: `relire:${m.id}` } : {}),
        texte: cat === 'autre' ? '' : m.texte,
      };
    });
    await this.depot.ecrire(id, 'mails', mails);
    return this.mails(id);
  }

  async mails(id: string): Promise<Mail[]> {
    if (!(await this.etat(id)).actif) return [];
    // Les mails gardés avant la correction du lien pointaient vers une page de PARTAGE qui n'existe pas.
    return ((await this.depot.lire<Mail[]>(id, 'mails')) ?? []).map((m) => ({ ...m, lien: `${this.base}/` }));
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
      // Mails à relire après une correction : on les traite comme nouveaux, sans alerte.
      const aRelire = new Set((anciens ?? []).filter((m) => m.id.startsWith('relire:')).map((m) => m.id.slice(7)));
      const profs = profsDuPlanning(planning ?? []);
      const choix = await this.expediteurs(id);
      const resultat: Mail[] = [];
      const nouveaux: Mail[] = [];
      for (const brut of boite) {
        const deja = connus.get(brut.id);
        // Mails triés avec les anciennes règles (sans « expediteur ») : retriés, sans alerte.
        if (deja && !deja.expediteur) {
          resultat.push(await this.trier(brut, profs, choix, client));
          continue;
        }
        if (deja) {
          resultat.push({ ...deja, nonLu: brut.nonLu });
          continue;
        }
        const mail = await this.trier(brut, profs, choix, client);
        resultat.push(mail);
        if (!aRelire.has(brut.id)) nouveaux.push(mail);
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
  private async trier(m: MailBrut, profs: Map<string, string[]>, choix: Record<string, Categorie>, client: PartageClient): Promise<Mail> {
    const de = { deNom: viaCampus(m.deNom) ? nomSansVia(m.deNom) : m.deNom, deAdresse: m.deAdresse };
    const prof = profDe(de, profs);
    const cle = cleExpediteur(m);
    const impose = choix[cle] ?? choix[m.deAdresse.toLowerCase()] ?? choix[m.deAdresse];
    const categorie = impose ?? categorieDe({ ...m, sujet: m.sujet }, prof);
    let texte = m.extrait;
    if (categorie !== 'autre') {
      try {
        texte = (await client.texte(m.id)) || m.extrait;
      } catch (e) {
        if (e instanceof ErreurJetonPartage) throw e;
      }
    }
    return {
      id: m.id, date: m.date, sujet: m.sujet.replace(/^\s*\[moodle\]\s*/i, ''), de: (viaCampus(m.deNom) ? nomSansVia(m.deNom).replace(/^merci de ne pas répondre à ce courriel$/i, 'e-campus') : m.deNom) || m.deAdresse, adresse: m.deAdresse, categorie,
      // Les « autres » n'ont d'étiquettes que s'ils viennent d'e-campus (devoir, nouveau contenu).
      etiquettes: categorie !== 'autre' || viaCampus(m.deNom) ? etiquettesDe(`${m.sujet}\n${texte}`) : [],
      matiere: (prof ? profs.get(prof)![0] : null) ?? matiereCampus(`${m.sujet} ${texte}`) ?? null,
      expediteur: cle,
      extrait: extraitDe(texte),
      texte: categorie === 'autre' ? '' : sansHistorique(texte).slice(0, TAILLE_TEXTE),
      lien: `${this.base}/`,
      nonLu: m.nonLu,
      ...(impose ? { corrige: true } : {}),
    };
  }
}
