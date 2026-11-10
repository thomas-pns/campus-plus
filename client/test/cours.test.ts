import { describe, expect, it } from 'vitest';
import { correspond, nomCourt, poleDe, semestreDe, sigle, taille, trierSemestres, typeFichier } from '../src/cours';
import type { Cours } from '../src/types';

const cours = (nom: string, code: string, categorie: string): Cours => ({ id: 1, nom, code, categorie, sections: [] });

describe('cours', () => {
  it('lit semestre, pôle et nom court', () => {
    const c = cours('Algèbre linéaire (S5)', '26_27_3ETI_05_MSP_101_C', '3ETI_05_MSP');
    expect(semestreDe(c)).toBe('S5');
    expect(nomCourt(c)).toBe('Algèbre linéaire');
    expect(poleDe(c).nom).toBe('Maths & signal');
    expect(semestreDe(cours('Optique (S6)', 'x', ''))).toBe('S6');
    expect(semestreDe(cours('Guide LOGICIELS', 'Guide LOGICIELS', 'Espaces ETUDIANTS'))).toBe('Ressources');
    expect(poleDe(cours('Guide', 'g', 'Espaces ETUDIANTS')).nom).toBe('Autres ressources');
  });

  it('lit le pôle dans le code quand la catégorie manque (cas réel de l’API e-campus)', () => {
    expect(poleDe(cours('Algèbre linéaire (S5)', '26_27_3ETI_05_MSP_101_C', '')).nom).toBe('Maths & signal');
    expect(poleDe(cours('Logique Numérique (S5)', '26_27_3ETI_05_ELPH_001_C', '')).nom).toBe('Électronique & physique');
    expect(poleDe(cours('Python (S5)', '26_27_3ETI_05_COMSC_109_C', '')).nom).toBe('Informatique');
    expect(poleDe(cours('Anglais (S5)', '26_27_3ETI_05_L_100_C', '')).nom).toBe('Langues');
    expect(poleDe(cours('Formation Humaine (S5)', '26_27_3ETI_05_ESS_001_C', '')).nom).toBe('Formation humaine');
    expect(poleDe(cours("Stage d'exécution (S6)", '26_27_3ETI_06S_IP_001_C', '')).nom).toBe('Stages');
    expect(semestreDe(cours("Stage d'exécution", '26_27_3ETI_06S_IP_001_C', ''))).toBe('S6');
  });

  it('range les semestres dans l’ordre, ressources à la fin', () => {
    expect(trierSemestres(['Ressources', 'S6', 'S5', 'S5'])).toEqual(['S5', 'S6', 'Ressources']);
  });

  it('fait des sigles lisibles', () => {
    expect(sigle(cours('Algèbre linéaire (S5)', '', ''))).toBe('AL');
    expect(sigle(cours('Bases de la physique quantique (S5)', '', ''))).toBe('BP');
    expect(sigle(cours('LV2 (S5)', '', ''))).toBe('LV');
    expect(sigle(cours('Anglais (S5)', '', ''))).toBe('AN');
  });

  it('écrit les tailles et les types', () => {
    expect(taille(512)).toBe('512 o');
    expect(taille(48_000)).toBe('48 Ko');
    expect(taille(2_400_000)).toBe('2,4 Mo');
    expect(taille(24_000_000)).toBe('24 Mo');
    expect(typeFichier({ nom: 'td1.pdf' } as never)).toBe('PDF');
    expect(typeFichier({ nom: 'Makefile' } as never)).toBe('Fichier');
  });

  it('cherche sans accents ni majuscules, tous les mots', () => {
    expect(correspond('Algèbre linéaire · Poly', 'algebre poly')).toBe(true);
    expect(correspond('Algèbre linéaire · Poly', 'algebre td')).toBe(false);
  });
});

import { classer, parType } from '../src/cours';
import type { Fichier } from '../src/types';

const f = (nom: string, dossier = ''): Fichier => ({ cle: nom, nom, dossier, taille: 1, modifie: 0, type: '' });

describe('tri par type', () => {
  it('lit le nom du fichier en premier', () => {
    expect(classer(f('td3.pdf'), 'Documents', 'Cours')).toBe('td');
    expect(classer(f('TD_3_correction.pdf'), 'TD', 'TD')).toBe('corriges');
    expect(classer(f('Corrigé TD2.pdf'), 'TD', 'TD')).toBe('corriges');
    expect(classer(f('Sujet_partiel_2024.pdf'), 'x', 'y')).toBe('annales');
    expect(classer(f('DS1-2023.pdf'), 'x', 'y')).toBe('annales');
    expect(classer(f('partiel_2024_corrige.pdf'), 'x', 'y')).toBe('annales'); // avec son sujet
    expect(classer(f('TP2-filtrage.pdf'), 'x', 'y')).toBe('tp');
    expect(classer(f('Chapitre 4 - diagonalisation.pdf'), 'x', 'y')).toBe('cours');
    expect(classer(f('poly-algebre.pdf'), 'x', 'y')).toBe('cours');
    expect(classer(f('Exercices supplémentaires.pdf'), 'x', 'y')).toBe('td');
  });

  it('se rabat sur l’élément, puis la section', () => {
    expect(classer(f('doc_final_v2.pdf'), 'TD 4', 'Semaine 3')).toBe('td');
    expect(classer(f('partie3.pdf'), 'Documents', 'Annales des années précédentes')).toBe('annales');
    expect(classer(f('img001.pdf'), 'Ressource', 'Généralités')).toBe('autres');
  });

  it('ne se trompe pas sur des mots qui contiennent les sigles', () => {
    expect(classer(f('studio.pdf'), 'x', 'y')).toBe('autres'); // « td » dans « studio »
    expect(classer(f('optique.pdf'), 'x', 'y')).toBe('autres'); // « tp » dans « optique »
    expect(classer(f('dessin.pdf'), 'x', 'y')).toBe('autres'); // « ds » dans « dessin »
  });

  it('regroupe un cours par type, dans l’ordre, en triant les noms naturellement', () => {
    const c = { id: 1, nom: 'X', code: '', categorie: '', sections: [
      { nom: 'Cours', elements: [{ id: 1, nom: 'Poly', type: 'resource', lien: '', fichiers: [f('poly.pdf')] }] },
      { nom: 'TD', elements: [{ id: 2, nom: 'TD', type: 'folder', lien: '', fichiers: [f('td10.pdf'), f('td2.pdf'), f('correction td2.pdf')] }] },
    ] };
    expect(parType(c).map((g) => [g.type.id, g.fichiers.map((x) => x.f.nom)])).toEqual([
      ['cours', ['poly.pdf']],
      ['td', ['td2.pdf', 'td10.pdf']],
      ['corriges', ['correction td2.pdf']],
    ]);
  });
});
