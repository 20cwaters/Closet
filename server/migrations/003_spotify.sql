-- Spotify: one linked account per person, plus their player preferences.
-- Tokens live server-side so a shared screen stays connected without anyone signing in on it.
CREATE TABLE spotify_accounts (
  person          TEXT PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  spotify_id      TEXT NOT NULL,
  display_name    TEXT,
  access_token    TEXT NOT NULL,
  refresh_token   TEXT NOT NULL,
  expires_at      INTEGER NOT NULL,   -- ms since epoch
  -- Preferences (cleared on disconnect)
  morning_uri     TEXT,               -- spotify:playlist:… started by one tap
  morning_name    TEXT,
  device_id       TEXT,               -- last speaker chosen, used when nothing is active
  device_name     TEXT,
  connected_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
