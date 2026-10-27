import { Router } from 'express';
import sharp from 'sharp';
import { db } from '../db.js';
import { photoUpload, removeImage, saveWebp } from '../images.js';

export const people = Router();

const list = () => db.prepare('SELECT id, name, photo FROM people ORDER BY created_at, rowid').all();

const MAX_NAME = 40;

/** A trimmed display name, or an error message. */
function validName(raw: unknown): string | { error: string } {
  const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  if (!name) return { error: 'A name is required' };
  if (name.length > MAX_NAME) return { error: `Keep the name under ${MAX_NAME} characters` };
  return name;
}

/**
 * The URL id for a new person: their name as a slug ("Sam Lee" → "sam-lee"), numbered if
 * taken. The id is the first part of every app URL, so it must not clash with what the
 * server serves at the top level.
 */
const RESERVED = new Set(['api', 'images', 'assets']);
function newId(name: string): string {
  const base =
    name
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'person';
  const taken = (id: string) => RESERVED.has(id) || !!db.prepare('SELECT 1 FROM people WHERE id = ?').get(id);
  let id = base;
  for (let n = 2; taken(id); n++) id = `${base}-${n}`;
  return id;
}

people.get('/', (_req, res) => {
  res.json(list());
});

people.post('/', (req, res) => {
  const name = validName(req.body?.name);
  if (typeof name !== 'string') return void res.status(400).json(name);
  const id = newId(name);
  db.prepare('INSERT INTO people (id, name) VALUES (?, ?)').run(id, name);
  res.status(201).json({ id, people: list() });
});

people.patch('/:id', (req, res) => {
  const name = validName(req.body?.name);
  if (typeof name !== 'string') return void res.status(400).json(name);
  const { changes } = db.prepare('UPDATE people SET name = ? WHERE id = ?').run(name, req.params.id);
  if (!changes) return void res.status(404).json({ error: 'No such person' });
  res.json(list());
});

/** How much removing someone deletes, for the confirmation. */
people.get('/:id/summary', (req, res) => {
  if (!db.prepare('SELECT 1 FROM people WHERE id = ?').get(req.params.id)) {
    return void res.status(404).json({ error: 'No such person' });
  }
  const count = (sql: string) => db.prepare(sql).pluck().get(req.params.id) as number;
  res.json({
    items: count('SELECT COUNT(*) FROM items WHERE owner = ?'),
    outfits: count('SELECT COUNT(*) FROM outfits WHERE person = ?'),
  });
});

/**
 * Remove a person and everything that's theirs: their pieces (also from anyone's outfits they
 * were shared into), outfits, wear log, plans and Spotify link. Images go too.
 */
people.delete('/:id', (req, res) => {
  const id = req.params.id;
  const person = db.prepare('SELECT photo FROM people WHERE id = ?').get(id) as { photo: string | null } | undefined;
  if (!person) return void res.status(404).json({ error: 'No such person' });

  const images = db.transaction(() => {
    const items = db
      .prepare('SELECT original_path, cutout_path, thumb_path, ai_cutout_path, ai_thumb_path FROM items WHERE owner = ?')
      .all(id) as Record<string, string | null>[];
    // Outfits are theirs, or someone else's that would be left with nothing but their pieces.
    const outfits = db
      .prepare(
        `SELECT id, photo FROM outfits o WHERE o.person = @id OR (
           EXISTS (SELECT 1 FROM outfit_items oi WHERE oi.outfit_id = o.id)
           AND NOT EXISTS (SELECT 1 FROM outfit_items oi JOIN items i ON i.id = oi.item_id
                           WHERE oi.outfit_id = o.id AND i.owner <> @id))`,
      )
      .all({ id }) as { id: number; photo: string | null }[];
    db.prepare('DELETE FROM outfit_plans WHERE person = ?').run(id);
    db.prepare('DELETE FROM wear_log WHERE person = ?').run(id);
    db.prepare('DELETE FROM outfits WHERE id IN (SELECT value FROM json_each(?))').run(
      JSON.stringify(outfits.map((o) => o.id)),
    );
    db.prepare('DELETE FROM items WHERE owner = ?').run(id);
    db.prepare('DELETE FROM people WHERE id = ?').run(id);
    return [person.photo, ...outfits.map((o) => o.photo), ...items.flatMap((i) => Object.values(i))];
  })();
  images.forEach(removeImage);
  res.json(list());
});

people.post('/:id/photo', photoUpload, async (req, res) => {
  const person = db.prepare('SELECT photo FROM people WHERE id = ?').get(req.params.id) as
    | { photo: string | null }
    | undefined;
  if (!person) return void res.status(404).json({ error: 'No such person' });
  if (!req.file) return void res.status(400).json({ error: 'No photo uploaded' });

  // Square-crop around the most interesting region (usually the face).
  const photo = await saveWebp(
    sharp(req.file.buffer).rotate().resize(480, 480, {
      fit: 'cover',
      position: 'attention',
    }),
    'people',
  );
  db.prepare('UPDATE people SET photo = ? WHERE id = ?').run(photo, req.params.id);
  removeImage(person.photo);
  res.json(list());
});
