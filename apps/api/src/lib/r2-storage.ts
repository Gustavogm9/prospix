/**
 * Cloudflare R2 storage (S3-compatible) · AUD-P2-033 fulfillment.
 *
 * Uploads LGPD export artifacts e gera URLs presigned com TTL configurável.
 * Paths sempre prefixados com `tenant_{id}/` para isolamento operacional.
 *
 * Em ambientes sem credenciais R2 (dev / test sem config),
 * `isR2Configured()` retorna false e callers usam fallback inline.
 *
 * Endpoint Cloudflare R2: https://{account_id}.r2.cloudflarestorage.com
 */
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env.js';
import { logger } from './logger.js';

let cachedClient: S3Client | null = null;

export function isR2Configured(): boolean {
  return !!(env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY);
}

export function getR2Client(): S3Client {
  if (cachedClient) return cachedClient;

  if (!isR2Configured()) {
    throw new Error('R2 storage not configured · set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY');
  }

  cachedClient = new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    },
  });

  return cachedClient;
}

/**
 * Faz upload de payload JSON ao R2 e retorna URL presigned com TTL.
 *
 * - Path: `tenant_{tenantId}/lgpd-exports/{filename}.json`
 * - Content-Type: application/json
 * - Cache-Control: private, no-cache (LGPD-sensitive)
 * - URL presigned · expira em R2_PRESIGN_TTL_SECONDS (default 7d)
 */
export async function uploadLgpdExport(params: {
  tenantId: string;
  requestId: string;
  payload: Record<string, unknown>;
}): Promise<{ key: string; presignedUrl: string; expiresAt: Date; size_bytes: number }> {
  if (!isR2Configured()) {
    throw new Error('R2 not configured for export upload');
  }

  const client = getR2Client();
  const key = `tenant_${params.tenantId}/lgpd-exports/${params.requestId}.json`;
  const body = Buffer.from(JSON.stringify(params.payload, null, 2), 'utf-8');

  await client.send(
    new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: key,
      Body: body,
      ContentType: 'application/json',
      CacheControl: 'private, no-cache',
      Metadata: {
        'tenant-id': params.tenantId,
        'lgpd-request-id': params.requestId,
        'uploaded-at': new Date().toISOString(),
      },
    }),
  );

  const presignedUrl = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }),
    { expiresIn: env.R2_PRESIGN_TTL_SECONDS },
  );

  const expiresAt = new Date(Date.now() + env.R2_PRESIGN_TTL_SECONDS * 1000);

  logger.info(
    {
      tenant_id: params.tenantId,
      lgpd_request_id: params.requestId,
      key,
      size_bytes: body.byteLength,
      expires_at: expiresAt.toISOString(),
    },
    'r2:lgpd-export-uploaded',
  );

  return { key, presignedUrl, expiresAt, size_bytes: body.byteLength };
}

/**
 * Remove um objeto do R2.
 * Usado quando admin purge um export antes do TTL expirar.
 */
export async function deleteR2Object(key: string): Promise<void> {
  if (!isR2Configured()) {
    throw new Error('R2 not configured');
  }
  const client = getR2Client();
  await client.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET, Key: key }));
  logger.info({ key }, 'r2:object-deleted');
}

/**
 * Gera URL presigned para upload (PUT direto pelo client) ao R2.
 *
 * Usado pelo flow Frente G Discovery (audio/video/transcrição/aprovação)
 * onde o client envia o arquivo binário sem passar pelo backend.
 *
 * @param key path completo no bucket (caller monta com tenant prefix)
 * @param contentType MIME enforçado no upload
 * @param expiresInSeconds TTL do PUT URL (default 15min)
 */
export async function presignUpload(params: {
  key: string;
  contentType: string;
  expiresInSeconds?: number;
}): Promise<{ uploadUrl: string; expiresAt: Date }> {
  if (!isR2Configured()) {
    throw new Error('R2 not configured for presigned upload');
  }
  const client = getR2Client();
  const ttl = params.expiresInSeconds ?? 900;
  const uploadUrl = await getSignedUrl(
    client,
    new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: params.key,
      ContentType: params.contentType,
      CacheControl: 'private, no-cache',
    }),
    { expiresIn: ttl },
  );
  const expiresAt = new Date(Date.now() + ttl * 1000);
  return { uploadUrl, expiresAt };
}

/**
 * Regenera URL presigned para um objeto existente.
 * Util quando a URL anterior expirou e o admin precisa nova.
 */
export async function regenerateR2PresignedUrl(key: string): Promise<{ presignedUrl: string; expiresAt: Date }> {
  if (!isR2Configured()) {
    throw new Error('R2 not configured');
  }
  const client = getR2Client();
  const presignedUrl = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: key }),
    { expiresIn: env.R2_PRESIGN_TTL_SECONDS },
  );
  const expiresAt = new Date(Date.now() + env.R2_PRESIGN_TTL_SECONDS * 1000);
  return { presignedUrl, expiresAt };
}
