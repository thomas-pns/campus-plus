/** Logique de l'écran Devoirs : une liste unique (devoirs e-campus + tâches perso), rangée par échéance. */
import type { Echeance, Tache } from './types';
import { ajouterJours, jourParis, lundiDe } from './dates';

export interface Ligne {
  cle: string;
  titre: string;
  sous: string;
  /** Jour de l'échéance « AAAA-MM-JJ », ou null pour « sans date ». */
  jour: string | null;
  /** Heure « HH:MM » pour les devoirs e-campus. */
  heure: string | null;
  fait: boolean;
  enRetard: boolean;
  source: { type: 'echeance'; e: Echeance } | { type: 'tache'; t: Tache };
}

const PARIS = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const LIBELLE_MODULE: Record<string, string> = { assign: 'Devoir', quiz: 'Test', workshop: 'Atelier', forum: 'Forum', lesson: 'Leçon', choice: 'Sondage', feedback: 'Questionnaire' };

export function lignes(echeances: Echeance[], taches: Tache[], maintenant: number): Ligne[] {
  const aujourdhui = jourParis(maintenant);
  const a = echeances.map((e): Ligne => ({
    cle: `e${e.id}`, titre: e.nom,
    sous: [LIBELLE_MODULE[e.module] ?? 'Activité', e.nomCours.replace(/\s*\(S\d+\)$/, '')].join(' · '),
    jour: jourParis(e.date * 1000), heure: PARIS.format(e.date * 1000), fait: e.fait,
    enRetard: !e.fait && e.date * 1000 < maintenant, source: { type: 'echeance', e },
  }));
  const b = taches.map((t): Ligne => ({
    cle: `t${t.id}`, titre: t.titre, sous: 'Ajouté par toi', jour: t.echeance, heure: null, fait: t.fait,
    enRetard: !t.fait && !!t.echeance && t.echeance < aujourdhui, source: { type: 'tache', t },
  }));
  return [...a, ...b].sort((x, y) => (x.jour ?? '9999').localeCompare(y.jour ?? '9999') || (x.heure ?? '').localeCompare(y.heure ?? '') || x.titre.localeCompare(y.titre));
}

export type Groupe = 'retard' | 'aujourdhui' | 'semaine' | 'plusTard' | 'sansDate' | 'faits';
export const NOMS_GROUPES: Record<Groupe, string> = {
  retard: 'En retard', aujourdhui: "Aujourd'hui", semaine: 'Cette semaine', plusTard: 'Plus tard', sansDate: 'Sans date', faits: 'Faits',
};

export function grouper(liste: Ligne[], maintenant: number): [Groupe, Ligne[]][] {
  const aujourdhui = jourParis(maintenant);
  const dimanche = ajouterJours(lundiDe(aujourdhui), 6);
  const groupe = (l: Ligne): Groupe => {
    if (l.fait) return 'faits';
    if (l.enRetard) return 'retard';
    if (!l.jour) return 'sansDate';
    if (l.jour === aujourdhui) return 'aujourdhui';
    return l.jour <= dimanche ? 'semaine' : 'plusTard';
  };
  const ordre: Groupe[] = ['retard', 'aujourdhui', 'semaine', 'plusTard', 'sansDate', 'faits'];
  const res = new Map<Groupe, Ligne[]>();
  for (const l of liste) res.set(groupe(l), [...(res.get(groupe(l)) ?? []), l]);
  // Les faits : les plus récents d'abord, et pas plus de 20.
  if (res.has('faits')) res.set('faits', res.get('faits')!.reverse().slice(0, 20));
  return ordre.filter((g) => res.has(g)).map((g) => [g, res.get(g)!]);
}

/** Ce qu'on montre sur l'écran Aujourd'hui : non faits, en retard ou dans les 7 jours, au plus 3. */
export function aVenir(liste: Ligne[], maintenant: number): Ligne[] {
  const limite = ajouterJours(jourParis(maintenant), 7);
  return liste.filter((l) => !l.fait && (l.enRetard || (l.jour !== null && l.jour <= limite))).slice(0, 3);
}
