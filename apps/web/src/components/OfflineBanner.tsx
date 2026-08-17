import { useEffect, useState } from 'react';
import { CloudOff } from 'lucide-react';

/**
 * Says out loud what the service worker is already doing.
 *
 * GET requests fall back to the runtime cache when the network is gone (see
 * `vite.config.ts`), so pages keep rendering — which is worse than useless
 * without this, because the figures look live when they are not, and any
 * *write* is going to fail. Supervisors work in places with no signal, so
 * this is the difference between "the app is broken" and "I'll do it at the
 * gate".
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const goOffline = () => setOffline(true);
    const goOnline = () => setOffline(false);
    window.addEventListener('offline', goOffline);
    window.addEventListener('online', goOnline);
    return () => {
      window.removeEventListener('offline', goOffline);
      window.removeEventListener('online', goOnline);
    };
  }, []);

  if (!offline) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 bg-amber-500 px-4 py-1.5 text-center text-xs font-medium text-amber-950"
    >
      <CloudOff size={14} aria-hidden className="shrink-0" />
      No connection — showing the last data received. Anything you save now will not go through.
    </div>
  );
}
