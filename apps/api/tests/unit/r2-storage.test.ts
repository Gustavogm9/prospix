/**
 * Testes de r2-storage (AUD-P2-033 R2 fulfillment).
 * Sem mock global de env (evita leak entre tests paralelos).
 * Seta process.env direto antes do import.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendMock = vi.fn();

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(() => ({ send: sendMock })),
  PutObjectCommand: vi.fn((input) => ({ __type: 'PutObjectCommand', input })),
  GetObjectCommand: vi.fn((input) => ({ __type: 'GetObjectCommand', input })),
  DeleteObjectCommand: vi.fn((input) => ({ __type: 'DeleteObjectCommand', input })),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://r2.example.com/presigned?token=mock'),
}));

// Seta env vars ANTES de importar o modulo (env.ts e singleton-cached)
process.env.R2_ACCOUNT_ID = 'mock-account';
process.env.R2_ACCESS_KEY_ID = 'mock-key';
process.env.R2_SECRET_ACCESS_KEY = 'mock-secret';
process.env.R2_BUCKET = 'prospix-test';
process.env.R2_PRESIGN_TTL_SECONDS = String(60 * 60);

const {
  isR2Configured,
  uploadLgpdExport,
  deleteR2Object,
  regenerateR2PresignedUrl,
} = await import('../../src/lib/r2-storage.js');

describe('r2-storage', () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({});
  });

  it('isR2Configured retorna true quando todas as creds estao setadas', () => {
    expect(isR2Configured()).toBe(true);
  });

  it('uploadLgpdExport faz PutObjectCommand + getSignedUrl + retorna metadata', async () => {
    const result = await uploadLgpdExport({
      tenantId: '11111111-1111-1111-1111-111111111111',
      requestId: 'req-1',
      payload: { leads: [{ id: 'l1' }] },
    });

    expect(result.key).toBe('tenant_11111111-1111-1111-1111-111111111111/lgpd-exports/req-1.json');
    expect(result.presignedUrl).toBe('https://r2.example.com/presigned?token=mock');
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(result.size_bytes).toBeGreaterThan(0);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const putCall = sendMock.mock.calls[0]![0];
    expect(putCall.__type).toBe('PutObjectCommand');
    expect(putCall.input.Bucket).toBe('prospix-test');
    expect(putCall.input.ContentType).toBe('application/json');
    expect(putCall.input.CacheControl).toBe('private, no-cache');
    expect(putCall.input.Metadata['tenant-id']).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('deleteR2Object envia DeleteObjectCommand com key', async () => {
    await deleteR2Object('tenant_abc/lgpd-exports/req-1.json');
    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0]![0];
    expect(call.__type).toBe('DeleteObjectCommand');
    expect(call.input.Key).toBe('tenant_abc/lgpd-exports/req-1.json');
  });

  it('regenerateR2PresignedUrl retorna nova URL + TTL', async () => {
    const result = await regenerateR2PresignedUrl('tenant_abc/lgpd-exports/req-1.json');
    expect(result.presignedUrl).toBe('https://r2.example.com/presigned?token=mock');
    expect(result.expiresAt).toBeInstanceOf(Date);
    expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });
});
