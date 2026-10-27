import { useEffect, useState } from 'react';
import { Sheet } from './Sheet';

/** Ask for a person's name: adding someone, or renaming them. */
export function NameSheet({ open, title, initial = '', action, onClose, onSave }: {
  open: boolean;
  title: string;
  initial?: string;
  /** The button's label, e.g. "Add" or "Save". */
  action: string;
  onClose: () => void;
  /** Resolve to close the sheet; throw to show the error and keep it open. */
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(initial);
    setError(null);
  }, [open, initial]);

  const submit = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(name.trim());
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose}>
      <form
        className="flex flex-col gap-3 px-3 pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h2 className="font-serif text-title">{title}</h2>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          placeholder="Name"
          aria-label="Name"
          autoComplete="off"
          className="min-h-tap rounded-md bg-stage px-4 text-body outline-none placeholder:text-muted"
        />
        {error && <p className="text-label text-danger">{error}</p>}
        <button
          type="submit"
          disabled={!name.trim() || busy}
          className="min-h-tap rounded-full bg-ink px-6 text-label font-medium text-on-ink transition-opacity active:opacity-80 disabled:opacity-40"
        >
          {busy ? 'Saving…' : action}
        </button>
      </form>
    </Sheet>
  );
}
