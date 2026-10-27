import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { db, migrate } from './db.js';
import { aiEnabled, resumeAi } from './ai.js';
import { resumePending } from './processing.js';
import { getWeather } from './weather.js';
import { items, styles } from './routes/items.js';
import { outfits } from './routes/outfits.js';
import { spotifyRoutes } from './routes/spotify.js';
import { suggestion } from './routes/suggestion.js';
import { wear } from './routes/wear.js';
import { calendar } from './routes/calendar.js';
import { people } from './routes/people.js';

migrate();
fs.mkdirSync(config.imagesDir, { recursive: true });

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// Healthy = the app and its database work. rembg is reported but doesn't fail the check:
// uploads queue up and retry while it's down, so the app itself is still fine.
app.get('/api/health', async (_req, res) => {
  db.prepare('SELECT 1').get();
  const rembg = await fetch(`${config.rembgUrl}/api`, { signal: AbortSignal.timeout(2000) }).then(
    () => 'up',
    () => 'down',
  );
  res.json({ ok: true, rembg });
});

app.get('/api/config', (_req, res) => {
  res.json({ idleTimeoutSeconds: config.idleTimeoutSeconds, ai: aiEnabled() });
});

app.use('/api/people', people);
app.use('/api/items', items);
app.use('/api/styles', styles);
app.use('/api/outfits', outfits);
app.use('/api/wear', wear);
app.use('/api/calendar', calendar);
app.use('/api/suggestion', suggestion);
app.use('/api/spotify', spotifyRoutes);
app.get('/api/weather', async (_req, res) => {
  try {
    res.json(await getWeather());
  } catch (err) {
    res.status(503).json({ error: `Weather unavailable: ${(err as Error).message}` });
  }
});
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Image filenames are random and never rewritten, so they can be cached forever.
app.use(
  '/images',
  express.static(config.imagesDir, { immutable: true, maxAge: '365d', fallthrough: false }),
);

// Built frontend: hashed assets cache forever, index.html never.
app.use(
  express.static(config.webDir, {
    setHeaders(res, file) {
      if (file.includes(`${path.sep}assets${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }),
);
app.get('/{*splat}', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(config.webDir, 'index.html'));
});

app.use(
  (err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = err.status ?? 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status === 404 ? 'Not found' : err.message });
  },
);

app.listen(config.port, () => {
  console.log(`closet listening on :${config.port}`);
  resumePending();
  resumeAi();
});
