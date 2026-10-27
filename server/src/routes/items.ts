import { Router } from 'express';
import { db, isPerson } from '../db.js';
import { ORIGINAL_MAX, photoUpload, removeImage, saveWebp } from '../images.js';
import { aiEnabled, enqueueAi } from '../ai.js';
import { enqueue } from '../processing.js';
import { CATEGORIES, WEATHER_TAGS, type Category, type WeatherTag } from '../rules.js';
import { outfitsWithItem } from './outfits.js';

export const items = Router();


interface ItemRow {
  id: number;
  owner: string;
  shared: number;
  name: string | null;
  original_path: string;
  cutout_path: string | null;
  thumb_path: string | null;
  status: string;
  ai_status: 'processing' | 'ready' | 'failed' | null;
  ai_cutout_path: string | null;
  ai_thumb_path: string | null;
  ai_error: string | null;
  use_ai: number;
  dress: number;
  archived: number;
  created_at: string;
  last_worn?: string | null;
}

export interface Tags {
  categories: Category[];
  weather: WeatherTag[];
  styles: string[];
}

/** Tags for a set of items, each list in a stable order (categories head to toe, styles as listed). */
export function loadTags(ids: number[]): Map<number, Tags> {
  const out = new Map<number, Tags>(ids.map((id) => [id, { categories: [], weather: [], styles: [] }]));
  if (!ids.length) return out;
  const rows = db
    .prepare(
      `SELECT t.item_id, t.kind, t.value FROM item_tags t
       LEFT JOIN styles s ON t.kind = 'style' AND s.name = t.value
       WHERE t.item_id IN (SELECT value FROM json_each(?))
       ORDER BY s.position, t.value`,
    )
    .all(JSON.stringify(ids)) as { item_id: number; kind: string; value: string }[];
  for (const r of rows) {
    const t = out.get(r.item_id)!;
    if (r.kind === 'category') t.categories.push(r.value as Category);
    else if (r.kind === 'weather') t.weather.push(r.value as WeatherTag);
    else t.styles.push(r.value);
  }
  for (const t of out.values()) {
    t.categories.sort((a, b) => CATEGORIES.indexOf(a) - CATEGORIES.indexOf(b));
    t.weather.sort((a, b) => WEATHER_TAGS.indexOf(a) - WEATHER_TAGS.indexOf(b));
  }
  return out;
}

/** `cutout`/`thumb` are whichever version the piece shows, so the rest of the app needn't care. */
export const toItem = (r: ItemRow, tags: Tags) => {
  const useAi = !!r.use_ai && r.ai_status === 'ready';
  return {
  id: r.id,
  owner: r.owner,
  shared: !!r.shared,
  ...tags,
  name: r.name,
  original: r.original_path,
  cutout: useAi ? r.ai_cutout_path : r.cutout_path,
  thumb: useAi ? r.ai_thumb_path : r.thumb_path,
  status: r.status,
  ai: r.ai_status ? { status: r.ai_status, error: r.ai_error } : null,
  useAi,
  dress: !!r.dress,
  archived: !!r.archived,
  createdAt: r.created_at,
  lastWorn: r.last_worn ?? null,
  };
};

/** Rows → API items, with their tags. */
export function withTags(rows: ItemRow[]) {
  const tags = loadTags(rows.map((r) => r.id));
  return rows.map((r) => toItem(r, tags.get(r.id)!));
}

const LAST_WORN = `(SELECT MAX(worn_on) FROM wear_log w WHERE w.item_id = i.id AND w.person = @person) AS last_worn`;

/** Items visible to a person: their own plus anything the other person shared. */
export function visibleItems(person: string) {
  return withTags(
    db
      .prepare(
        `SELECT i.*, ${LAST_WORN} FROM items i
         WHERE (i.owner = @person OR i.shared = 1) AND i.archived = 0
         ORDER BY i.created_at DESC, i.id DESC`,
      )
      .all({ person }) as ItemRow[],
  );
}

export function getItem(id: number | string, person?: string) {
  const row = db.prepare(`SELECT i.*, ${LAST_WORN} FROM items i WHERE i.id = @id`).get({ id, person: person ?? '' }) as
    | ItemRow
    | undefined;
  return row && withTags([row])[0];
}

