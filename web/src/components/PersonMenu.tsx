import { Camera, HelpCircle, Home, Moon, Music2, Pencil, Repeat, Sun, UserMinus } from 'lucide-react';
import { useRef, useState } from 'react';
import { spotifyKey, type Person, type PersonId, type SpotifyStatus } from '../api';
import { useLargeScreen } from '../lib/device';
import { peopleKey, personSummary, removePerson, renamePerson } from '../lib/people';
import { rememberPerson } from '../lib/person';
import { invalidate, useQuery } from '../lib/query';
import { connectSpotify, disconnectSpotify } from '../lib/spotify';
import { resizeImage, upload } from '../lib/resize';
import { setTheme, useTheme } from '../lib/theme';
import { openTutorial } from '../lib/tutorial';
import { navigate, useLocation } from '../router';
import { Avatar } from './Avatar';
import { NameSheet } from './NameSheet';
import { Sheet, SheetButton } from './Sheet';

/** The current person's avatar. Tapping it offers switching person, editing their profile, and settings. */
export function PersonButton({ person, size = 40 }: { person: PersonId; size?: number }) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { data: people } = useQuery<Person[]>(peopleKey);
  const { data: spotify } = useQuery<SpotifyStatus>(spotifyKey(person, 'status'));
  const { route } = useLocation();
  const large = useLargeScreen();
  const theme = useTheme();
  const me = people?.find((p) => p.id === person);
  // A few people fit as buttons here; with more, Profiles is the way to switch.
  const others = (people ?? []).filter((p) => p.id !== person);
  const quickSwitch = others.length <= 2 ? others : [];

  const switchTo = (id: PersonId) => {
    setOpen(false);
    if (!large) rememberPerson(id);
    navigate(`/${id}/${route.name === 'tab' ? route.tab : 'build'}`);
  };

  const remove = async () => {
    if (!me) return;
    const { items, outfits } = await personSummary(person).catch(() => ({ items: 0, outfits: 0 }));
    const lost = [items && `${items} piece${items === 1 ? '' : 's'}`, outfits && `${outfits} outfit${outfits === 1 ? '' : 's'}`]
      .filter(Boolean)
      .join(' and ');
    const msg = `Remove ${me.name}?${lost ? ` This deletes their ${lost} for good.` : ''} This can't be undone.`;
    if (!confirm(msg)) return;
    try {
      await removePerson(person);
      setOpen(false);
      navigate(large ? '/' : '/?switch', { replace: true });
    } catch (e) {
      alert((e as Error).message);
    }
  };

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const blob = await resizeImage(file, 600);
      await upload(`/api/people/${person}/photo`, blob);
      invalidate('/people');
      setOpen(false);
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="grid size-tap place-items-center rounded-full"
        aria-label={`${me?.name ?? ''}: profile and settings`}
      >
        <Avatar person={me} size={size} />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)}>
        <div className="flex items-center gap-3 px-3 pb-3">
          <Avatar person={me} size={44} />
          <span className="font-serif text-title">{me?.name}</span>
        </div>
        {quickSwitch.map((p) => (
          <SheetButton key={p.id} icon={<Repeat size={20} />} onClick={() => switchTo(p.id)}>
            Switch to {p.name}
          </SheetButton>
        ))}
        <SheetButton icon={<Camera size={20} />} onClick={() => fileRef.current?.click()}>
          {busy ? 'Uploading…' : me?.photo ? 'Change photo' : 'Add a photo'}
        </SheetButton>
        <SheetButton
          icon={<Pencil size={20} />}
          onClick={() => {
            setOpen(false);
            setRenaming(true);
          }}
        >
          Rename
        </SheetButton>
        {spotify?.enabled &&
          (spotify.connected ? (
            <SheetButton
              icon={<Music2 size={20} />}
              onClick={async () => {
                if (!confirm('Disconnect Spotify? The music player disappears until you connect again.')) return;
                await disconnectSpotify(person);
              }}
            >
              <span>
                Disconnect Spotify
                <span className="block text-caption text-muted">Connected as {spotify.name}</span>
              </span>
            </SheetButton>
          ) : (
            <SheetButton icon={<Music2 size={20} />} onClick={() => connectSpotify(person)}>
              <span>
                Connect Spotify
                <span className="block text-caption text-muted">Play music while you get ready</span>
              </span>
            </SheetButton>
          ))}
        <SheetButton
          icon={theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          <span>
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
            <span className="block text-caption text-muted">Just on this device</span>
          </span>
        </SheetButton>
        <SheetButton
          icon={<HelpCircle size={20} />}
          onClick={() => {
            setOpen(false);
            openTutorial();
          }}
        >
          How Closet works
        </SheetButton>
        {/* Phones normally skip the picker for the last person; ?switch shows it anyway. */}
        <SheetButton icon={<Home size={20} />} onClick={() => navigate(large ? '/' : '/?switch')}>
          <span>
            Profiles
            <span className="block text-caption text-muted">Switch person or add someone</span>
          </span>
        </SheetButton>
        <SheetButton icon={<UserMinus size={20} />} tone="danger" onClick={remove}>
          Remove {me?.name}
        </SheetButton>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => onPhoto(e.target.files?.[0])}
        />
      </Sheet>
      <NameSheet
        open={renaming}
        title="Rename"
        initial={me?.name ?? ''}
        action="Save"
        onClose={() => setRenaming(false)}
        onSave={(name) => renamePerson(person, name)}
      />
    </>
  );
}
