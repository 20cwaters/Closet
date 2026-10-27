import { Router } from 'express';
import { db, isPerson } from '../db.js';
import { photoUpload, removeImage, saveWebp } from '../images.js';
import { CATEGORIES, type Category } from '../rules.js';
import { getItem, withTags } from './items.js';

export const outfits = Router();

const SLOT_ORDER = `CASE oi.slot WHEN 'headwear' THEN 0 WHEN 'outerwear' THEN 1 WHEN 'top' THEN 2
  WHEN 'bottom' THEN 3 WHEN 'shoes' THEN 4 ELSE 5 END`;

interface OutfitRow {
  id: number;
  person: string;
  name: string | null;
  photo: string | null;
  created_at: string;
  last_worn: string | null;
}

/** Outfits with their pieces (head to toe, layers in order), newest first. Each piece carries its `slot`. */
export function loadOutfits(where: string, params: Record<string, unknown>) {
  const rows = db
    .prepare(
      `SELECT o.*, (SELECT MAX(worn_on) FROM wear_log w WHERE w.outfit_id = o.id) AS last_worn
       FROM outfits o WHERE ${where} ORDER BY o.created_at DESC, o.id DESC`,
    )
    .all(params) as OutfitRow[];
  const itemsOf = db.prepare(
    `SELECT i.*, oi.slot, (SELECT MAX(worn_on) FROM wear_log w WHERE w.item_id = i.id AND w.person = ?) AS last_worn
     FROM outfit_items oi JOIN items i ON i.id = oi.item_id
     WHERE oi.outfit_id = ? ORDER BY ${SLOT_ORDER}, oi.position`,
  );
  return rows.map((o) => {
    const rows = itemsOf.all(o.person, o.id) as (Parameters<typeof withTags>[0][number] & { slot: Category | null })[];
    const items = withTags(rows).map((item, i) => ({ ...item, slot: rows[i].slot ?? item.categories[0] ?? null }));
    return {
      id: o.id,
      person: o.person,
      name: o.name,
      photo: o.photo,
      createdAt: o.created_at,
      lastWorn: o.last_worn,
      items,
    };
  });
}

const getOutfit = (id: number | string) => loadOutfits('o.id = @id', { id })[0];

/** The person's saved outfit with exactly this set of items, if any. */
export function findOutfitWithItems(person: string, itemIds: number[]): number | undefined {
  const ids = [...new Set(itemIds)].sort((a, b) => a - b);
  const candidates = db
    .prepare(
      `SELECT o.id, group_concat(oi.item_id) AS ids FROM outfits o
       JOIN outfit_items oi ON oi.outfit_id = o.id WHERE o.person = ? GROUP BY o.id`,
    )
    .all(person) as { id: number; ids: string }[];
  return candidates.find(
    (c) => c.ids.split(',').map(Number).sort((a, b) => a - b).join(',') === ids.join(','),
  )?.id;
}

outfits.get('/', (req, res) => {
  const person = String(req.query.person ?? '');
  if (!isPerson(person)) return void res.status(400).json({ error: 'person is required' });
  res.json(loadOutfits('o.person = @person', { person }));
});

/** This person's outfits that include an item (for the item detail view). */
export function outfitsWithItem(person: string, itemId: number | string) {
  return loadOutfits(
    'o.person = @person AND o.id IN (SELECT outfit_id FROM outfit_items WHERE item_id = @itemId)',
    { person, itemId },
  );
}

outfits.get('/:id', (req, res) => {
  const outfit = getOutfit(req.params.id);
  if (!outfit) return void res.status(404).json({ error: 'No such outfit' });
  res.json(outfit);
});

type Piece = { id: number; slot: Category };

/** Check `pieces` ([{ id, slot }] in layer order) for a person; returns them de-duplicated, or an error. */
function validPieces(person: string, pieces: unknown): Piece[] | string {
  if (
    !Array.isArray(pieces) ||
    !pieces.length ||
    !pieces.every((p) => Number.isInteger(p?.id) && CATEGORIES.includes(p?.slot))
  )
    return 'pieces must be a non-empty list of { id, slot }';
  const seen = new Set<number>();
  const unique = (pieces as Piece[]).filter((p) => !seen.has(p.id) && seen.add(p.id));
  for (const p of unique) {
    const item = getItem(p.id);
    if (!item || (item.owner !== person && !item.shared)) return `Item ${p.id} isn't in ${person}'s closet`;
    if (!item.categories.includes(p.slot)) return `Item ${p.id} isn't tagged ${p.slot}`;
  }
  return unique;
}

