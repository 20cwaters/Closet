import crypto from 'node:crypto';
import { Router, type Response } from 'express';
import { config } from '../config.js';
import { db, isPerson } from '../db.js';
import { getAccount, SCOPES, spotify, spotifyEnabled, SpotifyError, tokenRequest } from '../spotify.js';

export const spotifyRoutes = Router();


/** Pending sign-ins: state → who and where to send them back. Short-lived, in memory. */
const pending = new Map<string, { person: string; returnTo: string; at: number }>();

/**
 * Only send people back to this app: a relative path, or an address on the local network or
 * tailnet. Anything else falls back to the app's own page, so the callback can't be used to
 * redirect to an arbitrary site.
 */
export function safeReturn(raw: unknown, person: string): string {
  const fallback = `/${person}/build`;
  if (typeof raw !== 'string' || !raw) return fallback;
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return fallback;
    const h = u.hostname;
    const ok =
      h === new URL(config.spotify.redirectUri).hostname ||
      h === 'localhost' ||
      /^(10|127)\.\d+\.\d+\.\d+$/.test(h) ||
      /^192\.168\.\d+\.\d+$/.test(h) ||
      /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(h) ||
      /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/.test(h) || // tailnet (100.64.0.0/10)
      /\.(home|home\.arpa|lan|local|ts\.net)$/.test(h);
    return ok ? u.toString() : fallback;
  } catch {
    return fallback;
  }
}

const withParam = (url: string, key: string, value: string) => {
  const [base, hash = ''] = url.split('#');
  return `${base}${base.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}${hash ? `#${hash}` : ''}`;
};

function fail(res: Response, err: unknown) {
  if (err instanceof SpotifyError) return void res.status(err.status).json({ error: err.message, code: err.code });
  throw err;
}

const personOf = (v: unknown) => (isPerson(v) ? v : null);

spotifyRoutes.get('/status', (req, res) => {
  const person = personOf(req.query.person);
  if (!person) return void res.status(400).json({ error: 'person is required' });
  const a = spotifyEnabled() ? getAccount(person) : undefined;
  res.json({
    enabled: spotifyEnabled(),
    connected: !!a,
    name: a?.display_name ?? null,
    morning: a?.morning_uri ? { uri: a.morning_uri, name: a.morning_name } : null,
    device: a?.device_id ? { id: a.device_id, name: a.device_name } : null,
  });
});

/** Start sign-in: redirect to Spotify's consent page. */
spotifyRoutes.get('/login', (req, res) => {
  const person = personOf(req.query.person);
  if (!person) return void res.status(400).send('person is required');
  if (!spotifyEnabled()) return void res.status(503).send('Spotify isn’t set up yet (see README)');
  const now = Date.now();
  for (const [k, v] of pending) if (now - v.at > 10 * 60_000) pending.delete(k);
  const state = crypto.randomBytes(16).toString('hex');
  pending.set(state, { person, returnTo: safeReturn(req.query.return, person), at: now });
  const url = new URL(`${config.spotify.accountsUrl}/authorize`);
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.spotify.clientId,
    scope: SCOPES,
    redirect_uri: config.spotify.redirectUri,
    state,
  }).toString();
  res.redirect(url.toString());
});

