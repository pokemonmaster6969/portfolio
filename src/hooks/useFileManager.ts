import { useCallback } from 'react'

export const useFileManager = () => {
  const formatBytes = useCallback((bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }, [])

  const calculateETA = useCallback((remaining: number, speed: number): string => {
    if (speed === 0) return '--:--'
    const seconds = Math.floor(remaining / speed)

    if (seconds > 3600) {
      const h = Math.floor(seconds / 3600)
      const m = Math.floor((seconds % 3600) / 60)
      return `${h}h ${m}m`
    }
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }, [])

  const sanitizePath = useCallback((path: string): string => {
    return path.trim().replace(/\\/g, '/')
  }, [])

  const isTextFile = useCallback((fileName: string): boolean => {
    const ext = (fileName.split('.').pop() || '').toLowerCase()
    const textExtensions = ['txt', 'csv', 'tsv', 'gtf', 'bed', 'json', 'md', 'log', 'xml', 'yaml', 'yml', 'html', 'css', 'js', 'ts']
    return textExtensions.includes(ext)
  }, [])

  const isImageFile = useCallback((fileName: string): boolean => {
    const ext = (fileName.split('.').pop() || '').toLowerCase()
    const imageExtensions = ['png', 'jpg', 'jpeg', 'svg', 'gif', 'webp', 'bmp', 'ico']
    return imageExtensions.includes(ext)
  }, [])

  return {
    formatBytes,
    calculateETA,
    sanitizePath,
    isTextFile,
    isImageFile
  }
}
