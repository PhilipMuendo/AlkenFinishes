import { useEffect, useState } from 'react';
import { CloudOff, Download } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/**
 * Two things the app knows and never used to say.
 *
 * **Offline.** The service worker serves the last good copy of every GET for a
 * day, which is the right call for site conditions — but a cached figure looks
 * exactly like a live one. A supervisor reading yesterday's stock as today's is
 * the cache working correctly and the interface lying. So when the connection
 * drops, say so, and keep saying it.
 *
 * **A new version.** Registration is `prompt`, not `autoUpdate`: a service
 * worker that takes over on the next navigation can swap the app out from
 * under a half-typed report. The reader decides when.
 */
export function ConnectionBar() {
  const [offline, setOffline] = useState(() => !navigator.onLine);

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  if (!offline && !needRefresh) return null;

  return (
    <div
      role="status"
      className={cn(
        'sticky top-0 z-30 flex items-center justify-center gap-2 px-4 py-1.5 text-center text-xs font-medium',
        offline ? 'bg-warn-surface text-warn-fg' : 'bg-info-surface text-info-fg',
      )}
    >
      {offline ? (
        <>
          <CloudOff size={14} className="shrink-0" />
          <span>No connection — showing what was last loaded. Anything you file will wait.</span>
        </>
      ) : (
        <>
          <Download size={14} className="shrink-0" />
          <span>A new version is ready.</span>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-xs underline"
            onClick={() => void updateServiceWorker(true)}
          >
            Update now
          </Button>
        </>
      )}
    </div>
  );
}
