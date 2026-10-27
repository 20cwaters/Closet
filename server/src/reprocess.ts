/**
 * Redo every cutout with the current pipeline (after it improves), oldest first:
 *   docker compose exec app node dist/reprocess.js          # all pieces
 *   docker compose exec app node dist/reprocess.js 12 40    # just these
 * Safe while the app is in use: each piece keeps its old cutout until the new one is saved.
 */
import { db } from './db.js';
import { processItem } from './processing.js';

const ids = process.argv.slice(2).length
  ? process.argv.slice(2).map(Number)
  : (db.prepare("SELECT id FROM items WHERE status IN ('ready', 'failed') ORDER BY id").pluck().all() as number[]);

for (const [n, id] of ids.entries()) {
  const started = Date.now();
  await processItem(id, { redo: true });
  console.log(`${n + 1}/${ids.length}  item ${id}  ${((Date.now() - started) / 1000).toFixed(1)}s`);
}
