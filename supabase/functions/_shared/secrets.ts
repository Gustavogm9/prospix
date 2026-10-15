const PREFIX = 'enc:v1';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function fromBase64(value: string): Uint8Array {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '='));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function env(name: string) {
  const deno = (globalThis as typeof globalThis & {
    Deno?: { env?: { get?: (key: string) => string | undefined } };
  }).Deno;
  return deno?.env?.get?.(name) || '';
}

function asArrayBuffer(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

function keyBytes(encodedKey = env('SECRETS_ENCRYPTION_KEY')) {
  const bytes = fromBase64(encodedKey);
  if (!encodedKey || bytes.length !== 32) {
    throw new Error('SECRETS_ENCRYPTION_KEY must contain exactly 32 base64 bytes');
  }
  return bytes;
}

async function cryptoKey(encodedKey?: string) {
  return crypto.subtle.importKey(
    'raw',
    asArrayBuffer(keyBytes(encodedKey)),
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );
}

export function isEncryptedSecret(value: string) {
  return value.startsWith(`${PREFIX}:`);
}

export async function decryptSecret(value: string, encodedKey?: string) {
  const parts = value.split(':');
  if (parts.length !== 5 || `${parts[0]}:${parts[1]}` !== PREFIX) {
    throw new Error('Invalid encrypted secret');
  }

  try {
    const iv = fromBase64(parts[2]!);
    const tag = fromBase64(parts[3]!);
    const ciphertext = fromBase64(parts[4]!);
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES || !ciphertext.length) {
      throw new Error('Invalid envelope');
    }
    const encrypted = new Uint8Array(ciphertext.length + tag.length);
    encrypted.set(ciphertext);
    encrypted.set(tag, ciphertext.length);
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: asArrayBuffer(iv), tagLength: 128 },
      await cryptoKey(encodedKey),
      asArrayBuffer(encrypted),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new Error('Invalid encrypted secret');
  }
}

export async function readStoredSecret(value: string) {
  if (isEncryptedSecret(value)) return decryptSecret(value);
  if (env('ALLOW_LEGACY_PLAINTEXT_SECRETS') === 'true') return value;
  throw new Error('Legacy plaintext secret is not allowed');
}
