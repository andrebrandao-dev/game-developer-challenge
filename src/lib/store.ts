/**
 * Minimal observable value compatible with React's useSyncExternalStore.
 * `set` only notifies when the value actually changes (shallow compare), which
 * is what keeps per-frame game updates from re-rendering React components.
 */
export class ValueStore<T extends object> {
  private value: T;
  private readonly listeners = new Set<() => void>();

  constructor(initial: T) {
    this.value = initial;
  }

  readonly get = (): T => this.value;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  set(next: T): void {
    if (shallowEqual(this.value, next)) return;
    this.value = next;
    for (const listener of this.listeners) listener();
  }

  patch(partial: Partial<T>): void {
    this.set({ ...this.value, ...partial });
  }
}

function shallowEqual<T extends object>(a: T, b: T): boolean {
  if (a === b) return true;
  const keysA = Object.keys(a) as (keyof T)[];
  if (keysA.length !== Object.keys(b).length) return false;
  return keysA.every((key) => Object.is(a[key], b[key]));
}
