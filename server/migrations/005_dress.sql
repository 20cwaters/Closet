-- A top that's a dress: Build and the daily pick leave out bottoms and outerwear with it.
ALTER TABLE items ADD COLUMN dress INTEGER NOT NULL DEFAULT 0;
