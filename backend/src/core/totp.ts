import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32Encode(buffer: Buffer) {
  let bits = 0, value = 0, out = '';
  for (const byte of buffer) { value = (value << 8) | byte; bits += 8; while (bits >= 5) { out += alphabet[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}
export function base32Decode(text: string) {
  let bits = 0, value = 0; const out: number[] = [];
  for (const char of text.replace(/=+$/, '').toUpperCase()) { const index = alphabet.indexOf(char); if (index < 0) throw new Error('Invalid base32'); value = (value << 5) | index; bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
export const newSecret = () => base32Encode(randomBytes(20));
export const stepFor = (time = Date.now()) => Math.floor(time / 30_000);
// RFC 6238 (HMAC-SHA1, 6 digits, 30 s step).
export function totp(secret: string, step: number) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const code = ((hmac[offset] & 127) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(code % 1_000_000).padStart(6, '0');
}
// Returns the matching step (within ±1 of now, newer than the last used step) or null.
export function verifyTotp(secret: string, code: string, lastUsedStep: number, now = Date.now()) {
  if (!/^\d{6}$/.test(code)) return null;
  for (const delta of [0, -1, 1]) {
    const step = stepFor(now) + delta;
    if (step > lastUsedStep && timingSafeEqual(Buffer.from(totp(secret, step)), Buffer.from(code))) return step;
  }
  return null;
}
const key = () => {
  const configured = process.env.MFA_ENCRYPTION_KEY;
  if (!configured && process.env.NODE_ENV === 'production') throw new Error('MFA_ENCRYPTION_KEY is required in production');
  return createHash('sha256').update(configured ?? 'local-development-mfa-key').digest();
};
export function encryptSecret(secret: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(), iv);
  const body = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map(part => part.toString('base64')).join('.');
}
export function decryptSecret(stored: string) {
  const [iv, tag, body] = stored.split('.').map(part => Buffer.from(part, 'base64'));
  const decipher = createDecipheriv('aes-256-gcm', key(), iv); decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
}
export const newRecoveryCodes = () => Array.from({ length: 8 }, () => randomBytes(5).toString('hex'));
export const hashRecovery = (code: string) => createHash('sha256').update(code.trim().toLowerCase()).digest('hex');
