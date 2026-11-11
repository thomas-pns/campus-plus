/** Point d'entrée du serveur Campus+. */
import { lireConfig } from './config.js';
import { Coffre } from './coffre.js';
import { Depot } from './depot.js';
import { Comptes } from './comptes.js';
import { Synchro } from './synchro.js';
import { AurionClient } from './sources/aurion.js';
import { creerApp } from './api.js';
import { Notifications } from './notifications.js';
import { SynchroCours } from './cours.js';
import { Taches } from './taches.js';
import { SynchroMails } from './mails.js';
import { PartageClient } from './sources/partage.js';
import { MoodleClient } from './sources/moodle.js';
import { SynchroOneDrive } from './onedrive.js';

const config = await lireConfig();
const coffre = new Coffre(config.cle);
const depot = new Depot(config.dossierDonnees, coffre);
const comptes = new Comptes(depot, coffre);
const fabriqueAurion = () => new AurionClient(config.aurionBase);
const notifications = await Notifications.demarrer(depot, coffre, config.dossierDonnees);
const cours = new SynchroCours(depot, comptes, coffre, config.dossierDonnees, () => new MoodleClient(), {
  journal: (m) => console.log(`[cours] ${m}`),
  surNouvellesAlertes: (id, alertes) => notifications.alertes(id, alertes),
});
const mails = new SynchroMails(depot, comptes, () => new PartageClient(), {
  journal: (m) => console.log(`[mails] ${m}`),
  surNouvellesAlertes: (id, alertes) => notifications.alertes(id, alertes),
});
const onedrive = config.onedriveClientId
  ? new SynchroOneDrive(depot, cours, { clientId: config.onedriveClientId, tenant: config.onedriveTenant, journal: (m) => console.log(`[onedrive] ${m}`) })
  : undefined;
const synchro = new Synchro(depot, comptes, fabriqueAurion, {
  cours,
  mails,
  onedrive,
  minutes: config.minutesSynchro,
  journal: (m) => console.log(`[synchro] ${m}`),
  surNouvellesAlertes: (id, alertes) => notifications.alertes(id, alertes),
});

const app = await creerApp({
  depot, comptes, synchro, notifications, cours, taches: new Taches(depot), mails, onedrive, fabriqueAurion,
  cookieSecurise: config.cookieSecurise,
  derriereProxy: config.derriereProxy,
  dossierClient: config.dossierClient,
  journal: true,
});
await app.listen({ port: config.port, host: '0.0.0.0' });
synchro.demarrer();

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    synchro.arreter();
    void app.close().then(() => process.exit(0));
  });
}
