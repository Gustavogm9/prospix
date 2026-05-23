import crypto from 'crypto';

export function hashOpaqueToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Hash a password using the secure scrypt algorithm with a random salt.
 * Returns the hash in salt:hash format.
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

/**
 * Verify a cleartext password against a stored scrypt hash in salt:hash format.
 * Implements timingSafeEqual to fully prevent timing-attacks.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  try {
    const parts = storedHash.split(':');
    if (parts.length !== 2) return false;
    
    const [salt, key] = parts;
    if (!salt || !key) return false;

    const hash = crypto.scryptSync(password, salt, 64).toString('hex');
    
    const bufferKey = Buffer.from(key, 'hex');
    const bufferHash = Buffer.from(hash, 'hex');

    if (bufferKey.length !== bufferHash.length) return false;

    return crypto.timingSafeEqual(bufferKey, bufferHash);
  } catch (err) {
    console.error('⚠️ Exception during password verification:', err);
    return false;
  }
}
