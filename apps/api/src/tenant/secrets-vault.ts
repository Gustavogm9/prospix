import crypto from 'crypto';
import { env } from '../config/env.js';
import { dbAdmin } from '../lib/db.js';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 12 bytes standard for GCM

// Cache the parsed encryption key
let parsedKey: Buffer;
try {
  parsedKey = Buffer.from(env.SECRETS_ENCRYPTION_KEY, 'base64');
  if (parsedKey.length !== 32) {
    throw new Error(`SECRETS_ENCRYPTION_KEY must be a 32-byte base64 string (got ${parsedKey.length} bytes)`);
  }
} catch (err) {
  throw new Error(`Invalid SECRETS_ENCRYPTION_KEY config: ${(err as Error).message}`);
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Output format: <iv_base64>.<tag_base64>.<ciphertext_base64>
 */
export async function encryptSecret(plaintext: string): Promise<string> {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, parsedKey, iv);
  
  let encrypted = cipher.update(plaintext, 'utf8', 'base64');
  encrypted += cipher.final('base64');
  
  const tag = cipher.getAuthTag();
  
  const ivBase64 = iv.toString('base64');
  const tagBase64 = tag.toString('base64');
  
  return `${ivBase64}.${tagBase64}.${encrypted}`;
}

/**
 * Decrypt a ciphertext string using AES-256-GCM.
 * Input format: <iv_base64>.<tag_base64>.<ciphertext_base64>
 */
export async function decryptSecret(ciphertext: string): Promise<string> {
  try {
    const parts = ciphertext.split('.');
    if (parts.length !== 3) {
      throw new Error('Invalid ciphertext format. Expected <iv>.<tag>.<data>');
    }

    const [ivBase64, tagBase64, dataBase64] = parts as [string, string, string];
    const iv = Buffer.from(ivBase64, 'base64');
    const tag = Buffer.from(tagBase64, 'base64');
    const data = Buffer.from(dataBase64, 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, parsedKey, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(data);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString('utf8');
  } catch {
    // Standard tampering error
    throw new Error('Decryption failed: AuthenticationFailed');
  }
}

interface DecryptedSecrets {
  evolutionBaseUrl: string | null;
  evolutionInstanceName: string | null;
  evolutionApiKey: string | null;
  googleOauthRefresh: string | null;
  googleMapsApiKey: string | null;
  openaiApiKey: string | null;
  anthropicApiKey: string | null;
  googleAiApiKey: string | null;
  twilioAccountSid: string | null;
  twilioAuthToken: string | null;
}

/**
 * Helper to fetch tenant secrets from DB and return all values decrypted.
 */
export async function getDecryptedSecrets(tenantId: string): Promise<DecryptedSecrets | null> {
  const { data: record, error } = await dbAdmin
    .from('tenant_secrets')
    .select('*')
    .eq('tenant_id', tenantId)
    .single();

  if (error || !record) return null;

  const decryptOrNull = async (val: string | null): Promise<string | null> => {
    if (!val) return null;
    return decryptSecret(val);
  };

  return {
    evolutionBaseUrl: record.evolution_base_url,
    evolutionInstanceName: record.evolution_instance_name,
    evolutionApiKey: await decryptOrNull(record.evolution_api_key_encrypted),
    googleOauthRefresh: await decryptOrNull(record.google_oauth_refresh_encrypted),
    googleMapsApiKey: await decryptOrNull(record.google_maps_api_key_encrypted),
    openaiApiKey: await decryptOrNull(record.openai_api_key_encrypted),
    anthropicApiKey: await decryptOrNull(record.anthropic_api_key_encrypted),
    googleAiApiKey: await decryptOrNull(record.google_ai_api_key_encrypted),
    twilioAccountSid: await decryptOrNull(record.twilio_account_sid_encrypted),
    twilioAuthToken: await decryptOrNull(record.twilio_auth_token_encrypted),
  };
}
