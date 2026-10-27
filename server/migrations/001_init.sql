-- Initial schema. Migrations run in filename order, each once, inside a transaction.

CREATE TABLE people (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL,
  photo TEXT                          -- path under /images, nullable
);

CREATE TABLE items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  owner         TEXT NOT NULL REFERENCES people(id),
  shared        INTEGER NOT NULL DEFAULT 0,
  -- NULL until tagged: untagged items stay out of Build and suggestions.
  category      TEXT CHECK (category IN ('headwear', 'outerwear', 'top', 'bottom', 'shoes')),
  warmth        TEXT NOT NULL DEFAULT 'medium' CHECK (warmth IN ('light', 'medium', 'warm')),
  name          TEXT,
  original_path TEXT NOT NULL,
  cutout_path   TEXT,
  thumb_path    TEXT,
  -- processing → ready, or failed (rembg unreachable; the original is used instead).
  status        TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'failed')),
  archived      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX items_owner ON items(owner, archived);

CREATE TABLE outfits (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  person     TEXT NOT NULL REFERENCES people(id),
  name       TEXT,
  photo      TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX outfits_person ON outfits(person);

CREATE TABLE outfit_items (
  outfit_id INTEGER NOT NULL REFERENCES outfits(id) ON DELETE CASCADE,
  item_id   INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  PRIMARY KEY (outfit_id, item_id)
);
CREATE INDEX outfit_items_item ON outfit_items(item_id);

CREATE TABLE wear_log (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  person    TEXT NOT NULL REFERENCES people(id),
  item_id   INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  outfit_id INTEGER REFERENCES outfits(id) ON DELETE SET NULL,
  worn_on   TEXT NOT NULL,            -- YYYY-MM-DD in the app's TZ
  UNIQUE (person, item_id, worn_on)
);
CREATE INDEX wear_log_person ON wear_log(person, worn_on);
