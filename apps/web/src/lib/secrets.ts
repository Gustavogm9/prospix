import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto';

const PREFIX = 'enc:v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function encryptionKey(encodedKey = process.env.SECRETS_ENCRYPTION_KEY || '') {
  let key: Buffer;
  try {
    key = Buffer.from(encodedKey, 'base64');
  } catch {
    throw new Error('SECRETS_ENCRYPTION_KEY inválida');
  }

  if (!encodedKey || key.length !== 32) {
    throw new Error('SECRETS_ENCRYPTION_KEY deve conter exatamente 32 bytes em base64');
  }
  return key;
}

export function isEncryptedSecret(value: string) {
  return value.startsWith(`${PREFIX}:`);
}

function decodeBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid base64url');
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.toString('base64url') !== value) throw new Error('non-canonical base64url');
  return decoded;
}

export function encryptSecret(
  plaintext: string,
  encodedKey = process.env.SECRETS_ENCRYPTION_KEY || '',
) {
  if (!plaintext) throw new Error('Segredo vazio não pode ser criptografado');
  const key = encryptionKey(encodedKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    PREFIX,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join(':');
}

export function decryptSecret(
  encrypted: string,
  encodedKey = process.env.SECRETS_ENCRYPTION_KEY || '',
) {
  const key = encryptionKey(encodedKey);
  const parts = encrypted.split(':');
  if (parts.length !== 5 || `${parts[0]}:${parts[1]}` !== PREFIX) {
    throw new Error('Segredo criptografado inválido');
  }

  try {
    const iv = decodeBase64Url(parts[2]!);
    const tag = decodeBase64Url(parts[3]!);
    const ciphertext = decodeBase64Url(parts[4]!);
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || !ciphertext.length) {
      throw new Error('invalid envelope');
    }
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Segredo criptografado inválido');
  }
}

export function readStoredSecret(
  stored: string,
  encodedKey = process.env.SECRETS_ENCRYPTION_KEY || '',
  options: { allowLegacyPlaintext?: boolean } = {},
) {
  if (isEncryptedSecret(stored)) return decryptSecret(stored, encodedKey);
  if (options.allowLegacyPlaintext) return stored;
  throw new Error('Segredo legado em texto puro não autorizado');
}
