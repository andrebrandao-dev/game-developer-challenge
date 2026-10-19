import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createQueryClient } from '@/api/queries';
import { App } from '@/app/App';
import { runtimeFlags } from '@/app/runtimeFlags';
import { startMockApi } from '@/mocks/browser';
import { installTestHooks } from '@/testing/testHooks';
import './styles/global.css';

async function bootstrap(): Promise<void> {
  const root = document.getElementById('root');
  if (!root) throw new Error('Missing #root element');

  try {
    await startMockApi();
  } catch (error) {
    // Without the mock API the game still works; ranking/history show their error states.
    console.warn('[pirate-battle] Mock API unavailable:', error);
  }

  const queryClient = createQueryClient();
  if (runtimeFlags.testHooks) installTestHooks(queryClient);

  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );
}

void bootstrap();
