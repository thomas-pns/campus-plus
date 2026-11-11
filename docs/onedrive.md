# Option OneDrive : créer l'application Microsoft

L'option « Copier mes cours sur OneDrive » range les fichiers e-campus dans le OneDrive de chaque élève :

```
OneDrive/Cours CPE/S5/Algèbre linéaire/TD/feuille 1.pdf
                     └ semestre └ matière   └ type (Cours, TD, Corrigés, TP, Annales et examens, Autres)
```

Chaque élève connecte son propre compte Microsoft depuis les réglages de l'appli, avec un code à taper
sur microsoft.com/devicelogin : le serveur ne voit jamais son mot de passe Microsoft. Le jeton d'accès
est gardé chiffré dans son dossier, comme le reste. Les fichiers de plus de 60 Mo (non copiés sur le
serveur) ne sont pas envoyés.

Pour que l'option apparaisse, le serveur a besoin de l'identifiant d'une « application » Microsoft.
C'est gratuit et ça se fait une seule fois (≈ 5 minutes).

## 1. Créer l'application

1. Va sur <https://entra.microsoft.com> et connecte-toi avec **un compte Microsoft personnel**
   (outlook.com, hotmail…). Le compte CPE n'a en général pas le droit de créer d'application.
   Si on te demande de créer un annuaire (« tenant »), accepte : c'est gratuit.
2. *Applications* → *Inscriptions d'applications* → **Nouvelle inscription**.
3. Nom : `Campus+`.
4. Types de comptes pris en charge : **Comptes dans un annuaire organisationnel et comptes Microsoft
   personnels** (pour les comptes CPE comme pour les comptes perso).
5. URI de redirection : laisse vide. Clique sur **Inscrire**.
6. Dans la page de l'application, copie **ID d'application (client)** : c'est `ONEDRIVE_CLIENT_ID`.

## 2. Autoriser la connexion par code

1. Menu *Authentification* → tout en bas, **Autoriser les flux de clients publics** → **Oui** → *Enregistrer*.

Pas besoin de « secret client » : la connexion par code n'en utilise pas (rien à cacher dans le docker-compose).

## 3. Permissions

Menu *Autorisations des API* : `User.Read` est déjà là. **Ajouter une autorisation** → *Microsoft Graph* →
*Autorisations déléguées* → coche `Files.ReadWrite` et `offline_access` → *Ajouter*.

## 4. Brancher sur le NAS

Dans le docker-compose (Container Manager → Projet → Modifier) :

```yaml
    environment:
      ONEDRIVE_CLIENT_ID: "l-identifiant-copié"
```

Puis *Construire* (ou redémarrer le projet). L'option apparaît dans Réglages → OneDrive.

## Si le compte CPE est refusé

Certaines écoles interdisent aux élèves d'autoriser une application qu'elles n'ont pas validée. Microsoft
affiche alors « Approbation de l'administrateur requise ». Deux solutions :

- se connecter avec **un compte Microsoft personnel** à la place (son OneDrive marche pareil, la
  reMarkable aussi) ;
- ou demander à la DSI de CPE d'approuver l'application `Campus+` (elle ne demande que l'accès aux
  fichiers de l'élève connecté).

## Pour la reMarkable

Dans l'appli reMarkable (téléphone ou ordinateur) : *Paramètres* → *Intégrations* → *OneDrive* → connecte le
même compte. Le dossier « Cours CPE » apparaît dans *Mes fichiers* → *OneDrive* sur la liseuse.
