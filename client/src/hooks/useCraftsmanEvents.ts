import { useEffect, type Dispatch } from 'react';
import type { Action } from '../store/reducer';

export function useCraftsmanEvents(craftsmanId: string | null, dispatch: Dispatch<Action>) {
  useEffect(() => {
    if (!craftsmanId) return;

    const es = new EventSource(`/api/craftsmen/${craftsmanId}/events`);

    es.addEventListener('status', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as { id: string; status: string; error_message?: string };
        dispatch({
          type: 'UPDATE_CRAFTSMAN_STATUS',
          id: data.id,
          status: data.status as Parameters<typeof dispatch>[0] extends { type: 'UPDATE_CRAFTSMAN_STATUS' } ? Parameters<typeof dispatch>[0]['status'] : never,
          error_message: data.error_message,
        });
      } catch {}
    });

    es.onerror = () => {
      // Connection errors are non-fatal; EventSource auto-reconnects
    };

    return () => es.close();
  }, [craftsmanId, dispatch]);
}
