/**
 * Alertes : ce qui a changé entre deux synchros (salle, horaire, cours supprimé ou ajouté, note publiée).
 * Fonctions pures, faciles à tester.
 */
import { createHash } from 'node:crypto';
import type { Evenement } from './sources/planning.js';
import type { Note } from './sources/aurion.js';

export type TypeAlerte = 'salle' | 'horaire' | 'supprime' | 'ajoute' | 'note' | 'fichier' | 'devoir';

export interface Alerte {
  id: string;
  type: TypeAlerte;
  /** Date de détection. */
  date: string;
  titre: string;
  detail: string;
  /** Clé stable de l'événement concerné, s'il y en a un. */
  cleEvenement?: string;
  /** Cours e-campus concerné (alertes « fichier »). */
  cours?: number;
}

/** On ne signale que les changements proches : au-delà, le planning bouge encore beaucoup. */
export const HORIZON_JOURS = 14;

const heure = (iso: string) => iso.slice(11, 16).replace(':', 'h');
const jour = (iso: string) => {
  const [a, m, j] = iso.slice(0, 10).split('-');
  return `${j}/${m}/${a}`;
};
const quand = (e: Evenement) => `${jour(e.debut)} à ${heure(e.debut)}`;
const libelle = (e: Evenement) => (e.type && e.type !== e.matiere ? `${e.matiere} (${e.type.trim()})` : e.matiere);
const identifiant = (...morceaux: string[]) => createHash('sha256').update(morceaux.join('|')).digest('hex').slice(0, 16);

/** Regroupe par clé stable ; deux créneaux identiques dans des salles différentes sont fusionnés. */
function parCle(evts: Evenement[]): Map<string, Evenement> {
  const m = new Map<string, Evenement>();
  for (const e of evts) {
    const deja = m.get(e.cle);
    m.set(e.cle, deja ? { ...deja, salles: [...new Set([...deja.salles, ...e.salles])] } : e);
  }
  return m;
}

export function comparerPlanning(avant: Evenement[], apres: Evenement[], maintenant: Date): Alerte[] {
  const debutFenetre = maintenant.getTime();
  const finFenetre = debutFenetre + HORIZON_JOURS * 24 * 3600 * 1000;
  const proche = (e: Evenement) => {
    const t = Date.parse(e.debut);
    return t >= debutFenetre && t <= finFenetre;
  };
  const date = maintenant.toISOString();
  const a = parCle(avant.filter(proche));
  const b = parCle(apres.filter(proche));
  const alertes: Alerte[] = [];

  for (const [cle, e] of b) {
    const ancien = a.get(cle);
    if (!ancien) {
      alertes.push({
        id: identifiant('ajoute', cle), type: 'ajoute', date, cleEvenement: cle,
        titre: e.categorie === 'examen' ? `Nouvel examen : ${e.matiere}` : `Nouveau créneau : ${libelle(e)}`,
        detail: `${quand(e)}${e.salles.length ? `, salle ${e.salles.join(' / ')}` : ''}`,
      });
      continue;
    }
    const s1 = [...ancien.salles].sort().join(' / ');
    const s2 = [...e.salles].sort().join(' / ');
    if (s1 !== s2) {
      alertes.push({
        id: identifiant('salle', cle, s2), type: 'salle', date, cleEvenement: cle,
        titre: `Changement de salle : ${libelle(e)}`,
        detail: `${quand(e)} : ${s2 || 'salle non précisée'} au lieu de ${s1 || 'salle non précisée'}`,
      });
    }
    if (ancien.fin !== e.fin) {
      alertes.push({
        id: identifiant('horaire', cle, e.fin), type: 'horaire', date, cleEvenement: cle,
        titre: `Horaire modifié : ${libelle(e)}`,
        detail: `${quand(e)} : fin à ${heure(e.fin)} au lieu de ${heure(ancien.fin)}`,
      });
    }
  }
  for (const [cle, e] of a) {
    if (b.has(cle)) continue;
    alertes.push({
      id: identifiant('supprime', cle), type: 'supprime', date, cleEvenement: cle,
      titre: `Créneau supprimé ou déplacé : ${libelle(e)}`,
      detail: `Il était prévu le ${quand(e)}`,
    });
  }
  return alertes;
}

const cleNote = (n: Note) => [n.semestre, n.cours, n.epreuve].join('|');

