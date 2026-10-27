import assert from 'node:assert/strict';
import { test } from 'node:test';
import { conditionsFor, needsOuterwear, type Category, type WeatherTag } from './rules.js';
import { daysBetween, suggest, type SItem, type SOutfit, type SuggestInput } from './suggest.js';

const DAY = '2026-10-22';
const ago = (n: number) => new Date(Date.parse(`${DAY}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

let nextId = 1;
const item = (categories: Category | Category[], weather: WeatherTag[] = [], wornDaysAgo?: number): SItem => ({
  id: nextId++,
  categories: Array.isArray(categories) ? categories : [categories],
  weather,
  lastWorn: wornDaysAgo === undefined ? null : ago(wornDaysAgo),
});
const outfit = (id: number, ...pieces: [SItem, Category][]): SOutfit => ({
  id,
  pieces: pieces.map(([i, slot]) => ({ id: i.id, slot })),
});

const base = (items: SItem[], outfits: SOutfit[] = [], over: Partial<SuggestInput> = {}): SuggestInput => ({
  person: 'sam',
  date: DAY,
  conditions: ['cool'],
  needsOuterwear: false,
  items,
  outfits,
  ...over,
});
const manyDays = (n: number) => Array.from({ length: n }, (_, d) => ago(-d));

test('daysBetween counts calendar days', () => {
  assert.equal(daysBetween('2026-10-21', DAY), 1);
  assert.equal(daysBetween('2026-09-30', '2026-10-01'), 1);
});

test("today's conditions: temperature bands, rain and wind", () => {
  assert.deepEqual(conditionsFor(40, 0, 5), ['cold']);
  assert.deepEqual(conditionsFor(55, 60, 5), ['cool', 'rainy']);
  assert.deepEqual(conditionsFor(70, 10, 25), ['warm', 'windy']);
  assert.deepEqual(conditionsFor(85, 0, 0), ['hot']);
  assert.equal(needsOuterwear(70, ['warm']), false);
  assert.equal(needsOuterwear(70, ['warm', 'windy']), true, 'wind brings out the outerwear row');
  assert.equal(needsOuterwear(55, ['cool']), true);
});

test('same person and day always gives the same pick; other days vary', () => {
  const items = [item('top'), item('top'), item('top'), item('top'), item('bottom'), item('bottom'), item('shoes')];
  const a = suggest(base(items));
  for (let i = 0; i < 5; i++) assert.deepEqual(suggest(base(items)), a);
  const picks = new Set(manyDays(30).map((date) => suggest(base(items, [], { date })).selected.top[0]));
  assert.ok(picks.size > 1);
});

test('tops worn in the last 5 days are skipped; 6 days ago is fine', () => {
  const recent = item('top', [], 5);
  const older = item('top', [], 6);
  for (const date of manyDays(20)) {
    // keep "days ago" fixed by moving the wear dates with the day
    const shift = daysBetween(DAY, date);
    const r = { ...recent, lastWorn: ago(5 - shift) }, o = { ...older, lastWorn: ago(6 - shift) };
    assert.deepEqual(suggest(base([r, o, item('bottom')], [], { date })).selected.top, [o.id]);
  }
});

test('bottoms use a 3-day window', () => {
  const recent = item('bottom', [], 3);
  const older = item('bottom', [], 4);
  for (let d = 0; d < 20; d++) {
    assert.deepEqual(suggest(base([recent, older], [], { person: `p${d}` })).selected.bottom, [older.id]);
  }
});

test('shoes worn yesterday are still fine (0-day window)', () => {
  const shoes = item('shoes', [], 1);
  const fresh = item('shoes');
  const seen = new Set(Array.from({ length: 40 }, (_, d) => suggest(base([shoes, fresh], [], { person: `p${d}` })).selected.shoes[0]));
  assert.ok(seen.has(shoes.id));
});

test('when everything was worn recently, it still suggests something', () => {
  const only = item('top', [], 1);
  assert.deepEqual(suggest(base([only])).selected.top, [only.id]);
});

test('pieces tagged for other temperatures are skipped; untagged pieces suit any', () => {
  const tee = item('top', ['hot', 'warm']);
  const sweater = item('top', ['cold', 'cool']);
  const anyWeather = item('top');
  for (let d = 0; d < 20; d++) {
    assert.notEqual(suggest(base([tee, sweater, anyWeather], [], { conditions: ['cold'], person: `p${d}` })).selected.top[0], tee.id);
    assert.notEqual(suggest(base([tee, sweater, anyWeather], [], { conditions: ['hot'], person: `p${d}` })).selected.top[0], sweater.id);
  }
  // "All weather" (every tag) is fine every day
  const all = item('bottom', ['hot', 'warm', 'cool', 'cold', 'rainy', 'windy']);
  for (const t of ['hot', 'warm', 'cool', 'cold'] as const) {
    assert.deepEqual(suggest(base([all], [], { conditions: [t] })).selected.bottom, [all.id]);
  }
});

test('rainy and windy days pick pieces tagged for them first', () => {
  const raincoat = item('outerwear', ['rainy']);
  const denim = item('outerwear', ['cool']);
  const windbreaker = item('outerwear', ['windy', 'cool']);
  for (let d = 0; d < 20; d++) {
    const opts = { needsOuterwear: true, person: `p${d}` };
    assert.deepEqual(suggest(base([raincoat, denim], [], { ...opts, conditions: ['cool', 'rainy'] })).selected.outerwear, [raincoat.id]);
    assert.deepEqual(suggest(base([windbreaker, denim], [], { ...opts, conditions: ['cool', 'windy'] })).selected.outerwear, [windbreaker.id]);
  }
});

test('a saved outfit that passes every rule beats assembling one', () => {
  const t = item('top'), b = item('bottom'), s = item('shoes');
  const r = suggest(base([t, b, s, item('top'), item('bottom')], [outfit(7, [t, 'top'], [b, 'bottom'], [s, 'shoes'])]));
  assert.equal(r.source, 'outfit');
  assert.equal(r.outfitId, 7);
  assert.deepEqual([r.selected.top, r.selected.bottom, r.selected.shoes], [[t.id], [b.id], [s.id]]);
});

test('layered outfits come back layered, in order', () => {
  const tank = item('top'), shirt = item('top'), vest = item('outerwear'), coat = item('outerwear'), b = item('bottom');
  const r = suggest(base([tank, shirt, vest, coat, b], [outfit(1, [tank, 'top'], [shirt, 'top'], [vest, 'outerwear'], [coat, 'outerwear'], [b, 'bottom'])]));
  assert.deepEqual(r.selected.top, [tank.id, shirt.id]);
  assert.deepEqual(r.selected.outerwear, [vest.id, coat.id]);
  assert.equal(r.showOuterwear, true);
});

test('a piece in several categories can fill either row, but never two at once', () => {
  const overshirt = item(['top', 'outerwear']);
  const r = suggest(base([overshirt, item('bottom')], [], { needsOuterwear: true }));
  const placed = [...r.selected.top, ...r.selected.outerwear];
  assert.deepEqual(placed, [overshirt.id], 'used once');
  // In a saved outfit it stays in the row it was saved in
  const tee = item('top');
  const o = suggest(base([overshirt, tee], [outfit(2, [tee, 'top'], [overshirt, 'outerwear'])]));
  assert.deepEqual(o.selected.outerwear, [overshirt.id]);
});

test('an outfit with a recently worn piece is skipped', () => {
  const t = item('top', [], 2), b = item('bottom'), alt = item('top');
  const r = suggest(base([t, b, alt], [outfit(1, [t, 'top'], [b, 'bottom'])]));
  assert.equal(r.source, 'pieces');
  assert.deepEqual(r.selected.top, [alt.id]);
});

test('outfits whose pieces were worn least recently are favoured', () => {
  const fresh = Array.from({ length: 3 }, (_, k) => ({ t: item('top'), b: item('bottom'), id: 10 + k }));
  const st = item('top', [], 7), sb = item('bottom', [], 8);
  const outfits = [...fresh.map((f) => outfit(f.id, [f.t, 'top'], [f.b, 'bottom'])), outfit(99, [st, 'top'], [sb, 'bottom'])];
  const items = [...fresh.flatMap((f) => [f.t, f.b]), st, sb];
  for (let d = 0; d < 40; d++) assert.notEqual(suggest(base(items, outfits, { person: `p${d}` })).outfitId, 99);
});

test('outfits containing archived pieces (absent from items) are ignored', () => {
  const t = item('top'), b = item('bottom');
  const r = suggest(base([t, b], [{ id: 3, pieces: [{ id: t.id, slot: 'top' }, { id: 12345, slot: 'bottom' }] }]));
  assert.equal(r.source, 'pieces');
});

test('rainy or cold days add outerwear, even to a saved outfit without it', () => {
  const t = item('top'), b = item('bottom'), coat = item('outerwear', ['cold']);
  const r = suggest(base([t, b, coat], [outfit(1, [t, 'top'], [b, 'bottom'])], { conditions: ['cold'], needsOuterwear: true }));
  assert.equal(r.source, 'outfit');
  assert.deepEqual(r.selected.outerwear, [coat.id]);
  assert.equal(r.showOuterwear, true);
  assert.deepEqual(suggest(base([t, b, coat])).selected.outerwear, [], 'no outerwear on a mild dry day');
});

test('headwear stays None unless it is cold and a hat is tagged Cold', () => {
  const t = item('top'), cap = item('headwear', ['warm']), beanie = item('headwear', ['cold']);
  assert.deepEqual(suggest(base([t, cap, beanie])).selected.headwear, []);
  assert.deepEqual(suggest(base([t, cap, beanie], [], { conditions: ['cold'] })).selected.headwear, [beanie.id]);
  assert.deepEqual(suggest(base([t, cap], [], { conditions: ['cold'] })).selected.headwear, []);
});

test('an empty closet gives an empty suggestion, not an error', () => {
  assert.equal(suggest(base([])).source, 'empty');
});

test('a dress is picked on its own: no bottoms, no outerwear', () => {
  const dress = { ...item('top'), dress: true };
  const skirt = item('bottom');
  const coat = item('outerwear');
  const s = suggest(base([dress, skirt, coat, item('shoes')], [], { needsOuterwear: true }));
  assert.deepEqual(s.selected.top, [dress.id]);
  assert.deepEqual(s.selected.bottom, []);
  assert.deepEqual(s.selected.outerwear, []);
  assert.equal(s.showOuterwear, true); // the row still shows, on None
});

test('an assembled outfit sticks to the style of its top', () => {
  for (let d = 0; d < 20; d++) {
    const work = { ...item('top'), styles: ['Work'] };
    const items = [
      work,
      { ...item('bottom'), styles: ['Casual'] },
      { ...item('bottom'), styles: ['Casual'] },
      { ...item('bottom'), styles: ['Work'] },
      { ...item('shoes'), styles: ['Casual'] },
      { ...item('shoes'), styles: ['Work', 'Casual'] },
    ];
    const s = suggest(base(items, [], { date: ago(-d) }));
    assert.equal(s.selected.bottom[0], items[3].id);
    assert.equal(s.selected.shoes[0], items[5].id);
  }
});

test('style gives way when nothing in a row has it', () => {
  const s = suggest(base([{ ...item('top'), styles: ['Work'] }, { ...item('bottom'), styles: ['Casual'] }]));
  assert.equal(s.selected.bottom.length, 1);
});

test('with the weather off, temperature tags, outerwear and hats are ignored', () => {
  const summer = item('top', ['hot']);
  const hat = item('headwear', ['cold']);
  const coat = item('outerwear');
  const s = suggest(base([summer, hat, coat, item('bottom')], [], { conditions: ['cold'], needsOuterwear: true, useWeather: false }));
  assert.deepEqual(s.selected.top, [summer.id]);
  assert.deepEqual(s.selected.outerwear, []);
  assert.deepEqual(s.selected.headwear, []);
  assert.equal(s.showOuterwear, false);
});
