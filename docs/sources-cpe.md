# Sources de données CPE (relevé du 10/11/2026)

Rien d'officiel : ces accès ont été observés depuis un navigateur connecté. Ils peuvent changer sans prévenir.
Toujours utiliser **ses propres identifiants**, et ne jamais publier de cookie, jeton ou lien personnel.

## WebAurion — `https://mycpe.cpe.fr` (JSF / PrimeFaces 5.3)

**Connexion**
- `GET /faces/Login.xhtml` → cookie de session.
- `POST /login` (`application/x-www-form-urlencoded`) : `username`, `password` (formulaire `formulaireSpring`, Spring Security). Redirige vers la page d'accueil si OK, sinon reste sur `Login.xhtml`.

**Navigation** : chaque page contient `input[name="javax.faces.ViewState"]`. Le menu latéral soumet :
`POST /faces/MainMenuPage.xhtml` — `form=form`, `form:sidebar=form:sidebar`, `form:sidebar_menuid=<id>`, `javax.faces.ViewState=<vs>`.
Ids : `18` Planning, `19` Notes, `20` Absences.

**Planning** (`Planning.xhtml`) : composant FullCalendar `div.schedule[id]` (ex. `form:j_idt118`, l'id change selon les versions).
```
POST /faces/Planning.xhtml
Faces-Request: partial/ajax
javax.faces.partial.ajax=true
javax.faces.source=<id>   javax.faces.partial.execute=<id>   javax.faces.partial.render=<id>
<id>=<id>   <id>_start=<ms epoch>   <id>_end=<ms epoch>
form=form   javax.faces.ViewState=<vs>
```
Réponse : XML `partial-response` contenant `{"events":[{id,title,start,end,allDay,className}]}`.
- `title` : lignes `salle(s) / groupe / matière / type / intervenant(s) / remarques…`
- `className` : `N01_COURS`, `N01_TD`, `N01_TP_LABO`, `N01_COURS_LANGUES`, `N01_COURS_FHES`, `N01_EXAMEN`, `N01_EXAMEN_MACHINE`, `N01_SPORT`, `N02_AUTONOMIE`, `N02_PRESENTATION`, `N02_BDE`, `N02_EVT_CPE`, `N02_RENTREE`, `N04_REUNION`.
- Examens : les remarques donnent la répartition (« De Prénom NOM à Prénom NOM inclus en salle F004_F005 », « Salles F004-F005 : de … à … »), voir `server/src/sources/planning.ts`.

**Notes** (`ChoixDonnee.xhtml`) : tableau `Semestre | Module / Domaine | Cours | Epreuve | Coefficient | Note | Motif d'absence` (notes provisoires).
**Absences** (`MesAbsences.xhtml`) : tableau `Date | Motif | Durée | Horaire | Cours | Intervenant | Matière` (ligne « Aucune absence. » si vide).

## Moodle — `https://e-campus.cpe.fr`

- `tool_mobile_get_public_config` (sans connexion) : API mobile active, connexion `typeoflogin=3` via le fournisseur **CAS** ; `launchurl` = `/admin/tool/mobile/launch.php`.
- Flux prévu côté serveur : obtenir un jeton de service `moodle_mobile_app` via le SSO CAS (launch.php → `moodlemobile://token=…`), puis `webservice/rest/server.php` :
  `core_enrol_get_users_courses`, `core_course_get_contents`, fichiers via `webservice/pluginfile.php?token=…`.
- Côté web (session navigateur), `core_course_get_enrolled_courses_by_timeline_classification` et `core_courseformat_get_state` répondent aussi (testé : 29 cours, sections, ressources, sous-sections).

## Mails — `https://partage.cpe.fr` (Zimbra « PARTAGE »)

- Connexion classique `username` / `password` (+ `login_csrf`), pas de SSO.
- Accès serveur envisagé : IMAP (déjà utilisé par l'app Mail d'iOS) ou API REST Zimbra (`/home/~/inbox?fmt=json`).

## Planning iCal (secours)

Sur l'accueil mycpe : `https://planning.cpe.fr/exportics.php?uid=<numéro>&mail=<adresse>`. Le lien ne contient que ces deux infos : **à traiter comme un secret**.
