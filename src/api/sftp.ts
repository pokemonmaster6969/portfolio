import axios, { type AxiosRequestConfig } from 'axios'

const RAW_API_ORIGIN = (import.meta.env?.VITE_API_BASE as string | undefined) || ''
const API_ORIGIN = (() => {
    if (!RAW_API_ORIGIN) return ''
    const isLocalOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(RAW_API_ORIGIN)
    if (!isLocalOrigin) return RAW_API_ORIGIN
    if (typeof window === 'undefined') return RAW_API_ORIGIN
    const host = window.location.hostname
    const isRemoteHost = host !== 'localhost' && host !== '127.0.0.1'
    return isRemoteHost ? '' : RAW_API_ORIGIN
})()

const API_BASE_URL = API_ORIGIN ? `${API_ORIGIN.replace(/\/$/, '')}/api/sftp` : '/api/sftp'

export const sftpApi = {
    apiBaseUrl: API_BASE_URL,
    getDownloadUrl: (sessionId: string, file: string) => {
        return `${API_BASE_URL}/download?sessionId=${encodeURIComponent(sessionId)}&file=${encodeURIComponent(file)}`
    },
    connect: (credentials: Record<string, unknown>) => axios.post(`${API_BASE_URL}/connect`, credentials),
    list: (sessionId: string, path: string, options: AxiosRequestConfig = {}) =>
        axios.get(`${API_BASE_URL}/list`, { params: { sessionId, path }, ...options }),
    listRecursive: (sessionId: string, path: string, options: AxiosRequestConfig = {}) =>
        axios.get(`${API_BASE_URL}/list-recursive`, { params: { sessionId, path }, ...options }),
    download: (sessionId: string, file: string, options: AxiosRequestConfig = {}) =>
        axios.get(`${API_BASE_URL}/download`, {
            params: { sessionId, file },
            responseType: 'blob',
            ...options
        }),
    delete: (sessionId: string, path: string, isDirectory: boolean) =>
        axios.post(`${API_BASE_URL}/delete`, { sessionId, path, isDirectory }),
    upload: (formData: FormData) =>
        axios.post(`${API_BASE_URL}/upload`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
        }),
    // Return file as text for small previews (server will stream same endpoint)
    preview: (sessionId: string, file: string, options: AxiosRequestConfig = {}) =>
        axios.get(`${API_BASE_URL}/download`, {
            params: { sessionId, file },
            responseType: 'text',
            ...options
        }),
    disconnect: (sessionId: string) => axios.post(`${API_BASE_URL}/disconnect`, { sessionId })
}
