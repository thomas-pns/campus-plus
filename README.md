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

🚧 Première version utilisable. Voir le [cahier des charges](docs/cahier-des-charges.md), les [sources de données](docs/sources-cpe.md) et le [guide d'installation sur un NAS](DEPLOIEMENT.md).

- `server/` (Node ≥ 20) : connexion à MyCPE et à e-campus avec le compte de chaque élève, planning, notes, absences, cours et fichiers, synchro automatique, alertes, notifications, API JSON. Testé contre un faux MyCPE.
- `client/` : l'appli (PWA Preact) avec les écrans Aujourd'hui, Planning (jour, semaine et mois), Alertes, Scolarité et Réglages. Consultable hors ligne, « tirer pour actualiser », notifications sur le téléphone (changement de salle, nouvelle note…).
- Cours e-campus copiés sur le serveur, rangés par semestre et pôle, avec recherche, badge « nouveau » et alerte à chaque nouveau fichier.
- Devoirs : échéances e-campus avec leur date limite et tâches perso, résumées sur l'accueil.
- Mails PARTAGE (à activer) : mails des profs et de l'école mis en avant, étiquetés (salle, examen, devoir, cours, annulation), « Créer un devoir » en un geste.
- Thème sombre (automatique ou au choix) et visite guidée au premier lancement.
- Option OneDrive : les cours rangés par semestre, matière et type copiés dans le OneDrive de l'élève, pour une reMarkable par exemple ([mise en place](docs/onedrive.md)).
- À venir : meilleur tri des mails, IA pour les mails.

## Voir la démo (sans compte CPE)

```bash
cd client && npm install && npm run build
cd ../server && npm install && npm run demo   # http://localhost:8787, identifiant « demo », mot de passe « demo »
```

## Essayer en vrai

Avec [Node.js](https://nodejs.org) 20 ou plus :

```bash
cd server
npm install
npm test          # tests, sans toucher au site de l'école
npm run essai     # se connecte à MyCPE avec TES identifiants (demandés au clavier, non enregistrés)
```

## Lancer le serveur

```bash
cp .env.example .env    # puis remplir CAMPUS_SECRET_KEY (openssl rand -base64 32)
cd server && npm run dev
```

| Route | Rôle |
|---|---|
| `POST /api/connexion` | `{identifiant, motDePasse}` CPE → cookie de session + première synchro |
| `GET /api/moi` | nom, état de la synchro |
| `GET /api/planning?debut=&fin=` | créneaux (avec `salleExamen` pour les examens) |
| `GET /api/notes` · `/api/absences` · `/api/alertes` | scolarité et changements détectés |
| `POST /api/synchro` | actualiser maintenant (au plus une fois par minute) |
| `POST /api/deconnexion` · `DELETE /api/compte` | se déconnecter · tout effacer du serveur |

## Sécurité

- Le serveur garde le mot de passe CPE de chaque élève, parce qu'il doit se reconnecter seul à MyCPE. Il est chiffré (AES-256-GCM), comme toutes les données sur le disque ; la clé reste dans le `.env` du serveur. Héberge-le seulement pour des gens qui te font confiance.
- « Supprimer mon compte » efface tout du serveur.
- Si MyCPE refuse le mot de passe, le serveur arrête d'essayer jusqu'à la prochaine connexion (pas de risque de bloquer le compte), et les essais de connexion à l'appli sont limités.
- Rien de personnel dans le dépôt : pas d'identifiant, de cookie, de lien iCal ni de vraie donnée. Les tests utilisent des exemples inventés.
- Le tri IA des mails sera optionnel (opt-in) : le contenu des mails concernés est envoyé au modèle choisi.

## Licence

MIT
