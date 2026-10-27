import { motion } from 'framer-motion';
import type React from 'react';
import { spring } from '../lib/motion';

export function Toggle({ on, onChange, label, hint }: {
  on: boolean; onChange: (on: boolean) => void; label: string; hint?: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex min-h-14 w-full items-center gap-3 rounded-md px-1 text-left"
    >
      <span className="flex-1">
        <span className="block text-body">{label}</span>
        {hint && <span className="block text-caption text-muted">{hint}</span>}
      </span>
      <span className={`flex h-8 w-13 shrink-0 items-center rounded-full p-1 transition-colors ${on ? 'justify-end bg-ink' : 'justify-start bg-stage'}`}>
        <motion.span layout transition={spring.snappy} className={`size-6 rounded-full ${on ? 'bg-on-ink' : 'bg-paper'}`} />
      </span>
    </button>
  );
}

/** Any-of-N choice with big targets. Selected = ink fill; tap again to deselect. */
export function MultiChoice<T extends string>({ options, value, onChange, columns, label }: {
  options: { id: T; label: string }[];
  value: T[];
  onChange: (v: T[]) => void;
  columns?: string;
  label: string;
}) {
  const toggle = (id: T) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : options.map((o) => o.id).filter((o) => o === id || value.includes(o)));
  return (
    <div role="group" aria-label={label} className={`grid gap-2 ${columns ?? 'grid-cols-3'}`}>
      {options.map((o) => (
        <Chip key={o.id} on={value.includes(o.id)} onClick={() => toggle(o.id)}>
          {o.label}
        </Chip>
      ))}
    </div>
  );
}

export function Chip({ on, onClick, children, className = '' }: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.96 }}
      transition={spring.snappy}
      onClick={onClick}
      aria-pressed={on}
      className={`min-h-12 rounded-md px-3 text-label font-medium transition-colors ${
        on ? 'bg-ink text-on-ink' : 'bg-stage text-ink'
      } ${className}`}
    >
      {children}
    </motion.button>
  );
}
