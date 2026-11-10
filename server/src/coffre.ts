/**
 * Chiffrement des données au repos : AES-256-GCM, clé fournie par CAMPUS_SECRET_KEY.
 * Tout ce qui est écrit sur le disque (identifiants, planning, notes…) passe par ici.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

const VERSION = 'v1';

export class Coffre {
  constructor(private cle: Buffer) {
    if (cle.length !== 32) throw new Error('La clé du coffre doit faire 32 octets.');
  }

  chiffrer(clair: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.cle, iv);
    const donnees = Buffer.concat([c.update(clair, 'utf8'), c.final()]);
    return [VERSION, iv.toString('base64'), c.getAuthTag().toString('base64'), donnees.toString('base64')].join('.');
  }

  /** Lève une erreur si le paquet a été modifié ou chiffré avec une autre clé. */
  dechiffrer(paquet: string): string {
    const [version, iv, etiquette, donnees] = paquet.split('.');
    if (version !== VERSION || !iv || !etiquette || donnees === undefined) throw new Error('Paquet chiffré illisible');
    const d = createDecipheriv('aes-256-gcm', this.cle, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(etiquette, 'base64'));
    return Buffer.concat([d.update(Buffer.from(donnees, 'base64')), d.final()]).toString('utf8');
  }

  /** Même chose pour des octets (fichiers de cours) : iv (12) + étiquette (16) + données. */
  chiffrerOctets(clair: Buffer): Buffer {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', this.cle, iv);
    const donnees = Buffer.concat([c.update(clair), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), donnees]);
  }

  dechiffrerOctets(paquet: Buffer): Buffer {
    if (paquet.length < 28) throw new Error('Paquet chiffré illisible');
    const d = createDecipheriv('aes-256-gcm', this.cle, paquet.subarray(0, 12));
    d.setAuthTag(paquet.subarray(12, 28));
    return Buffer.concat([d.update(paquet.subarray(28)), d.final()]);
  }

  /** Empreinte stable et non réversible (pour nommer un dossier sans y écrire l'identifiant). */
  empreinte(valeur: string, longueur = 24): string {
    return createHmac('sha256', this.cle).update(valeur).digest('hex').slice(0, longueur);
  }
}
