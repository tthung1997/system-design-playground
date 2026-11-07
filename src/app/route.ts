import { useCallback, useSyncExternalStore } from 'react';

export type Route =
  | { page: 'playground' }
  | { page: 'lessons'; id?: string }
  | { page: 'challenges'; id?: string };

export function parseRoute(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [page, id] = parts;
  if (page === 'lessons') return id ? { page, id } : { page };
  if (page === 'challenges') return id ? { page, id } : { page };
  return { page: 'playground' };
}

export function routeHref(route: Route): string {
  if (route.page === 'playground') return '#/playground';
  return route.id ? `#/${route.page}/${encodeURIComponent(route.id)}` : `#/${route.page}`;
}

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};
const snapshot = () => window.location.hash;

/** Hash-based routing keeps the app a static site and makes the browser back button work. */
export function useRoute(): [Route, (route: Route) => void] {
  const hash = useSyncExternalStore(subscribe, snapshot, () => '');
  const navigate = useCallback((route: Route) => {
    window.location.hash = routeHref(route);
  }, []);
  return [parseRoute(hash), navigate];
}
