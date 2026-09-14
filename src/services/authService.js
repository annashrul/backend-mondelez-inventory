import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const secret = process.env.AUTH_SECRET || 'development-only-change-me';

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  if (!stored?.startsWith('scrypt$')) return false;
  const [, salt, expectedHex] = stored.split('$');
  const expected = Buffer.from(expectedHex, 'hex');
  const actual = await scrypt(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function createToken(user) {
  const payload = Buffer.from(JSON.stringify({ sub: String(user.id), exp: Math.floor(Date.now() / 1000) + Number(process.env.AUTH_TOKEN_TTL_SECONDS || 28800) })).toString('base64url');
  const signature = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyToken(token) {
  const [payload, signature] = String(token || '').split('.');
  if (!payload || !signature) return null;
  const expected = createHmac('sha256', secret).update(payload).digest('base64url');
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (decoded.exp && decoded.exp < Math.floor(Date.now() / 1000)) return null;
  return decoded;
}
