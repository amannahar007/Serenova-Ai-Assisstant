import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
    this.setState({ error, errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-void text-white p-10 flex flex-col items-center justify-center font-mono">
          <div className="bg-slate border border-red-500/30 p-8 rounded-xl max-w-4xl w-full shadow-lg">
            <h1 className="text-2xl font-bold text-red-400 mb-4 flex items-center gap-3">
              <span>⚠️</span> React Runtime Crash
            </h1>
            <p className="text-sm text-text-muted mb-4">The application encountered an unexpected error during rendering.</p>
            
            <div className="bg-black/50 p-4 rounded-lg overflow-x-auto mb-4 border border-glass-border">
              <h2 className="text-red-300 font-bold mb-2">Error:</h2>
              <pre className="text-red-400 text-xs whitespace-pre-wrap">{this.state.error?.toString()}</pre>
            </div>
            
            <div className="bg-black/50 p-4 rounded-lg overflow-x-auto border border-glass-border">
              <h2 className="text-neon-cyan font-bold mb-2">Component Stack:</h2>
              <pre className="text-neon-cyan/70 text-xs whitespace-pre-wrap">{this.state.errorInfo?.componentStack}</pre>
            </div>

            <button 
              onClick={() => window.location.reload()} 
              className="mt-8 px-6 py-2 bg-neon-cyan text-white rounded-lg font-bold hover:bg-[#2f4a48] transition-colors"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
