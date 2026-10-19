import { useSyncExternalStore } from 'react';

export type LogTab = 'ranking' | 'history';

export type Route =
  | { name: 'menu' }
  | { name: 'options' }
  | { name: 'log'; tab: LogTab }
  | { name: 'battle' }
  | { name: 'result' };

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, '');
  switch (path) {
    case 'options':
      return { name: 'options' };
    case 'ranking':
      return { name: 'log', tab: 'ranking' };
    case 'history':
      return { name: 'log', tab: 'history' };
    case 'battle':
      return { name: 'battle' };
    case 'result':
      return { name: 'result' };
    default:
      return { name: 'menu' };
  }
}

export function routeToHash(route: Route): string {
  switch (route.name) {
    case 'menu':
      return '#/';
    case 'log':
      return `#/${route.tab}`;
    default:
      return `#/${route.name}`;
  }
}

let current = parseRoute(window.location.hash);
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

// Back/forward buttons and manual hash edits.
const syncFromLocation = () => {
  const next = parseRoute(window.location.hash);
  if (routeToHash(next) === routeToHash(current)) return;
  current = next;
  emit();
};
window.addEventListener('popstate', syncFromLocation);
window.addEventListener('hashchange', syncFromLocation);

/**
 * Updates the route synchronously (history.pushState does not fire
 * hashchange), so state changes made in the same handler see the new route.
 */
export function navigate(route: Route, options: { replace?: boolean } = {}): void {
  const hash = routeToHash(route);
  if (options.replace) window.history.replaceState(null, '', hash);
  else if (window.location.hash !== hash) window.history.pushState(null, '', hash);
  current = route;
  emit();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const useRoute = (): Route => useSyncExternalStore(subscribe, () => current);
