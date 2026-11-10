import { describe, expect, it } from 'vitest';
import { correspond, nomCourt, poleDe, semestreDe, sigle, taille, typeFichier } from '../src/cours';
import type { Cours } from '../src/types';

const cours = (nom: string, code: string, categorie: string): Cours => ({ id: 1, nom, code, categorie, sections: [] });

describe('cours', () => {
  it('lit semestre, pôle et nom court', () => {
    const c = cours('Algèbre linéaire (S5)', '26_27_3ETI_05_MSP_101_C', '3ETI_05_MSP');
    expect(semestreDe(c)).toBe('S5');
    expect(nomCourt(c)).toBe('Algèbre linéaire');
    expect(poleDe(c).nom).toBe('Maths & signal');
    expect(semestreDe(cours('Optique (S6)', 'x', ''))).toBe('S6');
    expect(semestreDe(cours('Guide LOGICIELS', 'Guide LOGICIELS', 'Espaces ETUDIANTS'))).toBe('Autres');
    expect(poleDe(cours('Guide', 'g', 'Espaces ETUDIANTS')).nom).toBe('Autres ressources');
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