items.get('/', (req, res) => {
  const person = String(req.query.person ?? '');
  if (!isPerson(person)) return void res.status(400).json({ error: 'person is required' });
  res.json(visibleItems(person));
});

items.get('/:id/outfits', (req, res) => {
  const person = String(req.query.person ?? '');
  if (!isPerson(person)) return void res.status(400).json({ error: 'person is required' });
  res.json(outfitsWithItem(person, req.params.id));
});

items.get('/:id', (req, res) => {
  const item = getItem(req.params.id, req.query.person as string | undefined);
  if (!item) return void res.status(404).json({ error: 'No such item' });
  res.json(item);
});

/** Upload one photo → new untagged item; the cutout is made in the background. */
items.post('/', photoUpload, async (req, res) => {
  const owner = String(req.body.owner ?? '');
  if (!isPerson(owner)) return void res.status(400).json({ error: 'owner is required' });
  if (!req.file) return void res.status(400).json({ error: 'No photo uploaded' });

  const original = await saveWebp(req.file.buffer, 'originals', { max: ORIGINAL_MAX, quality: 90 });
  const { lastInsertRowid } = db
    .prepare('INSERT INTO items (owner, original_path) VALUES (?, ?)')
    .run(owner, original);
  enqueue(Number(lastInsertRowid));
  res.status(201).json(getItem(Number(lastInsertRowid), owner));
});

/** Validate a tag list from the client: an array of allowed, distinct values. */
function tagList(value: unknown, allowed: readonly string[] | null, label: string): string[] | string {
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string'))
    return `${label} must be a list`;
  const list = [...new Set(value.map((v) => v.trim()).filter(Boolean))];
  const bad = allowed && list.find((v) => !allowed.includes(v));
  return bad ? `Unknown ${label.toLowerCase()}: ${bad}` : list;
}

items.patch('/:id', (req, res) => {
  const { categories, weather, styles, name, shared, archived, useAi, dress } = req.body ?? {};
  const id = Number(req.params.id);
  if (!db.prepare('SELECT 1 FROM items WHERE id = ?').get(id))
    return void res.status(404).json({ error: 'No such item' });

  const tagSets: [string, string[]][] = [];
  for (const [kind, value, allowed, label] of [
    ['category', categories, CATEGORIES, 'Category'],
    ['weather', weather, WEATHER_TAGS, 'Weather'],
    ['style', styles, null, 'Style'],
  ] as const) {
    if (value === undefined) continue;
    const list = tagList(value, kind === 'style' ? allStyles() : allowed, label);
    if (typeof list === 'string') return void res.status(400).json({ error: list });
    tagSets.push([kind, list]);
  }

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (name !== undefined) {
    sets.push('name = ?');
    vals.push(typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : null);
  }
  if (shared !== undefined) {
    sets.push('shared = ?');
    vals.push(shared ? 1 : 0);
  }
  if (archived !== undefined) {
    sets.push('archived = ?');
    vals.push(archived ? 1 : 0);
  }
  if (useAi !== undefined) {
    sets.push('use_ai = ?');
    vals.push(useAi ? 1 : 0);
  }
  if (dress !== undefined) {
    sets.push('dress = ?');
    vals.push(dress ? 1 : 0);
  }
  if (!sets.length && !tagSets.length) return void res.status(400).json({ error: 'Nothing to change' });

  db.transaction(() => {
    if (sets.length) db.prepare(`UPDATE items SET ${sets.join(', ')} WHERE id = ?`).run(...vals, id);
    const del = db.prepare('DELETE FROM item_tags WHERE item_id = ? AND kind = ?');
    const add = db.prepare('INSERT INTO item_tags (item_id, kind, value) VALUES (?, ?, ?)');
    for (const [kind, list] of tagSets) {
      del.run(id, kind);
      for (const v of list) add.run(id, kind, v);
    }
  })();
  res.json(getItem(id, req.query.person as string | undefined));
});

