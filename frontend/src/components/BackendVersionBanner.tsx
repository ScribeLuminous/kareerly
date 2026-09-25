import { useEffect, useState } from 'react';
import { loadBackendHealthConfig } from '../lib/api';
import { assessBackendVersion, outdatedBackendMessage, type BackendVersionCheck } from '../lib/backendVersion';

const DISMISSED_KEY = 'kareerly.backendVersionBannerDismissed';
// A backend that sleeps when idle may miss the first probe while it starts.
const RETRY_AFTER_MS = 20_000;

function wasDismissed(): boolean {
  try {
    return window.sessionStorage.getItem(DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

/** Warns when the backend runs older code than this website was built for. */
export default function BackendVersionBanner() {
  const [check, setCheck] = useState<BackendVersionCheck>({ status: 'unknown' });
  const [dismissed, setDismissed] = useState(wasDismissed);

  useEffect(() => {
    let active = true;
    let retry: number | undefined;
    const probe = async (retryIfUnknown: boolean) => {
      const result = assessBackendVersion(await loadBackendHealthConfig());
      if (!active) return;
      setCheck(result);
      if (result.status === 'unknown' && retryIfUnknown) {
        retry = window.setTimeout(() => void probe(false), RETRY_AFTER_MS);
      }
    };
    void probe(true);
    return () => {
      active = false;
      window.clearTimeout(retry);
    };
  }, []);

  if (check.status !== 'outdated' || dismissed) return null;
  const message = outdatedBackendMessage(check);

  const dismiss = () => {
    setDismissed(true);
    try {
      window.sessionStorage.setItem(DISMISSED_KEY, '1');
    } catch {
      // Storage may be blocked; the banner then returns on the next page load.
    }
  };

  return (
    <div role="status" className="flex items-start gap-3 border-b border-amber bg-amber-l px-4 py-2 text-sm text-dark">
      <div className="min-w-0 flex-1">
        <div className="font-semibold">{message.summary}</div>
        <div className="mt-0.5 break-words text-mid">{message.detail}</div>
      </div>
      <button type="button" onClick={dismiss} className="shrink-0 rounded px-2 py-1 font-bold text-amber hover:bg-card" aria-label="Dismiss this warning">
        Dismiss
      </button>
    </div>
  );
}
