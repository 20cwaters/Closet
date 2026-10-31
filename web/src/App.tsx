import { AnimatePresence, motion, MotionConfig } from 'framer-motion';
import { useCallback, useEffect, type CSSProperties, type ReactNode } from 'react';
import type { AppConfig, Person, PersonId } from './api';
import { MusicStrip } from './components/Music';
import { BottomBar, Rail } from './components/Nav';
import { Tutorial } from './components/Tutorial';
import { useLargeScreen, useRail } from './lib/device';
import { rememberedPerson } from './lib/person';
import { peopleKey } from './lib/people';
import { useQuery } from './lib/query';
import { openTutorial, tutorialSeen } from './lib/tutorial';
import { useIdleReset } from './lib/useIdleReset';
import { useWakeLock } from './lib/wakeLock';
import { useSpotify } from './lib/spotify';
import { navigate, useLocation, type Tab } from './router';
import { Add } from './screens/Add';
import { Build } from './screens/Build';
import { Closet } from './screens/Closet';
import { Home } from './screens/Home';
import { Calendar } from './overlays/Calendar';
import { ItemDetail } from './overlays/ItemDetail';
import { OutfitDetail } from './overlays/OutfitDetail';
import { Outfits } from './screens/Outfits';

export function App() {
  const { route, params } = useLocation();
  const large = useLargeScreen();
  const rail = useRail();
  const { data: config } = useQuery<AppConfig>('/config');
  const { data: people } = useQuery<Person[]>(peopleKey);
  const person = route.name === 'tab' ? route.person : null;

  // Phones skip the picker and go straight to the last person, unless switching.
  useEffect(() => {
    if (route.name !== 'home' || large || params.has('switch') || !people) return;
    const p = rememberedPerson();
    if (p && people.some((x) => x.id === p)) navigate(`/${p}/build`, { replace: true });
  }, [route.name, large, params, people]);

  // A link to someone who's been removed (or never existed) goes back to the picker.
  useEffect(() => {
    if (person && people && !people.some((p) => p.id === person)) navigate('/', { replace: true });
  }, [person, people]);

  // The tour shows the first time anyone opens a closet on this device.
  useEffect(() => {
    if (person && !tutorialSeen()) openTutorial();
  }, [person]);

  // The closet tablet drifts back to the picker when nobody's using it.
  const goHome = useCallback(() => navigate('/', { replace: true }), []);
  useIdleReset(large && route.name !== 'home', config?.idleTimeoutSeconds ?? 90, goHome);
  useWakeLock(large);

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence mode="wait" initial={false}>
        {route.name === 'home' ? (
          <motion.div
            key="home"
            className="h-full"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <Home />
          </motion.div>
        ) : (
          <motion.div
            key={route.person}
            className="flex h-full flex-col rail:flex-row"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            {rail && <Rail person={route.person} tab={route.tab} />}
            <TabArea person={route.person} tab={route.tab} rail={rail}>
              {route.tab === 'build' && <Build person={route.person} />}
              {route.tab === 'outfits' && <Outfits person={route.person} />}
              {route.tab === 'closet' && <Closet person={route.person} />}
              {route.tab === 'add' && <Add person={route.person} />}
            </TabArea>
            {!rail && <BottomBar person={route.person} tab={route.tab} />}
            <Overlays person={route.person} params={params} />
          </motion.div>
        )}
      </AnimatePresence>
      <Tutorial />
    </MotionConfig>
  );
}

/**
 * The screen, with music floating over its bottom edge on every tab but Build (which
 * gives its strip a row above the action buttons). Screens pad their scrolling content by
 * `--music-space` so the last row can scroll out from under it.
 */
function TabArea({ person, tab, rail, children }: { person: PersonId; tab: Tab; rail: boolean; children: ReactNode }) {
  const { connected } = useSpotify(person);
  const floating = connected && tab !== 'build';
  return (
    <main
      className="relative min-h-0 min-w-0 flex-1"
      style={{ '--music-space': floating ? '5rem' : '0px' } as CSSProperties}
    >
      {children}
      {floating && (
        // Phones: high enough to clear the raised Add button in the bar below.
        <MusicStrip
          person={person}
          floating
          className={`absolute z-20 ${rail ? 'right-8 bottom-4 w-[26rem]' : 'inset-x-4 bottom-3'}`}
        />
      )}
    </main>
  );
}

/** Detail views open over any screen. An item can open on top of an outfit, an outfit on the calendar. */
function Overlays({ person, params }: { person: PersonId; params: URLSearchParams }) {
  const item = Number(params.get('item')) || null;
  const outfit = Number(params.get('outfit')) || null;
  const month = params.get('calendar');
  return (
    <>
      <AnimatePresence>{month && <Calendar key="calendar" month={month} person={person} />}</AnimatePresence>
      <AnimatePresence>{outfit && <OutfitDetail key={`o${outfit}`} id={outfit} person={person} />}</AnimatePresence>
      <AnimatePresence>{item && <ItemDetail key={`i${item}`} id={item} person={person} />}</AnimatePresence>
    </>
  );
}
