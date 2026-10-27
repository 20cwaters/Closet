import path from 'node:path';

const num = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isFinite(n) ? n : fallback;
};

const dataDir = process.env.DATA_DIR ?? '/data';

export const config = {
  port: num(process.env.PORT, 8530),
  lat: num(process.env.LAT, 40.7128),
  lon: num(process.env.LON, -74.006),
  idleTimeoutSeconds: num(process.env.IDLE_TIMEOUT_SECONDS, 90),
  rembgUrl: (process.env.REMBG_URL ?? 'http://rembg:7000').replace(/\/$/, ''),
  rembgModel: process.env.REMBG_MODEL ?? 'isnet-general-use',
  spotify: {
    clientId: process.env.SPOTIFY_CLIENT_ID ?? '',
    clientSecret: process.env.SPOTIFY_CLIENT_SECRET ?? '',
    // Spotify only accepts HTTPS redirect URIs (see README for options).
    redirectUri: process.env.SPOTIFY_REDIRECT_URI ?? '',
    // Overridable for tests against a fake Spotify.
    accountsUrl: (process.env.SPOTIFY_ACCOUNTS_URL ?? 'https://accounts.spotify.com').replace(/\/$/, ''),
    apiUrl: (process.env.SPOTIFY_API_URL ?? 'https://api.spotify.com/v1').replace(/\/$/, ''),
  },
  // "Make it perfect" (AI product shots) through OpenRouter's image API. Off without a key.
  ai: {
    apiKey: process.env.OPENROUTER_API_KEY ?? '',
    model: process.env.AI_MODEL ?? 'bytedance-seed/seedream-5-0-flash',
    // Overridable for tests against a fake API.
    apiUrl: (process.env.AI_API_URL ?? 'https://openrouter.ai/api/v1').replace(/\/$/, ''),
    // Optional fallback, straight to OpenAI, for photos Seedream's filter refuses.
    openaiKey: process.env.OPENAI_API_KEY ?? '',
    openaiModel: process.env.OPENAI_IMAGE_MODEL ?? 'gpt-image-2.5-flare',
    openaiUrl: (process.env.OPENAI_API_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
  },
  dataDir,
  dbPath: path.join(dataDir, 'closet.db'),
  imagesDir: path.join(dataDir, 'images'),
  webDir: path.resolve(process.env.WEB_DIR ?? 'public'),
  migrationsDir: path.resolve(process.env.MIGRATIONS_DIR ?? 'migrations'),
};

/** Today's date as YYYY-MM-DD in the container's TZ (Node honours the TZ env var). */
export function today(d = new Date()): string {
  return d.toLocaleDateString('en-CA');
}
