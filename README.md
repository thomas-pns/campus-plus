# Campus+

Une appli web (PWA) open source pour les élèves de **CPE Lyon** : ton planning lisible, tes cours e-campus bien rangés, tes notes et absences, et tes mails d'école triés par l'IA.

> Projet étudiant non officiel, sans lien avec CPE Lyon. Chacun utilise ses propres identifiants CPE.

## Ce que ça fait (objectif)

- **Aujourd'hui** : prochain cours, compte à rebours, ta salle (et ta salle d'examen trouvée pour toi).
- **Planning** : jour, semaine, mois, une couleur par type de cours.
- **Cours** : fichiers Moodle synchronisés sur le serveur, rangés par semestre, UE et cours, avec recherche et badge « nouveau ».
- **Boîte** : les mails des profs et de la scolarité résumés (changement de salle, nouvelle version du cours, devoirs).
- **Scolarité** : notes et absences.
- **Devoirs** : détectés dans les mails et ajoutés à la main.
- Installable sur iPhone depuis Safari (Partager → Sur l'écran d'accueil).

## État

🚧 Début du projet. Voir le [cahier des charges](docs/cahier-des-charges.md) et les [sources de données](docs/sources-cpe.md).

- `server/` : Node ≥ 20. Client WebAurion (connexion, planning, notes, absences) et lecture du planning, testés sur des données fictives (`npm test`).
- `client/` : coquille PWA avec le correctif d'affichage iOS 26/27.

## Lancer le serveur

```bash
cd server
npm install
npm test
cp ../.env.example ../.env   # puis remplir CAMPUS_SECRET_KEY
```

## Sécurité

- Identifiants et jetons chiffrés au repos sur le serveur, jamais dans le dépôt.
- Pas de vraies données dans les tests : uniquement des exemples inventés.
- Le tri IA des mails est optionnel (opt-in) : le contenu des mails concernés est envoyé au modèle choisi.

## Licence

MIT
