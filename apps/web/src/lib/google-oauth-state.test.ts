import { describe, expect, it } from 'vitest';
import {
  createGoogleOAuthState,
  verifyGoogleOAuthState,
} from './google-oauth-state';

const secret = 'test-secret-with-at-least-thirty-two-characters';
const now = Date.UTC(2026, 9, 15, 12, 0, 0);

describe('Google OAuth state', () => {
  it('vincula tenant, usuário, nonce e expiração em um estado assinado', () => {
    const issued = createGoogleOAuthState(
      { tenantId: 'tenant-a', userId: 'user-a' },
      secret,
      now,
    );

    expect(
      verifyGoogleOAuthState(issued.state, issued.nonce, secret, now + 1_000),
    ).toEqual({ tenantId: 'tenant-a', userId: 'user-a' });
  });

  it('rejeita alteração do tenant no payload', () => {
    const issued = createGoogleOAuthState(
      { tenantId: 'tenant-a', userId: 'user-a' },
      secret,
      now,
    );
    const [payload, signature] = issued.state.split('.');
    const decoded = JSON.parse(Buffer.from(payload!, 'base64url').toString('utf8'));
    decoded.tenantId = 'tenant-b';
    const tampered = `${Buffer.from(JSON.stringify(decoded)).toString('base64url')}.${signature!}`;

    expect(() =>
      verifyGoogleOAuthState(tampered, issued.nonce, secret, now + 1_000),
    ).toThrow('Estado OAuth inválido');
  });

  it('rejeita callback sem o nonce HttpOnly emitido para o navegador', () => {
    const issued = createGoogleOAuthState(
      { tenantId: 'tenant-a', userId: 'user-a' },
      secret,
      now,
    );

    expect(() =>
      verifyGoogleOAuthState(issued.state, 'nonce-de-outro-fluxo', secret, now),
    ).toThrow('Estado OAuth inválido');
  });

  it('rejeita estado vencido', () => {
    const issued = createGoogleOAuthState(
      { tenantId: 'tenant-a', userId: 'user-a' },
      secret,
      now,
    );

    expect(() =>
      verifyGoogleOAuthState(issued.state, issued.nonce, secret, now + 10 * 60_000 + 1),
    ).toThrow('Estado OAuth expirado');
  });

  it('falha fechado quando o segredo não atende ao mínimo', () => {
    expect(() =>
      createGoogleOAuthState({ tenantId: 'tenant-a', userId: 'user-a' }, 'curto', now),
    ).toThrow('GOOGLE_OAUTH_STATE_SECRET');
  });
});
