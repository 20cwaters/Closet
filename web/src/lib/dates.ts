/** "today", "yesterday", "3 days ago", or a short date for anything older than two weeks. */
export function relativeDay(date: string | null | undefined): string | null {
  if (!date) return null;
  const then = new Date(`${date}T12:00`);
  const now = new Date();
  now.setHours(12, 0, 0, 0);
  const days = Math.round((now.getTime() - then.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 14) return `${days} days ago`;
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** "Oct 24", with the year when it isn't this year. */
export function shortDate(date: string): string {
  const d = new Date(`${date}T12:00`);
  const year = d.getFullYear() !== new Date().getFullYear();
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(year && { year: 'numeric' }) });
}

export const wornLabel = (date: string | null | undefined) => {
  const r = relativeDay(date);
  return r ? `Worn ${r}` : 'Not worn yet';
};

/** Today as YYYY-MM-DD on this device. */
export const localToday = () => new Date().toLocaleDateString('en-CA');
