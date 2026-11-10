/**
 * Essai en vrai, depuis ton ordinateur : `npm run essai`
 * Se connecte à MyCPE avec TES identifiants (demandés au clavier, jamais enregistrés)
 * et affiche un résumé de ce que le serveur saurait récupérer.
 */
import { createInterface } from 'node:readline';
import { AurionClient, ErreurIdentifiants } from './sources/aurion.js';
import { salleExamenPour } from './sources/planning.js';
import { anneeScolaire } from './synchro.js';
import { moyennesParCours } from './alertes.js';
import { MoodleClient } from './sources/moodle.js';

// Une seule lecture du clavier pour les deux questions ; en mode « caché », rien de ce qui est tapé n'est affiché.
const clavier = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY === true });
let cache = false;
const interne = clavier as unknown as { _writeToOutput: (s: string) => void };
const ecrire = interne._writeToOutput.bind(clavier);
interne._writeToOutput = (s) => {
  if (!cache) ecrire(s);
};
const lignes: string[] = [];
const enAttente: ((ligne: string) => void)[] = [];
clavier.on('line', (ligne) => {
  const suivant = enAttente.shift();
  if (suivant) suivant(ligne);
  else lignes.push(ligne);
});

function demander(question: string, secret = false): Promise<string> {
  return new Promise((ok) => {
    process.stdout.write(question);
    cache = secret;
    const fin = (reponse: string) => {
      cache = false;
      if (secret) process.stdout.write('\n');
      ok(reponse);
    };
    const dejaLue = lignes.shift();
    if (dejaLue !== undefined) fin(dejaLue);
    else enAttente.push(fin);
  });
}

const identifiant = (await demander('Identifiant CPE : ')).trim();
const motDePasse = await demander('Mot de passe (non affiché) : ', true);
clavier.close();
const client = new AurionClient(process.env.AURION_BASE);
const maintenant = new Date();

try {
  await client.connexion(identifiant, motDePasse);
  console.log('✅ Connexion réussie');
  const { debut, fin } = anneeScolaire(maintenant);
  const planning = await client.planning(debut, fin);
  console.log(`✅ Planning : ${planning.length} créneaux sur l'année (élève : ${client.nomEleve || 'nom non trouvé'})`);
  for (const e of planning.filter((x) => Date.parse(x.fin) > maintenant.getTime()).slice(0, 4)) {
    const salle = e.categorie === 'examen' ? salleExamenPour(e, client.nomEleve) ?? e.salles : e.salles;
    console.log(`   ${e.debut.slice(0, 16).replace('T', ' ')}  ${e.type.trim().padEnd(8)} ${e.matiere}  [${salle.join(' / ')}]`);
  }
  const notes = await client.notes();
  console.log(`✅ Notes : ${notes.length} épreuve(s)`);
  for (const m of moyennesParCours(notes)) console.log(`   ${m.cours} : ${m.moyenne ?? '—'}`);
  const absences = await client.absences();
  console.log(`✅ Absences : ${absences.length}`);

  const moodle = new MoodleClient();
  const jeton = await moodle.obtenirJeton(identifiant, motDePasse);
  console.log('✅ Connexion à e-campus par le CAS (jeton obtenu)');
  const cours = await moodle.cours(jeton);
  const fichiers = cours.flatMap((c) => c.sections.flatMap((x) => x.elements.flatMap((e) => e.fichiers)));
  console.log(`✅ e-campus : ${cours.length} cours, ${fichiers.length} fichiers (${Math.round(fichiers.reduce((t, f) => t + f.taille, 0) / 1e6)} Mo)`);
  for (const c of cours.slice(0, 5)) console.log(`   ${c.nom}`);
} catch (e) {
  console.error(e instanceof ErreurIdentifiants ? '❌ Identifiant ou mot de passe refusé.' : `❌ ${(e as Error).message}`);
  process.exitCode = 1;
}
