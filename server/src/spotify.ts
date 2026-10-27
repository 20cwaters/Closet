import { config } from './config.js';
import { db } from './db.js';

/**
 * A thin Spotify Web API client, one linked account per person. Tokens are refreshed
 * automatically; Spotify's errors are turned into the few cases the UI explains.
 */

export const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-read-currently-playing',
  'playlist-read-private',
  'playlist-read-collaborative',
].join(' ');

export const spotifyEnabled = () =>
  !!(config.spotify.clientId && config.spotify.clientSecret && config.spotify.redirectUri);

export interface Account {
  person: string;
  spotify_id: string;
  display_name: string | null;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  morning_uri: string | null;
  morning_name: string | null;
  device_id: string | null;
  device_name: string | null;
}

export class SpotifyError extends Error {
  constructor(
    message: string,
    /** not_connected | no_device | premium | rate_limited | spotify */
    readonly code: string,
    readonly status = 502,
  ) {
    super(message);
  }
}

export const getAccount = (person: string) =>
  db.prepare('SELECT * FROM spotify_accounts WHERE person = ?').get(person) as Account | undefined;

const basicAuth = () =>
  'Basic ' + Buffer.from(`${config.spotify.clientId}:${config.spotify.clientSecret}`).toString('base64');

/** POST to Spotify's token endpoint (code exchange or refresh). */
export async function tokenRequest(params: Record<string, string>) {
  const res = await fetch(`${config.spotify.accountsUrl}/api/token`, {
    method: 'POST',
    headers: { Authorization: basicAuth(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !body.access_token) {
    throw new SpotifyError(body.error_description ?? body.error ?? `token request failed (${res.status})`, body.error ?? 'spotify', res.status);
  }
  return body as { access_token: string; refresh_token?: string; expires_in: number };
}

/** A valid access token for a person, refreshing it if it's about to expire. */
async function accessToken(person: string, force = false): Promise<string> {
  const acct = getAccount(person);
  if (!acct) throw new SpotifyError('Spotify isn’t connected', 'not_connected', 409);
  if (!force && acct.expires_at - Date.now() > 60_000) return acct.access_token;
  try {
    const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: acct.refresh_token });
    db.prepare(
      // Spotify may rotate the refresh token; keep the newest one.
      'UPDATE spotify_accounts SET access_token = ?, refresh_token = COALESCE(?, refresh_token), expires_at = ? WHERE person = ?',
    ).run(t.access_token, t.refresh_token ?? null, Date.now() + t.expires_in * 1000, person);
    return t.access_token;
  } catch (err) {
    if (err instanceof SpotifyError && err.code === 'invalid_grant') {
      // Access was revoked (or the app was reset): forget the link so the UI offers Connect again.
      db.prepare('DELETE FROM spotify_accounts WHERE person = ?').run(person);
      throw new SpotifyError('Spotify was disconnected. Connect again.', 'not_connected', 409);
    }
    throw err;
  }
}

/** Call the Web API as a person. Returns parsed JSON, or null for an empty (204) reply. */
export async function spotify<T = unknown>(person: string, method: string, path: string, body?: unknown): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await accessToken(person, attempt > 0);
    const res = await fetch(`${config.spotify.apiUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 401 && attempt === 0) continue; // expired early: refresh once and retry
    if (res.status === 204 || res.status === 202) return null;
    const text = await res.text();
    // Player commands sometimes answer success with a bare request id ("Kshw04mUeA"), not JSON.
    let json: { error?: { reason?: string; message?: string } } | null = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      if (!res.ok) console.error(`spotify: ${res.status} ${text.slice(0, 200)}`);
    }
    if (res.ok) return json as T;

    const reason: string = json?.error?.reason ?? '';
    if (res.status === 404 && (reason === 'NO_ACTIVE_DEVICE' || path.startsWith('/me/player'))) {
      throw new SpotifyError('Open Spotify on your phone or speaker, then try again', 'no_device', 409);
    }
    if (res.status === 403 && reason === 'PREMIUM_REQUIRED') {
      throw new SpotifyError('Controlling playback needs Spotify Premium', 'premium', 403);
    }
    if (res.status === 429) {
      throw new SpotifyError('Spotify is busy. Try again in a moment.', 'rate_limited', 429);
    }
    throw new SpotifyError(json?.error?.message ?? `Spotify answered ${res.status}`, 'spotify', 502);
  }
  throw new SpotifyError('Spotify sign-in expired', 'not_connected', 409);
}
