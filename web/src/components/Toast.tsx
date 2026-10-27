import { AnimatePresence, motion } from 'framer-motion';
import { useEffect } from 'react';
import { spring } from '../lib/motion';

export interface ToastMessage {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
}

/** A short confirmation that floats above the actions, with an optional undo. */
export function Toast({ message, onDone }: { message: ToastMessage | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, 5000);
    return () => clearTimeout(t);
  }, [message, onDone]);

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-full z-20 flex justify-center pb-3">
      <AnimatePresence>
        {message && (
          <motion.div
            key={message.id}
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={spring.snappy}
            className="pointer-events-auto flex min-h-12 items-center gap-4 rounded-full bg-ink pr-2 pl-5 text-label text-on-ink"
            role="status"
          >
            {message.text}
            {message.action && (
              <button
                onClick={() => {
                  message.action!.run();
                  onDone();
                }}
                className="min-h-11 rounded-full px-3 font-medium underline-offset-4 active:underline"
              >
                {message.action.label}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
