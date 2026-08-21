import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertOctagon, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Keeps one broken component from taking the whole app with it.
 *
 * Without a boundary, a single unexpected null anywhere in the tree unmounts
 * everything — including the navigation out of it. In a standalone-display PWA
 * there is no browser chrome to press back from, so the app becomes a white
 * rectangle until it is force-quit.
 *
 * Used at two depths: once around the router, and once around each panel, so a
 * broken Financials tab costs the reader that tab and not the site page.
 */
interface Props {
  children: ReactNode;
  /** Named for the reader — "this panel", "the site page". */
  label?: string;
  /** Panels render inline; the app root takes the whole screen. */
  variant?: 'panel' | 'page';
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
    // No telemetry service here yet; the console is what a developer has when
    // a supervisor reports "it went blank".
    console.error('Unhandled render error', error, info.componentStack);
  }

  private reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const { label = 'This', variant = 'panel' } = this.props;

    return (
      <div
        className={
          variant === 'page'
            ? 'flex min-h-screen flex-col items-center justify-center gap-3 bg-surface-muted p-6 text-center'
            : 'flex flex-col items-center gap-3 rounded-xl border border-hairline bg-surface p-8 text-center shadow-sm'
        }
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-danger-surface text-danger-fg">
          <AlertOctagon size={20} />
        </div>
        <div>
          <p className="font-semibold text-fg">{label} stopped working</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-fg-muted">
            Nothing you entered was lost and nothing on file has changed. Reloading usually clears
            it; if it keeps happening, tell the office what you were doing.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={this.reset}>
            <RefreshCw size={14} /> Try again
          </Button>
          {variant === 'page' && (
            <Button size="sm" onClick={() => window.location.reload()}>
              Reload the app
            </Button>
          )}
        </div>
      </div>
    );
  }
}