/** Spotify sends the browser back here with a one-time code. */
spotifyRoutes.get('/callback', async (req, res) => {
  const entry = pending.get(String(req.query.state ?? ''));
  if (!entry) return void res.status(400).send('This sign-in link has expired. Start again from Closet.');
  pending.delete(String(req.query.state));
  if (req.query.error || !req.query.code) {
    return void res.redirect(withParam(entry.returnTo, 'spotify', 'cancelled'));
  }
  try {
    const t = await tokenRequest({
      grant_type: 'authorization_code',
      code: String(req.query.code),
      redirect_uri: config.spotify.redirectUri,
    });
    if (!t.refresh_token) throw new SpotifyError('Spotify sent no refresh token', 'spotify');
    const meRes = await fetch(`${config.spotify.apiUrl}/me`, {
      headers: { Authorization: `Bearer ${t.access_token}` },
      signal: AbortSignal.timeout(10_000),
    });
    // 403 here usually means the account isn't on the app's allowlist (Development Mode).
    if (meRes.status === 403) throw new SpotifyError('not on allowlist', 'not_allowed', 403);
    const me = (await meRes.json()) as { id: string; display_name?: string };
    db.prepare(
      `INSERT INTO spotify_accounts (person, spotify_id, display_name, access_token, refresh_token, expires_at)
       VALUES (@person, @id, @name, @access, @refresh, @expires)
       ON CONFLICT (person) DO UPDATE SET spotify_id = @id, display_name = @name,
         access_token = @access, refresh_token = @refresh, expires_at = @expires`,
    ).run({
      person: entry.person,
      id: me.id,
      name: me.display_name ?? me.id,
      access: t.access_token,
      refresh: t.refresh_token,
      expires: Date.now() + t.expires_in * 1000,
    });
    res.redirect(withParam(entry.returnTo, 'spotify', 'connected'));
  } catch (err) {
    console.error('spotify callback failed', err);
    const code = err instanceof SpotifyError && err.code === 'not_allowed' ? 'not_allowed' : 'error';
    res.redirect(withParam(entry.returnTo, 'spotify', code));
  }
});

spotifyRoutes.delete('/connection', (req, res) => {
  const person = personOf(req.query.person);
  if (!person) return void res.status(400).json({ error: 'person is required' });
  db.prepare('DELETE FROM spotify_accounts WHERE person = ?').run(person);
  res.status(204).end();
});

interface SpotifyImage {
  url: string;
  width?: number | null;
}
/** The smallest image at least `min` px wide (Spotify lists largest first). */
const pickImage = (images: SpotifyImage[] | undefined, min = 120) =>
  images?.length ? ([...images].reverse().find((i) => (i.width ?? min) >= min) ?? images[0]).url : null;

/** What's playing right now, trimmed to what the strip shows. */
spotifyRoutes.get('/player', async (req, res) => {
  const person = personOf(req.query.person);
  if (!person) return void res.status(400).json({ error: 'person is required' });
  try {
    const p = await spotify<{
      is_playing: boolean;
      device?: { id: string; name: string; type: string; volume_percent: number | null };
      context?: { uri: string } | null;
      item?: { name: string; uri: string; artists?: { name: string }[]; album?: { images?: SpotifyImage[] }; show?: { name: string; images?: SpotifyImage[] } } | null;
    }>(person, 'GET', '/me/player?additional_types=episode');
    res.json({
      isPlaying: !!p?.is_playing,
      device: p?.device ? { id: p.device.id, name: p.device.name, type: p.device.type } : null,
      context: p?.context?.uri ?? null,
      track: p?.item
        ? {
            name: p.item.name,
            uri: p.item.uri,
            by: p.item.artists?.map((a) => a.name).join(', ') ?? p.item.show?.name ?? '',
            image: pickImage(p.item.album?.images ?? p.item.show?.images, 64),
          }
        : null,
    });
  } catch (err) {
    // "Nothing playing anywhere" isn't an error for the strip.
    if (err instanceof SpotifyError && err.code === 'no_device')
      return void res.json({ isPlaying: false, device: null, context: null, track: null });
    fail(res, err);
  }
});

/** Speakers and phones Spotify can play on right now (Spotify Connect). */
spotifyRoutes.get('/devices', async (req, res) => {
  const person = personOf(req.query.person);
  if (!person) return void res.status(400).json({ error: 'person is required' });
  try {
    const d = await spotify<{ devices: { id: string | null; name: string; type: string; is_active: boolean; is_restricted: boolean }[] }>(
      person,
      'GET',
      '/me/player/devices',
    );
    res.json(
      (d?.devices ?? [])
        .filter((x) => x.id && !x.is_restricted)
        .map((x) => ({ id: x.id, name: x.name, type: x.type, active: x.is_active })),
    );
  } catch (err) {
    fail(res, err);
  }
});

