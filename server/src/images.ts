import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import sharp from 'sharp';
import { config } from './config.js';

export type Folder = 'originals' | 'cutouts' | 'thumbs' | 'outfits' | 'people';

/** Accept one photo per request, held in memory (the client already shrank it). */
export const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
}).single('photo');

/** Long edge of stored item originals (cutouts are cropped from these). */
export const ORIGINAL_MAX = 2400;

const newName = () => `${crypto.randomUUID()}.webp`;

/** Write a buffer under images/<folder>/ as WebP; returns the path relative to images/. */
export async function saveWebp(
  input: Buffer | sharp.Sharp,
  folder: Folder,
  opts: { max?: number; quality?: number } = {},
): Promise<string> {
  const rel = path.posix.join(folder, newName());
  const dest = path.join(config.imagesDir, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  // A ready-made pipeline brings its own rotate/resize (sharp keeps only the last resize call).
  const pipeline = Buffer.isBuffer(input)
    ? sharp(input)
        .rotate()
        .resize({ width: opts.max ?? 1200, height: opts.max ?? 1200, fit: 'inside', withoutEnlargement: true })
    : input;
  await pipeline
    .webp({ quality: opts.quality ?? 85, alphaQuality: 90 })
    .toFile(dest);
  return rel;
}

export function removeImage(rel: string | null | undefined) {
  if (!rel) return;
  fs.rm(path.join(config.imagesDir, rel), { force: true }, () => {});
}
