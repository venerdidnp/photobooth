import crypto from 'node:crypto';

const sha256 = (s: string): Buffer => crypto.createHash('sha256').update(s).digest();

/** Perbandingan waktu-konstan (lewat hash supaya panjang berbeda tidak bocor). */
function safeEqual(a: string, b: string): boolean {
  return crypto.timingSafeEqual(sha256(a), sha256(b));
}

/** Periksa header `Authorization: Basic ...` terhadap user + password dari env. */
export function checkBasicAuth(header: string | undefined, user: string, pass: string): boolean {
  if (!header) return false;
  const match = /^basic\s+/i.exec(header);
  if (!match) return false;
  const decoded = Buffer.from(header.slice(match[0].length).trim(), 'base64').toString('utf8');
  const i = decoded.indexOf(':');
  if (i < 0) return false;
  const userOk = safeEqual(decoded.slice(0, i), user);
  const passOk = safeEqual(decoded.slice(i + 1), pass);
  return userOk && passOk;
}

export const BASIC_REALM = 'Basic realm="Photobooth", charset="UTF-8"';
