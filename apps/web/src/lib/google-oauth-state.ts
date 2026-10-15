import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const GOOGLE_OAUTH_NONCE_COOKIE = 'prospix_google_oauth_nonce';
export const GOOGLE_OAUTH_STATE_TTL_SECONDS = 10 * 60;

type OAuthStatePayload = {
  tenantId: string;
  userId: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
};

function assertSecret(secret: string) {
  if (secret.length < 32) {
    throw new Error('GOOGLE_OAUTH_STATE_SECRET deve ter pelo menos 32 caracteres');
  }
}

function sign(payload: string, secret: string) {
  return createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function invalidState(): never {
  throw new Error('Estado OAuth inválido');
}

export function createGoogleOAuthState(
  identity: { tenantId: string; userId: string },
  secret: string,
  now = Date.now(),
) {
  assertSecret(secret);
  if (!identity.tenantId || !identity.userId) invalidState();

  const nonce = randomBytes(32).toString('base64url');
  const payload: OAuthStatePayload = {
    ...identity,
    nonce,
    issuedAt: now,
    expiresAt: now + GOOGLE_OAUTH_STATE_TTL_SECONDS * 1_000,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');

  return {
    nonce,
    state: `${encodedPayload}.${sign(encodedPayload, secret)}`,
  };
}

export function verifyGoogleOAuthState(
  state: string,
  expectedNonce: string,
  secret: string,
  now = Date.now(),
) {
  assertSecret(secret);
  const parts = state.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1] || !expectedNonce) invalidState();

  const [encodedPayload, receivedSignature] = parts;
  if (!safeEqual(receivedSignature, sign(encodedPayload, secret))) invalidState();

  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as OAuthStatePayload;
  } catch {
    invalidState();
  }

  if (
    !payload ||
    typeof payload.tenantId !== 'string' ||
    !payload.tenantId ||
    typeof payload.userId !== 'string' ||
    !payload.userId ||
    typeof payload.nonce !== 'string' ||
    !safeEqual(payload.nonce, expectedNonce) ||
    typeof payload.issuedAt !== 'number' ||
    typeof payload.expiresAt !== 'number' ||
    payload.issuedAt > now + 60_000 ||
    payload.expiresAt - payload.issuedAt !== GOOGLE_OAUTH_STATE_TTL_SECONDS * 1_000
  ) {
    invalidState();
  }

  if (payload.expiresAt < now) {
    throw new Error('Estado OAuth expirado');
  }

  return { tenantId: payload.tenantId, userId: payload.userId };
}

export function getConfiguredAppOrigin(value: string | undefined) {
  if (!value) throw new Error('NEXT_PUBLIC_APP_URL não configurada');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('NEXT_PUBLIC_APP_URL inválida');
  }
  if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
    throw new Error('NEXT_PUBLIC_APP_URL deve usar HTTPS em produção');
  }
  return url.origin;
}
