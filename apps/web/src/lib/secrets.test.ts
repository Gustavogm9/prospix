import { describe, expect, it } from 'vitest';
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecret,
  readStoredSecret,
} from './secrets';

const key = Buffer.alloc(32, 7).toString('base64');
const otherKey = Buffer.alloc(32, 8).toString('base64');

describe('segredos de tenant', () => {
  it('protege com AES-256-GCM e recupera o conteúdo', () => {
    const encrypted = encryptSecret('valor-sensível', key);

    expect(isEncryptedSecret(encrypted)).toBe(true);
    expect(encrypted).not.toContain('valor-sensível');
    expect(decryptSecret(encrypted, key)).toBe('valor-sensível');
  });

  it('usa nonce diferente em cada gravação', () => {
    expect(encryptSecret('mesmo-valor', key)).not.toBe(encryptSecret('mesmo-valor', key));
  });

  it('rejeita adulteração e chave incorreta', () => {
    const encrypted = encryptSecret('valor-sensível', key);

    expect(() => decryptSecret(`${encrypted}x`, key)).toThrow('Segredo criptografado inválido');
    expect(() => decryptSecret(encrypted, otherKey)).toThrow('Segredo criptografado inválido');
  });

  it('falha fechado com chave ausente ou de tamanho incorreto', () => {
    expect(() => encryptSecret('valor', '')).toThrow('SECRETS_ENCRYPTION_KEY');
    expect(() => encryptSecret('valor', Buffer.alloc(16).toString('base64'))).toThrow(
      'SECRETS_ENCRYPTION_KEY',
    );
  });

  it('aceita legado em texto puro somente quando explicitamente autorizado', () => {
    expect(() => readStoredSecret('legado', key)).toThrow('texto puro');
    expect(readStoredSecret('legado', key, { allowLegacyPlaintext: true })).toBe('legado');
  });
});
