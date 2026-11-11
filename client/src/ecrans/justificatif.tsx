/**
 * Envoi d'un justificatif d'absence à MyCPE depuis l'appli. Rien ne part tout seul : l'élève remplit,
 * relit, puis appuie lui-même sur « Envoyer à MyCPE ».
 */
import { useEffect, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { Icone } from '../composants';
import { ErreurApi } from '../api';

export interface Brouillon { debut: string; fin: string }

const lireBase64 = (f: File) => new Promise<string>((ok, ko) => {
  const r = new FileReader();
  r.onload = () => ok(String(r.result).split(',')[1] ?? '');
  r.onerror = () => ko(new Error('Lecture du fichier impossible'));
  r.readAsDataURL(f);
});

const joli = (d: string) => new Date(d).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function Justificatif({ brouillon, surFermer }: { brouillon: Brouillon; surFermer: () => void }) {
  const [debut, setDebut] = useState(brouillon.debut);
  const [fin, setFin] = useState(brouillon.fin);
  const [motifs, setMotifs] = useState<string[] | null>(null);
  const [motif, setMotif] = useState('');
  const [fichier, setFichier] = useState<File | null>(null);
  const [etape, setEtape] = useState<'saisie' | 'relecture' | 'envoi' | 'fait'>('saisie');
  const [message, setMessage] = useState('');

  useEffect(() => {
    void fetch('/api/justificatif/motifs', { credentials: 'same-origin' }).then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.erreur ?? 'MyCPE injoignable');
      setMotifs(j.motifs);
    }).catch((e) => { setMotifs([]); setMessage((e as Error).message); });
  }, []);

  const probleme = !debut || !fin ? 'Indique le début et la fin.' : fin < debut ? 'La fin est avant le début.'
    : !motif ? 'Choisis un motif.' : !fichier ? 'Ajoute le justificatif.'
    : fichier.size > 5_000_000 ? 'Fichier trop gros : 5 Mo au plus.'
    : !/\.(pdf|docx|png|jpe?g)$/i.test(fichier.name) ? 'MyCPE accepte les PDF, DOCX, PNG et JPG.' : '';

  const envoyer = async () => {
    if (probleme || !fichier) return;
    setEtape('envoi');
    setMessage('');
    try {
      const rep = await fetch('/api/justificatif', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ debut, fin, motif, fichier: { nom: fichier.name, donnees: await lireBase64(fichier) } }),
      });
      const j = await rep.json().catch(() => ({}));
      if (!rep.ok) throw new ErreurApi(rep.status, j.erreur ?? `Erreur ${rep.status}`);
      setMessage(j.message);
      setEtape('fait');
    } catch (e) {
      setMessage((e as Error).message);
      setEtape('relecture');
    }
  };

  return createPortal(
    <div class="voile" onClick={(ev) => ev.target === ev.currentTarget && etape !== 'envoi' && surFermer()}>
      <section class="feuille" role="dialog" aria-modal="true" aria-label="Justifier une absence">
        <div class="feuille-haut">
          <span class="pastille c-examen">Justificatif d’absence</span>
          <button type="button" class="rond" onClick={surFermer} disabled={etape === 'envoi'} aria-label="Fermer"><Icone nom="fermer" taille={18} epaisseur={2.4} /></button>
        </div>
        {etape === 'fait' ? (
          <>
            <h2>C’est envoyé ✅</h2>
            <p>{message}</p>
            <p class="petit-texte">MyCPE l’a enregistré. Le statut de l’absence se met à jour quand la scolarité l’a traité.</p>
            <button type="button" class="bouton large" onClick={surFermer}>Fermer</button>
          </>
        ) : etape === 'saisie' ? (
          <>
            <h2>Justifier une absence</h2>
            <div class="formulaire-court">
              <label>Début<input type="datetime-local" value={debut} onInput={(e) => setDebut((e.target as HTMLInputElement).value)} /></label>
              <label>Fin<input type="datetime-local" value={fin} onInput={(e) => setFin((e.target as HTMLInputElement).value)} /></label>
              <label>Motif
                <select value={motif} onChange={(e) => setMotif((e.target as HTMLSelectElement).value)} disabled={!motifs?.length}>
                  <option value="">{motifs === null ? 'Chargement depuis MyCPE…' : 'Choisir…'}</option>
                  {motifs?.map((m) => <option value={m}>{m}</option>)}
                </select>
              </label>
              <div class="champ-fichier">
                <span class="etiquette-champ">Justificatif (PDF, photo…)</span>
                <label class="choix-fichier">
                  <input type="file" accept=".pdf,.docx,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" onChange={(e) => setFichier((e.target as HTMLInputElement).files?.[0] ?? null)} />
                  <Icone nom="fichier" taille={18} />
                  <span>{fichier ? fichier.name : 'Aucun fichier choisi'}</span>
                  <strong>{fichier ? 'Changer' : 'Choisir'}</strong>
                </label>
              </div>
            </div>
            {(message || probleme) && <p class="petit-texte rouge">{message || probleme}</p>}
            <button type="button" class="bouton large" disabled={!!probleme} onClick={() => setEtape('relecture')}>Relire avant d’envoyer</button>
          </>
        ) : (
          <>
            <h2>Tout est bon ?</h2>
            <ul class="details">
              <li><Icone nom="horloge" taille={20} /><span>Du <strong>{joli(debut)}</strong><br />au <strong>{joli(fin)}</strong></span></li>
              <li><Icone nom="note" taille={20} /><span>{motif}</span></li>
              <li><Icone nom="fichier" taille={20} /><span>{fichier?.name}</span></li>
            </ul>
            {message && <p class="petit-texte rouge">{message}</p>}
            <p class="petit-texte">En appuyant sur « Envoyer », Campus+ remplit le formulaire de MyCPE avec ces informations et l’envoie en ton nom.</p>
            <button type="button" class="bouton large" disabled={etape === 'envoi'} onClick={() => void envoyer()}>{etape === 'envoi' ? 'Envoi à MyCPE…' : 'Envoyer à MyCPE'}</button>
            <button type="button" class="lien-bouton" disabled={etape === 'envoi'} onClick={() => setEtape('saisie')}>Modifier</button>
          </>
        )}
      </section>
    </div>,
    document.getElementById('app') ?? document.body,
  );
}

/** Brouillon pré-rempli depuis une absence de MyCPE (« 10/11/2026 », « 08:00 - 10:00 »), sinon aujourd'hui. */
export function brouillonDepuis(date?: string, horaire?: string): Brouillon {
  const d = date?.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  const h = horaire?.match(/(\d{1,2})[:h](\d{2}).*?(\d{1,2})[:h](\d{2})/);
  const jour = d ? `${d[3]}-${d[2]}-${d[1]}` : new Date().toLocaleDateString('fr-CA');
  const deux = (x: string) => x.padStart(2, '0');
  return {
    debut: `${jour}T${h ? `${deux(h[1])}:${h[2]}` : '08:00'}`,
    fin: `${jour}T${h ? `${deux(h[3])}:${h[4]}` : '18:00'}`,
  };
}
