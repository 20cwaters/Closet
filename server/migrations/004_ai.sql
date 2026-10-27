-- "Make it perfect": an AI-recreated product shot of the piece, kept next to the real
-- cutout so either can be shown. A retake clears it (it no longer matches the photo).
ALTER TABLE items ADD COLUMN ai_status TEXT CHECK (ai_status IN ('processing', 'ready', 'failed'));
ALTER TABLE items ADD COLUMN ai_cutout_path TEXT;
ALTER TABLE items ADD COLUMN ai_thumb_path TEXT;
ALTER TABLE items ADD COLUMN ai_error TEXT;
-- Show the AI version instead of the real cutout (only while ai_status = 'ready').
ALTER TABLE items ADD COLUMN use_ai INTEGER NOT NULL DEFAULT 0;
