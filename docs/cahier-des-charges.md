# Campus+ — cahier des charges (v0.4, 10/11/2026)

App web (PWA) open source pour les élèves de CPE Lyon : planning, cours, scolarité, mails triés par IA, devoirs.
Auto-hébergée (au départ sur un NAS perso), pour un cercle d'amis puis plus large.

## 1. Sources de données

| Donnée | Source | Méthode | Statut |
|---|---|---|---|
| Planning | WebAurion `mycpe.cpe.fr` | POST AJAX PrimeFaces → JSON `events` | ✅ testé (253 événements/an) |
| Notes | WebAurion `ChoixDonnee.xhtml` | tableau HTML | ✅ lu |
| Absences | WebAurion `MesAbsences.xhtml` | tableau HTML | ✅ lu |
| Cours | Moodle `e-campus.cpe.fr` | API mobile officielle (jeton via SSO CAS) | ✅ API active, cours + sections + fichiers |
| Mails | Zimbra PARTAGE `partage.cpe.fr` | IMAP ou API REST Zimbra (identifiant + mot de passe) | 🟡 faisable, à brancher |
| Planning (secours) | `planning.cpe.fr/exportics.php` | iCal (lien personnel = secret) | ⚠️ à vérifier |

Détails techniques : [sources-cpe.md](sources-cpe.md).

## 2. Écrans (maquettes « Campus+ — maquettes »)

Barre d'onglets : **Aujourd'hui · Planning · Cours · Boîte · Scolarité**. Réglages via l'avatar.

1. **Aujourd'hui** : prochain événement avec compte à rebours, salle (et salle d'examen perso, corrigée si un mail l'a changée), timeline du jour, « À faire » (devoirs), tuiles dernière note / nouveaux fichiers.
2. **Planning** : jour / semaine / mois, couleur par type, examens encadrés en rouge, hors ligne.
3. **Cours** : semestre → UE → cours → sections, recherche, badge « nouveau ». Dans un cours : fichiers + infos « détectées dans tes mails » (nouvelle version du cours, changement de salle…).
4. **Boîte** : mails PARTAGE triés par l'IA en cartes courtes — *Salles & horaires*, *Profs*, *Devoirs*, *École* — avec action directe (ouvrir le cours, voir le planning) et « Voir le mail » (renvoie vers partage.cpe.fr). Les autres mails sont repliés.
5. **Scolarité** : notes (provisoires) avec moyennes pondérées, absences.
6. **Devoirs** : remplis automatiquement depuis les mails des profs (ex. « correction des exos 10, 14, 15, 16 ») + ajout manuel avec échéance.
7. **Réglages** : statut du serveur, dernière synchro, option OneDrive école, tri IA on/off, notifications par type, revoir la visite guidée, tutos de l'école (réécrits plus tard), thème.
8. **Visite guidée** à la première ouverture (4 étapes), rejouable depuis les réglages.

Actualisation : synchro automatique côté serveur (toutes les 5–10 min) + **tirer vers le bas pour forcer** (utile car iOS ne réveille pas les PWA en arrière-plan).

## 3. Tri IA des mails

- Le serveur récupère les nouveaux mails, garde ceux des profs / de la scolarité (liste d'expéditeurs tirée du planning : intervenants + adresses école), et demande à un modèle un JSON : catégorie, résumé en une phrase, cours concerné, date/séance concernée, devoir éventuel, changement de salle éventuel.
- Le résultat est rattaché au cours et à la séance du planning ; un changement de salle met à jour l'affichage (avec la mention « détecté par mail »).
- **Opt-in** par élève (le contenu des mails part chez le fournisseur du modèle) ; clé d'API dans `.env` du serveur. Alternative possible : modèle local sur le NAS.
- On ne recopie pas les mails dans l'appli : résumé + lien vers PARTAGE.

## 4. Option OneDrive école (plus tard)

Le NAS reste la référence ; s'il est activé, il copie l'arborescence rangée vers le OneDrive école de l'élève (Microsoft Graph, connexion Microsoft de l'élève). À tester : l'admin CPE peut bloquer les applis tierces. Pas d'envoi direct reMarkable.

## 5. Technique et sécurité

- Front : PWA (Vite + TypeScript). Correctif iOS 26/27 repris d'All-In Club (barre d'état `default`, pas de `position: fixed` plein écran, `#app` à 100 %, `env(safe-area-inset-*)`).
- Back : Node ≥ 20 sur le NAS (Docker), un worker de synchro par élève.
- Chaque élève se connecte avec son compte CPE ; identifiants et jetons **chiffrés au repos** (clé `CAMPUS_SECRET_KEY`) ; HTTPS ; rien de personnel dans le dépôt (pas d'identifiant, cookie, lien iCal, vraie donnée) ; tests avec données fictives.

## 6. Étapes

1. ✅ Reverse des sources, maquettes, squelette du dépôt.
2. ✅ Serveur : client WebAurion, comptes et données chiffrés, sessions, synchro automatique et à la demande, alertes, API JSON. Testé contre un faux WebAurion ; reste l'essai en vrai (`npm run essai`, puis le NAS).
3. ✅ Appli PWA (Aujourd'hui, Planning jour/semaine, Alertes, Scolarité, Réglages), image Docker et guide NAS. Vérifiée à l'écran avec des données de démo ; reste la mise en ligne sur le NAS et l'essai sur iPhone.
4. ✅ Notifications push (salle, horaire, créneau, note), réglables par type dans les Réglages.
5. ✅ Cours e-campus : connexion CAS, jeton mobile, fichiers copiés et chiffrés sur le serveur (une seule copie pour tous), onglet Cours avec recherche et badge « nouveau », alertes « nouveau fichier ». Testé contre un faux e-campus ; reste l'essai en vrai.
6. ✅ Devoirs : échéances e-campus (bloc Chronologie : devoirs, tests) avec date limite, tâches perso, « À faire » sur l'accueil, alertes « nouveau devoir ».
7. Mails PARTAGE + tri IA (devoirs et changements de salle détectés dans les mails), tri IA des fichiers douteux.
8. Visite guidée, puis OneDrive.
