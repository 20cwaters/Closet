import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { config } from './config.js';
import { db } from './db.js';
import { removeImage, saveWebp } from './images.js';
import { frameCutout, removeBackground } from './processing.js';

/**
 * "Make it perfect": an image model redraws the piece as a clean, flat, evenly lit product
 * shot, which then goes through the usual background removal. The real cutout is kept, so
 * each piece can switch between the two. Runs one piece at a time, like processing.ts.
 */
export const aiEnabled = () => !!config.ai.apiKey;

const queue: number[] = [];
let running = false;

export function enqueueAi(id: number) {
  if (!queue.includes(id)) queue.push(id);
  void pump();
}

/** Pick up anything left half-done by a restart. */
export function resumeAi() {
  const ids = db.prepare("SELECT id FROM items WHERE ai_status = 'processing' ORDER BY id").pluck().all() as number[];
  ids.forEach(enqueueAi);
}

async function pump() {
  if (running) return;
  running = true;
  while (queue.length) await enhanceItem(queue.shift()!);
  running = false;
}

export class AiError extends Error {
  /** `blocked`: the model's content filter refused the photo (retrying won't help). */
  constructor(message: string, readonly blocked = false) {
    super(message);
  }
}

const BLOCKED = 'The AI won’t redraw this one: its filter blocks some prints, like well-known characters.'

const WHAT: Record<string, string> = {
  headwear: 'hat',
  outerwear: 'jacket',
  top: 'top',
  bottom: 'pair of bottoms',
  shoes: 'pair of shoes',
};

/** What to ask for. Faithfulness first: the result has to still be *this* piece. */
export function promptFor(name: string | null, categories: string[]) {
  const kind = WHAT[categories[0]] ?? 'clothing item';
  const what = name ? `${kind} ("${name}")` : kind;
  const pose =
    categories[0] === 'shoes'
      ? 'Show the pair side by side from a slight three-quarter angle, evenly lit with soft studio light.'
      : 'Lay it perfectly flat and symmetrical, smoothed with no wrinkles, viewed straight from above, evenly lit with soft studio light.';
  return [
    `Turn this photo into a clean e-commerce product image of the exact same ${what}.`,
    'Keep the piece identical: same cut, proportions, length, fabric texture and color, and every logo,',
    'letter, number, graphic, print, pattern, label and stitch exactly as photographed, in the same',
    'place and size. Do not add, remove, redraw or invent any detail.',
    pose,
    'Remove everything else in the photo. Only the piece, centered, on a plain solid medium grey',
    'background, no shadow, no props, no added text.',
  ].join(' ');
}

/** Ask Seedream (via OpenRouter) for a product shot of `photo`. Returns the image bytes and the cost in USD. */
export async function recreate(photo: Buffer, prompt: string): Promise<{ image: Buffer; cost: number | null }> {
  const res = await fetch(`${config.ai.apiUrl}/images`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.ai.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ai.model,
      prompt,
      input_references: [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${photo.toString('base64')}` } }],
      aspect_ratio: '3:4',
      resolution: '2K',
      output_format: 'png',
      n: 1,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`ai: ${res.status} ${detail.slice(0, 300)}`);
    if (/moderation/i.test(detail)) throw new AiError(BLOCKED, true);
    throw new AiError(
      res.status === 402
        ? 'Out of AI credits. Add some at openrouter.ai/settings/credits.'
        : res.status === 401 || res.status === 403
          ? "The AI key isn't working (OPENROUTER_API_KEY)."
          : res.status === 429
            ? 'The AI service is busy. Try again in a minute.'
            : `The AI service had a problem (${res.status}). Try again.`,
    );
  }
  const body = (await res.json()) as { data?: { b64_json?: string }[]; usage?: { cost?: number | null } };
  const b64 = body.data?.[0]?.b64_json;
  if (!b64) throw new AiError('The AI service sent back no image. Try again.');
  return { image: Buffer.from(b64, 'base64'), cost: body.usage?.cost ?? null };
}

/**
 * The fallback: OpenAI's image model, for photos Seedream refuses. About 5¢ rather than 2¢,
 * and its own filter is different (it often allows prints Seedream won't).
 */
export async function recreateOpenAi(photo: Buffer, prompt: string): Promise<{ image: Buffer; cost: number | null }> {
  const form = new FormData();
  form.append('model', config.ai.openaiModel);
  form.append('prompt', prompt);
  form.append('image[]', new Blob([new Uint8Array(photo)], { type: 'image/jpeg' }), 'photo.jpg');
  form.append('quality', 'medium');
  form.append('size', '1024x1536');
  form.append('output_format', 'png');
  const res = await fetch(`${config.ai.openaiUrl}/images/edits`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.ai.openaiKey}` },
    body: form,
    signal: AbortSignal.timeout(240_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`ai (openai): ${res.status} ${detail.slice(0, 300)}`);
    if (/moderation|safety/i.test(detail)) throw new AiError(BLOCKED, true);
    throw new AiError(
      /insufficient_quota|billing/i.test(detail)
        ? 'Out of OpenAI credits. Add some at platform.openai.com.'
        : res.status === 401 || res.status === 403
          ? "The OpenAI key isn't working (OPENAI_API_KEY)."
          : res.status === 429
            ? 'The AI service is busy. Try again in a minute.'
            : `The AI service had a problem (${res.status}). Try again.`,
    );
  }
  const body = (await res.json()) as {
    data?: { b64_json?: string }[];
    usage?: { output_tokens?: number; input_tokens_details?: { text_tokens?: number; image_tokens?: number } };
  };
  const b64 = body.data?.[0]?.b64_json;
  if (!b64) throw new AiError('The AI service sent back no image. Try again.');
  // OpenAI bills by token: $5/M text in, $8/M image in, $30/M image out (Oct 2026).
  const u = body.usage;
  const cost = u
    ? ((u.input_tokens_details?.text_tokens ?? 0) * 5 + (u.input_tokens_details?.image_tokens ?? 0) * 8 + (u.output_tokens ?? 0) * 30) / 1e6
    : null;
  return { image: Buffer.from(b64, 'base64'), cost };
}

