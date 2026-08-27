/**
 * Criptografia dos segredos das empresas (certificado .pfx + senhas).
 *
 * AES-256-GCM com chave-mestra em WEBAPP_MASTER_KEY (fora do banco):
 * banco vazado sem a chave-mestra = certificados ilegíveis.
 */
import * as crypto from 'crypto';

function getMasterKey(): Buffer {
  const raw = process.env['WEBAPP_MASTER_KEY'] || '';
  if (!raw) {
    throw new Error('WEBAPP_MASTER_KEY nao definida — obrigatoria para o cadastro de empresas');
  }
  const buf = Buffer.from(raw, 'base64');
  if (buf.length === 32) return buf;
  // Chave em formato livre: deriva 32 bytes via scrypt
  return crypto.scryptSync(raw, 'nfe-engine-master-v1', 32);
}

/** Criptografa um segredo (Buffer ou string) → base64(iv || authTag || ciphertext). */
export function encryptSecret(plain: Buffer | string): string {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.isBuffer(plain) ? plain : Buffer.from(plain, 'utf-8');
  const enc = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

/** Decripta o payload gerado por encryptSecret. */
export function decryptSecret(payload: string): Buffer {
  const key = getMasterKey();
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]);
}

/** Hash de senha de acesso (scrypt + salt) — para as senhas por empresa. */
export function hashSenha(senha: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(senha, salt, 32);
  return salt.toString('hex') + ':' + hash.toString('hex');
}

export function verifySenha(senha: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const hash = crypto.scryptSync(senha, Buffer.from(saltHex, 'hex'), 32);
  return crypto.timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}
