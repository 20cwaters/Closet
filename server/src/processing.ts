import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { aiEnabled, enqueueAi } from './ai.js';
import { config } from './config.js';
import { db } from './db.js';
import { removeImage, saveWebp } from './images.js';

/**
 * Background removal runs one photo at a time in the background, so an upload returns
 * as soon as the original is saved and tagging can start while cutouts are still being made.
 */
const queue: number[] = [];
let running = false;

export function enqueue(id: number) {
  if (!queue.includes(id)) queue.push(id);
  void pump();
}

/** Pick up anything left half-done by a restart. */
export function resumePending() {
  const ids = db.prepare("SELECT id FROM items WHERE status = 'processing' ORDER BY id").pluck().all() as number[];
  ids.forEach(enqueue);
}

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) {
    const id = queue.shift()!;
    try {
      await processItem(id);
    } catch (err) {
      console.error(`item ${id}: processing failed`, err);
    }
  }
  running = false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Ask rembg for a transparent PNG. Retries while rembg is still starting (it takes ~1 min cold). */
export async function removeBackground(image: Buffer): Promise<Buffer> {
  for (let attempt = 0; ; attempt++) {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(image)]), 'photo.webp');
    form.append('model', config.rembgModel);
    try {
      const res = await fetch(`${config.rembgUrl}/api/remove`, {
        method: 'POST',
        body: form,
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) throw new Error(`rembg answered ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    } catch (err) {
      // Connection refused/reset = rembg not up yet (or restarting). Give it ~3 minutes.
      const transient = err instanceof TypeError || (err as Error).name === 'TimeoutError';
      if (!transient || attempt >= 18) throw err;
      await sleep(10_000);
    }
  }
}

/**
 * Make an item's cutout and thumbnail. `redo` re-makes an existing cutout (after the
 * pipeline improves): if that fails, the item keeps the cutout it had.
 */
export async function processItem(id: number, { redo = false } = {}) {
  const item = db.prepare('SELECT original_path, cutout_path, thumb_path FROM items WHERE id = ?').get(id) as
    | { original_path: string; cutout_path: string | null; thumb_path: string | null }
    | undefined;
  if (!item) return;
  const original = await fs.readFile(path.join(config.imagesDir, item.original_path)).catch(() => null);
  if (!original) return; // deleted before we got to it

  try {
    const png = await removeBackground(original);
    const framed = await frameCutout(png);

    const cutout = await saveWebp(framed, 'cutouts', { max: CUTOUT_MAX, quality: 88 });
    const thumb = await saveWebp(framed, 'thumbs', { max: 480, quality: 80 });
    const { changes } = db
      .prepare("UPDATE items SET cutout_path = ?, thumb_path = ?, status = 'ready' WHERE id = ?")
      .run(cutout, thumb, id);
    // Deleted while we were working on it; otherwise the old images (redo, or the
    // fallback thumbnail of an earlier failed attempt) are no longer used.
    if (!changes) [cutout, thumb].forEach(removeImage);
    else [item.cutout_path, item.thumb_path].forEach(removeImage);
    // New pieces (and retakes) get their AI version straight away; it's shown once ready.
    if (changes && !redo && aiEnabled()) {
      db.prepare("UPDATE items SET ai_status = 'processing', ai_error = NULL WHERE id = ? AND ai_status IS NULL").run(id);
      enqueueAi(id);
    }
  } catch (err) {
    if (redo) {
      console.error(`item ${id}: redoing the cutout failed, keeping the old one`, err);
      return;
    }
    console.error(`item ${id}: background removal failed, using the original photo`, err);
    const thumb = await saveWebp(original, 'thumbs', { max: 480, quality: 80 });
    const { changes } = db.prepare("UPDATE items SET thumb_path = ?, status = 'failed' WHERE id = ?").run(thumb, id);
    if (!changes) removeImage(thumb);
  }
}

/** Long edge of a finished cutout: about what the tablet's largest view shows at full sharpness. */
const CUTOUT_MAX = 1600;
/** Alpha below this (of 255) is background haze rembg wasn't sure about; it's faded to 0. */
const HAZE = 28;
/** Connected-blob analysis runs on a grid of CELL×CELL pixel cells. */
const CELL = 8;
/** Blobs smaller than this fraction of the largest are stray bits (a hanger, a pillow corner). */
const MIN_BLOB = 0.2;

/**
 * Clean and crop a rembg cutout:
 *  1. fade faint haze to fully transparent,
 *  2. keep only the main object(s): label solid blobs on a coarse grid and drop any much
 *     smaller than the largest (a pair of shoes is two similar blobs, so both stay),
 *  3. crop to what's left, plus a small margin so the drop shadow isn't clipped.
 * (sharp's trim() can't be used: rembg keeps the original colours under transparent pixels.)
 */
export async function frameCutout(png: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const gw = Math.ceil(width / CELL);
  const gh = Math.ceil(height / CELL);

  // 1. Haze → 0, and mark grid cells that contain solid (alpha > 128) pixels.
  const scale = 255 / (255 - HAZE);
  const solid = new Uint8Array(gw * gh);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4 + 3;
      const a = Math.max(0, Math.round((data[i] - HAZE) * scale));
      data[i] = a;
      if (a > 128) solid[((y / CELL) | 0) * gw + ((x / CELL) | 0)] = 1;
    }
  }

  // 2. Label 8-connected blobs of solid cells.
  const label = new Int32Array(gw * gh).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let start = 0; start < solid.length; start++) {
    if (!solid[start] || label[start] >= 0) continue;
    const id = sizes.length;
    let size = 0;
    label[start] = id;
    stack.push(start);
    while (stack.length) {
      const c = stack.pop()!;
      size++;
      const cx = c % gw;
      const cy = (c / gw) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const n = ny * gw + nx;
          if (solid[n] && label[n] < 0) {
            label[n] = id;
            stack.push(n);
          }
        }
      }
    }
    sizes.push(size);
  }
  const largest = Math.max(0, ...sizes);
  // Reject near-empty masks (rembg found nothing it thinks is the subject).
  // (A small subject far away is still fine, just lower resolution once cropped.)
  if (largest * CELL * CELL < width * height * 0.002) throw new Error('cutout is empty');

  // Cells to keep, and their bounding box.
  const keep = Buffer.alloc(gw * gh);
  let minX = gw, minY = gh, maxX = 0, maxY = 0;
  for (let c = 0; c < label.length; c++) {
    if (label[c] < 0 || sizes[label[c]] < largest * MIN_BLOB) continue;
    keep[c] = 255;
    const cx = c % gw;
    const cy = (c / gw) | 0;
    minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
    minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
  }
  // Grow the box by one cell so the feathered edge isn't cropped.
  minX = Math.max(0, minX - 1); minY = Math.max(0, minY - 1);
  maxX = Math.min(gw - 1, maxX + 1); maxY = Math.min(gh - 1, maxY + 1);
  const left = minX * CELL;
  const top = minY * CELL;
  const w = Math.min(width, (maxX + 1) * CELL) - left;
  const h = Math.min(height, (maxY + 1) * CELL) - top;

  // Upsample the cell mask with a blur so dropped regions fade out instead of
  // leaving blocky grid-shaped edges, then multiply it into the alpha.
  const mask = await sharp(keep, { raw: { width: gw, height: gh, channels: 1 } })
    .resize(gw * CELL, gh * CELL, { kernel: 'cubic' })
    .blur(CELL * 0.75)
    .extract({ left: 0, top: 0, width, height })
    .extractChannel(0) // sharp would otherwise hand back 3-channel sRGB
    .raw()
    .toBuffer();
  for (let p = 0; p < width * height; p++) {
    data[p * 4 + 3] = (data[p * 4 + 3] * Math.min(255, mask[p] * 2)) / 255;
  }

  // 3. Crop to the kept cells and add the margin.
  const pad = Math.round(Math.max(w, h) * 0.04);
  return sharp(data, { raw: { width, height, channels: 4 } })
    .extract({ left, top, width: w, height: h })
    .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
}
