import { api, spotifyKey, type PersonId, type SpotifyPlayer, type SpotifyStatus } from '../api';
import { invalidate, setQueryData, useQuery } from './query';

/** Connection status, and (when connected) what's playing, refreshed every few seconds. */
export function useSpotify(person: PersonId) {
  const { data: status } = useQuery<SpotifyStatus>(spotifyKey(person, 'status'));
  const connected = !!status?.enabled && status.connected;
  const { data: player, refresh } = useQuery<SpotifyPlayer>(connected ? spotifyKey(person, 'player') : null, {
    maxAge: 5000,
  });
  return { status, connected, player, refresh };
}

/** Send sign-in through the server, which comes back to this page afterwards. */
export function connectSpotify(person: PersonId) {
  location.href = `/api/spotify/login?person=${person}&return=${encodeURIComponent(location.href)}`;
}

export async function disconnectSpotify(person: PersonId) {
  await api.del(`/spotify/connection?person=${person}`);
  invalidate('/spotify/');
}

/**
 * Run a player command, then refresh "now playing" (twice: Spotify takes a moment to
 * report the new state). Optimistically flips play/pause so the button answers at once.
 */
export async function control(
  person: PersonId,
  action: 'play' | 'pause' | 'next' | 'previous',
  body: { uri?: string; deviceId?: string; deviceName?: string } = {},
) {
  const key = spotifyKey(person, 'player');
  if (action === 'play' || action === 'pause') {
    setQueryData<SpotifyPlayer>(key, (p) => (p ? { ...p, isPlaying: action === 'play' } : p));
  }
  try {
    await api.post(`/spotify/${action}`, { person, ...body });
  } finally {
    setTimeout(() => invalidate(key), 400);
    setTimeout(() => invalidate(key), 1500);
    if (body.deviceId) invalidate(spotifyKey(person, 'status'));
  }
}
