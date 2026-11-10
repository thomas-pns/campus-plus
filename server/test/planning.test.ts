import { describe, expect, it } from 'vitest';
import {
  extraireEvenements, lireEvenement, lireRepartition, normaliserNom, salleExamenPour,
} from '../src/sources/planning.js';

// Données fictives : même format que WebAurion, noms et salles inventés.
const REPONSE = `<?xml version='1.0' encoding='UTF-8'?>
<partial-response><changes><update id="form:j_idt118"><![CDATA[{"events" : [
{"id":"a1","title":"F008\\n3ETI\\nAlgèbre linéaire\\nCours\\nDUPONT Alice\\n\\n","start":"2026-11-02T08:00:00+0100","end":"2026-11-02T10:00:00+0100","allDay":false,"editable":true,"className":"N01_COURS"},
{"id":"a2","title":"I105\\n3ETI GRA\\nLogique Numérique\\nTP\\nMARTIN Paul / DURAND Léa\\nTP-ELN1\\n","start":"2026-11-02T13:30:00+0100","end":"2026-11-02T17:45:00+0100","allDay":false,"editable":true,"className":"N01_TP_LABO"},
{"id":"a3","title":"F004 / F005 / F008\\n3ETI\\nPhysique\\nExamen \\nDUPONT Alice\\nPour tous les autres étudiants\\nDe Hugo ABADIE à Zoé LEROY inclus en salle Salle F004_F005\\nDe Nina MARCHAND à Yann ZIMMER inclus en Salle F008\\n","start":"2026-11-10T10:30:00+0100","end":"2026-11-10T12:00:00+0100","allDay":false,"editable":true,"className":"N01_EXAMEN"}
]}]]></update></changes></partial-response>`;

describe('planning WebAurion', () => {
  const evts = extraireEvenements(REPONSE).map(lireEvenement);

  it('extrait tous les événements', () => {
    expect(evts).toHaveLength(3);
  });

  it('donne une clé stable, indépendante de l’id WebAurion', () => {
    const encore = extraireEvenements(REPONSE.replace('"id":"a1"', '"id":"zz"')).map(lireEvenement);
    expect(encore[0].id).toBe('zz');
    expect(encore[0].cle).toBe(evts[0].cle);
    expect(new Set(evts.map((e) => e.cle)).size).toBe(3);
  });

  it('écrit les dates au format ISO strict (lisible par Safari)', () => {
    expect(evts[0].debut).toBe('2026-11-02T08:00:00+01:00');
    expect(evts[0].fin).toBe('2026-11-02T10:00:00+01:00');
  });

  it('découpe le titre en champs', () => {
    expect(evts[0]).toMatchObject({ salles: ['F008'], groupe: '3ETI', matiere: 'Algèbre linéaire', type: 'Cours', categorie: 'cours' });
    expect(evts[1].intervenants).toEqual(['MARTIN Paul', 'DURAND Léa']);
    expect(evts[1].remarques).toEqual(['TP-ELN1']);
    expect(evts[2].categorie).toBe('examen');
  });

  it('lit la répartition des salles d’examen', () => {
    expect(lireRepartition(evts[2].remarques)).toEqual([
      { de: 'ABADIE', a: 'LEROY', salles: ['F004', 'F005'] },
      { de: 'MARCHAND', a: 'ZIMMER', salles: ['F008'] },
    ]);
  });

  it('trouve la salle de l’élève', () => {
    expect(salleExamenPour(evts[2], 'BERNARD--COSTE')).toEqual(['F004', 'F005']);
    expect(salleExamenPour(evts[2], 'Petit')).toEqual(['F008']);
    expect(salleExamenPour(evts[2], 'Camille BERNARD--COSTE')).toEqual(['F004', 'F005']);
    expect(salleExamenPour(evts[2], '')).toBeNull();
    expect(salleExamenPour(evts[1], 'Petit')).toBeNull();
  });

  it('accepte la forme « Salles X-Y : de A à B »', () => {
    expect(lireRepartition(['  Salles F004-F005 : de Hugo ABADIE à Zoé LEROY'])).toEqual([
      { de: 'ABADIE', a: 'LEROY', salles: ['F004', 'F005'] },
    ]);
  });

  it('tolère un espace après le séparateur de salles', () => {
    expect(lireRepartition(['De Hugo Abadie à Zoé LEROY inclus en Salle F002_ F003'])[0].salles).toEqual(['F002', 'F003']);
  });

  it('normalise les noms composés et accentués', () => {
    expect(normaliserNom('Éloïse  Bernard--Coste')).toBe('ELOISE BERNARD COSTE');
  });
});
