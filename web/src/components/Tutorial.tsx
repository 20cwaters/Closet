import { AnimatePresence, motion } from 'framer-motion';
import { CalendarDays, Camera, Layers, Lock, Shirt, Sparkles, Users, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { spring } from '../lib/motion';
import { closeTutorial, useTutorialOpen } from '../lib/tutorial';

const STEPS: { Icon: LucideIcon; title: string; body: string }[] = [
  {
    Icon: Sparkles,
    title: 'Welcome to Closet',
    body: 'Your clothes, your outfits, and a pick for today, all in one place. Here’s a quick tour.',
  },
  {
    Icon: Camera,
    title: 'Add your clothes',
    body: 'Tap + and photograph each piece laid flat on a plain background. The background is removed for you. Choose many photos at once and tag them while they upload.',
  },
  {
    Icon: Shirt,
    title: 'Tag each piece',
    body: 'Say what it is (top, bottoms, shoes…), the weather it suits, and its style. Untagged pieces wait in your Closet until you tag them.',
  },
  {
    Icon: Layers,
    title: 'Build an outfit',
    body: 'Build opens on today’s pick, chosen from the weather and what you haven’t worn lately. Swipe a row to change a piece, or Shuffle for a new idea.',
  },
  {
    Icon: Lock,
    title: 'Lock, save, wear',
    body: 'Lock a row to keep that piece while you shuffle the rest. Save outfit keeps the look; Wear today logs it so tomorrow’s pick won’t repeat it.',
  },
  {
    Icon: CalendarDays,
    title: 'Outfits and calendar',
    body: 'Outfits holds everything you’ve saved. Open the calendar to see what you wore, or plan an outfit for a day ahead.',
  },
  {
    Icon: Users,
    title: 'Everyone gets a closet',
    body: 'Tap your avatar to switch person, add a photo, or come back to this tour. Add more people from the Profiles screen, and share pieces between closets.',
  },
];

export function Tutorial() {
  const open = useTutorialOpen();
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeTutorial();
      if (e.key === 'ArrowRight') setStep((s) => Math.min(s + 1, STEPS.length - 1));
      if (e.key === 'ArrowLeft') setStep((s) => Math.max(s - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const last = step === STEPS.length - 1;
  const { Icon, title, body } = STEPS[step];

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
          <motion.div
            className="absolute inset-0 bg-black/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={closeTutorial}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="How Closet works"
            className="relative flex w-full max-w-md flex-col rounded-t-lg bg-paper px-6 pt-6 pb-5 safe-bottom sm:rounded-lg"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={spring.glide}
          >
            <button
              onClick={closeTutorial}
              className="absolute right-3 top-3 min-h-11 rounded-full px-3 text-label text-muted active:bg-stage"
            >
              Skip
            </button>
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={step}
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -16 }}
                transition={{ duration: 0.16 }}
                className="flex min-h-64 flex-col items-center gap-4 pt-6 text-center"
                aria-live="polite"
              >
                <span className="grid size-20 place-items-center rounded-full bg-stage text-accent">
                  <Icon size={34} strokeWidth={1.6} />
                </span>
                <h2 className="font-serif text-title">{title}</h2>
                <p className="max-w-sm text-body text-muted">{body}</p>
              </motion.div>
            </AnimatePresence>
            <div className="mt-6 flex justify-center gap-1.5" aria-hidden>
              {STEPS.map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 rounded-full transition-all ${i === step ? 'w-5 bg-ink' : 'w-1.5 bg-line'}`}
                />
              ))}
            </div>
            <div className="mt-5 flex gap-2">
              {step > 0 && (
                <button
                  onClick={() => setStep(step - 1)}
                  className="min-h-tap flex-1 rounded-full bg-stage px-6 text-label font-medium"
                >
                  Back
                </button>
              )}
              <button
                onClick={() => (last ? closeTutorial() : setStep(step + 1))}
                className="min-h-tap flex-1 rounded-full bg-ink px-6 text-label font-medium text-on-ink active:opacity-80"
              >
                {last ? 'Get started' : 'Next'}
              </button>
            </div>
            <p className="sr-only">
              Step {step + 1} of {STEPS.length}
            </p>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
