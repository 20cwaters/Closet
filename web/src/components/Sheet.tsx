import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, type ReactNode } from 'react';
import { spring } from '../lib/motion';

/** A bottom sheet. On the tablet it floats centred at the bottom instead of spanning edge to edge. */
export function Sheet({
  open,
  onClose,
  children,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <motion.div
            className="absolute inset-0 bg-black/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            className="relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-lg bg-paper px-4 pt-3 pb-4 safe-bottom sm:mb-4 sm:rounded-lg"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '110%' }}
            transition={spring.glide}
          >
            <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-line" />
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export function SheetButton({
  icon,
  children,
  onClick,
  tone,
}: {
  icon?: ReactNode;
  children: ReactNode;
  onClick: () => void;
  tone?: 'danger';
}) {
  return (
    <button
      onClick={onClick}
      className={`flex min-h-14 w-full items-center gap-3 rounded-md px-3 text-left text-body active:bg-stage ${
        tone === 'danger' ? 'text-danger' : ''
      }`}
    >
      <span className="text-muted">{icon}</span>
      {children}
    </button>
  );
}
