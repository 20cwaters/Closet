-- Outfits planned for a day (the calendar). One per person per day; the daily pick uses it.
CREATE TABLE outfit_plans (
  person    TEXT NOT NULL REFERENCES people(id),
  date      TEXT NOT NULL,              -- YYYY-MM-DD in the app's TZ
  outfit_id INTEGER NOT NULL REFERENCES outfits(id) ON DELETE CASCADE,
  PRIMARY KEY (person, date)
);
