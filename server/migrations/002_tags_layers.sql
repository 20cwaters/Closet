-- Multi-value tags (category, weather, style), user-editable style list, and layered outfits.

-- An item can have several categories (an overshirt is a top and outerwear), several
-- weather conditions, and several styles.
CREATE TABLE item_tags (
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  kind    TEXT NOT NULL CHECK (kind IN ('category', 'weather', 'style')),
  value   TEXT NOT NULL,
  PRIMARY KEY (item_id, kind, value)
);
CREATE INDEX item_tags_kind ON item_tags(kind, value);

INSERT INTO item_tags (item_id, kind, value)
  SELECT id, 'category', category FROM items WHERE category IS NOT NULL;

-- light/medium/warm become the temperatures each suited.
INSERT INTO item_tags (item_id, kind, value)
  SELECT i.id, 'weather', m.tag FROM items i JOIN (
    SELECT 'light' AS warmth, 'hot' AS tag UNION ALL SELECT 'light', 'warm'
    UNION ALL SELECT 'medium', 'warm' UNION ALL SELECT 'medium', 'cool'
    UNION ALL SELECT 'warm', 'cool' UNION ALL SELECT 'warm', 'cold'
  ) m ON m.warmth = i.warmth;

ALTER TABLE items DROP COLUMN category;
ALTER TABLE items DROP COLUMN warmth;

-- Styles to choose from; more can be added from the tag picker.
CREATE TABLE styles (
  name     TEXT PRIMARY KEY COLLATE NOCASE,
  position INTEGER NOT NULL
);
INSERT INTO styles (name, position) VALUES
  ('Casual', 1), ('Work', 2), ('Dressy', 3), ('Athletic', 4), ('Lounge', 5), ('Outdoor', 6);

-- Which Build row each piece was in, and its layer order (two tops, a jacket over a vest).
ALTER TABLE outfit_items ADD COLUMN slot TEXT
  CHECK (slot IS NULL OR slot IN ('headwear', 'outerwear', 'top', 'bottom', 'shoes'));
ALTER TABLE outfit_items ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
UPDATE outfit_items SET slot = (
  SELECT value FROM item_tags t
  WHERE t.item_id = outfit_items.item_id AND t.kind = 'category' LIMIT 1
);
