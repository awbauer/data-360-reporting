import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Last line of defence: a rendering error shows what went wrong and a way out instead of a blank
 * page. Errors from requests are handled where they're made; this catches the rest.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="hint" role="alert">
        Something went wrong on this page: {this.state.error.message || 'unknown error'}.{' '}
        <button className="link" onClick={() => this.setState({ error: null })}>Try again</button>
        {' or '}
        <button className="link" onClick={() => window.location.reload()}>reload the page</button>.
      </div>
    );
  }
}
