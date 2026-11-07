import { Router } from 'express';
import { currentLocation, parsePlace, savePlace, searchPlaces } from '../location.js';

export const location = Router();

location.get('/', (_req, res) => {
  res.json(currentLocation());
});

location.get('/search', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (query.length < 2) return void res.json([]);
  try {
    res.json(await searchPlaces(query));
  } catch (err) {
    console.warn(`location search: ${(err as Error).message}`);
    res.status(503).json({ error: "Couldn't look that up. Is the internet connected?" });
  }
});

location.put('/', (req, res) => {
  const place = parsePlace(req.body);
  if (!place) return void res.status(400).json({ error: 'That is not a place' });
  savePlace(place);
  res.json(currentLocation());
});
