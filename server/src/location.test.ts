import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

// config.ts reads these once, on import.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'closet-test-'));
process.env.DATA_DIR = dataDir;
delete process.env.LAT;
delete process.env.LON;

const { db, migrate } = await import('./db.js');
const { currentLocation, parsePlace, placeName, savePlace } = await import('./location.js');
migrate();

after(() => {
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('until a town is picked, the default counts as not chosen', () => {
  assert.deepEqual(currentLocation(), { name: null, lat: 40.7128, lon: -74.006, chosen: false });
});

test('a picked town wins, and picking again replaces it', () => {
  savePlace({ name: 'Dublin, Ireland', lat: 53.33, lon: -6.25 });
  savePlace({ name: 'Pune, Maharashtra, India', lat: 18.52, lon: 73.86 });
  assert.deepEqual(currentLocation(), { name: 'Pune, Maharashtra, India', lat: 18.52, lon: 73.86, chosen: true });
});

test('parsePlace takes real places and refuses anything else', () => {
  assert.deepEqual(parsePlace({ name: ' Oslo ', lat: 59.9, lon: 10.7, extra: 1 }), { name: 'Oslo', lat: 59.9, lon: 10.7 });
  assert.equal(parsePlace(undefined), null);
  assert.equal(parsePlace({ name: '', lat: 1, lon: 1 }), null);
  assert.equal(parsePlace({ name: 'x'.repeat(121), lat: 1, lon: 1 }), null);
  assert.equal(parsePlace({ name: 'Nowhere', lat: 91, lon: 0 }), null);
  assert.equal(parsePlace({ name: 'Nowhere', lat: 0, lon: 181 }), null);
  assert.equal(parsePlace({ name: 'Nowhere', lat: '1', lon: 0 }), null);
  assert.equal(parsePlace({ name: 'Nowhere', lat: NaN, lon: 0 }), null);
});

test('placeName leaves out a region that repeats the town', () => {
  const at = { latitude: 0, longitude: 0 };
  assert.equal(placeName({ ...at, name: 'Dublin', admin1: 'Leinster', country: 'Ireland' }), 'Dublin, Leinster, Ireland');
  assert.equal(placeName({ ...at, name: 'Singapore', admin1: 'Singapore', country: 'Singapore' }), 'Singapore, Singapore');
  assert.equal(placeName({ ...at, name: 'Atlantis' }), 'Atlantis');
});
