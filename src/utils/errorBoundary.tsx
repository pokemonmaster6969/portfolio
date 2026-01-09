import React, { type ReactNode } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="w-full max-w-md">
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-8">
              <div className="flex items-start gap-4 mb-6">
                <div className="w-12 h-12 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="w-6 h-6 text-red-500" />
                </div>
                <div className="flex-1">
                  <h2 className="text-lg font-bold text-slate-900 mb-2">Something went wrong</h2>
                  <p className="text-sm text-slate-600 mb-2">We encountered an unexpected error.</p>
                  {this.state.error && (
                    <details className="text-xs text-slate-500 mt-3">
                      <summary className="cursor-pointer font-medium mb-1">Error details</summary>
                      <pre className="bg-slate-50 p-2 rounded text-[10px] overflow-auto max-h-32">
                        {this.state.error.message}
                      </pre>
                    </details>
                  )}
                </div>
              </div>

              <button
                onClick={this.handleReset}
                className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600 transition-all"
              >
                <RefreshCw className="w-4 h-4" />
                <span>Try again</span>
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
