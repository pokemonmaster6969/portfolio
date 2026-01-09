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

const API_BASE_URL = API_ORIGIN ? `${API_ORIGIN.replace(/\/$/, '')}/api/db` : '/api/db'

export type DbTransferTask = {
    id: string
    sessionId?: string
    name: string
    url?: string
    size?: number
    progress?: number
    status?: string
    startTime?: number
    bytesDownloaded?: number
    speed?: number
    errorMessage?: string
}

export const dbApi = {
    apiBaseUrl: API_BASE_URL,
    health: (options: AxiosRequestConfig = {}) => axios.get(`${API_BASE_URL}/health`, options),
    auditRecent: (sessionId: string, limit = 100, options: AxiosRequestConfig = {}) =>
        axios.get(`${API_BASE_URL}/audit/recent`, { params: { sessionId, limit }, ...options }),
    upsertTasks: (sessionId: string, tasks: DbTransferTask[], options: AxiosRequestConfig = {}) =>
        axios.post(
            `${API_BASE_URL}/tasks/upsert`,
            { sessionId, tasks },
            { headers: { 'Content-Type': 'application/json' }, ...options }
        ),
    insertSnapshot: (
        sessionId: string,
        snapshotType: string,
        path: string | null,
        payload: unknown,
        options: AxiosRequestConfig = {}
    ) =>
        axios.post(
            `${API_BASE_URL}/snapshots`,
            { sessionId, snapshotType, path, payload },
            { headers: { 'Content-Type': 'application/json' }, ...options }
        ),
}
