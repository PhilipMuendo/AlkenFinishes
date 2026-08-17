import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

/**
 * Last line of defence. Without one, a single render throw anywhere in the
 * tree unmounts the whole app and leaves a white screen — on a phone, with no
 * console to look at, that is indistinguishable from the app being broken.
 *
 * Reloading is the honest recovery here: the error already happened during
 * render, so the component's state cannot be trusted.
 */
interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-surface-muted p-6">
        <div className="w-full max-w-sm rounded-2xl border border-hairline bg-surface p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-fg">Something broke</h1>
          <p className="mt-1.5 text-sm text-fg-muted">
            This page hit an error it couldn’t recover from. Reloading usually clears it.
          </p>
          <Button className="mt-5 w-full" onClick={() => window.location.reload()}>
            Reload
          </Button>
          {import.meta.env.DEV && (
            <pre className="mt-4 max-h-40 overflow-auto rounded-lg bg-surface-sunken p-3 text-left text-xs text-fg-muted">
              {error.message}
            </pre>
          )}
        </div>
      </div>
    );
  }
}
