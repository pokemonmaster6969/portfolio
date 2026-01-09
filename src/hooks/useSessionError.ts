import { useCallback } from 'react'

export interface ApiError {
  message: string
  code?: string
  statusCode?: number
  retryable: boolean
}

export const useSessionError = () => {
  const parseError = useCallback((error: unknown): ApiError => {
    const e = (typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : {})
    const response = (typeof e.response === 'object' && e.response !== null ? (e.response as Record<string, unknown>) : {})
    const data = (typeof response.data === 'object' && response.data !== null ? (response.data as Record<string, unknown>) : {})

    const statusCode = typeof response.status === 'number' ? response.status : undefined
    const messageFromData = typeof data.error === 'string' ? data.error : undefined
    const messageFromError = typeof e.message === 'string' ? e.message : undefined
    const message = messageFromData || messageFromError || 'An unexpected error occurred'
    
    // Determine if error is retryable
    const retryable = !statusCode || statusCode >= 500 || statusCode === 408 || statusCode === 429

    return {
      message,
      code: typeof e.code === 'string' ? e.code : undefined,
      statusCode,
      retryable
    }
  }, [])

  const getErrorDisplay = useCallback((error: ApiError): string => {
    if (error.statusCode === 401 || error.statusCode === 403) {
      return 'Authentication failed. Please check your credentials.'
    }
    if (error.statusCode === 404) {
      return 'Server or path not found.'
    }
    if (error.statusCode === 500) {
      return 'Server error. Please try again later.'
    }
    if (error.statusCode === 503) {
      return 'Service unavailable. Please try again later.'
    }
    if (error.statusCode === 408 || error.statusCode === 429) {
      return 'Request timeout. Please try again.'
    }
    return error.message
  }, [])

  return {
    parseError,
    getErrorDisplay
  }
}
