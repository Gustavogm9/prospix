import crypto from 'crypto';

/**
 * Hashes an opaque token (e.g. API key, refresh token) using SHA-256.
 * Used for storing token hashes in the database instead of plaintext.
 */
export function hashOpaqueToken(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * @deprecated Password hashing is now handled by Supabase Auth (bcrypt).
 * This function is kept temporarily for seed scripts and admin user creation
 * that still write to the DB `passwordHash` column during the migration.
 * Will be removed once all user creation goes through Supabase Auth.
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
