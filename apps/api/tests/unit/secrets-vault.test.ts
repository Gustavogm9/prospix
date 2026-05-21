import { describe, it, expect } from 'vitest';
import { encryptSecret, decryptSecret } from '../../src/tenant/secrets-vault.js';

describe('Secrets Vault (AES-256-GCM)', () => {
  it('should encrypt and decrypt a plaintext string correctly (round-trip)', async () => {
    const originalText = 'my-super-secret-api-key-12345!';
    const ciphertext = await encryptSecret(originalText);
    
    expect(ciphertext).toBeDefined();
    expect(ciphertext).toContain('.');
    expect(ciphertext.split('.')).toHaveLength(3);

    const decryptedText = await decryptSecret(ciphertext);
    expect(decryptedText).toBe(originalText);
  });

  it('should throw an error if the ciphertext is tampered with', async () => {
    const plaintext = 'another-sensitive-token';
    const ciphertext = await encryptSecret(plaintext);
    
    // Split and modify the encrypted content part
    const parts = ciphertext.split('.');
    const [iv, tag, encryptedData] = parts as [string, string, string];
    
    // Create tampered ciphertext by changing a character in the encrypted data
    const tamperedData = encryptedData.substring(0, 5) + (encryptedData[5] === 'A' ? 'B' : 'A') + encryptedData.substring(6);
    const tamperedCiphertext = `${iv}.${tag}.${tamperedData}`;

    await expect(decryptSecret(tamperedCiphertext)).rejects.toThrow('AuthenticationFailed');
  });

  it('should throw an error for malformed ciphertext structure', async () => {
    await expect(decryptSecret('invalid-structure')).rejects.toThrow('AuthenticationFailed');
    await expect(decryptSecret('part1.part2')).rejects.toThrow('AuthenticationFailed');
  });
});
