import { useState, useEffect } from 'react'
import { LoginPage } from './components/LoginPage'
import { Dashboard } from './components/Dashboard'
import type { SessionInfo } from './types'
import { sftpApi } from './api/sftp'
import { AlertCircle, RefreshCw } from 'lucide-react'

interface AutoSessionError {
  message: string
  retryable: boolean
  code?: string
}

function App() {
  const [session, setSession] = useState<SessionInfo | null>(null)
  const [initialPath, setInitialPath] = useState<string>('/')
  const [isInitializing, setIsInitializing] = useState(false)
  const [initError, setInitError] = useState<AutoSessionError | null>(null)

  // Handle auto-session initialization from URL parameters
  useEffect(() => {
    const initializeSession = async () => {
      try {
        const params = new URLSearchParams(window.location.search)
        const sessionId = params.get('sessionId')
        const path = params.get('path') || '/'
        const server = params.get('server') || ''
        const username = params.get('username') || ''

        setInitialPath(path)

        // Skip initialization if no sessionId provided
        if (!sessionId) return

        setIsInitializing(true)
        setInitError(null)

        try {
          // Validate session by listing the provided path
          await sftpApi.list(sessionId, path)
          
          // Session is valid, update state
          setSession({
            sessionId,
            server,
            username,
            currentPath: path,
            isAdmin: false
          })
          setIsInitializing(false)
        } catch (err: unknown) {
          const e = (typeof err === 'object' && err !== null ? (err as Record<string, unknown>) : {})
          const response = (typeof e.response === 'object' && e.response !== null ? (e.response as Record<string, unknown>) : {})
          const data = (typeof response.data === 'object' && response.data !== null ? (response.data as Record<string, unknown>) : {})

          const errorCode = typeof response.status === 'number' ? response.status : undefined
          const errorMessage = (typeof data.error === 'string' ? data.error : undefined) || (typeof e.message === 'string' ? e.message : undefined) || 'Session validation failed'
          
          // Determine if error is retryable
          const isRetryable = !errorCode || errorCode >= 500 || errorCode === 408
          
          setInitError({
            message: errorMessage,
            retryable: isRetryable,
            code: errorCode?.toString()
          })
          setIsInitializing(false)
          
          // Log for debugging
          console.warn('Auto-session initialization failed:', {
            code: errorCode,
            message: errorMessage,
            retryable: isRetryable
          })
        }
      } catch (err) {
        console.error('Unexpected error during session initialization:', err)
        setInitError({
          message: 'An unexpected error occurred',
          retryable: true
        })
        setIsInitializing(false)
      }
    }

    initializeSession()
  }, [])

  const handleRetrySession = () => {
    setInitError(null)
    setIsInitializing(true)
    // Trigger re-initialization by re-running the effect
    window.location.reload()
  }

  // Show error state if auto-session init failed
  if (initError && !session) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="card p-8">
            <div className="flex items-start gap-4 mb-6">
              <div className="w-12 h-12 rounded-lg bg-red-50 flex items-center justify-center flex-shrink-0">
                <AlertCircle className="w-6 h-6 text-red-500" />
              </div>
              <div className="flex-1">
                <h2 className="text-lg font-bold text-slate-900 mb-1">Session Error</h2>
                <p className="text-sm text-slate-600">{initError.message}</p>
                {initError.code && (
                  <p className="text-xs text-slate-500 mt-2">Error code: {initError.code}</p>
                )}
              </div>
            </div>

            <div className="flex gap-3">
              {initError.retryable && (
                <button
                  onClick={handleRetrySession}
                  disabled={isInitializing}
                  className="btn-primary flex-1 py-2 text-sm"
                >
                  <RefreshCw className={`w-4 h-4 ${isInitializing ? 'animate-spin' : ''}`} />
                  <span>{isInitializing ? 'Retrying...' : 'Retry'}</span>
                </button>
              )}
              <button
                onClick={() => {
                  setInitError(null)
                  setSession(null)
                }}
                className="btn-secondary flex-1 py-2 text-sm"
              >
                New Login
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Show loading state while initializing
  if (isInitializing) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-lg bg-white border border-slate-100 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
          </div>
          <p className="text-sm font-medium text-slate-600">Initializing session...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {!session ? (
        <LoginPage initialPath={initialPath} onLogin={setSession} />
      ) : (
        <Dashboard
          session={session}
          onLogout={() => setSession(null)}
        />
      )}
    </div>
  )
}

export default App
