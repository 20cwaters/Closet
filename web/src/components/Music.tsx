import { AnimatePresence, motion } from 'framer-motion';
import { Music2, Pause, Play, RefreshCw, SkipBack, SkipForward, Speaker, Star } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import {
  api,
  spotifyKey,
  type PersonId,
  type SpotifyDevice,
  type SpotifyPlaylist,
} from '../api';
import { spring } from '../lib/motion';
import { invalidate, useQuery } from '../lib/query';
import { control, useSpotify } from '../lib/spotify';
import { Sheet } from './Sheet';

/**
 * A slim "now playing" strip for the Build screen. Shows nothing until the person has
 * connected Spotify (from their avatar menu). Tap it for playlists and speakers.
 */
export function MusicStrip({ person, className = '' }: { person: PersonId; className?: string }) {
  const { status, connected, player } = useSpotify(person);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!connected) return null;

  const run = (p: Promise<unknown>) => {
    setError(null);
    p.catch((e: Error) => setError(e.message));
  };
  const track = player?.track;
  const morning = status?.morning;

  return (
    <>
      <div className={`flex min-h-14 items-center gap-3 rounded-lg bg-stage pr-1 pl-2 ${className}`}>
        <button onClick={() => setOpen(true)} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 text-left" aria-label="Music">
          <AlbumArt src={track?.image ?? null} size={40} />
          <span className="min-w-0 flex-1">
            <AnimatePresence mode="popLayout" initial={false}>
              <motion.span
                key={error ?? track?.uri ?? 'idle'}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={spring.snappy}
                className="block"
              >
                {error ? (
                  <span className="block text-label text-danger">{error}</span>
                ) : track ? (
                  <>
                    <span className="block truncate text-label font-medium">{track.name}</span>
                    <span className="block truncate text-caption text-muted">
                      {track.by}
                      {player?.device && ` · ${player.device.name}`}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="block truncate text-label font-medium">{morning ? morning.name : 'Music'}</span>
                    <span className="block truncate text-caption text-muted">
                      {morning ? 'Your morning playlist' : 'Pick a playlist'}
                    </span>
                  </>
                )}
              </motion.span>
            </AnimatePresence>
          </span>
        </button>
        {track ? (
          <>
            <RoundButton
              label={player?.isPlaying ? 'Pause' : 'Play'}
              onClick={() => run(control(person, player?.isPlaying ? 'pause' : 'play'))}
            >
              {player?.isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
            </RoundButton>
            <RoundButton label="Next" onClick={() => run(control(person, 'next'))}>
              <SkipForward size={20} />
            </RoundButton>
          </>
        ) : (
          <RoundButton
            label={morning ? `Play ${morning.name}` : 'Choose music'}
            // No speaker known yet (first time, nothing active): let them pick one in the sheet.
            onClick={() => (morning && status?.device ? run(control(person, 'play', { uri: morning.uri })) : setOpen(true))}
          >
            <Play size={20} fill="currentColor" />
          </RoundButton>
        )}
      </div>
      <MusicSheet person={person} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function RoundButton({ label, onClick, children, large }: { label: string; onClick: () => void; children: ReactNode; large?: boolean }) {
  return (
    <motion.button
      whileTap={{ scale: 0.88 }}
      transition={spring.settle}
      onClick={onClick}
      aria-label={label}
      className={`grid shrink-0 place-items-center rounded-full ${large ? 'size-14 bg-ink text-on-ink' : 'size-12 text-ink active:bg-paper'}`}
    >
      {children}
    </motion.button>
  );
}

function AlbumArt({ src, size }: { src: string | null; size: number }) {
  const [failed, setFailed] = useState<string | null>(null);
  return src && failed !== src ? (
    <img
      src={src}
      alt=""
      onError={() => setFailed(src)}
      className="shrink-0 rounded-sm object-cover"
      style={{ width: size, height: size }}
    />
  ) : (
    <span className="grid shrink-0 place-items-center rounded-sm bg-paper text-muted" style={{ width: size, height: size }}>
      <Music2 size={size * 0.45} />
    </span>
  );
}

/** Controls, where to play, and the person's playlists (star one as the morning playlist). */
function MusicSheet({ person, open, onClose }: { person: PersonId; open: boolean; onClose: () => void }) {
  const { status, player } = useSpotify(person);
  const { data: devices, refresh: refreshDevices, loading: loadingDevices } = useQuery<SpotifyDevice[]>(
    open ? spotifyKey(person, 'devices') : null,
  );
  const { data: playlists, error: playlistError } = useQuery<SpotifyPlaylist[]>(open ? spotifyKey(person, 'playlists') : null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);

  // Where "play" goes: the speaker picked here, else wherever Spotify is playing, else last used.
  const activeId = devices?.find((d) => d.active)?.id;
  const only = devices?.length === 1 ? devices[0].id : undefined;
  const target = chosen ?? player?.device?.id ?? activeId ?? status?.device?.id ?? only ?? null;
  useEffect(() => {
    if (open) {
      setError(null);
      refreshDevices();
    }
  }, [open, refreshDevices]);

  const run = (p: Promise<unknown>) => {
    setError(null);
    return p.catch((e: Error) => setError(e.message));
  };
  const targetName = devices?.find((d) => d.id === target)?.name;
  const play = (uri?: string) => run(control(person, 'play', { uri, deviceId: target ?? undefined, deviceName: targetName }));

  const setMorning = async (p: SpotifyPlaylist | null) => {
    await api.put('/spotify/morning', { person, uri: p?.uri ?? null, name: p?.name });
    invalidate(spotifyKey(person, 'status'));
  };

  const track = player?.track;
  return (
    <Sheet open={open} onClose={onClose}>
      <div className="flex max-h-[80svh] flex-col">
        <div className="flex items-center gap-4 px-2 pb-4">
          <AlbumArt src={track?.image ?? null} size={64} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-serif text-title">{track ? track.name : 'Music'}</p>
            <p className="truncate text-label text-muted">
              {track ? track.by : status?.name ? `Spotify · ${status.name}` : 'Spotify'}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-center gap-6 pb-4">
          <RoundButton label="Previous" onClick={() => run(control(person, 'previous'))}>
            <SkipBack size={22} />
          </RoundButton>
          <RoundButton
            large
            label={player?.isPlaying ? 'Pause' : 'Play'}
            onClick={() => (player?.isPlaying ? run(control(person, 'pause')) : play())}
          >
            {player?.isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
          </RoundButton>
          <RoundButton label="Next" onClick={() => run(control(person, 'next'))}>
            <SkipForward size={22} />
          </RoundButton>
        </div>
        {error && <p className="px-2 pb-3 text-center text-label text-danger">{error}</p>}

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-label text-muted">Play on</p>
            <button
              onClick={() => refreshDevices()}
              className="-my-2 flex min-h-tap items-center gap-1.5 px-1 text-label text-accent"
              aria-label="Refresh speakers"
            >
              <RefreshCw size={14} className={loadingDevices ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
          {devices?.length ? (
            <div className="mb-5 flex flex-wrap gap-2">
              {devices.map((d) => (
                <button
                  key={d.id}
                  onClick={() => {
                    setChosen(d.id);
                    // Already playing: move the music to this speaker straight away.
                    if (player?.isPlaying) run(control(person, 'play', { deviceId: d.id, deviceName: d.name }));
                  }}
                  aria-pressed={target === d.id}
                  className={`flex min-h-12 items-center gap-2 rounded-md px-3 text-label font-medium transition-colors ${
                    target === d.id ? 'bg-ink text-on-ink' : 'bg-stage text-ink'
                  }`}
                >
                  <Speaker size={16} /> {d.name}
                </button>
              ))}
            </div>
          ) : (
            <p className="mb-5 text-label text-muted">
              {devices ? 'No speakers found. Open Spotify on your phone or speaker, then tap Refresh.' : 'Looking for speakers…'}
            </p>
          )}

          <p className="mb-2 text-label text-muted">Your playlists</p>
          {playlistError && <p className="text-label text-danger">{playlistError.message}</p>}
          <ul className="flex flex-col">
            {(playlists ?? []).map((p) => {
              const isMorning = status?.morning?.uri === p.uri;
              return (
                <li key={p.uri} className="flex items-center gap-1">
                  <button onClick={() => play(p.uri)} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-md px-1 text-left active:bg-stage">
                    <AlbumArt src={p.image} size={44} />
                    <span className="min-w-0">
                      <span className="block truncate text-label font-medium">{p.name}</span>
                      <span className="block text-caption text-muted">
                        {isMorning ? 'Morning playlist · ' : ''}
                        {p.tracks} {p.tracks === 1 ? 'song' : 'songs'}
                      </span>
                    </span>
                  </button>
                  <button
                    onClick={() => setMorning(isMorning ? null : p)}
                    aria-pressed={isMorning}
                    aria-label={isMorning ? `Stop using ${p.name} as morning playlist` : `Use ${p.name} as morning playlist`}
                    className={`grid size-tap shrink-0 place-items-center rounded-full ${isMorning ? 'text-accent' : 'text-muted'}`}
                  >
                    <Star size={18} fill={isMorning ? 'currentColor' : 'none'} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </Sheet>
  );
}