export function comparerNotes(avant: Note[], apres: Note[], maintenant: Date): Alerte[] {
  const anciennes = new Map(avant.map((n) => [cleNote(n), n]));
  const date = maintenant.toISOString();
  const alertes: Alerte[] = [];
  for (const n of apres) {
    if (n.note === null) continue;
    const ancienne = anciennes.get(cleNote(n));
    if (ancienne && ancienne.note === n.note) continue;
    alertes.push({
      id: identifiant('note', cleNote(n), String(n.note)), type: 'note', date,
      titre: ancienne && ancienne.note !== null ? `Note modifiée : ${n.cours}` : `Note publiée : ${n.cours}`,
      detail: `${n.epreuve} : ${String(n.note).replace('.', ',')}/20`,
    });
  }
  return alertes;
}

/* ---------- Moyennes ---------- */

export interface MoyenneCours {
  semestre: string;
  module: string;
  cours: string;
  /** Moyenne pondérée par les coefficients des épreuves notées ; null si aucune note. */
  moyenne: number | null;
  epreuvesNotees: number;
}

export function moyennesParCours(notes: Note[]): MoyenneCours[] {
  const groupes = new Map<string, { base: Pick<MoyenneCours, 'semestre' | 'module' | 'cours'>; somme: number; poids: number; n: number }>();
  for (const n of notes) {
    const cle = [n.semestre, n.module, n.cours].join('|');
    const g = groupes.get(cle) ?? { base: { semestre: n.semestre, module: n.module, cours: n.cours }, somme: 0, poids: 0, n: 0 };
    if (n.note !== null) {
      const poids = n.coefficient && n.coefficient > 0 ? n.coefficient : 1;
      g.somme += n.note * poids;
      g.poids += poids;
      g.n++;
    }
    groupes.set(cle, g);
  }
  return [...groupes.values()].map((g) => ({
    ...g.base,
    moyenne: g.poids ? Math.round((g.somme / g.poids) * 100) / 100 : null,
    epreuvesNotees: g.n,
  }));
}

/* ---------- Cours e-campus ---------- */

interface FichierIndexe { cle: string; nom: string; adresse: string }
interface CoursIndexe { id: number; nom: string; sections: { nom: string; elements: { nom: string; fichiers: FichierIndexe[] }[] }[] }

/** Nouveaux fichiers (adresse jamais vue) et fichiers mis à jour (même adresse, nouvelle version). */
export function comparerCours(avant: CoursIndexe[], apres: CoursIndexe[], maintenant: Date): Alerte[] {
  const anciennes = new Map<string, string>();
  for (const c of avant) for (const s of c.sections) for (const e of s.elements) for (const f of e.fichiers) anciennes.set(f.adresse, f.cle);
  const date = maintenant.toISOString();
  const alertes: Alerte[] = [];
  for (const c of apres) {
    for (const s of c.sections) {
      for (const e of s.elements) {
        for (const f of e.fichiers) {
          const ancienne = anciennes.get(f.adresse);
          if (ancienne === f.cle) continue;
          alertes.push({
            id: identifiant('fichier', f.cle), type: 'fichier', date,
            titre: `${ancienne ? 'Fichier mis à jour' : 'Nouveau fichier'} : ${c.nom}`,
            detail: `${f.nom} · ${s.nom}`,
            cours: c.id,
          });
        }
      }
    }
  }
  return alertes;
}

interface EcheanceIndexee { id: number; nom: string; nomCours: string; cours: number; date: number }

const dateCourte = (secondes: number) => new Intl.DateTimeFormat('fr-FR', {
  timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
}).format(secondes * 1000);

/** Nouveaux devoirs, et devoirs dont la date limite a changé. */
export function comparerEcheances(avant: EcheanceIndexee[], apres: EcheanceIndexee[], maintenant: Date): Alerte[] {
  const anciennes = new Map(avant.map((e) => [e.id, e]));
  const date = maintenant.toISOString();
  const alertes: Alerte[] = [];
  for (const e of apres) {
    if (e.date * 1000 < maintenant.getTime()) continue;
    const ancienne = anciennes.get(e.id);
    if (ancienne && ancienne.date === e.date) continue;
    alertes.push({
      id: identifiant('devoir', String(e.id), String(e.date)), type: 'devoir', date, cours: e.cours,
      titre: `${ancienne ? 'Date limite modifiée' : 'Nouveau devoir'} : ${e.nom}`,
      detail: `${e.nomCours} · à rendre ${dateCourte(e.date)}`,
    });
  }
  return alertes;
}
