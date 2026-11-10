# Sources de données CPE (relevé du 10/11/2026)

Rien d'officiel : ces accès ont été observés depuis un navigateur connecté. Ils peuvent changer sans prévenir.
Toujours utiliser **ses propres identifiants**, et ne jamais publier de cookie, jeton ou lien personnel.

## WebAurion — `https://mycpe.cpe.fr` (JSF / PrimeFaces 5.3)

Parcours vérifié le 10/11/2026 en rejouant les requêtes depuis un navigateur connecté. Seul l'envoi du
formulaire de connexion par le serveur n'a pas encore été essayé en vrai (`npm run essai` le fait).

**Connexion**
- `GET /faces/Login.xhtml` → cookie de session.
- `POST /login` (`application/x-www-form-urlencoded`) : `username`, `password` (formulaire `formulaireSpring`, Spring Security, pas de jeton CSRF).
  Succès : redirection vers `/`, qui affiche la page d'accueil. Échec : retour sur `Login.xhtml`.
- La session expire après une vingtaine de minutes sans activité.
- Sans session, `GET /faces/Planning.xhtml` répond quand même 200 avec une page vide (ni menu, ni planning) : ne pas se fier au code HTTP.

**Navigation** : toutes les pages ont un formulaire `form#form` dont l'`action` est la page courante, et un
jeton `javax.faces.ViewState` **propre à la page** (à renvoyer à cette page-là, pas à une autre).
Le menu latéral soumet ce formulaire avec **tous ses champs** plus :
`form:sidebar=form:sidebar`, `form:sidebar_menuid=<n°>`. Réponse : redirection vers la page demandée.
Numéros relevés : `18` Planning, `19` Notes, `20` Absences. Ils peuvent dépendre du profil : le client les
retrouve par le libellé du lien (`onclick="…'form:sidebar_menuid':'18'…"`).

**Planning** (`/faces/Planning.xhtml`) : composant FullCalendar `<div id="form:j_idt118" class="schedule">`
(l'id peut changer : le lire dans la page). Le titre de la page est `Planning Prénom NOM`.
```
POST /faces/Planning.xhtml
Faces-Request: partial/ajax
javax.faces.partial.ajax=true
javax.faces.source=<id>   javax.faces.partial.execute=<id>   javax.faces.partial.render=<id>
<id>=<id>   <id>_start=<ms epoch>   <id>_end=<ms epoch>
form=form   javax.faces.ViewState=<vs>
```
Réponse : XML `partial-response` contenant `{"events" : [{id,title,start,end,allDay,editable,className}]}`
et un `<update id="…javax.faces.ViewState…">`. Une seule requête peut couvrir toute l'année.
- `id` : **aléatoire à chaque chargement**. Pour comparer deux synchros, utiliser une clé stable (début + matière + type + groupe).
- `title` : lignes `salle(s) / groupe / matière / type / intervenant(s) / remarques…`
- `className` : `N01_COURS`, `N01_TD`, `N01_TP_LABO`, `N01_COURS_LANGUES`, `N01_COURS_FHES`, `N01_EXAMEN`, `N01_EXAMEN_MACHINE`, `N01_SPORT`, `N02_AUTONOMIE`, `N02_PRESENTATION`, `N02_BDE`, `N02_EVT_CPE`, `N02_RENTREE`, `N04_REUNION`.
- Examens : les remarques donnent la répartition (« De Prénom NOM à Prénom NOM inclus en salle F004_F005 », « Salles F004-F005 : de … à … »), voir `server/src/sources/planning.ts`.

**Notes** (`/faces/ChoixDonnee.xhtml`) et **absences** (`/faces/MesAbsences.xhtml`) : un bloc `div.ui-datatable`
avec `thead th > span.ui-column-title` et `tbody.ui-datatable-data > tr > td`.
- Notes : `Semestre | Module / Domaine | Cours | Epreuve | Coefficient | Note | Motif d'absence` (notes provisoires, virgule décimale).
- Absences : `Date | Motif d'absence | Durée | Horaire | Cours | Intervenant | Matière` ; si vide, une ligne `tr.ui-datatable-empty-message` (« Aucune absence. »).
- Pas de pagination observée (avec une seule note) : à revérifier quand il y en aura beaucoup.

## Moodle — `https://e-campus.cpe.fr` + CAS `https://auth.cpe.fr`

Mêmes identifiants que MyCPE (adresse mail + mot de passe). Le CAS est un Apereo CAS sans double authentification.

**Obtenir un jeton (comme l'appli Moodle officielle)** — `server/src/sources/moodle.ts`
1. `GET /login/index.php?authCAS=CAS` → redirection vers `https://auth.cpe.fr/login?service=https%3A%2F%2Fe-campus.cpe.fr%2Flogin%2Findex.php`.
2. Formulaire `form#fm1` (action `login`) : `username`, `password`, `execution` (jeton caché, ~7 000 caractères), `_eventId=submit`, `geolocation`, `deviceFingerprint` (vides).
   Refus : le CAS réaffiche le formulaire. Succès : redirection vers `…/login/index.php?ticket=ST-…`, qui ouvre la session Moodle.
3. `GET /admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=<aléatoire>&urlscheme=moodlemobile`
   → redirection vers `moodlemobile://token=<base64 de « md5(adresse du site + passeport):::jeton:::jeton privé »>`.
4. Le jeton sert ensuite pour `POST /webservice/rest/server.php` (`wstoken`, `wsfunction`, `moodlewsrestformat=json`) :
   `core_webservice_get_site_info`, `core_enrol_get_users_courses`, `core_course_get_contents` ;
   fichiers par `webservice/pluginfile.php/…?token=…`. Jeton refusé : `errorcode: invalidtoken` (on en redemande un).

`tool_mobile_get_public_config` (sans connexion) confirme : API mobile active, `typeoflogin=3`, fournisseur « CAS ».
Testé : 29 cours, sections, ressources et sous-sections (Moodle 4.5+).

## Mails — `https://partage.cpe.fr` (Zimbra « PARTAGE »)

- Connexion classique `username` / `password` (+ `login_csrf`), pas de SSO.
- Accès serveur envisagé : IMAP (déjà utilisé par l'app Mail d'iOS) ou API REST Zimbra (`/home/~/inbox?fmt=json`).

## Planning iCal (secours)

Sur l'accueil mycpe : `https://planning.cpe.fr/exportics.php?uid=<numéro>&mail=<adresse>`. Le lien ne contient que ces deux infos : **à traiter comme un secret**.
