import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import axios from 'axios';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { AppRouter } from './router';
import { ToastProvider, useToast } from './lib/toast';
import { getErrorMessage } from './lib/errors';
import { installGlobalErrorHandlers } from './lib/monitoring';
import { ErrorBoundary } from './components/ErrorBoundary';
import { StepUpDialog } from './components/StepUpDialog';
import './styles.css';

declare module '@tanstack/react-query' {
  interface Register {
    /** inlineError: the page renders this query's failure itself (QueryErrorState), so skip the global toast. */
    queryMeta: { inlineError?: boolean };
  }
}

/** Server down or unreachable (no response / 5xx). A 4xx is an answer the page handles itself. */
function isOutage(error: unknown) {
  return axios.isAxiosError(error) && (!error.response || error.response.status >= 500);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Retrying a 4xx (forbidden, not found, validation) only repeats the same answer.
      retry: (failureCount, error) => isOutage(error) && failureCount < 2,
      staleTime: 30_000,
    },
  },
});

installGlobalErrorHandlers();

/** One toast per outage message, so a dead API does not stack a toast per query. */
function QueryOutageToaster() {
  const { showToast } = useToast();
  useEffect(() => {
    let lastMessage = '';
    let lastAt = 0;
    return queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'error') return;
      const { error } = event.action;
      if (event.query.meta?.inlineError || !isOutage(error)) return;
      const message = getErrorMessage(error);
      if (message === lastMessage && Date.now() - lastAt < 10_000) return;
      lastMessage = message;
      lastAt = Date.now();
      showToast(message, 'error');
    });
  }, [showToast]);
  return null;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary fullPage>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          <QueryOutageToaster />
          <BrowserRouter>
            <AppRouter />
          </BrowserRouter>
          <StepUpDialog />
        </ToastProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