/** Seedream first; OpenAI (if set up) when Seedream's filter refuses the photo. */
async function recreateAny(id: number, photo: Buffer, prompt: string) {
  try {
    return { ...(await recreate(photo, prompt)), by: 'Seedream' };
  } catch (err) {
    if (!(err instanceof AiError && err.blocked && config.ai.openaiKey)) throw err;
    console.log(`item ${id}: Seedream refused it, trying OpenAI`);
    return { ...(await recreateOpenAi(photo, prompt)), by: 'OpenAI' };
  }
}

/** Make (or redo) a piece's AI version. Errors end up on the item, not thrown. */
export async function enhanceItem(id: number) {
  const item = db
    .prepare('SELECT original_path, name, ai_cutout_path, ai_thumb_path FROM items WHERE id = ?')
    .get(id) as { original_path: string; name: string | null; ai_cutout_path: string | null; ai_thumb_path: string | null } | undefined;
  if (!item) return;
  const categories = db
    .prepare("SELECT value FROM item_tags WHERE item_id = ? AND kind = 'category'")
    .pluck()
    .all(id) as string[];
  try {
    const original = await fs.readFile(path.join(config.imagesDir, item.original_path));
    // The model works at about this size anyway; a smaller upload is quicker.
    const photo = await sharp(original).rotate().resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
    const started = Date.now();
    const { image, cost, by } = await recreateAny(id, photo, promptFor(item.name, categories));
    const framed = await frameCutout(await removeBackground(image));
    const cutout = await saveWebp(framed, 'cutouts', { max: 1600, quality: 88 });
    const thumb = await saveWebp(framed, 'thumbs', { max: 480, quality: 80 });
    // Only if it's still the same photo (a retake while we worked makes this result stale).
    const { changes } = db
      .prepare(
        `UPDATE items SET ai_status = 'ready', ai_cutout_path = ?, ai_thumb_path = ?, ai_error = NULL, use_ai = 1
         WHERE id = ? AND original_path = ?`,
      )
      .run(cutout, thumb, id, item.original_path);
    if (!changes) [cutout, thumb].forEach(removeImage);
    else [item.ai_cutout_path, item.ai_thumb_path].forEach(removeImage);
    console.log(`item ${id}: AI version (${by}) ready in ${((Date.now() - started) / 1000).toFixed(0)}s${cost != null ? `, $${cost.toFixed(4)}` : ''}`);
  } catch (err) {
    console.error(`item ${id}: AI version failed`, err);
    const message = err instanceof AiError ? err.message : "Couldn't make the AI version. Try again.";
    db.prepare("UPDATE items SET ai_status = 'failed', ai_error = ? WHERE id = ? AND ai_status = 'processing'").run(message, id);
  }
}
