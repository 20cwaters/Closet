import { useEffect } from 'react';

/**
 * Keep the closet tablet's screen on. The Wake Lock API only exists in a secure context
 * (HTTPS or localhost), so on plain LAN HTTP this quietly does nothing; see the README.
 * Browsers drop the lock when the page is hidden, so it is re-requested on return.
 */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || !window.isSecureContext || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const request = async () => {
      if (document.visibilityState !== 'visible' || cancelled) return;
      try {
        lock = await navigator.wakeLock.request('screen');
      } catch {
        /* e.g. battery saver; try again next time the page becomes visible */
      }
    };
    request();
    document.addEventListener('visibilitychange', request);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', request);
      lock?.release().catch(() => {});
    };
  }, [enabled]);
}
