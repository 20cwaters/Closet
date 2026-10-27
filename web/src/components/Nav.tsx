import { motion } from 'framer-motion';
import { GalleryVerticalEnd, Layers, Plus, Shirt } from 'lucide-react';
import type { PersonId } from '../api';
import { spring } from '../lib/motion';
import { navigate, type Tab } from '../router';
import { PersonButton } from './PersonMenu';

const items = [
  { tab: 'build', label: 'Build', Icon: Layers },
  { tab: 'outfits', label: 'Outfits', Icon: GalleryVerticalEnd },
  { tab: 'closet', label: 'Closet', Icon: Shirt },
] as const;

function NavLink({ person, tab, active, label, Icon, rail }: {
  person: PersonId; tab: Tab; active: boolean; label: string; Icon: typeof Shirt; rail: boolean;
}) {
  return (
    <button
      onClick={() => navigate(`/${person}/${tab}`, { replace: true })}
      className={`relative flex min-h-tap flex-col items-center justify-center gap-0.5 ${
        rail ? 'w-full py-3' : 'flex-1 py-2'
      } ${active ? 'text-ink' : 'text-muted'}`}
      aria-current={active ? 'page' : undefined}
    >
      <Icon size={22} strokeWidth={active ? 2 : 1.6} />
      <span className="text-caption">{label}</span>
      {active && (
        <motion.span
          layoutId={`nav-dot-${rail}`}
          className={`absolute rounded-full bg-ink ${rail ? 'left-0 h-6 w-[3px]' : 'top-0 h-[3px] w-6'}`}
          transition={spring.snappy}
        />
      )}
    </button>
  );
}

function AddButton({ person, rail }: { person: PersonId; rail: boolean }) {
  return (
    <motion.button
      whileTap={{ scale: 0.92 }}
      transition={spring.snappy}
      onClick={() => navigate(`/${person}/add`)}
      className={`grid place-items-center rounded-full bg-ink text-on-ink ${rail ? 'size-14' : 'size-14 -mt-5'}`}
      aria-label="Add clothes"
    >
      <Plus size={26} strokeWidth={2} />
    </motion.button>
  );
}

/** Phones and portrait tablet: a bottom bar with Add in the middle, where the thumb is. */
export function BottomBar({ person, tab }: { person: PersonId; tab: Tab }) {
  const [build, outfits, closet] = items;
  return (
    // Above the screen (which is positioned), or tiles scrolling under it cover the raised Add button.
    <nav className="relative z-10 flex items-center border-t border-line bg-paper px-2 safe-bottom">
      <NavLink person={person} {...build} active={tab === build.tab} rail={false} />
      <NavLink person={person} {...outfits} active={tab === outfits.tab} rail={false} />
      <div className="flex flex-1 justify-center">
        <AddButton person={person} rail={false} />
      </div>
      <NavLink person={person} {...closet} active={tab === closet.tab} rail={false} />
      <div className="flex flex-1 justify-center">
        <PersonButton person={person} size={30} />
      </div>
    </nav>
  );
}

/** Landscape tablet: a slim left rail, so Build keeps the full height. */
export function Rail({ person, tab }: { person: PersonId; tab: Tab }) {
  return (
    <nav className="flex w-24 shrink-0 flex-col items-center gap-2 border-r border-line py-5">
      <PersonButton person={person} size={44} />
      <div className="mt-6 flex w-full flex-col gap-1">
        {items.map((it) => (
          <NavLink key={it.tab} person={person} {...it} active={tab === it.tab} rail />
        ))}
      </div>
      <div className="mt-auto">
        <AddButton person={person} rail />
      </div>
    </nav>
  );
}
