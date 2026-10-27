import type { ReactNode } from 'react';

/** Title row at the top of a screen. Kept small so content gets the space. */
export function ScreenHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <header className="flex min-h-16 items-center gap-3 px-5 pt-[max(0.75rem,env(safe-area-inset-top))] rail:px-8 rail:pt-6">
      <div className="min-w-0">
        <h1 className="font-serif text-title">{title}</h1>
        {subtitle && <div className="-mt-0.5 truncate text-caption text-muted">{subtitle}</div>}
      </div>
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </header>
  );
}