spotifyRoutes.get('/playlists', async (req, res) => {
  const person = personOf(req.query.person);
  if (!person) return void res.status(400).json({ error: 'person is required' });
  try {
    const out: { uri: string; name: string; image: string | null; tracks: number }[] = [];
    let path: string | null = '/me/playlists?limit=50';
    // Up to 200 playlists, which covers almost everyone without hammering the quota.
    for (let page = 0; path && page < 4; page++) {
      const r: {
        items: ({ uri: string; name: string; images?: SpotifyImage[] | null; tracks?: { total: number } } | null)[];
        next: string | null;
      } | null = await spotify(person, 'GET', path);
      for (const p of r?.items ?? []) {
        if (p) out.push({ uri: p.uri, name: p.name, image: pickImage(p.images ?? undefined, 120), tracks: p.tracks?.total ?? 0 });
      }
      path = r?.next ? r.next.replace(config.spotify.apiUrl, '') : null;
    }
    res.json(out);
  } catch (err) {
    fail(res, err);
  }
});

/**
 * Play: resume, or start a playlist (`uri`). Plays on `deviceId` if given, else wherever
 * Spotify is active, else the last speaker this person chose.
 */
spotifyRoutes.post('/play', async (req, res) => {
  const person = personOf(req.body?.person);
  if (!person) return void res.status(400).json({ error: 'person is required' });
  const { uri, deviceId, deviceName } = req.body ?? {};
  if (uri !== undefined && (typeof uri !== 'string' || !/^spotify:[a-z]+(:[A-Za-z0-9]+)+$/.test(uri)))
    return void res.status(400).json({ error: 'Not a Spotify link' });
  try {
    const saved = getAccount(person);
    const target = typeof deviceId === 'string' && deviceId ? deviceId : null;
    const body = uri ? { context_uri: uri } : undefined;
    const play = (device: string | null) =>
      spotify(person, 'PUT', `/me/player/play${device ? `?device_id=${encodeURIComponent(device)}` : ''}`, body);
    try {
      await play(target);
    } catch (err) {
      // Nothing active: fall back to the speaker they used last time.
      if (!(err instanceof SpotifyError && err.code === 'no_device' && !target && saved?.device_id)) throw err;
      await play(saved.device_id);
    }
    if (target) {
      db.prepare('UPDATE spotify_accounts SET device_id = ?, device_name = ? WHERE person = ?').run(
        target,
        typeof deviceName === 'string' ? deviceName.slice(0, 80) : null,
        person,
      );
    }
    res.json({ ok: true });
  } catch (err) {
    fail(res, err);
  }
});

for (const [action, method, path] of [
  ['pause', 'PUT', '/me/player/pause'],
  ['next', 'POST', '/me/player/next'],
  ['previous', 'POST', '/me/player/previous'],
] as const) {
  spotifyRoutes.post(`/${action}`, async (req, res) => {
    const person = personOf(req.body?.person);
    if (!person) return void res.status(400).json({ error: 'person is required' });
    try {
      await spotify(person, method, path);
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  });
}

/** The playlist "Play" starts with one tap when nothing is playing. `uri: null` clears it. */
spotifyRoutes.put('/morning', (req, res) => {
  const person = personOf(req.body?.person);
  if (!person) return void res.status(400).json({ error: 'person is required' });
  const { uri, name } = req.body ?? {};
  if (uri !== null && (typeof uri !== 'string' || !uri.startsWith('spotify:')))
    return void res.status(400).json({ error: 'Not a Spotify link' });
  const { changes } = db
    .prepare('UPDATE spotify_accounts SET morning_uri = ?, morning_name = ? WHERE person = ?')
    .run(uri, uri ? String(name ?? '').slice(0, 120) : null, person);
  if (!changes) return void res.status(409).json({ error: 'Spotify isn’t connected', code: 'not_connected' });
  res.json({ ok: true });
});
