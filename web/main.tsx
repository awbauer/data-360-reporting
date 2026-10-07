import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ApiError, type SessionInfo } from './api';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';

const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (!(error instanceof ApiError)) return;
      // Lost the Salesforce connection: back to Connect. Lost the app session: back to sign-in.
      const patch: Partial<SessionInfo> | null =
        error.code === 'not_connected' ? { connected: false, instanceHost: null }
          : error.code === 'unauthenticated' ? { user: null, connected: false, instanceHost: null }
            : null;
      if (patch) queryClient.setQueryData<SessionInfo>(['session'], (s) => (s ? { ...s, ...patch } : s));
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (count, error) => !(error instanceof ApiError) && count < 2,
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