const setPieces = (outfitId: number | bigint, pieces: Piece[]) => {
  db.prepare('DELETE FROM outfit_items WHERE outfit_id = ?').run(outfitId);
  const add = db.prepare('INSERT INTO outfit_items (outfit_id, item_id, slot, position) VALUES (?, ?, ?, ?)');
  pieces.forEach((p, i) => add.run(outfitId, p.id, p.slot, i));
};

/**
 * Save a combination: `pieces` = [{ id, slot }] in layer order (slot = the Build row).
 * Saving the same set of items twice returns the existing outfit.
 */
outfits.post('/', (req, res) => {
  const { person, pieces, name } = req.body ?? {};
  if (!isPerson(person)) return void res.status(400).json({ error: 'person is required' });
  const unique = validPieces(person, pieces);
  if (typeof unique === 'string') return void res.status(400).json({ error: unique });

  const existing = findOutfitWithItems(person, unique.map((p) => p.id));
  if (existing) return void res.json({ ...getOutfit(existing), existing: true });

  const id = db.transaction(() => {
    const { lastInsertRowid } = db
      .prepare('INSERT INTO outfits (person, name) VALUES (?, ?)')
      .run(person, typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : null);
    setPieces(lastInsertRowid, unique);
    return Number(lastInsertRowid);
  })();
  res.status(201).json({ ...getOutfit(id), existing: false });
});

/** Edit: replace an outfit's pieces (name, photo and wear history stay). */
outfits.put('/:id', (req, res) => {
  const row = db.prepare('SELECT person FROM outfits WHERE id = ?').get(req.params.id) as { person: string } | undefined;
  if (!row) return void res.status(404).json({ error: 'No such outfit' });
  const unique = validPieces(row.person, req.body?.pieces);
  if (typeof unique === 'string') return void res.status(400).json({ error: unique });
  const other = findOutfitWithItems(row.person, unique.map((p) => p.id));
  if (other && other !== Number(req.params.id))
    return void res.status(409).json({ error: 'You already have an outfit with exactly these pieces' });
  db.transaction(() => setPieces(Number(req.params.id), unique))();
  res.json(getOutfit(req.params.id));
});

outfits.patch('/:id', (req, res) => {
  const { name } = req.body ?? {};
  const { changes } = db
    .prepare('UPDATE outfits SET name = ? WHERE id = ?')
    .run(typeof name === 'string' && name.trim() ? name.trim().slice(0, 80) : null, req.params.id);
  if (!changes) return void res.status(404).json({ error: 'No such outfit' });
  res.json(getOutfit(req.params.id));
});

outfits.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT photo FROM outfits WHERE id = ?').get(req.params.id) as
    | { photo: string | null }
    | undefined;
  if (!row) return void res.status(404).json({ error: 'No such outfit' });
  db.prepare('DELETE FROM outfits WHERE id = ?').run(req.params.id);
  removeImage(row.photo);
  res.status(204).end();
});

/** A photo of the person wearing it. Same upload path as items, without background removal. */
outfits.post('/:id/photo', photoUpload, async (req, res) => {
  const row = db.prepare('SELECT photo FROM outfits WHERE id = ?').get(req.params.id) as
    | { photo: string | null }
    | undefined;
  if (!row) return void res.status(404).json({ error: 'No such outfit' });
  if (!req.file) return void res.status(400).json({ error: 'No photo uploaded' });
  const photo = await saveWebp(req.file.buffer, 'outfits', { max: 1200, quality: 85 });
  db.prepare('UPDATE outfits SET photo = ? WHERE id = ?').run(photo, req.params.id);
  removeImage(row.photo);
  res.json(getOutfit(String(req.params.id)));
});
