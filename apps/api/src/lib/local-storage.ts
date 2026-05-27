import fs from 'fs/promises';
import path from 'path';
import { logger } from './logger.js';

const UPLOAD_BASE = process.env.UPLOAD_DIR || '/data/uploads';

/**
 * Check if local storage is available (always true — filesystem is always there)
 */
export function isLocalStorageConfigured(): boolean {
  return true;
}

/**
 * Upload a file buffer to local filesystem.
 * Returns the relative key (path) for later retrieval.
 */
export async function uploadFile(params: {
  key: string;
  body: Buffer;
  contentType?: string;
}): Promise<{ key: string; size_bytes: number }> {
  const fullPath = path.join(UPLOAD_BASE, params.key);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, params.body);
  logger.info({ key: params.key, size: params.body.byteLength }, 'local-storage:uploaded');
  return { key: params.key, size_bytes: params.body.byteLength };
}

/**
 * Get the absolute filesystem path for a stored file.
 */
export function getFilePath(key: string): string {
  return path.join(UPLOAD_BASE, key);
}

/**
 * Check if a file exists.
 */
export async function fileExists(key: string): Promise<boolean> {
  try {
    await fs.access(path.join(UPLOAD_BASE, key));
    return true;
  } catch {
    return false;
  }
}

/**
 * Read a file from local storage.
 */
export async function readFile(key: string): Promise<Buffer> {
  return fs.readFile(path.join(UPLOAD_BASE, key));
}

/**
 * Delete a file from local storage.
 */
export async function deleteFile(key: string): Promise<void> {
  try {
    await fs.unlink(path.join(UPLOAD_BASE, key));
    logger.info({ key }, 'local-storage:deleted');
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
    logger.warn({ key }, 'local-storage:delete-not-found (non-fatal)');
  }
}

/**
 * Generate the public URL for a stored file.
 * Uses API_URL + /uploads/ prefix which nginx proxies to the filesystem.
 */
export function getPublicUrl(key: string): string {
  const apiUrl = process.env.API_URL || 'http://localhost:3000';
  return `${apiUrl}/uploads/${key}`;
}
