/**
 * "Make it perfect" for many pieces at once, one after another:
 *   docker compose run --rm --no-deps -T app node dist/enhance.js          # every piece without an AI version
 *   docker compose run --rm --no-deps -T app node dist/enhance.js 12 40    # just these (redoing any they have)
 * Each piece switches to its AI version as it finishes; the app can be used meanwhile.
 */
import { aiEnabled, enhanceItem } from './ai.js';
import { db, migrate } from './db.js';

if (!aiEnabled()) {
  console.error('OPENROUTER_API_KEY is not set');
  process.exit(1);
}
migrate();

const ids = process.argv.slice(2).length
  ? process.argv.slice(2).map(Number)
  : (db
      .prepare("SELECT id FROM items WHERE status = 'ready' AND archived = 0 AND ai_status IS NULL ORDER BY id")
      .pluck()
      .all() as number[]);

for (const [n, id] of ids.entries()) {
  db.prepare("UPDATE items SET ai_status = 'processing', ai_error = NULL WHERE id = ?").run(id);
  await enhanceItem(id);
  const { ai_status, ai_error } = db.prepare('SELECT ai_status, ai_error FROM items WHERE id = ?').get(id) as {
    ai_status: string;
    ai_error: string | null;
  };
  console.log(`${n + 1}/${ids.length}  item ${id}  ${ai_status}${ai_error ? `: ${ai_error}` : ''}`);
  // Out of credits or a bad key won't fix itself on the next piece.
  if (ai_error && /credits|key/.test(ai_error)) process.exit(1);
}
