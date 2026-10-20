import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { isChunkLoadError, reloadForNewRelease, reportError } from '../lib/monitoring';
import { Button } from './ui/button';

type Props = { children: ReactNode; fullPage?: boolean };
type State = { error: Error | null; updateAvailable: boolean };

/**
 * Stops a crash in one page from blanking the whole app. Inside the layout the
 * sidebar keeps working, so the user can navigate away; the router remounts this
 * boundary per route (keyed by path), which clears the error on navigation.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, updateAvailable: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error, updateAvailable: isChunkLoadError(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (isChunkLoadError(error)) {
      if (reloadForNewRelease()) return;
      reportError('chunk', error);
      return;
    }
    const withComponentStack = new Error(error.message);
    withComponentStack.name = error.name;
    withComponentStack.stack = `${error.stack ?? ''}\nComponent stack:${info.componentStack ?? ''}`;
    reportError('boundary', withComponentStack);
  }

  render() {
    const { error, updateAvailable } = this.state;
    if (!error) return this.props.children;

    return (
      <div className={this.props.fullPage ? 'flex min-h-screen items-center justify-center p-6' : 'flex justify-center py-16'}>
        <div role="alert" className="max-w-md text-center space-y-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600">
            <AlertTriangle size={24} aria-hidden />
          </div>
          <h2 className="text-xl font-semibold">{updateAvailable ? 'A new version is available' : 'Something went wrong on this page'}</h2>
          <p className="text-sm text-muted-foreground">
            {updateAvailable
              ? 'The portal was updated while this tab was open. Reload to continue.'
              : 'The error has been reported. Reload the page to try again; if it keeps happening, contact your administrator.'}
          </p>
          <Button onClick={() => window.location.reload()}>
            <RefreshCw size={16} className="mr-2" aria-hidden /> Reload page
          </Button>
        </div>
      </div>
    );
  }
}
