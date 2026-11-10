/** Point d'entrée du serveur Campus+. */
import { lireConfig } from './config.js';
import { Coffre } from './coffre.js';
import { Depot } from './depot.js';
import { Comptes } from './comptes.js';
import { Synchro } from './synchro.js';
import { AurionClient } from './sources/aurion.js';
import { creerApp } from './api.js';

const config = await lireConfig();
const coffre = new Coffre(config.cle);
const depot = new Depot(config.dossierDonnees, coffre);
const comptes = new Comptes(depot, coffre);
const fabriqueAurion = () => new AurionClient(config.aurionBase);
const synchro = new Synchro(depot, comptes, fabriqueAurion, {
  minutes: config.minutesSynchro,
  journal: (m) => console.log(`[synchro] ${m}`),
});

const app = await creerApp({
  depot, comptes, synchro, fabriqueAurion,
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
