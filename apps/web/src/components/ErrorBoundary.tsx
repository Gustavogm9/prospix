import { Component, ErrorInfo, ReactNode } from 'react';

interface Props { children: ReactNode; }
interface State { hasError: boolean; error: Error | null; }

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught render error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'Inter, sans-serif', background: '#F8FAFC' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
          <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#0F172A', marginBottom: '8px' }}>Algo deu errado</h1>
          <p style={{ fontSize: '14px', color: '#64748B', marginBottom: '24px', textAlign: 'center', maxWidth: '400px' }}>
            Ocorreu um erro inesperado. Tente recarregar a página.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{ padding: '10px 24px', background: '#1B3A6B', color: '#fff', border: 'none', borderRadius: '12px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}
          >
            Recarregar página
          </button>
          {this.state.error && (
            <pre style={{ marginTop: '24px', padding: '12px', background: '#F1F3F6', borderRadius: '8px', fontSize: '11px', color: '#94A3B8', maxWidth: '500px', overflow: 'auto' }}>
              {this.state.error.message}
            </pre>
          )}
        </div>
      );
    }
    return this.props.children;
  }
}
