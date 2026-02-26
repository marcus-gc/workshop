import { useEffect, useCallback, type Dispatch } from 'react';
import { listCraftsmen, listProjects } from '../api';
import type { Action } from '../store/reducer';

export function useCraftsmen(dispatch: Dispatch<Action>) {
  const fetch = useCallback(async () => {
    try {
      const [craftsmen, projects] = await Promise.all([listCraftsmen(), listProjects()]);
      dispatch({ type: 'SET_CRAFTSMEN', craftsmen });
      dispatch({ type: 'SET_PROJECTS', projects });
    } catch (err) {
      console.error('Failed to load craftsmen/projects:', err);
    }
  }, [dispatch]);

  useEffect(() => {
    fetch();
    const id = setInterval(fetch, 30_000);
    return () => clearInterval(id);
  }, [fetch]);

  return fetch;
}
