/**
 * Démo sans compte CPE : `npm run demo` (après `npm run build` dans client/).
 * Lance un faux MyCPE rempli de données inventées, puis le serveur Campus+ branché dessus.
 * Identifiant : demo — mot de passe : demo
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { FauxAurion, type EvenementFaux } from './faux-aurion.js';
import { Coffre } from '../src/coffre.js';
import { Depot } from '../src/depot.js';
import { Comptes } from '../src/comptes.js';
import { Synchro } from '../src/synchro.js';
import { AurionClient } from '../src/sources/aurion.js';
import { creerApp } from '../src/api.js';
import { Notifications } from '../src/notifications.js';

const jourPlus = (lundi: Date, n: number) => {
  const d = new Date(lundi.getTime() + n * 86_400_000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
};
const maintenant = new Date();
const lundi = new Date(Date.UTC(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate() - ((maintenant.getDay() + 6) % 7)));

type Modele = [jour: number, debut: string, fin: string, classe: string, salle: string, groupe: string, matiere: string, type: string, prof: string, ...remarques: string[]];
const SEMAINE: Modele[] = [
  [0, '08:00', '10:00', 'N01_COURS', 'F008', '3ETI', 'Signaux analogiques et numériques', 'Cours', 'LEFEVRE Marc'],
  [0, '10:15', '12:15', 'N01_COURS', 'F006 / F007', '3ETI', 'Électronique analogique', 'Cours', 'ROUSSEL Anne'],
  [0, '13:30', '15:30', 'N01_TD', 'F002', '3ETI GRA', 'Électronique analogique', 'TD', 'ROUSSEL Anne'],
  [0, '15:45', '17:45', 'N01_TD', 'F007', '3ETI GRA', 'Algèbre linéaire', 'TD', 'DUPONT Alice'],
  [1, '08:00', '10:00', 'N01_COURS', 'F008', '3ETI', 'Logique numérique', 'Cours', 'MARTIN Paul'],
  [1, '10:30', '12:00', 'N01_EXAMEN', 'F004 / F005 / F008', '3ETI', 'Physique des semi-conducteurs', 'Examen ', 'DUPONT Alice / GIRARD Luc', 'De Hugo ABADIE à Zoé LEROY inclus en salle Salle F004_F005', 'De Nina MARCHAND à Yann ZIMMER inclus en Salle F008'],
  [1, '13:30', '15:30', 'N01_COURS_LANGUES', 'F001', '3ETI 600GR1', 'LV2', 'Langues', 'WANG Li'],
  [1, '15:45', '17:45', 'N01_COURS_FHES', 'Grand Amphi', '3ETI GR2', 'SHES', 'Cours FHES', 'MOREAU Jean'],
  [3, '08:00', '10:00', 'N01_TD', 'H001', '3ETI GRA', 'Signaux analogiques et numériques', 'TD', 'LEFEVRE Marc'],
  [3, '10:15', '12:15', 'N01_TP_LABO', 'I105', '3ETI GRA', 'Signaux analogiques et numériques', 'TP', 'LEFEVRE Marc'],
  [3, '13:30', '15:30', 'N01_COURS', 'F008', '3ETI', 'Algèbre linéaire', 'Cours', 'DUPONT Alice'],
  [4, '08:00', '12:15', 'N01_TP_LABO', 'G103', '3ETI GRA', 'Techniques et langages du Web', 'TP', 'PETIT Hugo'],
  [4, '13:30', '15:00', 'N02_AUTONOMIE', 'H001', '3ETI', 'Non pédagogique', 'Autonomie', ''],
  [4, '15:45', '17:45', 'N01_SPORT', 'Gymnase', '3ETI', 'Sport', 'Sport', ''],
];
const evenements: EvenementFaux[] = [-7, 0, 7, 14].flatMap((decalage) => SEMAINE.map(([j, debut, fin, className, salle, groupe, matiere, type, prof, ...remarques]) => ({
  title: [salle, groupe, matiere, type, prof, ...remarques, ''].join('\n'),
  start: `${jourPlus(lundi, j + decalage)}T${debut}:00+0100`,
  end: `${jourPlus(lundi, j + decalage)}T${fin}:00+0100`,
  className,
})));

const faux = new FauxAurion({
  identifiant: 'demo', motDePasse: 'demo', nom: 'Camille BERNARD--COSTE', evenements,
  notes: [
    ['26_27 - Semestre 5', 'Électronique et sciences physiques', 'Physique des semi-conducteurs', 'P1 - Ecrit 1', '50', '8,5', ''],
    ['26_27 - Semestre 5', 'Électronique et sciences physiques', 'Physique des semi-conducteurs', 'P1 - Ecrit 2', '50', '', ''],
    ['26_27 - Semestre 5', 'Électronique et sciences physiques', 'Logique numérique', 'TP noté', '30', '15', ''],
    ['26_27 - Semestre 5', 'Mathématiques et signal', 'Algèbre linéaire', 'Ecrit 1', '50', '12,5', ''],
    ['26_27 - Semestre 5', 'Mathématiques et signal', 'Algèbre linéaire', 'Ecrit 2', '50', '14', ''],
  ],
  absences: [],
});
const aurionBase = await faux.demarrer();

const coffre = new Coffre(randomBytes(32));
const depot = new Depot(await mkdtemp(join(tmpdir(), 'campus-demo-')), coffre);
const comptes = new Comptes(depot, coffre);
const fabriqueAurion = () => new AurionClient(aurionBase);
const notifications = await Notifications.demarrer(depot, coffre, await mkdtemp(join(tmpdir(), 'campus-demo-vapid-')));
const synchro = new Synchro(depot, comptes, fabriqueAurion, { minutes: 15, surNouvellesAlertes: (id, a) => notifications.alertes(id, a) });
const app = await creerApp({ depot, comptes, synchro, notifications, fabriqueAurion, cookieSecurise: false, dossierClient: process.env.CLIENT_DIR ?? '../client/dist' });
const port = Number(process.env.PORT ?? 8787);
await app.listen({ port, host: '127.0.0.1' });
console.log(`Démo : http://localhost:${port}  (identifiant « demo », mot de passe « demo »)`);

// Pour montrer les alertes : `kill -USR2 <pid>` déplace un cours et publie une note (sauf sous Windows).
process.on('SIGUSR2', () => {
  const prochain = faux.donnees.evenements.find((e) => Date.parse(e.start.replace('+0100', '+01:00')) > Date.now() && e.className === 'N01_COURS');
  if (prochain) prochain.title = prochain.title.replace(/^[^\n]+/, 'Amphi B');
  faux.donnees.notes[1][5] = '13';
  console.log('Données de démo modifiées : une salle changée, une note publiée.');
});
