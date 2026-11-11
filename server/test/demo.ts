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
import { Taches } from '../src/taches.js';
import { SynchroMails } from '../src/mails.js';
import { PartageClient } from '../src/sources/partage.js';
import { FauxPartage, mailsFaux } from './faux-partage.js';
import { SynchroCours } from '../src/cours.js';
import { MoodleClient } from '../src/sources/moodle.js';
import { coursFaux, FauxMoodle } from './faux-moodle.js';

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

const moodle = new FauxMoodle();
moodle.identifiant = 'demo';
moodle.motDePasse = 'demo';
moodle.cours = coursFaux();
// Un cours plus fourni, rangé comme le font souvent les profs, pour montrer le tri par type.
moodle.cours.push({
  id: 4286, fullname: 'Signaux Analogiques et Numériques (S5) * 26_27_3ETI_05_MSP_103_C', shortname: '26_27_3ETI_05_MSP_103_C', categoryname: '3ETI_05_MSP',
  sections: [
    { nom: 'Semaine 1', elements: [
      { id: 20, nom: 'Documents', type: 'folder', fichiers: [
        { nom: 'Chapitre1_Fourier.pdf', contenu: '%PDF-1.4 a', modifie: 1_790_000_000 },
        { nom: 'td1_enonce.pdf', contenu: '%PDF-1.4 b', modifie: 1_790_000_000 },
        { nom: 'td1_correction.pdf', contenu: '%PDF-1.4 c', modifie: 1_790_000_000 },
      ] },
    ] },
    { nom: 'Semaine 2', elements: [
      { id: 21, nom: 'Slides cours 2', type: 'resource', fichiers: [{ nom: 'cours2.pdf', contenu: '%PDF-1.4 d', modifie: 1_790_000_000 }] },
      { id: 22, nom: 'TP filtrage', type: 'resource', fichiers: [{ nom: 'TP2-filtrage.pdf', contenu: '%PDF-1.4 e', modifie: 1_790_000_000 }] },
    ] },
    { nom: 'Préparer le partiel', elements: [
      { id: 23, nom: 'Annales', type: 'folder', fichiers: [
        { nom: 'partiel_2024.pdf', contenu: '%PDF-1.4 f', modifie: 1_790_000_000 },
        { nom: 'partiel_2024_corrige.pdf', contenu: '%PDF-1.4 g', modifie: 1_790_000_000 },
      ] },
      { id: 24, nom: 'Questions sur le cours', type: 'forum' },
    ] },
  ],
});
const dans = (jours: number, heure: number) => {
  const d = new Date();
  d.setDate(d.getDate() + jours);
  d.setHours(heure, 59, 0, 0);
  return Math.floor(d.getTime() / 1000);
};
moodle.echeances = [
  { id: 501, nom: 'Exercices semaine 45', module: 'assign', cours: 4280, date: dans(-2, 23), enRetard: true },
  { id: 502, nom: 'QCM chapitre 3', module: 'quiz', cours: 4280, date: dans(1, 8) },
  { id: 503, nom: 'Compte rendu TP filtrage', module: 'assign', cours: 4286, date: dans(3, 23) },
  { id: 504, nom: 'Projet : site web', module: 'assign', cours: 4286, date: dans(20, 18) },
];
const adressesMoodle = await moodle.demarrer();
const partage = new FauxPartage();
partage.adresse = 'demo';
partage.motDePasse = 'demo';
partage.mails = mailsFaux(Date.now()).map((m) => (m.deNom.includes('DUPONT') ? m : m));
const basePartage = await partage.demarrer();

const coffre = new Coffre(randomBytes(32));
const depot = new Depot(await mkdtemp(join(tmpdir(), 'campus-demo-')), coffre);
const comptes = new Comptes(depot, coffre);
const fabriqueAurion = () => new AurionClient(aurionBase);
const notifications = await Notifications.demarrer(depot, coffre, await mkdtemp(join(tmpdir(), 'campus-demo-vapid-')));
const dossierDemo = await mkdtemp(join(tmpdir(), 'campus-demo-fichiers-'));
const cours = new SynchroCours(depot, comptes, coffre, dossierDemo, () => new MoodleClient(adressesMoodle), { surNouvellesAlertes: (id, a) => notifications.alertes(id, a) });
const mails = new SynchroMails(depot, comptes, () => new PartageClient(basePartage), { base: basePartage, surNouvellesAlertes: (id, a) => notifications.alertes(id, a) });
const synchro = new Synchro(depot, comptes, fabriqueAurion, { minutes: 15, cours, mails, surNouvellesAlertes: (id, a) => notifications.alertes(id, a) });
const app = await creerApp({ depot, comptes, synchro, notifications, cours, taches: new Taches(depot), mails, fabriqueAurion, cookieSecurise: false, dossierClient: process.env.CLIENT_DIR ?? '../client/dist' });
const port = Number(process.env.PORT ?? 8787);
await app.listen({ port, host: '127.0.0.1' });
console.log(`Démo : http://localhost:${port}  (identifiant « demo », mot de passe « demo »)`);

// Pour montrer les alertes : `kill -USR2 <pid>` déplace un cours et publie une note (sauf sous Windows).
process.on('SIGUSR2', () => {
  const prochain = faux.donnees.evenements.find((e) => Date.parse(e.start.replace('+0100', '+01:00')) > Date.now() && e.className === 'N01_COURS');
  if (prochain) prochain.title = prochain.title.replace(/^[^\n]+/, 'Amphi B');
  faux.donnees.notes[1][5] = '13';
  moodle.cours[1].sections[0].elements[0].fichiers!.push({ nom: 'correction-ex10-16.pdf', contenu: '%PDF-1.4 correction', modifie: Math.floor(Date.now() / 1000) });
  console.log('Données de démo modifiées : une salle changée, une note publiée.');
});