/** Retake: a new photo for an existing piece. Tags and outfits stay; the cutout is redone. */
items.post('/:id/photo', photoUpload, async (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(id) as ItemRow | undefined;
  if (!row) return void res.status(404).json({ error: 'No such item' });
  if (!req.file) return void res.status(400).json({ error: 'No photo uploaded' });

  const original = await saveWebp(req.file.buffer, 'originals', { max: ORIGINAL_MAX, quality: 90 });
  db.prepare(
    `UPDATE items SET original_path = ?, cutout_path = NULL, thumb_path = NULL, status = 'processing',
       ai_status = NULL, ai_cutout_path = NULL, ai_thumb_path = NULL, ai_error = NULL, use_ai = 0 WHERE id = ?`,
  ).run(original, id);
  // The AI version was of the old photo, so it goes too.
  [row.original_path, row.cutout_path, row.thumb_path, row.ai_cutout_path, row.ai_thumb_path].forEach(removeImage);
  enqueue(id);
  res.json(getItem(id, req.query.person as string | undefined));
});

/**
 * Delete a piece for good. It leaves any saved outfits; an outfit left with no pieces at all
 * goes too (with its photo).
 */
items.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM items WHERE id = ?').get(req.params.id) as ItemRow | undefined;
  if (!row) return void res.status(404).json({ error: 'No such item' });
  const emptied = db.transaction(() => {
    const outfitIds = db.prepare('SELECT outfit_id FROM outfit_items WHERE item_id = ?').pluck().all(row.id) as number[];
    db.prepare('DELETE FROM items WHERE id = ?').run(row.id);
    const empty = db.prepare(
      `SELECT id, photo FROM outfits WHERE id IN (SELECT value FROM json_each(?))
       AND NOT EXISTS (SELECT 1 FROM outfit_items WHERE outfit_id = outfits.id)`,
    ).all(JSON.stringify(outfitIds)) as { id: number; photo: string | null }[];
    db.prepare('DELETE FROM outfits WHERE id IN (SELECT value FROM json_each(?))').run(JSON.stringify(empty.map((o) => o.id)));
    return empty;
  })();
  emptied.forEach((o) => removeImage(o.photo));
  [row.original_path, row.cutout_path, row.thumb_path, row.ai_cutout_path, row.ai_thumb_path].forEach(removeImage);
  res.status(204).end();
});

/** "Make it perfect": start (or redo) the AI version. It's shown automatically once ready. */
items.post('/:id/ai', (req, res) => {
  if (!aiEnabled()) return void res.status(503).json({ error: 'AI clean-up isn’t set up (see README)' });
  const row = db.prepare('SELECT status, ai_status FROM items WHERE id = ?').get(req.params.id) as
    | Pick<ItemRow, 'status' | 'ai_status'>
    | undefined;
  if (!row) return void res.status(404).json({ error: 'No such item' });
  if (row.status !== 'ready') return void res.status(409).json({ error: 'Wait until this piece’s photo is ready' });
  if (row.ai_status !== 'processing') {
    db.prepare("UPDATE items SET ai_status = 'processing', ai_error = NULL WHERE id = ?").run(req.params.id);
    enqueueAi(Number(req.params.id));
  }
  res.json(getItem(req.params.id, req.query.person as string | undefined));
});

/** Try background removal again (e.g. after rembg was down). */
items.post('/:id/retry', (req, res) => {
  const { changes } = db
    .prepare("UPDATE items SET status = 'processing' WHERE id = ? AND status = 'failed'")
    .run(req.params.id);
  if (!changes) return void res.status(409).json({ error: 'Item is not in a failed state' });
  enqueue(Number(req.params.id));
  res.json(getItem(req.params.id));
});

// ---- Styles: the list to choose from (seeded in migration 002; more can be added) ----

export const allStyles = () =>
  db.prepare('SELECT name FROM styles ORDER BY position, name').pluck().all() as string[];

export const styles = Router();

styles.get('/', (_req, res) => res.json(allStyles()));

styles.post('/', (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > 24) return void res.status(400).json({ error: 'A style needs a short name' });
  // Sentence case, so "work" and "Work" don't both appear.
  const pretty = name[0].toUpperCase() + name.slice(1);
  db.prepare(
    'INSERT OR IGNORE INTO styles (name, position) VALUES (?, (SELECT COALESCE(MAX(position), 0) + 1 FROM styles))',
  ).run(pretty);
  res.json(allStyles());
});
