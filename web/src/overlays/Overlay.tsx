import { motion } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import { spring } from '../lib/motion';

/**
 * A full-screen detail view. The page fades in behind a shared-element hero (which flies
 * in via layoutId), then the rest of the content rises into place.
 */
export function Overlay({ onClose, children, z = 40 }: { onClose: () => void; children: ReactNode; z?: number }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <motion.div className="fixed inset-0 flex flex-col" style={{ zIndex: z }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
      <motion.div
        className="absolute inset-0 bg-paper"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.22 }}
      />
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center px-2 pt-[max(0.5rem,env(safe-area-inset-top))] rail:px-5 rail:pt-4">
          <button
            onClick={onClose}
            className="flex min-h-tap items-center gap-1.5 rounded-full px-3 text-label text-muted active:bg-stage"
          >
            <ArrowLeft size={20} /> Back
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto rail:overflow-hidden">{children}</div>
      </div>
    </motion.div>
  );
}

/** Content that rises in just after the hero lands. */
export function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...spring.glide, delay: 0.08 }}
    >
      {children}
    </motion.div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-label font-medium">{title}</h2>
      {children}
    </section>
  );
}

/** A title that edits in place. Saves on Enter or when focus leaves. */
export function EditableTitle({ value, placeholder, onSave, editable }: {
  value: string | null;
  placeholder: string;
  onSave: (v: string) => void;
  editable: boolean;
}) {
  if (!editable) return <h1 className="font-serif text-title">{value ?? placeholder}</h1>;
  return (
    <input
      key={value ?? ''}
      defaultValue={value ?? ''}
      placeholder={placeholder}
      aria-label="Name"
      maxLength={80}
      onBlur={(e) => e.target.value.trim() !== (value ?? '') && onSave(e.target.value)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      className="-mx-1 w-full rounded-sm bg-transparent px-1 font-serif text-title placeholder:text-muted focus:bg-stage focus:outline-none"
    />
  );
}
