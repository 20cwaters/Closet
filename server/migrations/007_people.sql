-- People are added from the app instead of being fixed in the schema. The table is rebuilt
-- to drop the old CHECK on id (SQLite can't drop a constraint in place); migrate() turns
-- foreign keys off around this, as SQLite's table-rebuild procedure requires.

CREATE TABLE people_new (
  id         TEXT PRIMARY KEY,          -- URL slug, e.g. "sam" or "sam-2"
  name       TEXT NOT NULL,
  photo      TEXT,                      -- path under /images, nullable
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
-- Keep existing people in the order they were added (the list sorts by created_at, rowid).
INSERT INTO people_new (id, name, photo) SELECT id, name, photo FROM people ORDER BY rowid;
DROP TABLE people;
ALTER TABLE people_new RENAME TO people;
