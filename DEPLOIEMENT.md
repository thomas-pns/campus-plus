# Déploiement de Campus+ sur le NAS

Même principe qu'All-In Club : GitHub fabrique l'image Docker à chaque envoi sur `main`,
le NAS la télécharge, et le proxy inversé DSM la rend accessible en HTTPS.

Adresse proposée : **https://campus.parlotte.synology.me** (à adapter).

## 1. Rendre l'image téléchargeable (une seule fois)

Après le premier passage du workflow **Tests et image** (onglet *Actions* du dépôt) :

1. GitHub > ton profil > **Packages** > `campus-plus`.
2. **Package settings** > *Danger Zone* > **Change visibility** > **Public**.

## 2. Container Manager

1. **File Station** : dans le dossier partagé `docker`, crée le dossier `campus-plus`.
2. **Container Manager > Projet > Créer** :
   - Nom du projet : `campus-plus` ;
   - Chemin : `/docker/campus-plus` ;
   - Source : **Créer docker-compose.yml**, puis colle le contenu de [`docker-compose.yml`](docker-compose.yml).
3. **Suivant**, puis **Terminé**. Le conteneur `campus-plus` démarre.

Vérification depuis un PC de la maison : `http://IP-DU-NAS:8767/api/sante` affiche `{"ok":true}`.

## 3. Proxy inversé (obligatoire : la connexion ne marche qu'en HTTPS)

DSM > **Panneau de configuration > Portail de connexion > Avancé > Proxy inversé > Créer** :

| Champ | Valeur |
|---|---|
| Description | `campus-plus` |
| Source : protocole | HTTPS |
| Source : nom d'hôte | `campus.parlotte.synology.me` |
| Source : port | 443 |
| Destination : protocole | HTTP |
| Destination : nom d'hôte | `localhost` |
| Destination : port | 8767 |

Le certificat `*.parlotte.synology.me` déjà en place couvre ce sous-domaine.
Le port 443 de la box pointe déjà vers le NAS : **rien d'autre à ouvrir**, et surtout pas le port 8767.

Le cookie de session n'est envoyé qu'en HTTPS : en ouvrant `http://IP-DU-NAS:8767` directement, la page
s'affiche mais la connexion ne tient pas. C'est voulu.

## 4. Installer l'appli sur un téléphone

- **iPhone** : ouvrir l'adresse dans Safari > bouton Partager > **Sur l'écran d'accueil**.
- **Android** : Chrome > menu ⋮ > **Installer l'application**.

Le planning et les notes déjà chargés restent consultables sans connexion.

## 5. Sauvegarde et clé de chiffrement

Tout est dans `/docker/campus-plus/data` : un dossier par élève (fichiers chiffrés) et `cle-secrete`,
la clé créée au premier démarrage. Sans cette clé, les données sont illisibles et chacun devra se reconnecter.
Qui possède le dossier **et** la clé peut tout lire, mots de passe CPE compris : ne partage pas ce dossier.
Pour séparer les deux, fournis la clé par `CAMPUS_SECRET_KEY` dans le docker-compose.

## 6. Mises à jour

Chaque envoi sur `main` publie une nouvelle image (après les tests).
Container Manager > **Projet > campus-plus > Action > Construire** récupère la dernière version.
