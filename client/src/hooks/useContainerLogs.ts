import { useEffect, type Dispatch } from 'react';
import type { Action } from '../store/reducer';

export function useContainerLogs(
  craftsmanId: string | null,
  active: boolean,
  dispatch: Dispatch<Action>
) {
  useEffect(() => {
    if (!craftsmanId || !active) return;

    let es: EventSource | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;

    function connect(attempt = 0) {
      es = new EventSource(`/api/craftsmen/${craftsmanId}/logs`);

      es.onmessage = (e: MessageEvent) => {
        dispatch({ type: 'APPEND_LOG', craftsmanId: craftsmanId!, line: e.data });
      };

      es.onerror = () => {
        es?.close();
        // Retry up to 5 times with backoff (for containers still starting)
        if (attempt < 5) {
          retryTimeout = setTimeout(() => connect(attempt + 1), 1000 * (attempt + 1));
        }
      };
    }

    connect();

    return () => {
      if (retryTimeout) clearTimeout(retryTimeout);
      es?.close();
    };
  }, [craftsmanId, active, dispatch]);
}
