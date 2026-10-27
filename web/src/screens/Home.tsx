import { motion } from 'framer-motion';
import { HelpCircle, UserPlus } from 'lucide-react';
import { useState } from 'react';
import type { Person, PersonId } from '../api';
import { Avatar } from '../components/Avatar';
import { NameSheet } from '../components/NameSheet';
import { WeatherLine } from '../components/WeatherLine';
import { useLargeScreen } from '../lib/device';
import { spring } from '../lib/motion';
import { addPerson, peopleKey } from '../lib/people';
import { rememberPerson } from '../lib/person';
import { useQuery } from '../lib/query';
import { openTutorial } from '../lib/tutorial';
import { navigate } from '../router';

export function Home() {
  const { data: people } = useQuery<Person[]>(peopleKey);
  const large = useLargeScreen();
  const [adding, setAdding] = useState(false);

  const pick = (id: PersonId) => {
    if (!large) rememberPerson(id);
    navigate(`/${id}/build`);
  };

  const add = async (name: string) => pick(await addPerson(name));

  if (people && !people.length) return <Welcome onAdd={add} />;

  // Up to three people get a column (or row) each; more share a grid.
  const many = (people?.length ?? 0) > 3;

  return (
    <div className="flex h-full flex-col">
      <WeatherLine className="px-6 pt-[max(1.5rem,env(safe-area-inset-top))] text-center" />
      <div
        className={
          many
            ? 'grid min-h-0 flex-1 auto-rows-fr grid-cols-2 gap-y-6 overflow-y-auto px-6 py-8 landscape:grid-cols-4'
            : 'flex min-h-0 flex-1 flex-col landscape:flex-row'
        }
      >
        {(people ?? []).map((p, i) => (
          <motion.button
            key={p.id}
            onClick={() => pick(p.id)}
            whileTap={{ scale: 0.97 }}
            transition={spring.snappy}
            className={
              many
                ? 'flex flex-col items-center justify-center gap-3'
                : `flex flex-1 flex-col items-center justify-center gap-5 mx-8 landscape:mx-0 landscape:my-12 ${
                    i > 0 ? 'border-line portrait:border-t landscape:border-l' : ''
                  }`
            }
          >
            <Avatar person={p} size={many ? (large ? 112 : 80) : large ? 168 : 112} />
            <span
              className={`max-w-full truncate px-2 font-serif ${
                many ? 'text-title' : large ? 'text-hero' : 'text-display'
              }`}
            >
              {p.name}
            </span>
          </motion.button>
        ))}
      </div>
      {people && (
        <div className="flex justify-center gap-2 px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <button
            onClick={() => setAdding(true)}
            className="flex min-h-tap items-center gap-2 rounded-full px-4 text-label text-muted active:bg-stage"
          >
            <UserPlus size={18} /> Add person
          </button>
          <button
            onClick={openTutorial}
            className="flex min-h-tap items-center gap-2 rounded-full px-4 text-label text-muted active:bg-stage"
          >
            <HelpCircle size={18} /> How it works
          </button>
        </div>
      )}
      <NameSheet
        open={adding}
        title="Add a person"
        action="Add"
        onClose={() => setAdding(false)}
        onSave={add}
      />
    </div>
  );
}

/** First run: nobody's here yet. */
function Welcome({ onAdd }: { onAdd: (name: string) => Promise<void> }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onAdd(name.trim());
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="font-serif text-display">Closet</h1>
      <p className="max-w-sm text-body text-muted">
        Photograph your clothes, build outfits, and get a pick for each day based on the weather. Start with
        your name; you can add everyone else in your household afterwards.
      </p>
      <form
        className="mt-4 flex w-full max-w-sm flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          placeholder="Your name"
          aria-label="Your name"
          autoComplete="given-name"
          className="min-h-tap rounded-md bg-stage px-4 text-center text-body outline-none placeholder:text-muted"
        />
        {error && <p className="text-label text-danger">{error}</p>}
        <button
          type="submit"
          disabled={!name.trim() || busy}
          className="min-h-tap rounded-full bg-ink px-6 text-label font-medium text-on-ink transition-opacity active:opacity-80 disabled:opacity-40"
        >
          {busy ? 'Setting up…' : 'Get started'}
        </button>
      </form>
    </div>
  );
}
