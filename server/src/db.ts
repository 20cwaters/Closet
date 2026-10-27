import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');

export function migrate() {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  )`);
  const applied = new Set(
    db.prepare('SELECT name FROM schema_migrations').pluck().all() as string[],
  );
  const files = fs
    .readdirSync(config.migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  // Foreign keys are off while migrating so a migration can rebuild a table others point at
  // (SQLite's documented procedure); each one is checked before it commits.
  db.pragma('foreign_keys = OFF');
  try {
    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(config.migrationsDir, file), 'utf8');
      db.transaction(() => {
        db.exec(sql);
        const broken = db.pragma('foreign_key_check') as unknown[];
        if (broken.length) throw new Error(`${file} leaves ${broken.length} broken foreign key(s)`);
        db.prepare('INSERT INTO schema_migrations (name) VALUES (?)').run(file);
      })();
      console.log(`migration applied: ${file}`);
    }
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

/** Whether `id` is someone's profile. Routes check this before acting for a person. */
export const isPerson = (id: unknown): id is string =>
  typeof id === 'string' && !!db.prepare('SELECT 1 FROM people WHERE id = ?').get(id);
