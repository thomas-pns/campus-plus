/**
 * Transforme les événements bruts du planning WebAurion en objets propres.
 *
 * Un événement brut ressemble à :
 *   { id, title: "F008\n3ETI\nAlgèbre linéaire\nCours\nNOM Prénom\n\n", start, end, className: "N01_COURS" }
 * Les lignes du titre sont : salle(s), groupe, matière, type, intervenant(s), puis des remarques libres.
 */

export type Categorie =
  | 'cours' | 'td' | 'tp' | 'langues' | 'fhes' | 'examen' | 'sport'
  | 'autonomie' | 'presentation' | 'evenement' | 'reunion' | 'autre';

export interface EvenementBrut {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  className?: string;
}

export interface Evenement {
  id: string;
  debut: string;
  fin: string;
  categorie: Categorie;
  classeAurion: string;
  salles: string[];
  groupe: string;
  matiere: string;
  type: string;
  intervenants: string[];
  remarques: string[];
}

const CATEGORIES: Record<string, Categorie> = {
  N01_COURS: 'cours',
  N01_TD: 'td',
  N01_TP_LABO: 'tp',
  N01_COURS_LANGUES: 'langues',
  N01_COURS_FHES: 'fhes',
  N01_EXAMEN: 'examen',
  N01_EXAMEN_MACHINE: 'examen',
  N01_SPORT: 'sport',
  N02_AUTONOMIE: 'autonomie',
  N02_PRESENTATION: 'presentation',
  N02_BDE: 'evenement',
  N02_EVT_CPE: 'evenement',
  N02_RENTREE: 'evenement',
  N04_REUNION: 'reunion',
};

export function categorieDe(classe = ''): Categorie {
  return CATEGORIES[classe.trim()] ?? 'autre';
}

const separerListe = (ligne: string) =>
  ligne.split('/').map((s) => s.trim()).filter(Boolean);

export function lireEvenement(brut: EvenementBrut): Evenement {
  const lignes = brut.title.split('\n').map((l) => l.trim());
  const [salles = '', groupe = '', matiere = '', type = '', intervenants = '', ...reste] = lignes;
  return {
    id: brut.id,
    debut: brut.start,
    fin: brut.end,
    categorie: categorieDe(brut.className),
    classeAurion: brut.className ?? '',
    salles: separerListe(salles),
    groupe,
    matiere,
    type,
    intervenants: separerListe(intervenants),
    remarques: reste.filter(Boolean),
  };
}

/** Extrait le JSON `{"events":[…]}` de la réponse AJAX PrimeFaces (XML partial-response). */
export function extraireEvenements(reponseAjax: string): EvenementBrut[] {
  const debut = reponseAjax.indexOf('{"events"');
  if (debut < 0) return [];
  // Le JSON se termine par "]}" ; on cherche la fin équilibrée pour ne pas dépendre du CDATA.
  let profondeur = 0;
  let dansChaine = false;
  for (let i = debut; i < reponseAjax.length; i++) {
    const c = reponseAjax[i];
    if (dansChaine) {
      if (c === '\\') i++;
      else if (c === '"') dansChaine = false;
      continue;
    }
    if (c === '"') dansChaine = true;
    else if (c === '{' || c === '[') profondeur++;
    else if (c === '}' || c === ']') {
      profondeur--;
      if (profondeur === 0) return JSON.parse(reponseAjax.slice(debut, i + 1)).events ?? [];
    }
  }
  return [];
}

/* ---------- Salle d'examen personnelle ---------- */

/** Met un nom en forme comparable : majuscules, sans accents, tirets et espaces normalisés. */
export function normaliserNom(nom: string): string {
  return nom
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[—–-]+/g, ' ')
    .replace(/[^A-Z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Le nom de famille est le dernier mot (ou les mots en MAJUSCULES s'il y en a). */
function nomDeFamille(nomComplet: string): string {
  const mots = nomComplet.trim().split(/\s+/);
  const majuscules = mots.filter((m) => m.length > 1 && m === m.toUpperCase() && /[A-Z]/.test(m));
  return normaliserNom(majuscules.length ? majuscules.join(' ') : mots[mots.length - 1] ?? '');
}

function normaliserSalle(salle: string): string[] {
  return salle
    .replace(/^salles?\s+/i, '')
    .split(/\s*[_\/-]\s*|\s+et\s+/i)
    .map((s) => s.trim().toUpperCase())
    .filter((s) => /^[A-Z]{1,2}\d{3}$/.test(s));
}

export interface Repartition {
  de: string;
  a: string;
  salles: string[];
}

const RE_DE_A_EN_SALLE = /de\s+(.+?)\s+à\s+(.+?)\s+(?:inclus\s+)?en\s+(?:salle\s+)?(?:salle\s+)?([A-Z]\d{3}(?:\s*[_\/-]\s*[A-Z]?\d{3})*)/i;
const RE_SALLES_DEUX_POINTS = /salles?\s+([A-Z]\d{3}(?:\s*[_\/-]\s*[A-Z]?\d{3})*)\s*:\s*de\s+(.+?)\s+à\s+(.+?)(?:\s+\+|\s*$)/i;

/** Lit les plages « De X à Y en salle Z » présentes dans les remarques d'un examen. */
export function lireRepartition(remarques: string[]): Repartition[] {
  const res: Repartition[] = [];
  for (const ligne of remarques) {
    let m = ligne.match(RE_SALLES_DEUX_POINTS);
    if (m) {
      res.push({ de: nomDeFamille(m[2]), a: nomDeFamille(m[3]), salles: normaliserSalle(m[1]) });
      continue;
    }
    m = ligne.match(RE_DE_A_EN_SALLE);
    if (m) res.push({ de: nomDeFamille(m[1]), a: nomDeFamille(m[2]), salles: normaliserSalle(m[3]) });
  }
  return res;
}

/** Renvoie les salles de l'élève pour un examen, ou null si la répartition ne permet pas de conclure. */
export function salleExamenPour(evt: Evenement, nomEleve: string): string[] | null {
  const nom = normaliserNom(nomEleve);
  for (const r of lireRepartition(evt.remarques)) {
    if (nom.localeCompare(r.de) >= 0 && nom.localeCompare(r.a) <= 0) return r.salles;
  }
  return null;
}
