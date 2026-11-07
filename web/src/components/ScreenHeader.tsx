import type { ReactNode } from 'react';

/** Title row at the top of a screen. Kept small so content gets the space. */
export function ScreenHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex min-h-16 items-center gap-3 px-5 pt-[max(0.75rem,env(safe-area-inset-top))] rail:px-8 rail:pt-6">
      <div className="min-w-0">
        <h1 className="font-serif text-title">{title}</h1>
        {/* Room above for a button in here to be tall enough to tap: truncate clips anything outside its box. */}
        {subtitle && <div className="-mt-[1.8125rem] truncate pt-[1.6875rem] text-caption text-muted">{subtitle}</div>}
      </div>
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </header>
  );
}
