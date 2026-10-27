import type { ReactNode } from 'react';

/** An empty state that says what to do next. */
export function Empty({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
      <p className="font-serif text-title">{title}</p>
      {body && <p className="max-w-xs text-label text-muted">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function PrimaryButton({ children, onClick, disabled }: {
  children: ReactNode; onClick?: () => void; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="min-h-tap rounded-full bg-ink px-6 text-label font-medium text-on-ink transition-opacity active:opacity-80 disabled:opacity-40"
    >
      {children}
    </button>
  );
}
