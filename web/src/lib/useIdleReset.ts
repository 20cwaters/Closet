import { useEffect } from 'react';

/** Call `onIdle` after `seconds` without touch, key, wheel or scroll input. */
export function useIdleReset(enabled: boolean, seconds: number, onIdle: () => void) {
  useEffect(() => {
    if (!enabled || seconds <= 0) return;
    let timer = window.setTimeout(onIdle, seconds * 1000);
    const reset = () => {
      clearTimeout(timer);
      timer = window.setTimeout(onIdle, seconds * 1000);
    };
    const events = ['pointerdown', 'keydown', 'wheel', 'scroll'] as const;
    events.forEach((e) => window.addEventListener(e, reset, { capture: true, passive: true }));
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, reset, { capture: true }));
    };
  }, [enabled, seconds, onIdle]);
}
