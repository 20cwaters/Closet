-- Household-wide settings made in the app. So far just the weather location, so that
-- nobody has to edit .env to get their own weather.

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL            -- JSON
);
