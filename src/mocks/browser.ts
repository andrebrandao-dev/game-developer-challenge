import { setupWorker } from 'msw/browser';
import type { QueryClient } from '@tanstack/react-query';
import { runtimeFlags } from '@/app/runtimeFlags';
import { clearOutbox } from '@/api/pendingRecords';
import { resetKnownRevision } from '@/api/queries';
import { NETWORK_CHANGED_EVENT } from '@/api/RecordSyncAgent';
import { mockDb, mockScenario } from './db';
import { handlers } from './handlers';
import { DEFAULT_SCENARIO_ID } from './scenarios';

/**
 * Starts the MSW service worker. Mocks run in every build (including the
 * published one), because the ranking/history backend is simulated.
 * Only /api requests are intercepted; everything else is bypassed.
 */
export async function startMockApi(): Promise<void> {
  if (runtimeFlags.scenario) mockScenario.select(runtimeFlags.scenario);
  const worker = setupWorker(...handlers);
  await worker.start({
    serviceWorker: { url: `${import.meta.env.BASE_URL}mockServiceWorker.js` },
    onUnhandledFrame: 'bypass',
    quiet: !import.meta.env.DEV,
  });
}

/** Switches scenario and lets queued records retry under the new conditions. */
export function selectScenario(id: string): void {
  mockScenario.select(id);
  window.dispatchEvent(new Event(NETWORK_CHANGED_EVENT));
}

/**
 * Restores the initial state: fixtures only, default scenario, empty outbox,
 * fresh query cache.
 */
export function resetNetworkState(queryClient: QueryClient): void {
  mockDb.reset();
  mockScenario.select(DEFAULT_SCENARIO_ID);
  clearOutbox();
  resetKnownRevision();
  queryClient.clear();
}
