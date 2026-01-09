import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
    Folder,
    File,
    Search,
    Download,
    RefreshCw,
    Upload,
    Home,
    ChevronRight,
    LogOut,
    HardDrive,
    Activity,
    ArrowLeft,
    X,
    Menu,
    Shield,
    Eye,
    ClipboardList,
} from 'lucide-react'
import { sftpApi } from '../api/sftp'
import type { SFTPFile, SessionInfo } from '../types'
import { motion, AnimatePresence } from 'framer-motion'
import { TransferManager, type TransferTask } from './TransferManager'
import JSZip from 'jszip'
import { DownloadsPage } from './DownloadsPage.tsx'
import { dbApi } from '../api/db'
import OverviewPage from './OverviewPage'
import unigenomeLogo from '../assets/unigenome.png'
import toast from 'react-hot-toast'
import { useDebouncedValue } from '../hooks'

interface DashboardStats {
    folders: number
    files: number
    size: number
}

interface SubfolderSummary {
    name: string
    path: string
    files: number
    size: number
    topTypes: Array<{ ext: string; count: number }>
}

type FolderCategory = 'Raw Data' | 'Reference/Annotation' | 'Assembly/Mapping' | 'Plots/Correlation' | 'Differential Expression' | 'Enrichment/GO' | 'Pathways' | 'Other'

interface CategorySummary {
    category: FolderCategory
    folders: number
    files: number
    size: number
}

interface FileCardProps {
    file: SFTPFile
    onClick: () => void
    onDownload: () => void
    formatBytes: (bytes: number) => string
    selected: boolean
    onSelect: () => void
}

interface DashboardProps {
    session: SessionInfo
    onLogout: () => void
}

export const Dashboard: React.FC<DashboardProps> = ({ session, onLogout }) => {
    const [view, setView] = useState<'overview' | 'dashboard' | 'files' | 'downloads' | 'audit'>('overview')
    const [lastMainView, setLastMainView] = useState<'overview' | 'dashboard' | 'files'>('overview')
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const [files, setFiles] = useState<SFTPFile[]>([])
    const [loading, setLoading] = useState(true)
    const [currentPath, setCurrentPath] = useState(session.currentPath)
    const [search, setSearch] = useState('')
    const debouncedSearch = useDebouncedValue(search, 200)
    const [stats, setStats] = useState<DashboardStats>({ folders: 0, files: 0, size: 0 })
    const [deepFiles, setDeepFiles] = useState<SFTPFile[]>([])
    const [deepLoading, setDeepLoading] = useState(false)
    const [deepError, setDeepError] = useState<string | null>(null)
    const [deepLastRefreshedAt, setDeepLastRefreshedAt] = useState<number | null>(null)
    const [deepFolderCount, setDeepFolderCount] = useState(0)
    const [deepFolderSummaries, setDeepFolderSummaries] = useState<SubfolderSummary[]>([])
    const [selectedSubfolder, setSelectedSubfolder] = useState<SubfolderSummary | null>(null)
    const [folderBatchRunning, setFolderBatchRunning] = useState(false)
    const [folderBatchIndex, setFolderBatchIndex] = useState(0)
    const [folderBatchTotal, setFolderBatchTotal] = useState(0)
    const [folderBatchCurrentName, setFolderBatchCurrentName] = useState<string | null>(null)
    const [tasks, setTasks] = useState<TransferTask[]>(() => {
        try {
            const savedTasks = localStorage.getItem('sftp-download-tasks');
            if (savedTasks) {
                const tasks = JSON.parse(savedTasks) as TransferTask[];
                return tasks.map(task => (
                    task.status === 'downloading' ? { ...task, status: 'ready' } : task
                ));
            }
            return [];
        } catch {
            return [];
        }
    });

    useEffect(() => {
        localStorage.setItem('sftp-download-tasks', JSON.stringify(tasks));
    }, [tasks]);

    const dbSyncTimerRef = useRef<number | null>(null)
    const dbSnapshotTimerRef = useRef<number | null>(null)
    const dbDisabledRef = useRef(false)
    const auditTimerRef = useRef<number | null>(null)
    const auditAbortRef = useRef<AbortController | null>(null)
    const auditInFlightRef = useRef(false)

    const [auditLoading, setAuditLoading] = useState(false)
    const [auditError, setAuditError] = useState<string | null>(null)
    const [auditData, setAuditData] = useState<{ connections: any[]; downloads: any[]; logs: any[] } | null>(null)

    const [auditType, setAuditType] = useState<'all' | 'connections' | 'downloads' | 'logs'>('all')
    const [auditUser, setAuditUser] = useState('')
    const [auditServer, setAuditServer] = useState('')
    const [auditQuery, setAuditQuery] = useState('')
    const [auditFrom, setAuditFrom] = useState('')
    const [auditTo, setAuditTo] = useState('')
    const [auditSelected, setAuditSelected] = useState<{ type: string; id: string; createdAt?: string; payload: any } | null>(null)

    const checkDbOnce = useCallback(async () => {
        if (dbDisabledRef.current) return false
        try {
            await dbApi.health()
            return true
        } catch {
            dbDisabledRef.current = true
            return false
        }
    }, [])

    useEffect(() => {
        if (!session.isAdmin) return
        if (view !== 'audit') return

        let cancelled = false

        const load = async () => {
            if (auditInFlightRef.current) return
            auditInFlightRef.current = true

            auditAbortRef.current?.abort()
            const controller = new AbortController()
            auditAbortRef.current = controller

            setAuditLoading(true)
            setAuditError(null)

            try {
                const res = await dbApi.auditRecent(session.sessionId, 100, { signal: controller.signal })
                if (cancelled) return
                const data = (res && res.data && typeof res.data === 'object' ? (res.data as Record<string, any>) : {})
                setAuditData({
                    connections: Array.isArray(data.connections) ? data.connections : [],
                    downloads: Array.isArray(data.downloads) ? data.downloads : [],
                    logs: Array.isArray(data.logs) ? data.logs : [],
                })
            } catch (err) {
                if (cancelled) return
                const e = (typeof err === 'object' && err !== null ? (err as Record<string, any>) : {})
                const name = typeof e.name === 'string' ? e.name : ''
                if (name === 'CanceledError' || name === 'AbortError') return
                const msg = (typeof e.message === 'string' ? e.message : null) || 'Failed to load audit logs'
                setAuditError(msg)
            } finally {
                auditInFlightRef.current = false
                if (cancelled) return
                setAuditLoading(false)
            }
        }

        void load()
        if (auditTimerRef.current) window.clearInterval(auditTimerRef.current)
        auditTimerRef.current = window.setInterval(() => {
            void load()
        }, 20000)

        if (!auditFrom && !auditTo) {
            const to = new Date()
            const from = new Date()
            from.setDate(from.getDate() - 7)
            const fmt = (d: Date) => d.toISOString().slice(0, 10)
            setAuditFrom(fmt(from))
            setAuditTo(fmt(to))
        }

        return () => {
            cancelled = true
            if (auditTimerRef.current) window.clearInterval(auditTimerRef.current)
            auditTimerRef.current = null
            auditAbortRef.current?.abort()
            auditAbortRef.current = null
            auditInFlightRef.current = false
        }
    }, [view, session.isAdmin, session.sessionId, auditFrom, auditTo])

    useEffect(() => {
        // Debounced task persistence (client-side tasks telemetry)
        if (dbSyncTimerRef.current) window.clearTimeout(dbSyncTimerRef.current)
        dbSyncTimerRef.current = window.setTimeout(async () => {
            const ok = await checkDbOnce()
            if (!ok) return
            try {
                await dbApi.upsertTasks(session.sessionId, tasks as unknown as any[])
            } catch {
                // do not surface DB errors to UI
            }
        }, 600)
        return () => {
            if (dbSyncTimerRef.current) window.clearTimeout(dbSyncTimerRef.current)
        }
    }, [tasks, session.sessionId, checkDbOnce])

    useEffect(() => {
        return () => {
            if (dbSnapshotTimerRef.current) window.clearTimeout(dbSnapshotTimerRef.current)
        }
    }, [])
    const [isTransferManagerOpen, setIsTransferManagerOpen] = useState(false)
    const [selectedPaths, setSelectedPaths] = useState<string[]>([])
    const [previewFile, setPreviewFile] = useState<SFTPFile | null>(null)
    const [previewContent, setPreviewContent] = useState<string | null>(null)
    const [previewUrl, setPreviewUrl] = useState<string | null>(null)
    const [previewLoading, setPreviewLoading] = useState(false)
    const [uiError, setUiError] = useState<string | null>(null)

    const listAbortRef = useRef<AbortController | null>(null)
    const previewAbortRef = useRef<AbortController | null>(null)
    const listRequestIdRef = useRef(0)
    const previewRequestIdRef = useRef(0)
    const deepAbortRef = useRef<AbortController | null>(null)
    const deepRequestIdRef = useRef(0)
    const deepCacheRef = useRef<
        Map<string, { files: SFTPFile[]; folderCount: number; folderSummaries: SubfolderSummary[]; at: number }>
    >(new Map())

    const folderBatchAbortRef = useRef<AbortController | null>(null)

    const listCacheRef = useRef<Map<string, { files: SFTPFile[]; at: number }>>(new Map())
    const currentPathRef = useRef(currentPath)

    useEffect(() => {
        currentPathRef.current = currentPath
    }, [currentPath])

    const clearPreview = useCallback(() => {
        previewAbortRef.current?.abort()
        setPreviewFile(null)
        setPreviewContent(null)
        if (previewUrl) {
            URL.revokeObjectURL(previewUrl)
            setPreviewUrl(null)
        }
    }, [previewUrl])

    const fetchFiles = useCallback(async (path: string, options?: { force?: boolean }) => {
        const cacheKey = `${session.sessionId}:${path}`
        const TTL_MS = 15_000

        if (!options?.force) {
            const cached = listCacheRef.current.get(cacheKey)
            if (cached && Date.now() - cached.at < TTL_MS) {
                const sortedFiles = [...cached.files].sort((a: SFTPFile, b: SFTPFile) => {
                    if (a.isDirectory && !b.isDirectory) return -1
                    if (!a.isDirectory && b.isDirectory) return 1
                    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
                })

                setFiles(sortedFiles)
                setCurrentPath(path)

                const folders = sortedFiles.filter((f: SFTPFile) => f.isDirectory).length
                const fileCount = sortedFiles.length - folders
                const totalSize = sortedFiles.reduce((acc: number, f: SFTPFile) => acc + (f.size || 0), 0)
                setStats({ folders, files: fileCount, size: totalSize })
                setUiError(null)
                setLoading(false)
                return
            }
        }

        const requestId = ++listRequestIdRef.current
        listAbortRef.current?.abort()
        const controller = new AbortController()
        listAbortRef.current = controller

        setLoading(true)
        try {
            const response = await sftpApi.list(session.sessionId, path, { signal: controller.signal })
            const respFiles = (response.data?.files as SFTPFile[] | undefined) || []
            const sortedFiles = [...respFiles].sort((a: SFTPFile, b: SFTPFile) => {
                if (a.isDirectory && !b.isDirectory) return -1
                if (!a.isDirectory && b.isDirectory) return 1
                return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
            })

            listCacheRef.current.set(cacheKey, { files: sortedFiles, at: Date.now() })

            setFiles(sortedFiles)
            setCurrentPath(path)

            const folders = sortedFiles.filter((f: SFTPFile) => f.isDirectory).length
            const fileCount = sortedFiles.length - folders
            const totalSize = sortedFiles.reduce((acc: number, f: SFTPFile) => acc + (f.size || 0), 0)
            setStats({ folders, files: fileCount, size: totalSize })
        } catch (err) {
            const e = err as Error
            if (e?.name === 'CanceledError' || e?.name === 'AbortError') return
            console.error('Failed to fetch files', err)
            setUiError('Failed to fetch files. Please try again.')
        } finally {
            const isLatest = requestId === listRequestIdRef.current
            if (isLatest) {
                setLoading(false)

                // Only clear selection/preview when navigating to a different directory.
                // Refreshing the same directory should not wipe user context.
                if (path !== currentPathRef.current) {
                    setSelectedPaths([])
                    clearPreview()
                }
            }
        }
    }, [session.sessionId, clearPreview])

    const fetchDeepFiles = useCallback(async (path: string, force?: boolean) => {
        const cacheKey = `${session.sessionId}:${path}`
        if (!force) {
            const cached = deepCacheRef.current.get(cacheKey)
            if (cached) {
                setDeepFiles(cached.files)
                setDeepFolderCount(cached.folderCount)
                setDeepFolderSummaries(cached.folderSummaries)
                setDeepLastRefreshedAt(cached.at)
                setDeepError(null)
                return
            }
        }

        const requestId = ++deepRequestIdRef.current
        deepAbortRef.current?.abort()
        const controller = new AbortController()
        deepAbortRef.current = controller

        setDeepLoading(true)
        setDeepError(null)
        try {
            const response = await sftpApi.list(session.sessionId, path, { signal: controller.signal })
            const topLevel = (response.data?.files as SFTPFile[] | undefined) || []
            const folders = topLevel.filter(f => f.isDirectory)
            const topFiles = topLevel.filter(f => !f.isDirectory)

            const concurrency = 6
            const queue = [...folders]
            const collectedFiles: SFTPFile[] = [...topFiles]
            const summaries: SubfolderSummary[] = []

            const workers = new Array(Math.min(concurrency, queue.length)).fill(0).map(async () => {
                while (queue.length > 0) {
                    if (controller.signal.aborted) return
                    const folder = queue.shift()
                    if (!folder) return
                    try {
                        const resp = await sftpApi.list(session.sessionId, folder.path, { signal: controller.signal })
                        const entries = (resp.data?.files as SFTPFile[] | undefined) || []
                        const filesOnly = entries.filter(e => !e.isDirectory)
                        for (const f of filesOnly) collectedFiles.push(f)

                        const typeMap = new Map<string, number>()
                        for (const f of filesOnly) {
                            const extRaw = (f.name.split('.').pop() || '').toLowerCase()
                            const ext = extRaw && extRaw !== f.name.toLowerCase() ? extRaw : '(none)'
                            typeMap.set(ext, (typeMap.get(ext) || 0) + 1)
                        }
                        const topTypes = [...typeMap.entries()]
                            .map(([ext, count]) => ({ ext, count }))
                            .sort((a, b) => b.count - a.count)
                            .slice(0, 3)

                        summaries.push({
                            name: folder.name,
                            path: folder.path,
                            files: filesOnly.length,
                            size: filesOnly.reduce((acc, f) => acc + (f.size || 0), 0),
                            topTypes,
                        })
                    } catch {
                        summaries.push({
                            name: folder.name,
                            path: folder.path,
                            files: 0,
                            size: 0,
                            topTypes: [],
                        })
                    }
                }
            })

            await Promise.all(workers)
            summaries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))

            const next = collectedFiles
            const at = Date.now()
            deepCacheRef.current.set(cacheKey, { files: next, folderCount: folders.length, folderSummaries: summaries, at })

            setDeepFiles(next)
            setDeepFolderCount(folders.length)
            setDeepFolderSummaries(summaries)
            setDeepLastRefreshedAt(at)

            // Persist a lightweight snapshot for analytics (best-effort)
            if (dbSnapshotTimerRef.current) window.clearTimeout(dbSnapshotTimerRef.current)
            dbSnapshotTimerRef.current = window.setTimeout(async () => {
                const ok = await checkDbOnce()
                if (!ok) return
                try {
                    await dbApi.insertSnapshot(session.sessionId, 'deep_scan', cacheKey, {
                        at,
                        folderCount: folders.length,
                        fileCount: next.length,
                        totalSize: next.reduce((acc, f) => acc + (f.size || 0), 0),
                        folderSummaries: summaries,
                    })
                } catch {
                    // ignore
                }
            }, 800)
        } catch (err) {
            const e = err as Error
            if (e?.name === 'CanceledError' || e?.name === 'AbortError') return
            console.error('Failed to fetch recursive files', err)
            setDeepError(e?.message || 'Failed to scan subfolders')
        } finally {
            const isLatest = requestId === deepRequestIdRef.current
            if (isLatest) {
                setDeepLoading(false)
            }
        }
    }, [session.sessionId, checkDbOnce])

    const openPreview = useCallback(async (file: SFTPFile) => {
        const requestId = ++previewRequestIdRef.current
        previewAbortRef.current?.abort()
        const controller = new AbortController()
        previewAbortRef.current = controller

        setPreviewFile(file)
        setPreviewContent(null)
        if (previewUrl) { URL.revokeObjectURL(previewUrl); setPreviewUrl(null) }
        setPreviewLoading(true)

        const ext = (file.name.split('.').pop() || '').toLowerCase()
        const textExt = ['txt','csv','tsv','gtf','bed','json','md','log']
        const imgExt = ['png','jpg','jpeg','svg','gif','webp']

        try {
            // Guard: don't attempt to preview very large files in-browser
            const MAX_PREVIEW = 2 * 1024 * 1024 // 2 MB
            if (file.size && file.size > MAX_PREVIEW) {
                setPreviewContent('File too large to preview in the browser (over 2 MB). Please download to view it locally.')
                setPreviewLoading(false)
                return
            }
            if (textExt.includes(ext)) {
                const resp = await sftpApi.preview(session.sessionId, file.path, { signal: controller.signal })
                setPreviewContent(resp.data || '')
            } else if (imgExt.includes(ext)) {
                const resp = await sftpApi.download(session.sessionId, file.path, { responseType: 'blob', signal: controller.signal })
                const url = window.URL.createObjectURL(new Blob([resp.data]))
                setPreviewUrl(url)
            } else {
                setPreviewContent('Preview not available for this file type.')
            }
        } catch (err) {
            const e = err as Error
            if (e?.name === 'CanceledError' || e?.name === 'AbortError') return
            console.error('Preview failed', err)
            setPreviewContent('Failed to load preview.')
            setUiError('Preview failed. Please try again.')
        } finally {
            const isLatest = requestId === previewRequestIdRef.current
            if (isLatest) {
                setPreviewLoading(false)
            }
        }
    }, [session.sessionId, previewUrl])

    useEffect(() => {
        fetchFiles(currentPath)
    }, [currentPath, fetchFiles])

    useEffect(() => {
        if (view !== 'dashboard') return
        fetchDeepFiles(currentPath)
    }, [view, currentPath, fetchDeepFiles])

    useEffect(() => {
        if (view === 'files') return
        setSelectedPaths([])
        clearPreview()
    }, [view, clearPreview])

    useEffect(() => {
        if (!previewFile) return
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') clearPreview()
        }
        window.addEventListener('keydown', onKeyDown)
        return () => window.removeEventListener('keydown', onKeyDown)
    }, [previewFile, clearPreview])


    const handleCancelTransfer = useCallback((id: string) => {
        setTasks(prev => {
            const t = prev.find(x => x.id === id)
            if (t) toast.success(`Removed: ${t.name}`)
            return prev.filter(x => x.id !== id)
        })
    }, []);

    const clearCompletedDownloads = useCallback(() => {
        setTasks(prev => prev.filter(t => t.status !== 'completed'))
        toast.success('Cleared completed downloads')
    }, [])

    const onTaskUpdate = useCallback((id: string, updates: Partial<TransferTask>) => {
        setTasks(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    }, []);

    const formatBytes = useCallback((bytes: number): string => {
        if (bytes === 0) return '0 B'
        const k = 1024
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
    }, [])

    const toggleSelectPath = useCallback((path: string) => {
        setSelectedPaths(prev => prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path])
    }, [])

    const selectAll = useCallback(() => {
        const all = files.filter(f => !f.isDirectory).map(f => f.path)
        setSelectedPaths(all)
    }, [files])

    const selectVisible = useCallback(() => {
        // Compute visible files from current `files` and `search` instead of
        // relying on `filteredFiles` which is declared later (avoids TDZ error).
        const vis = files
            .filter(f => f.name.toLowerCase().includes(debouncedSearch.toLowerCase()))
            .filter(f => !f.isDirectory)
            .map(f => f.path)
        setSelectedPaths(vis)
    }, [files, debouncedSearch])

    const clearSelection = useCallback(() => setSelectedPaths([]), [])

    const handleZipAndDownload = useCallback(async (
        directoryPath: string,
        directoryName: string,
        filesToZip: SFTPFile[],
        options?: { signal?: AbortSignal; concurrency?: number }
    ) => {
        const zip = new JSZip();
        const taskId = Math.random().toString(36).substr(2, 9);

        const toastId = toast.loading(`Preparing ${directoryName}.zip…`)

        const zipTask: TransferTask = {
            id: taskId,
            name: `${directoryName}.zip`,
            size: filesToZip.reduce((acc, f) => acc + f.size, 0),
            url: '', // No direct URL for zip
            progress: 0,
            status: 'downloading',
            startTime: Date.now(),
            bytesDownloaded: 0,
            speed: 0,
        };

        setTasks(prev => [zipTask, ...prev]);

        let downloadedBytes = 0;
        const basePrefix = directoryPath.endsWith('/') ? directoryPath : `${directoryPath}/`

        const concurrency = Math.max(1, Math.min(10, options?.concurrency ?? 4))
        const queue = [...filesToZip]
        const signal = options?.signal

        const workers = new Array(Math.min(concurrency, queue.length)).fill(0).map(async () => {
            while (queue.length > 0) {
                if (signal?.aborted) return
                const file = queue.shift()
                if (!file) return
                try {
                    const response = await sftpApi.download(session.sessionId, file.path, { signal })
                    const relative = file.path.startsWith(basePrefix) ? file.path.substring(basePrefix.length) : file.name
                    zip.file(relative, response.data)
                    downloadedBytes += file.size
                    const progress = zipTask.size > 0 ? (downloadedBytes / zipTask.size) * 100 : 0
                    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, progress, bytesDownloaded: downloadedBytes } : t))
                } catch (error) {
                    const e = error as Error
                    if (e?.name === 'CanceledError' || e?.name === 'AbortError') return
                    console.error(`Failed to download ${file.name}`, error)
                }
            }
        })

        await Promise.all(workers)
        if (signal?.aborted) {
            setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'canceled' } : t))
            toast.dismiss(toastId)
            toast('Zip canceled', { id: toastId })
            return
        }
        const content = await zip.generateAsync({ type: 'blob' })
        const url = window.URL.createObjectURL(content);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `${directoryName}.zip`);
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'completed', progress: 100 } : t));
        toast.dismiss(toastId)
        toast.success(`${directoryName}.zip ready`)
    }, [session.sessionId]);

    const handleQueueDownloads = useCallback(async (pathsToQueue?: string[]) => {
        const paths = pathsToQueue && pathsToQueue.length > 0 ? pathsToQueue : selectedPaths;
        if (paths.length === 0) return;

        const byPath = new Map<string, SFTPFile>()
        for (const f of files) byPath.set(f.path, f)
        for (const f of deepFiles) if (!byPath.has(f.path)) byPath.set(f.path, f)

        const filesToProcess = paths.map(p => byPath.get(p)).filter(Boolean) as SFTPFile[]
        const individualFilesToQueue: SFTPFile[] = [];

        for (const file of filesToProcess) {
            if (file.isDirectory) {
                try {
                    const response = await sftpApi.listRecursive(session.sessionId, file.path);
                    await handleZipAndDownload(file.path, file.name, response.data.files);
                } catch {
                    toast.error(`Failed to prepare zip: ${file.name}`)
                }
            } else {
                individualFilesToQueue.push(file);
            }
        }

        if (individualFilesToQueue.length > 0) {
            const newTasks: TransferTask[] = individualFilesToQueue.map(file => ({
                id: Math.random().toString(36).substr(2, 9),
                name: file.name,
                size: file.size,
                url: sftpApi.getDownloadUrl(session.sessionId, file.path),
                progress: 0,
                status: 'ready',
                startTime: Date.now(),
                bytesDownloaded: 0,
                speed: 0,
            }));
            setTasks(prev => [...newTasks, ...prev]);
            toast.success(`${newTasks.length} download${newTasks.length === 1 ? '' : 's'} queued`)
        }

        if (filesToProcess.length > 0) {
            setLastMainView('files');
            setView('downloads');
            setSelectedPaths([]);
        }
    }, [selectedPaths, files, deepFiles, session.sessionId, handleZipAndDownload]);

    const filteredFiles = files.filter(f => f.name.toLowerCase().includes(debouncedSearch.toLowerCase()))
    const breadcrumbs = currentPath.split('/').filter(p => p)
    const atRoot = breadcrumbs.length === 0
    const parentPath = atRoot ? '/' : '/' + breadcrumbs.slice(0, -1).join('/')

    const auditEvents = useMemo(() => {
        const rows: Array<{ type: 'connections' | 'downloads' | 'logs'; id: string; createdAt?: string; payload: any }> = []

        for (const c of auditData?.connections || []) {
            rows.push({ type: 'connections', id: String(c.id ?? ''), createdAt: c.created_at, payload: c })
        }
        for (const d of auditData?.downloads || []) {
            rows.push({ type: 'downloads', id: String(d.id ?? ''), createdAt: d.created_at, payload: d })
        }
        for (const l of auditData?.logs || []) {
            rows.push({ type: 'logs', id: String(l.id ?? ''), createdAt: l.created_at, payload: l })
        }

        const toMs = (iso?: string) => {
            if (!iso) return 0
            const t = Date.parse(iso)
            return Number.isFinite(t) ? t : 0
        }

        return rows.sort((a, b) => toMs(b.createdAt) - toMs(a.createdAt))
    }, [auditData])

    const filteredAuditEvents = useMemo(() => {
        const userNeedle = auditUser.trim().toLowerCase()
        const serverNeedle = auditServer.trim().toLowerCase()
        const qNeedle = auditQuery.trim().toLowerCase()
        const fromMs = auditFrom ? Date.parse(`${auditFrom}T00:00:00`) : null
        const toMs = auditTo ? Date.parse(`${auditTo}T23:59:59`) : null

        const includesNeedle = (raw: unknown, needle: string) => {
            if (!needle) return true
            if (raw == null) return false
            return String(raw).toLowerCase().includes(needle)
        }

        const withinRange = (iso?: string) => {
            if (!fromMs && !toMs) return true
            const t = iso ? Date.parse(iso) : NaN
            if (!Number.isFinite(t)) return false
            if (fromMs != null && t < fromMs) return false
            if (toMs != null && t > toMs) return false
            return true
        }

        return auditEvents.filter(e => {
            if (auditType !== 'all' && e.type !== auditType) return false
            if (!withinRange(e.createdAt)) return false

            const p = e.payload || {}
            const userRaw = (p.username ?? p.user ?? p.user_name) as unknown
            const serverRaw = (p.server ?? p.host) as unknown

            if (!includesNeedle(userRaw, userNeedle)) return false
            if (!includesNeedle(serverRaw, serverNeedle)) return false

            if (qNeedle) {
                const hay = JSON.stringify(p).toLowerCase()
                if (!hay.includes(qNeedle)) return false
            }

            return true
        })
    }, [auditEvents, auditType, auditFrom, auditTo, auditUser, auditServer, auditQuery])

    const exportAuditCsv = useCallback(() => {
        const esc = (v: unknown) => {
            const s = v == null ? '' : String(v)
            return `"${s.replace(/"/g, '""')}"`
        }

        const rows = filteredAuditEvents.map(e => {
            const p = e.payload || {}
            const username = p.username ?? p.user ?? p.user_name ?? ''
            const server = p.server ?? p.host ?? ''
            const action = e.type === 'connections'
                ? (p.success ? 'connect_ok' : 'connect_fail')
                : e.type === 'downloads'
                    ? 'download'
                    : (p.level ?? 'log')
            const message = e.type === 'downloads'
                ? (p.remote_path ?? '')
                : (p.message ?? p.error_message ?? '')

            return [
                e.createdAt ?? '',
                e.type,
                username,
                server,
                action,
                message,
            ]
        })

        const header = ['created_at', 'type', 'username', 'server', 'action', 'message']
        const csv = [header.map(esc).join(','), ...rows.map(r => r.map(esc).join(','))].join('\n')
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        const fromPart = auditFrom || 'all'
        const toPart = auditTo || 'all'
        a.href = url
        a.download = `audit_${fromPart}_${toPart}.csv`
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
        toast.success('Exported audit CSV')
    }, [filteredAuditEvents, auditFrom, auditTo])

    const deepStats = useMemo(() => {
        const totalSize = deepFiles.reduce((acc: number, f: SFTPFile) => acc + (f.size || 0), 0)
        return { folders: deepFolderCount, files: deepFiles.length, size: totalSize }
    }, [deepFiles, deepFolderCount])

    const nonDirFiles = useMemo(() => deepFiles.filter(f => !f.isDirectory), [deepFiles])
    const largestFiles = useMemo(() => {
        return [...nonDirFiles]
            .sort((a, b) => (b.size || 0) - (a.size || 0))
            .slice(0, 8)
    }, [nonDirFiles])

    const fileTypeStats = useMemo(() => {
        const map = new Map<string, { count: number; size: number }>()
        for (const f of nonDirFiles) {
            const extRaw = (f.name.split('.').pop() || '').toLowerCase()
            const ext = extRaw && extRaw !== f.name.toLowerCase() ? extRaw : '(none)'
            const prev = map.get(ext) || { count: 0, size: 0 }
            map.set(ext, { count: prev.count + 1, size: prev.size + (f.size || 0) })
        }
        const byCount = [...map.entries()]
            .map(([ext, v]) => ({ ext, ...v }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 8)
        const bySize = [...map.entries()]
            .map(([ext, v]) => ({ ext, ...v }))
            .sort((a, b) => b.size - a.size)
            .slice(0, 8)
        return { byCount, bySize }
    }, [nonDirFiles])

    const fileTypeSegments = useMemo(() => {
        const top = fileTypeStats.byCount.slice(0, 5)
        const topSum = top.reduce((acc, x) => acc + x.count, 0)
        const other = nonDirFiles.length - topSum
        const colors = ['#3b82f6', '#22c55e', '#a855f7', '#f97316', '#06b6d4', '#94a3b8']
        const segments = top.map((x, idx) => ({ label: x.ext, value: x.count, color: colors[idx] }))
        if (other > 0) segments.push({ label: 'other', value: other, color: colors[5] })
        return segments
    }, [fileTypeStats.byCount, nonDirFiles.length])

    const deriveCategory = useCallback((folderName: string): FolderCategory => {
        const n = folderName.toLowerCase()
        if (/(raw[_\s-]?data|fastq|reads)/.test(n)) return 'Raw Data'
        if (/(reference|genome|annotation|gtf|gff)/.test(n)) return 'Reference/Annotation'
        if (/(transcript[_\s-]?assembly|assembly|mapping|alignment|bam|sam)/.test(n)) return 'Assembly/Mapping'
        if (/(correlation|pearson|plot|plots|pca|heatmap|qc)/.test(n)) return 'Plots/Correlation'
        if (/(differential|dge|de[_\s-]?genes|expression)/.test(n)) return 'Differential Expression'
        if (/(enrichment|go)/.test(n)) return 'Enrichment/GO'
        if (/(pathway|pathways|kegg|reactome)/.test(n)) return 'Pathways'
        return 'Other'
    }, [])

    const categorySummaries = useMemo((): CategorySummary[] => {
        const map = new Map<FolderCategory, CategorySummary>()
        for (const s of deepFolderSummaries) {
            const cat = deriveCategory(s.name)
            const prev = map.get(cat) || { category: cat, folders: 0, files: 0, size: 0 }
            map.set(cat, { category: cat, folders: prev.folders + 1, files: prev.files + s.files, size: prev.size + s.size })
        }
        return [...map.values()].sort((a, b) => b.size - a.size)
    }, [deepFolderSummaries, deriveCategory])

    const categorySegments = useMemo(() => {
        const top = categorySummaries.slice(0, 6)
        const other = categorySummaries.slice(6).reduce((acc, x) => acc + x.size, 0)
        const colors = ['#3b82f6', '#22c55e', '#a855f7', '#f97316', '#06b6d4', '#ef4444', '#94a3b8']
        const segments = top.map((x, idx) => ({ label: x.category, value: x.size, color: colors[idx] }))
        if (other > 0) segments.push({ label: 'Other', value: other, color: colors[6] })
        return segments
    }, [categorySummaries])

    const topCategory = useMemo(() => {
        return categorySummaries.length > 0 ? categorySummaries[0] : null
    }, [categorySummaries])

    const drilldown = useMemo(() => {
        if (!selectedSubfolder) return null
        const prefix = selectedSubfolder.path.endsWith('/') ? selectedSubfolder.path : `${selectedSubfolder.path}/`
        const inFolder = deepFiles.filter(f => f.path.startsWith(prefix) && !f.isDirectory)

        const typeMap = new Map<string, { count: number; size: number }>()
        for (const f of inFolder) {
            const extRaw = (f.name.split('.').pop() || '').toLowerCase()
            const ext = extRaw && extRaw !== f.name.toLowerCase() ? extRaw : '(none)'
            const prev = typeMap.get(ext) || { count: 0, size: 0 }
            typeMap.set(ext, { count: prev.count + 1, size: prev.size + (f.size || 0) })
        }
        const byCount = [...typeMap.entries()]
            .map(([ext, v]) => ({ ext, ...v }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 8)

        const segTop = byCount.slice(0, 5)
        const segSum = segTop.reduce((acc, x) => acc + x.count, 0)
        const segOther = inFolder.length - segSum
        const colors = ['#3b82f6', '#22c55e', '#a855f7', '#f97316', '#06b6d4', '#94a3b8']
        const segments = segTop.map((x, idx) => ({ label: x.ext, value: x.count, color: colors[idx] }))
        if (segOther > 0) segments.push({ label: 'other', value: segOther, color: colors[5] })

        const largest = [...inFolder].sort((a, b) => (b.size || 0) - (a.size || 0)).slice(0, 10)
        const totalSize = inFolder.reduce((acc, f) => acc + (f.size || 0), 0)

        return { files: inFolder, totalSize, byCount, segments, largest }
    }, [selectedSubfolder, deepFiles])

    const rollingAvgSpeed = useMemo(() => {
        const active = tasks.filter(t => t.status === 'downloading' && (t.speed || 0) > 0)
        if (active.length === 0) return 0
        const sum = active.reduce((acc, t) => acc + (t.speed || 0), 0)
        return sum / active.length
    }, [tasks])

    const errorGroups = useMemo(() => {
        const map = new Map<string, { message: string; count: number }>()
        for (const t of tasks) {
            if (t.status !== 'error') continue
            const msg = (t.errorMessage && t.errorMessage.trim()) ? t.errorMessage.trim() : 'Download failed'
            map.set(msg, { message: msg, count: (map.get(msg)?.count || 0) + 1 })
        }
        return [...map.values()].sort((a, b) => b.count - a.count)
    }, [tasks])

    const retryFailedDownloads = useCallback(() => {
        setTasks(prev => prev.map(t => t.status === 'error' ? { ...t, status: 'ready', progress: 0, bytesDownloaded: 0, speed: 0, startTime: Date.now(), errorMessage: undefined } : t))
    }, [])

    const cancelAllDownloads = useCallback(() => {
        setTasks(prev => {
            if (prev.length > 0) toast.success('Cleared downloads')
            return []
        })
    }, [])

    const cancelFolderBatch = useCallback(() => {
        folderBatchAbortRef.current?.abort()
        folderBatchAbortRef.current = null
        setFolderBatchRunning(false)
        setFolderBatchCurrentName(null)
    }, [])

    const getZipConcurrency = useCallback(() => {
        const conn = (navigator as unknown as { connection?: { downlink?: number; effectiveType?: string } }).connection
        const downlink = conn?.downlink
        const type = conn?.effectiveType
        if (typeof downlink === 'number') {
            if (downlink < 3) return 2
            if (downlink < 8) return 4
            return 6
        }
        if (type && /2g/.test(type)) return 2
        if (type && /3g/.test(type)) return 3
        return 4
    }, [])

    const downloadFoldersOneByOne = useCallback(async () => {
        if (folderBatchRunning) return
        if (deepFolderSummaries.length === 0) return

        const controller = new AbortController()
        folderBatchAbortRef.current?.abort()
        folderBatchAbortRef.current = controller

        setFolderBatchRunning(true)
        setFolderBatchTotal(deepFolderSummaries.length)
        setFolderBatchIndex(0)

        setLastMainView('dashboard')
        setView('downloads')

        const concurrency = getZipConcurrency()
        let idx = 0
        for (const folder of deepFolderSummaries) {
            if (controller.signal.aborted) break
            idx += 1
            setFolderBatchIndex(idx)
            setFolderBatchCurrentName(folder.name)
            try {
                const response = await sftpApi.listRecursive(session.sessionId, folder.path)
                const filesToZip = (response.data?.files as SFTPFile[] | undefined) || []
                await handleZipAndDownload(folder.path, folder.name, filesToZip, { signal: controller.signal, concurrency })
            } catch (err) {
                console.error('Failed to create zip for folder', folder.path, err)
            }
        }

        folderBatchAbortRef.current = null
        setFolderBatchRunning(false)
        setFolderBatchCurrentName(null)
    }, [deepFolderSummaries, folderBatchRunning, getZipConcurrency, session.sessionId, handleZipAndDownload]);

    const taskSummary = useMemo(() => {
        const summary: Record<string, number> = {}
        for (const t of tasks) {
            summary[t.status] = (summary[t.status] || 0) + 1
        }
        const recent = [...tasks]
            .sort((a, b) => (b.startTime || 0) - (a.startTime || 0))
            .slice(0, 6)
        const totalBytes = tasks.reduce((acc, t) => acc + (t.bytesDownloaded || 0), 0)
        return { summary, recent, totalBytes }
    }, [tasks])

    return (
        <div className="flex h-screen bg-slate-50 overflow-hidden relative">
            {uiError && (
                <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-50 border border-red-200 text-red-800 px-4 py-2 rounded-lg shadow-sm flex items-center gap-3">
                    <span className="text-sm font-medium">{uiError}</span>
                    <button className="text-sm font-semibold" onClick={() => setUiError(null)}>Dismiss</button>
                </div>
            )}
            {/* Sidebar */}
            {sidebarOpen && (
                <div
                    className="fixed inset-0 bg-slate-900/40 z-40 md:hidden"
                    onClick={() => setSidebarOpen(false)}
                    aria-hidden="true"
                />
            )}
            <aside
                className={`fixed inset-y-0 left-0 w-72 md:w-64 bg-white border-r border-slate-200 flex flex-col items-stretch z-50 transform transition-transform duration-200 md:static md:translate-x-0 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}`}
            >
                <div className="p-6 border-b border-slate-200">
                    <div className="flex flex-col items-start gap-3">
                        <div className="inline-flex items-center justify-center px-4 py-3 rounded-2xl bg-white border border-slate-200 shadow-sm">
                            <img
                                src={unigenomeLogo}
                                alt="Unigenome"
                                className="h-10 w-auto object-contain select-none"
                                draggable={false}
                            />
                        </div>
                        <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Unipath Specialty Laboratory</p>
                    </div>
                </div>

                <nav
                    className="flex-1 px-4 py-6 space-y-2"
                    aria-label="Main navigation"
                    onClick={() => {
                        if (sidebarOpen) setSidebarOpen(false)
                    }}
                >
                    <button
                        onClick={() => setView('overview')}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-slate-700 hover:bg-blue-50 hover:text-blue-600 transition-all font-medium group"
                        aria-label="Open projects overview"
                    >
                        <Folder className="w-5 h-5 text-slate-400 group-hover:text-blue-600 transition-colors" aria-hidden="true" />
                        <span className="text-sm">Projects</span>
                    </button>

                    <button
                        onClick={() => setView('dashboard')}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-slate-700 hover:bg-blue-50 hover:text-blue-600 transition-all font-medium group"
                        aria-label="Open dashboard analytics"
                    >
                        <Activity className="w-5 h-5 text-slate-400 group-hover:text-blue-600 transition-colors" aria-hidden="true" />
                        <span className="text-sm">Dashboard</span>
                    </button>

                    <button
                        onClick={() => setView('files')}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-slate-700 hover:bg-blue-50 hover:text-blue-600 transition-all font-medium group"
                        aria-label="Open file manager"
                    >
                        <Folder className="w-5 h-5 text-slate-400 group-hover:text-blue-600 transition-colors" aria-hidden="true" />
                        <span className="text-sm">File Manager</span>
                    </button>

                    <button
                        onClick={() => { setView('files'); fetchFiles('/') }}
                        className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-slate-700 hover:bg-blue-50 hover:text-blue-600 transition-all font-medium group"
                        aria-label="Navigate to root directory"
                    >
                        <Home className="w-5 h-5 text-slate-400 group-hover:text-blue-600 transition-colors" aria-hidden="true" />
                        <span className="text-sm">Root</span>
                    </button>

                    <div className="pt-4 pb-2 px-4">
                        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-4">Connection</p>
                        <div className="space-y-3 text-sm">
                            <div>
                                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Server</p>
                                <p className="text-slate-600 font-mono text-xs truncate" title={session.server}>{session.server}</p>
                            </div>
                            <div>
                                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">User</p>
                                <p className="text-slate-600 font-medium text-xs" title={session.username}>{session.username}</p>
                            </div>
                        </div>
                        <div className="mt-6">
                            <button
                                onClick={() => {
                                    if (view === 'overview') setLastMainView('overview')
                                    if (view === 'dashboard') setLastMainView('dashboard')
                                    if (view === 'files') setLastMainView('files')
                                    setView('downloads')
                                }}
                                className="w-full flex items-center gap-3 px-4 py-3 rounded-lg text-slate-700 hover:bg-blue-50 hover:text-blue-600 transition-all font-medium group"
                                aria-label="Open downloads page"
                            >
                                <Download className="w-5 h-5 text-slate-400 group-hover:text-blue-600 transition-colors" aria-hidden="true" />
                                <span className="text-sm">Downloads</span>
                            </button>

                            {session.isAdmin && (
                                <button
                                    onClick={() => setView('audit')}
                                    className="mt-2 w-full flex items-center gap-3 px-4 py-3 rounded-lg text-slate-700 hover:bg-blue-50 hover:text-blue-600 transition-all font-medium group"
                                    aria-label="Open audit logs"
                                >
                                    <ClipboardList className="w-5 h-5 text-slate-400 group-hover:text-blue-600 transition-colors" aria-hidden="true" />
                                    <span className="text-sm">Audit</span>
                                </button>
                            )}
                        </div>
                    </div>
                </nav>

                <div className="p-4 border-t border-slate-200">
                    <button
                        onClick={() => {
                            if (sidebarOpen) setSidebarOpen(false)
                            onLogout()
                        }}
                        className="w-full btn-secondary py-2.5 text-sm font-semibold"
                        aria-label="Logout from session"
                    >
                        <LogOut className="w-4 h-4" aria-hidden="true" />
                        <span>Logout</span>
                    </button>
                </div>
            </aside>

            {/* Main Content or Downloads Page */}
            {view === 'overview' ? (
                <OverviewPage
                    sessionId={session.sessionId}
                    deliverablesRoot={currentPath}
                    currentPath={currentPath}
                    onOpenFiles={(projectPath) => {
                        setLastMainView('files')
                        setView('files')
                        fetchFiles(projectPath)
                    }}
                />
            ) : view === 'downloads' ? (
                <DownloadsPage
                    tasks={tasks}
                    onCancel={handleCancelTransfer}
                    onCancelAll={cancelAllDownloads}
                    onClearCompleted={clearCompletedDownloads}
                    onPause={(id: string) => setTasks(prev => prev.map(t => t.id === id ? { ...t, status: 'paused' } : t))}
                    onResume={(id: string) => setTasks(prev => prev.map(t => t.id === id ? { ...t, status: 'ready' } : t))}
                    onClose={() => setView(lastMainView)}
                />
            ) : view === 'audit' ? (
                <main className="flex-1 flex flex-col relative overflow-hidden">
                    <header className="h-20 bg-white border-b border-slate-200 px-6 flex items-center justify-between z-10">
                        <div className="flex items-center gap-3 min-w-0">
                            <button
                                onClick={() => setSidebarOpen(true)}
                                className="md:hidden p-2 -ml-2 hover:bg-slate-100 rounded-lg transition-all"
                                aria-label="Open menu"
                            >
                                <Menu className="w-5 h-5 text-slate-600" aria-hidden="true" />
                            </button>
                            <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                                <ClipboardList className="w-5 h-5 text-blue-600" aria-hidden="true" />
                            </div>
                            <div className="min-w-0">
                                <h2 className="text-lg font-bold text-slate-900 truncate">Audit</h2>
                                <p className="text-xs text-slate-500 truncate">Recent client actions</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => setView(lastMainView)}
                                className="btn-secondary px-4 py-2 text-sm font-semibold"
                                aria-label="Back"
                            >
                                <ArrowLeft className="w-4 h-4" aria-hidden="true" />
                                <span>Back</span>
                            </button>
                        </div>
                    </header>

                    <div className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 xl:px-10 py-8 custom-scrollbar">
                        <div>
                            {auditError && (
                                <div className="mb-4 bg-red-50 border border-red-200 text-red-800 text-sm font-semibold rounded-lg px-4 py-3">
                                    {auditError}
                                </div>
                            )}

                            {auditLoading && !auditData ? (
                                <div className="card p-6">
                                    <div className="h-4 w-48 bg-slate-100 rounded animate-pulse" />
                                    <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-6">
                                        {new Array(3).fill(0).map((_, i) => (
                                            <div key={i} className="card p-6 border border-slate-100">
                                                <div className="h-4 w-28 bg-slate-100 rounded animate-pulse" />
                                                <div className="mt-4 space-y-3">
                                                    {new Array(6).fill(0).map((__, j) => (
                                                        <div key={j} className="h-14 bg-slate-100 rounded-lg animate-pulse" />
                                                    ))}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ) : (
                                <div>
                                    <div className="card p-4 mb-6 border border-slate-100">
                                        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
                                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 flex-1">
                                                <div>
                                                    <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Type</label>
                                                    <select
                                                        value={auditType}
                                                        onChange={(e) => setAuditType(e.target.value as any)}
                                                        className="input-field mt-1 w-full"
                                                        aria-label="Audit type"
                                                    >
                                                        <option value="all">All</option>
                                                        <option value="connections">Connections</option>
                                                        <option value="downloads">Downloads</option>
                                                        <option value="logs">Logs</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">User</label>
                                                    <input
                                                        value={auditUser}
                                                        onChange={(e) => setAuditUser(e.target.value)}
                                                        className="input-field mt-1 w-full"
                                                        placeholder="e.g. lab_user"
                                                        aria-label="Filter by user"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Server</label>
                                                    <input
                                                        value={auditServer}
                                                        onChange={(e) => setAuditServer(e.target.value)}
                                                        className="input-field mt-1 w-full"
                                                        placeholder="e.g. 10.0.0.10"
                                                        aria-label="Filter by server"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">From</label>
                                                    <input
                                                        type="date"
                                                        value={auditFrom}
                                                        onChange={(e) => setAuditFrom(e.target.value)}
                                                        className="input-field mt-1 w-full"
                                                        aria-label="From date"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">To</label>
                                                    <input
                                                        type="date"
                                                        value={auditTo}
                                                        onChange={(e) => setAuditTo(e.target.value)}
                                                        className="input-field mt-1 w-full"
                                                        aria-label="To date"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Search</label>
                                                    <input
                                                        value={auditQuery}
                                                        onChange={(e) => setAuditQuery(e.target.value)}
                                                        className="input-field mt-1 w-full"
                                                        placeholder="Search in payload…"
                                                        aria-label="Search audit"
                                                    />
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2 justify-end">
                                                <button
                                                    type="button"
                                                    onClick={exportAuditCsv}
                                                    disabled={filteredAuditEvents.length === 0}
                                                    className="btn-secondary px-4 py-2 text-sm font-semibold"
                                                    aria-label="Export CSV"
                                                >
                                                    <Download className="w-4 h-4" aria-hidden="true" />
                                                    <span>Export CSV</span>
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        setAuditType('all')
                                                        setAuditUser('')
                                                        setAuditServer('')
                                                        setAuditQuery('')
                                                    }}
                                                    className="btn-secondary px-4 py-2 text-sm font-semibold"
                                                    aria-label="Reset filters"
                                                >
                                                    <span>Reset</span>
                                                </button>
                                            </div>
                                        </div>
                                        <div className="mt-3 text-xs text-slate-500">
                                            Showing <span className="font-semibold text-slate-700">{filteredAuditEvents.length}</span> of{' '}
                                            <span className="font-semibold text-slate-700">{auditEvents.length}</span> events
                                        </div>
                                    </div>

                                    <div className="card p-4 border border-slate-100">
                                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <button
                                                    type="button"
                                                    onClick={() => setAuditType('all')}
                                                    className={auditType === 'all' ? 'btn-primary px-3 py-2 text-xs' : 'btn-secondary px-3 py-2 text-xs'}
                                                    aria-label="All events"
                                                >
                                                    All ({filteredAuditEvents.length})
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setAuditType('connections')}
                                                    className={auditType === 'connections' ? 'btn-primary px-3 py-2 text-xs' : 'btn-secondary px-3 py-2 text-xs'}
                                                    aria-label="Connection events"
                                                >
                                                    Connections ({filteredAuditEvents.filter(x => x.type === 'connections').length})
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setAuditType('downloads')}
                                                    className={auditType === 'downloads' ? 'btn-primary px-3 py-2 text-xs' : 'btn-secondary px-3 py-2 text-xs'}
                                                    aria-label="Download events"
                                                >
                                                    Downloads ({filteredAuditEvents.filter(x => x.type === 'downloads').length})
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setAuditType('logs')}
                                                    className={auditType === 'logs' ? 'btn-primary px-3 py-2 text-xs' : 'btn-secondary px-3 py-2 text-xs'}
                                                    aria-label="Log events"
                                                >
                                                    Logs ({filteredAuditEvents.filter(x => x.type === 'logs').length})
                                                </button>
                                            </div>
                                            <div className="text-xs text-slate-500">Click a row for full details</div>
                                        </div>

                                        <div className="mt-4 overflow-x-auto">
                                            <table className="min-w-full text-sm">
                                                <thead>
                                                    <tr className="text-left text-xs text-slate-500">
                                                        <th className="py-2 pr-4">Time</th>
                                                        <th className="py-2 pr-4">Type</th>
                                                        <th className="py-2 pr-4">User</th>
                                                        <th className="py-2 pr-4">Server</th>
                                                        <th className="py-2 pr-4">IP</th>
                                                        <th className="py-2 pr-4">Device</th>
                                                        <th className="py-2 pr-4">Summary</th>
                                                        <th className="py-2 pr-4">Status</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {filteredAuditEvents.slice(0, 100).map((e: any) => {
                                                        const p = e.payload || {}
                                                        const username = p.username ?? p.user ?? p.user_name ?? '--'
                                                        const server = p.server ?? p.host ?? '--'
                                                        const ip = p.ip ?? p.client_ip ?? '--'
                                                        const userAgent = p.user_agent ?? p.userAgent ?? p.ua ?? '--'
                                                        const summary = e.type === 'downloads'
                                                            ? (p.remote_path ?? '--')
                                                            : e.type === 'connections'
                                                                ? `${p.protocol || p.requested_protocol || '--'} connect`
                                                                : (p.message ?? p.error_message ?? '--')
                                                        const status = e.type === 'connections'
                                                            ? (p.success ? 'OK' : 'FAIL')
                                                            : e.type === 'logs'
                                                                ? String((p.level || 'log')).toUpperCase()
                                                                : 'OK'

                                                        return (
                                                            <tr
                                                                key={`${e.type}:${e.id}`}
                                                                className="border-t border-slate-100 hover:bg-blue-50/30 cursor-pointer"
                                                                onClick={() => setAuditSelected({ type: e.type, id: e.id, createdAt: e.createdAt, payload: p })}
                                                            >
                                                                <td className="py-3 pr-4 text-slate-600 whitespace-nowrap">
                                                                    {e.createdAt ? new Date(e.createdAt).toLocaleString() : '--'}
                                                                </td>
                                                                <td className="py-3 pr-4">
                                                                    <span className="text-xs font-semibold text-slate-700">
                                                                        {String(e.type).slice(0, 1).toUpperCase() + String(e.type).slice(1)}
                                                                    </span>
                                                                </td>
                                                                <td className="py-3 pr-4 text-slate-700 truncate max-w-[14rem]" title={String(username)}>{String(username)}</td>
                                                                <td className="py-3 pr-4 text-slate-700 truncate max-w-[14rem]" title={String(server)}>{String(server)}</td>
                                                                <td className="py-3 pr-4 text-slate-700 truncate max-w-[12rem]" title={String(ip)}>{String(ip)}</td>
                                                                <td className="py-3 pr-4 text-slate-700 truncate max-w-[18rem]" title={String(userAgent)}>{String(userAgent)}</td>
                                                                <td className="py-3 pr-4 text-slate-700 truncate max-w-[26rem]" title={String(summary)}>{String(summary)}</td>
                                                                <td className="py-3 pr-4">
                                                                    <span className={`text-[11px] font-bold ${status === 'FAIL' || status === 'ERROR' ? 'text-red-600' : status === 'OK' ? 'text-emerald-600' : 'text-slate-500'}`}>{status}</span>
                                                                </td>
                                                            </tr>
                                                        )
                                                    })}
                                                    {filteredAuditEvents.length === 0 && (
                                                        <tr className="border-t border-slate-100">
                                                            <td colSpan={8} className="py-10 text-center text-sm text-slate-500">
                                                                No audit events match your filters.
                                                            </td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>

                                        {filteredAuditEvents.length > 100 && (
                                            <div className="mt-3 text-xs text-slate-500">
                                                Showing first <span className="font-semibold text-slate-700">100</span> results. Narrow filters to refine.
                                            </div>
                                        )}
                                    </div>

                                    <AnimatePresence>
                                        {auditSelected && (
                                            <motion.div
                                                className="fixed inset-0 z-50"
                                                initial={{ opacity: 0 }}
                                                animate={{ opacity: 1 }}
                                                exit={{ opacity: 0 }}
                                                role="dialog"
                                                aria-modal="true"
                                                aria-label="Audit event details"
                                            >
                                                <button
                                                    type="button"
                                                    className="absolute inset-0 bg-black/40"
                                                    aria-label="Close details"
                                                    onClick={() => setAuditSelected(null)}
                                                />

                                                <motion.aside
                                                    initial={{ x: 420, opacity: 0 }}
                                                    animate={{ x: 0, opacity: 1 }}
                                                    exit={{ x: 420, opacity: 0 }}
                                                    transition={{ type: 'tween', duration: 0.18 }}
                                                    className="absolute inset-y-0 right-0 w-full sm:w-[32rem] bg-white border-l border-slate-200 flex flex-col overflow-hidden"
                                                >
                                                    <div className="p-5 border-b border-slate-200 flex items-start justify-between gap-4">
                                                        <div className="min-w-0">
                                                            <h3 className="font-semibold text-slate-900 truncate">Audit event</h3>
                                                            <p className="text-xs text-slate-500 mt-1 truncate">
                                                                {auditSelected.type} · {auditSelected.createdAt ? new Date(auditSelected.createdAt).toLocaleString() : '--'}
                                                            </p>
                                                        </div>
                                                        <button
                                                            type="button"
                                                            onClick={() => setAuditSelected(null)}
                                                            className="p-2 hover:bg-slate-100 rounded-lg text-slate-500"
                                                            aria-label="Close details"
                                                        >
                                                            <X className="w-5 h-5" aria-hidden="true" />
                                                        </button>
                                                    </div>

                                                    <div className="flex-1 p-5 bg-slate-50 overflow-auto custom-scrollbar">
                                                        <div className="card p-4">
                                                            <pre className="whitespace-pre-wrap text-xs text-slate-700 font-mono">
                                                                {JSON.stringify(auditSelected.payload, null, 2)}
                                                            </pre>
                                                        </div>
                                                    </div>
                                                </motion.aside>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            )}
                        </div>
                    </div>
                </main>
            ) : view === 'dashboard' ? (
                <main className="flex-1 flex flex-col relative overflow-hidden">
                    <header className="h-20 bg-white border-b border-slate-200 px-6 flex items-center justify-between z-10">
                        <div className="flex items-center gap-3 min-w-0">
                            <button
                                onClick={() => setSidebarOpen(true)}
                                className="md:hidden p-2 -ml-2 hover:bg-slate-100 rounded-lg transition-all"
                                aria-label="Open menu"
                            >
                                <Menu className="w-5 h-5 text-slate-600" aria-hidden="true" />
                            </button>
                            <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                                <Activity className="w-5 h-5 text-blue-600" aria-hidden="true" />
                            </div>
                            <div className="min-w-0">
                                <h2 className="text-lg font-bold text-slate-900 truncate">Dashboard</h2>
                                <p className="text-xs text-slate-500 truncate" title={currentPath}>Snapshot: {currentPath}</p>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            <button
                                onClick={() => fetchDeepFiles(currentPath, true)}
                                className="p-2 hover:bg-slate-100 rounded-lg transition-all"
                                aria-label="Refresh dashboard data"
                            >
                                <RefreshCw className={`w-5 h-5 text-slate-500 ${deepLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
                            </button>
                            <button
                                onClick={() => setView('files')}
                                className="btn-primary px-4 py-2 text-sm font-semibold"
                                aria-label="Open file manager"
                            >
                                <Folder className="w-4 h-4" aria-hidden="true" />
                                <span>Open File Manager</span>
                            </button>
                        </div>
                    </header>

                    <div className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-8 xl:px-10 py-8 custom-scrollbar">
                        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start xl:items-stretch">

                            <div className="xl:col-span-8 space-y-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">

                            <div className="card p-6 h-full bg-gradient-to-br from-white to-slate-50/60 border border-slate-100 hover:shadow-md transition-shadow">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-sm font-bold text-slate-900">Inventory</h3>
                                    <span className={`text-xs font-semibold ${deepLoading ? 'text-blue-600' : 'text-slate-400'}`}>{deepLoading ? 'Scanning…' : 'Snapshot'}</span>
                                </div>
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-semibold text-slate-500 uppercase">Folders</span>
                                        <span className="text-lg font-bold text-slate-900">{deepStats.folders}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-semibold text-slate-500 uppercase">Files</span>
                                        <span className="text-lg font-bold text-slate-900">{deepStats.files}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs font-semibold text-slate-500 uppercase">Total size</span>
                                        <span className="text-lg font-bold text-slate-900">{formatBytes(deepStats.size)}</span>
                                    </div>
                                    {deepError && (
                                        <div className="bg-red-50 border border-red-200 text-red-800 text-xs font-semibold rounded-lg px-3 py-2">
                                            {deepError}
                                        </div>
                                    )}
                                    <div className="pt-2 border-t border-slate-200">
                                        <p className="text-xs text-slate-500">
                                            Last refreshed:{' '}
                                            <span className="font-semibold text-slate-700">
                                                {deepLastRefreshedAt ? new Date(deepLastRefreshedAt).toLocaleString() : '--'}
                                            </span>
                                        </p>
                                    </div>

                                    <div className="pt-3 border-t border-slate-200 space-y-2">
                                        <button
                                            onClick={downloadFoldersOneByOne}
                                            disabled={deepFolderSummaries.length === 0 || folderBatchRunning}
                                            className="btn-primary w-full py-2 text-sm font-semibold"
                                            aria-label="Download folders one by one"
                                        >
                                            <Download className="w-4 h-4" aria-hidden="true" />
                                            <span>{folderBatchRunning ? 'Preparing…' : 'Download folders (one-by-one)'}</span>
                                        </button>

                                        {folderBatchRunning && (
                                            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                                                <div className="flex items-center justify-between gap-3">
                                                    <p className="text-xs font-semibold text-slate-500 uppercase">Folder batch</p>
                                                    <p className="text-xs font-bold text-slate-900">{folderBatchIndex}/{folderBatchTotal}</p>
                                                </div>
                                                {folderBatchCurrentName && (
                                                    <p className="mt-2 text-xs text-slate-600 truncate" title={folderBatchCurrentName}>
                                                        Current: <span className="font-semibold">{folderBatchCurrentName}</span>
                                                    </p>
                                                )}
                                                <button
                                                    onClick={cancelFolderBatch}
                                                    className="mt-3 w-full py-2 text-sm font-semibold rounded-lg border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 transition-all"
                                                    aria-label="Cancel folder downloads"
                                                >
                                                    <span>Cancel</span>
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="card p-6 h-full bg-gradient-to-br from-white to-slate-50/60 border border-slate-100 hover:shadow-md transition-shadow">
                                <h3 className="text-sm font-bold text-slate-900 mb-4">Category insights</h3>
                                {categorySummaries.length === 0 ? (
                                    <div className="text-sm text-slate-500">No subfolders to categorize.</div>
                                ) : (
                                    <div className="flex items-stretch gap-5">
                                        <div className="flex items-center justify-center scale-90 origin-center">
                                            <DonutChart
                                                segments={categorySegments}
                                                centerLabel={topCategory ? formatBytes(topCategory.size) : '--'}
                                                centerSubLabel={topCategory ? topCategory.category : 'Top'}
                                            />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="space-y-2">
                                                {categorySummaries.slice(0, 6).map((c) => (
                                                    <div key={c.category} className="flex items-center justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <p className="text-sm font-semibold text-slate-900 truncate" title={c.category}>{c.category}</p>
                                                            <p className="text-xs text-slate-500">{c.folders} folders · {c.files} files</p>
                                                        </div>
                                                        <div className="text-sm font-bold text-slate-900 flex-shrink-0">{formatBytes(c.size)}</div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                                </div>

                            <div className="card p-6 border border-slate-100 hover:shadow-md transition-shadow">
                                <h3 className="text-sm font-bold text-slate-900 mb-4">File types (top by count)</h3>
                                {nonDirFiles.length === 0 ? (
                                    <div className="text-sm text-slate-500">No files in this folder.</div>
                                ) : (
                                    <div className="flex flex-col md:flex-row gap-6 items-stretch">
                                        <div className="flex items-center justify-center md:w-56 scale-90 md:scale-100 origin-center">
                                            <DonutChart
                                                segments={fileTypeSegments}
                                                centerLabel={`${nonDirFiles.length}`}
                                                centerSubLabel="files"
                                            />
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <div className="space-y-3">
                                                {fileTypeStats.byCount.slice(0, 8).map(item => {
                                                    const pct = nonDirFiles.length ? Math.round((item.count / nonDirFiles.length) * 100) : 0
                                                    return (
                                                        <div key={item.ext} className="flex items-center gap-4">
                                                            <div className="w-24 text-xs font-mono text-slate-700 truncate" title={item.ext}>{item.ext}</div>
                                                            <div className="flex-1">
                                                                <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                                                                    <div className="h-full bg-blue-500" style={{ width: `${pct}%` }} />
                                                                </div>
                                                            </div>
                                                            <div className="w-24 text-right text-xs text-slate-500">{item.count} ({pct}%)</div>
                                                            <div className="w-28 text-right text-xs text-slate-500">{formatBytes(item.size)}</div>
                                                        </div>
                                                    )
                                                })}
                                            </div>

                                            <div className="mt-5 pt-4 border-t border-slate-200">
                                                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                                    {fileTypeSegments.map(s => {
                                                        const pct = nonDirFiles.length ? Math.round((s.value / nonDirFiles.length) * 100) : 0
                                                        return (
                                                            <div key={s.label} className="flex items-center gap-2 min-w-0">
                                                                <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: s.color }} />
                                                                <span className="text-xs text-slate-600 truncate" title={s.label}>{s.label}</span>
                                                                <span className="text-xs text-slate-400 flex-shrink-0">{pct}%</span>
                                                            </div>
                                                        )
                                                    })}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            </div>

                            <div className="card p-6 xl:col-span-4 h-full flex flex-col bg-gradient-to-br from-white to-slate-50/60 border border-slate-100 hover:shadow-md transition-shadow">
                                <h3 className="text-sm font-bold text-slate-900 mb-4">Download activity</h3>
                                <div className="flex-1 overflow-auto pr-1 custom-scrollbar">
                                    <div className="space-y-3">
                                        <div className="grid grid-cols-2 gap-3">
                                            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                                                <p className="text-xs font-semibold text-slate-500 uppercase">Completed</p>
                                                <p className="text-lg font-bold text-slate-900">{taskSummary.summary.completed || 0}</p>
                                            </div>
                                            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                                                <p className="text-xs font-semibold text-slate-500 uppercase">In queue</p>
                                                <p className="text-lg font-bold text-slate-900">{(taskSummary.summary.ready || 0) + (taskSummary.summary.downloading || 0)}</p>
                                            </div>
                                            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                                                <p className="text-xs font-semibold text-slate-500 uppercase">Errors</p>
                                                <p className="text-lg font-bold text-slate-900">{taskSummary.summary.error || 0}</p>
                                            </div>
                                            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                                                <p className="text-xs font-semibold text-slate-500 uppercase">Downloaded</p>
                                                <p className="text-lg font-bold text-slate-900">{formatBytes(taskSummary.totalBytes)}</p>
                                            </div>
                                        </div>

                                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                                            <p className="text-xs font-semibold text-slate-500 uppercase">Avg speed (active)</p>
                                            <p className="text-lg font-bold text-slate-900">{rollingAvgSpeed > 0 ? `${formatBytes(rollingAvgSpeed)}/s` : '--'}</p>
                                        </div>

                                        {errorGroups.length > 0 && (
                                            <div className="pt-2 border-t border-slate-200">
                                                <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Errors (grouped)</p>
                                                <div className="space-y-2">
                                                    {errorGroups.slice(0, 3).map(e => (
                                                        <div key={e.message} className="flex items-start justify-between gap-3">
                                                            <p className="text-xs text-slate-600 line-clamp-2 flex-1" title={e.message}>{e.message}</p>
                                                            <span className="text-xs font-bold text-slate-900 flex-shrink-0">{e.count}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                                <button
                                                    onClick={retryFailedDownloads}
                                                    className="btn-secondary w-full py-2 text-sm font-semibold mt-3"
                                                    aria-label="Retry failed downloads"
                                                >
                                                    <RefreshCw className="w-4 h-4" aria-hidden="true" />
                                                    <span>Retry failed</span>
                                                </button>
                                            </div>
                                        )}

                                        <div className="pt-2 border-t border-slate-200">
                                            <p className="text-xs font-semibold text-slate-500 uppercase mb-2">Recent</p>
                                            {taskSummary.recent.length === 0 ? (
                                                <div className="text-sm text-slate-500">No downloads yet.</div>
                                            ) : (
                                                <div className="space-y-2">
                                                    {taskSummary.recent.map(t => (
                                                        <div key={t.id} className="flex items-center justify-between gap-3">
                                                            <div className="min-w-0">
                                                                <p className="text-xs font-semibold text-slate-700 truncate" title={t.name}>{t.name}</p>
                                                                <p className="text-[11px] text-slate-500">{t.status}</p>
                                                            </div>
                                                            <div className="text-[11px] text-slate-500 flex-shrink-0">{Math.round(t.progress)}%</div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="pt-3 mt-3 border-t border-slate-200">
                                    <button
                                        onClick={() => {
                                            setLastMainView('dashboard')
                                            setView('downloads')
                                        }}
                                        className="btn-secondary w-full py-2 text-sm font-semibold"
                                        aria-label="Open downloads"
                                    >
                                        <Download className="w-4 h-4" aria-hidden="true" />
                                        <span>Open Downloads</span>
                                    </button>
                                </div>
                            </div>

                            <div className="card p-6 lg:col-span-8 border border-slate-100 hover:shadow-md transition-shadow">
                                <div className="flex items-center justify-between gap-4 mb-4">
                                    <h3 className="text-sm font-bold text-slate-900">Subfolder insights (1 level)</h3>
                                    <p className="text-xs text-slate-500">Scans files inside each direct subfolder only</p>
                                </div>

                                {deepFolderCount === 0 ? (
                                    <div className="text-sm text-slate-500">No subfolders found.</div>
                                ) : (
                                    <div className="overflow-auto custom-scrollbar">
                                        <div className="min-w-[860px]">
                                            <div className="grid grid-cols-12 gap-3 text-xs font-bold text-slate-400 uppercase tracking-wider pb-3 border-b border-slate-200">
                                                <div className="col-span-5">Folder</div>
                                                <div className="col-span-2 text-right">Files</div>
                                                <div className="col-span-2 text-right">Size</div>
                                                <div className="col-span-2">Top types</div>
                                                <div className="col-span-1 text-right">Action</div>
                                            </div>

                                            <div className="divide-y divide-slate-100">
                                                {deepFolderSummaries.map((s) => (
                                                    <div
                                                        key={s.path}
                                                        onClick={() => setSelectedSubfolder(s)}
                                                        className="grid grid-cols-12 gap-3 py-3 items-center hover:bg-slate-50 rounded-lg transition-colors cursor-pointer"
                                                        aria-label={`Open insights for ${s.name}`}
                                                        role="button"
                                                        tabIndex={0}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') setSelectedSubfolder(s)
                                                        }}
                                                    >
                                                        <div className="col-span-5 min-w-0">
                                                            <p className="text-sm font-semibold text-slate-900 truncate" title={s.name}>{s.name}</p>
                                                            <p className="text-xs text-slate-500 truncate" title={s.path}>{s.path}</p>
                                                        </div>
                                                        <div className="col-span-2 text-right text-sm text-slate-700">{s.files}</div>
                                                        <div className="col-span-2 text-right text-sm text-slate-700">{formatBytes(s.size)}</div>
                                                        <div className="col-span-2 text-xs text-slate-600">
                                                            {s.topTypes.length === 0 ? '--' : s.topTypes.map(t => `${t.ext}:${t.count}`).join('  ')}
                                                        </div>
                                                        <div className="col-span-1 flex justify-end">
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); setView('files'); fetchFiles(s.path) }}
                                                                className="btn-secondary px-3 py-2 text-xs font-semibold"
                                                                aria-label={`Open ${s.name}`}
                                                            >
                                                                <span>Open</span>
                                                            </button>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="card p-6 lg:col-span-4 border border-slate-100 hover:shadow-md transition-shadow">
                                <div className="flex items-center justify-between gap-4 mb-4">
                                    <h3 className="text-sm font-bold text-slate-900">Largest files</h3>
                                    <p className="text-xs text-slate-500">Across current dashboard snapshot</p>
                                </div>

                                {largestFiles.length === 0 ? (
                                    <div className="text-sm text-slate-500">No files in this snapshot.</div>
                                ) : (
                                    <div className="space-y-3">
                                        {largestFiles.map(f => (
                                            <div key={f.path} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200">
                                                <File className="w-4 h-4 text-slate-400 flex-shrink-0" aria-hidden="true" />
                                                <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-semibold text-slate-900 truncate" title={f.name}>{f.name}</p>
                                                    <p className="text-xs text-slate-500">{formatBytes(f.size || 0)}</p>
                                                </div>
                                                <button
                                                    onClick={() => handleQueueDownloads([f.path])}
                                                    className="btn-secondary px-3 py-2 text-xs font-semibold"
                                                    aria-label={`Queue download for ${f.name}`}
                                                >
                                                    <Download className="w-4 h-4" aria-hidden="true" />
                                                    <span>Queue</span>
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <AnimatePresence>
                                {selectedSubfolder && drilldown && (
                                    <motion.div
                                        className="fixed inset-0 z-50 flex items-center justify-center p-6"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        exit={{ opacity: 0 }}
                                        role="dialog"
                                        aria-modal="true"
                                        aria-label="Subfolder insights"
                                        onMouseDown={(e) => {
                                            if (e.target === e.currentTarget) setSelectedSubfolder(null)
                                        }}
                                    >
                                        <div className="absolute inset-0 bg-slate-900/40" />

                                        <motion.div
                                            className="relative w-full max-w-5xl bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden"
                                            initial={{ y: 12, scale: 0.98, opacity: 0 }}
                                            animate={{ y: 0, scale: 1, opacity: 1 }}
                                            exit={{ y: 12, scale: 0.98, opacity: 0 }}
                                            onMouseDown={(e) => e.stopPropagation()}
                                        >
                                            <div className="px-6 py-5 border-b border-slate-200 flex items-start justify-between gap-4">
                                                <div className="min-w-0">
                                                    <h3 className="text-lg font-bold text-slate-900 truncate" title={selectedSubfolder.name}>{selectedSubfolder.name}</h3>
                                                    <p className="text-xs text-slate-500 truncate" title={selectedSubfolder.path}>{selectedSubfolder.path}</p>
                                                    <p className="text-xs text-slate-500 mt-2">
                                                        Category:{' '}
                                                        <span className="font-semibold text-slate-700">{deriveCategory(selectedSubfolder.name)}</span>
                                                        {' '}· Files:{' '}
                                                        <span className="font-semibold text-slate-700">{drilldown.files.length}</span>
                                                        {' '}· Size:{' '}
                                                        <span className="font-semibold text-slate-700">{formatBytes(drilldown.totalSize)}</span>
                                                    </p>
                                                </div>
                                                <div className="flex items-center gap-2 flex-shrink-0">
                                                    <button
                                                        onClick={() => handleQueueDownloads(drilldown.files.map(f => f.path))}
                                                        disabled={drilldown.files.length === 0}
                                                        className="btn-primary px-4 py-2 text-sm font-semibold"
                                                        aria-label="Queue all files in this folder"
                                                    >
                                                        <Download className="w-4 h-4" aria-hidden="true" />
                                                        <span>Queue all</span>
                                                    </button>
                                                    <button
                                                        onClick={() => { setView('files'); fetchFiles(selectedSubfolder.path); setSelectedSubfolder(null) }}
                                                        className="btn-secondary px-4 py-2 text-sm font-semibold"
                                                        aria-label="Open folder in file manager"
                                                    >
                                                        <Folder className="w-4 h-4" aria-hidden="true" />
                                                        <span>Open</span>
                                                    </button>
                                                    <button
                                                        onClick={() => setSelectedSubfolder(null)}
                                                        className="p-2 rounded-lg hover:bg-slate-100 text-slate-500"
                                                        aria-label="Close"
                                                    >
                                                        <X className="w-5 h-5" aria-hidden="true" />
                                                    </button>
                                                </div>
                                            </div>

                                            <div className="p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
                                                <div className="card p-5 lg:col-span-5">
                                                    <h4 className="text-sm font-bold text-slate-900 mb-4">File types</h4>
                                                    {drilldown.files.length === 0 ? (
                                                        <div className="text-sm text-slate-500">No files found in this folder.</div>
                                                    ) : (
                                                        <div className="flex flex-col sm:flex-row gap-5 items-stretch">
                                                            <div className="flex items-center justify-center sm:w-48 scale-90 sm:scale-100 origin-center">
                                                                <DonutChart
                                                                    segments={drilldown.segments}
                                                                    centerLabel={`${drilldown.files.length}`}
                                                                    centerSubLabel="files"
                                                                />
                                                            </div>
                                                            <div className="flex-1 min-w-0 space-y-2">
                                                                {drilldown.byCount.slice(0, 6).map(x => {
                                                                    const pct = drilldown.files.length ? Math.round((x.count / drilldown.files.length) * 100) : 0
                                                                    return (
                                                                        <div key={x.ext} className="flex items-center gap-3">
                                                                            <div className="w-24 text-xs font-mono text-slate-700 truncate" title={x.ext}>{x.ext}</div>
                                                                            <div className="flex-1">
                                                                                <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                                                                                    <div className="h-full bg-blue-500" style={{ width: `${pct}%` }} />
                                                                                </div>
                                                                            </div>
                                                                            <div className="w-16 text-right text-xs text-slate-500">{pct}%</div>
                                                                        </div>
                                                                    )
                                                                })}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>

                                                <div className="card p-5 lg:col-span-7">
                                                    <h4 className="text-sm font-bold text-slate-900 mb-4">Largest files</h4>
                                                    {drilldown.largest.length === 0 ? (
                                                        <div className="text-sm text-slate-500">No files found in this folder.</div>
                                                    ) : (
                                                        <div className="space-y-3 max-h-80 overflow-auto pr-2 custom-scrollbar">
                                                            {drilldown.largest.map(f => (
                                                                <div key={f.path} className="flex items-center gap-3">
                                                                    <File className="w-4 h-4 text-slate-400 flex-shrink-0" aria-hidden="true" />
                                                                    <div className="flex-1 min-w-0">
                                                                        <p className="text-sm font-semibold text-slate-900 truncate" title={f.name}>{f.name}</p>
                                                                        <p className="text-xs text-slate-500">{formatBytes(f.size || 0)}</p>
                                                                    </div>
                                                                    <button
                                                                        onClick={() => handleQueueDownloads([f.path])}
                                                                        className="btn-secondary px-3 py-2 text-xs font-semibold"
                                                                        aria-label={`Queue download for ${f.name}`}
                                                                    >
                                                                        <Download className="w-4 h-4" aria-hidden="true" />
                                                                        <span>Queue</span>
                                                                    </button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </motion.div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>
                </main>
            ) : (
                <main className="flex-1 flex flex-col relative overflow-hidden">
                {/* Header */}
                <header className="h-20 bg-white border-b border-slate-200 px-4 sm:px-6 md:px-8 flex items-center justify-between z-10">
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                        <button
                            onClick={() => setSidebarOpen(true)}
                            className="md:hidden p-2 -ml-2 hover:bg-slate-100 rounded-lg transition-all"
                            aria-label="Open menu"
                        >
                            <Menu className="w-5 h-5 text-slate-600" aria-hidden="true" />
                        </button>
                        <button
                            onClick={() => {
                                fetchFiles(parentPath)
                            }}
                            disabled={atRoot}
                            className={`p-2 rounded-lg transition-all ${atRoot ? 'text-slate-300 cursor-not-allowed' : 'hover:bg-slate-100'}`}
                            aria-label="Navigate to parent directory"
                        >
                            <ArrowLeft className="w-5 h-5 text-slate-500" aria-hidden="true" />
                        </button>
                        <nav className="flex items-center gap-1 overflow-x-auto whitespace-nowrap py-2" aria-label="Breadcrumb">
                            <button
                                onClick={() => fetchFiles('/')}
                                className={`font-medium text-sm px-2 ${atRoot ? 'text-slate-900' : 'text-slate-500 hover:text-blue-600'}`}
                            >
                                Root
                            </button>
                            {breadcrumbs.map((part, i) => (
                                <React.Fragment key={i}>
                                    <ChevronRight className="w-4 h-4 text-slate-300" aria-hidden="true" />
                                    <button
                                        onClick={() => fetchFiles('/' + breadcrumbs.slice(0, i + 1).join('/'))}
                                        title={part}
                                        className={`text-sm font-medium px-2 transition-colors max-w-[10rem] truncate ${i === breadcrumbs.length - 1 ? 'text-slate-900' : 'text-slate-500 hover:text-blue-600'}`}
                                    >
                                        {part}
                                    </button>
                                </React.Fragment>
                            ))}
                        </nav>
                    </div>

                    <div className="flex items-center gap-3 flex-shrink-0">
                        <div className="relative hidden md:block">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden="true" />
                            <input
                                type="text"
                                placeholder="Search files..."
                                className="input-field pl-9 pr-4 py-2 text-sm w-48"
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                aria-label="Search files"
                            />
                        </div>
                        <button
                            onClick={() => fetchFiles(currentPath, { force: true })}
                            className="p-2 hover:bg-slate-100 rounded-lg transition-all"
                            aria-label="Refresh file list"
                        >
                            <RefreshCw className={`w-5 h-5 text-slate-500 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
                        </button>
                    </div>
                </header>

                {/* Enhanced Stats Bar */}
                <div className="px-4 sm:px-6 md:px-8 py-4 bg-gradient-to-r from-slate-50 to-white border-b border-slate-200 flex items-center justify-between">
                    <div className="flex items-center gap-8">
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-success-50 border border-success-200">
                            <div className="w-2 h-2 rounded-full bg-success-500 status-online"></div>
                            <span className="text-xs font-bold text-success-700 uppercase tracking-wide">Connected</span>
                        </div>
                        <div className="flex items-center gap-6 text-sm">
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                                    <Folder className="w-5 h-5 text-blue-600" aria-hidden="true" />
                                </div>
                                <div>
                                    <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Folders</p>
                                    <p className="text-xl font-extrabold text-slate-900 font-display">{stats.folders}</p>
                                </div>
                            </div>
                            <div className="w-px h-10 bg-slate-200" />
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
                                    <File className="w-5 h-5 text-emerald-600" aria-hidden="true" />
                                </div>
                                <div>
                                    <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Files</p>
                                    <p className="text-xl font-extrabold text-slate-900 font-display">{stats.files}</p>
                                </div>
                            </div>
                            <div className="w-px h-10 bg-slate-200" />
                            <div className="flex items-center gap-3">
                                <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center">
                                    <HardDrive className="w-5 h-5 text-purple-600" aria-hidden="true" />
                                </div>
                                <div>
                                    <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Total Size</p>
                                    <p className="text-xl font-extrabold text-slate-900 font-display">{formatBytes(stats.size)}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <button className="btn-secondary px-4 py-2 text-sm font-semibold shadow-sm" disabled aria-label="Upload files">
                            <Upload className="w-4 h-4" aria-hidden="true" />
                            <span>Upload</span>
                        </button>
                        <button
                            onClick={() => handleQueueDownloads()}
                            disabled={selectedPaths.length === 0}
                            className="btn-primary px-5 py-2.5 text-sm font-bold shadow-md hover:shadow-lg transition-shadow"
                        >
                            <Download className="w-4 h-4" aria-hidden="true" />
                            <span>{selectedPaths.length ? `Queue (${selectedPaths.length})` : 'Queue'}</span>
                        </button>
                    </div>
                </div>

                {/* Selection Bar */}
                {selectedPaths.length > 0 && (
                    <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        className="selection-bar sticky top-0 z-10 px-4 sm:px-6 md:px-8 py-3 bg-blue-50 border-b border-blue-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                    >
                        <div className="flex items-center justify-between sm:justify-start gap-3">
                            <div className="flex items-center gap-3">
                                <span className="inline-flex items-center rounded-full bg-blue-100 px-3 py-1 text-sm font-semibold text-blue-900">
                                    {selectedPaths.length} selected
                                </span>
                                <button
                                    type="button"
                                    onClick={clearSelection}
                                    className="btn-secondary px-3 py-2 text-xs"
                                    aria-label="Clear selection"
                                >
                                    Clear
                                </button>
                            </div>

                            <div className="hidden sm:flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={selectVisible}
                                    className="btn-secondary px-3 py-2 text-xs"
                                    aria-label="Select visible files"
                                >
                                    Select visible
                                </button>
                                <button
                                    type="button"
                                    onClick={selectAll}
                                    className="btn-secondary px-3 py-2 text-xs"
                                    aria-label="Select all files"
                                >
                                    Select all
                                </button>
                            </div>
                        </div>

                        <div className="flex items-center gap-2 justify-end">
                            <div className="flex sm:hidden items-center gap-2">
                                <button
                                    type="button"
                                    onClick={selectVisible}
                                    className="btn-secondary px-3 py-2 text-xs"
                                    aria-label="Select visible files"
                                >
                                    Visible
                                </button>
                                <button
                                    type="button"
                                    onClick={selectAll}
                                    className="btn-secondary px-3 py-2 text-xs"
                                    aria-label="Select all files"
                                >
                                    All
                                </button>
                            </div>
                            <button
                                type="button"
                                onClick={() => handleQueueDownloads()}
                                className="btn-primary px-4 py-2 text-sm"
                                aria-label="Queue selected files"
                            >
                                <Download className="w-4 h-4" aria-hidden="true" />
                                Queue selected
                            </button>
                        </div>
                    </motion.div>
                )}

                {/* Files Grid */}
                <div className="flex-1 overflow-y-auto px-4 sm:px-6 md:px-8 py-6 sm:py-8 custom-scrollbar">
                    {loading ? (
                        <FileGridSkeleton />
                    ) : filteredFiles.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-center">
                            <HardDrive className="w-12 h-12 text-slate-300 mb-4" aria-hidden="true" />
                            <p className="text-lg font-semibold text-slate-600">No files found</p>
                            <p className="text-sm text-slate-500 mt-1">This directory is empty or no files match your search</p>
                        </div>
                    ) : (
                        <motion.div layout className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                            <AnimatePresence mode="popLayout">
                                {filteredFiles.map((file) => (
                                    <FileCard
                                        key={file.path}
                                        file={file}
                                        onClick={() => file.isDirectory ? fetchFiles(file.path) : openPreview(file)}
                                        onDownload={() => handleQueueDownloads([file.path])}
                                        formatBytes={formatBytes}
                                        selected={selectedPaths.includes(file.path)}
                                        onSelect={() => toggleSelectPath(file.path)}
                                    />
                                ))}
                            </AnimatePresence>
                        </motion.div>
                    )}
                </div>
            </main>
            )}

            {/* Preview Sidebar */}
            <AnimatePresence>
                {previewFile && (
                    <motion.div
                        className="fixed inset-0 z-50"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        role="dialog"
                        aria-modal="true"
                        aria-label="File preview"
                    >
                        <button
                            type="button"
                            className="absolute inset-0 bg-black/40"
                            aria-label="Close preview"
                            onClick={clearPreview}
                        />

                        <motion.aside
                            initial={{ x: 420, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            exit={{ x: 420, opacity: 0 }}
                            transition={{ type: 'tween', duration: 0.18 }}
                            className="absolute inset-y-0 right-0 w-full sm:w-[28rem] bg-white border-l border-slate-200 flex flex-col overflow-hidden"
                        >
                            <div className="p-5 border-b border-slate-200 flex items-start justify-between gap-4">
                                <div className="flex-1 min-w-0">
                                    <h3 className="font-semibold text-slate-900 truncate" title={previewFile.name}>{previewFile.name}</h3>
                                    <p className="text-xs text-slate-500 mt-1">{previewFile.isDirectory ? 'Folder' : formatBytes(previewFile.size)}</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={clearPreview}
                                    className="p-2 hover:bg-slate-100 rounded-lg text-slate-500"
                                    aria-label="Close preview"
                                >
                                    <X className="w-5 h-5" aria-hidden="true" />
                                </button>
                            </div>

                            <div className="flex-1 p-5 bg-slate-50 overflow-auto custom-scrollbar">
                                {previewLoading ? (
                                    <div className="flex items-center justify-center h-full">
                                        <div className="text-center">
                                            <div className="w-8 h-8 rounded-full border-2 border-slate-300 border-t-blue-600 animate-spin mx-auto mb-2" />
                                            <p className="text-xs text-slate-500">Loading...</p>
                                        </div>
                                    </div>
                                ) : previewUrl ? (
                                    <img src={previewUrl} alt={previewFile.name} className="w-full h-auto object-contain rounded-lg bg-white" />
                                ) : previewContent ? (
                                    <pre className="whitespace-pre-wrap text-xs text-slate-700 font-mono bg-white p-4 rounded-lg">{previewContent.slice(0, 1000)}</pre>
                                ) : (
                                    <div className="flex items-center justify-center h-full text-center">
                                        <div>
                                            <Eye className="w-8 h-8 text-slate-300 mx-auto mb-2" aria-hidden="true" />
                                            <p className="text-sm font-medium text-slate-600">No preview available</p>
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="p-5 border-t border-slate-200 flex gap-2">
                                <button
                                    type="button"
                                    onClick={() => previewFile && handleQueueDownloads([previewFile.path])}
                                    className="btn-primary flex-1 py-2 text-sm"
                                    aria-label="Download file"
                                >
                                    <Download className="w-4 h-4" aria-hidden="true" />
                                    Download
                                </button>
                            </div>
                        </motion.aside>
                    </motion.div>
                )}
            </AnimatePresence>

            <TransferManager
                tasks={tasks}
                onCancel={handleCancelTransfer}
                onTaskUpdate={onTaskUpdate}
                isOpen={view !== 'downloads' && isTransferManagerOpen}
                onToggle={() => setIsTransferManagerOpen(!isTransferManagerOpen)}
            />
        </div>
    )
}

const FileGridSkeleton = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {new Array(12).fill(0).map((_, i) => (
            <div key={i} className="card p-4 flex flex-col">
                <div className="flex items-start justify-between mb-3">
                    <div className="h-10 w-10 rounded-lg bg-slate-100 border border-slate-200 animate-pulse" />
                    <div className="h-4 w-4 rounded bg-slate-100 border border-slate-200 animate-pulse" />
                </div>
                <div className="h-4 w-3/4 bg-slate-100 rounded animate-pulse" />
                <div className="mt-2 h-4 w-2/3 bg-slate-100 rounded animate-pulse" />
                <div className="mt-4 pt-2 border-t border-slate-100 flex items-center justify-between">
                    <div className="h-3 w-16 bg-slate-100 rounded animate-pulse" />
                    <div className="h-3 w-10 bg-slate-100 rounded animate-pulse" />
                </div>
                <div className="mt-3 h-9 w-full bg-slate-100 rounded-lg animate-pulse" />
            </div>
        ))}
    </div>
)

const getFileIcon = (fileName: string, isDirectory: boolean) => {
    if (isDirectory) return <Folder className="w-6 h-6 fill-current text-blue-600" aria-hidden="true" />
    const ext = fileName.toLowerCase().split('.').pop()
    if (['fastq', 'fq', 'gz'].includes(ext || '')) return <Activity className="w-6 h-6 text-emerald-600" aria-hidden="true" />
    if (['bam', 'sam', 'bai'].includes(ext || '')) return <HardDrive className="w-6 h-6 text-blue-600" aria-hidden="true" />
    if (['vcf', 'bcf', 'bed'].includes(ext || '')) return <Shield className="w-6 h-6 text-purple-600" aria-hidden="true" />
    if (['pdf', 'doc', 'docx', 'txt'].includes(ext || '')) return <File className="w-6 h-6 text-orange-600" aria-hidden="true" />
    return <File className="w-6 h-6 text-slate-400" aria-hidden="true" />
}

type DonutChartSegment = {
    label: string
    value: number
    color: string
}

interface DonutChartProps {
    segments: DonutChartSegment[]
    centerLabel?: string
    centerSubLabel?: string
}

const DonutChart: React.FC<DonutChartProps> = ({ segments, centerLabel, centerSubLabel }) => {
    const size = 180
    const strokeWidth = 20
    const radius = (size - strokeWidth) / 2
    const cx = size / 2
    const cy = size / 2
    const circumference = 2 * Math.PI * radius
    const [hoveredSegment, setHoveredSegment] = React.useState<string | null>(null)

    const total = segments.reduce((acc, s) => acc + (s.value || 0), 0)

    let offset = 0
    return (
        <div className="relative group" style={{ width: size, height: size }}>
            <svg 
                width={size} 
                height={size} 
                viewBox={`0 0 ${size} ${size}`} 
                role="img" 
                aria-label="File type distribution"
                className="drop-shadow-sm"
            >
                {/* Background ring */}
                <circle
                    cx={cx}
                    cy={cy}
                    r={radius}
                    fill="none"
                    stroke="#f1f5f9"
                    strokeWidth={strokeWidth}
                />
                <g transform={`rotate(-90 ${cx} ${cy})`}>
                    {segments.map((s) => {
                        const value = s.value || 0
                        const portion = total > 0 ? value / total : 0
                        const dash = portion * circumference
                        const gap = circumference - dash
                        const dashArray = `${dash} ${gap}`
                        const dashOffset = -offset
                        offset += dash
                        const isHovered = hoveredSegment === s.label
                        return (
                            <circle
                                key={s.label}
                                cx={cx}
                                cy={cy}
                                r={radius}
                                fill="none"
                                stroke={s.color}
                                strokeWidth={isHovered ? strokeWidth + 2 : strokeWidth}
                                strokeDasharray={dashArray}
                                strokeDashoffset={dashOffset}
                                strokeLinecap="round"
                                className="transition-all duration-200 cursor-pointer"
                                style={{ filter: isHovered ? 'brightness(1.1)' : 'none' }}
                                onMouseEnter={() => setHoveredSegment(s.label)}
                                onMouseLeave={() => setHoveredSegment(null)}
                            />
                        )
                    })}
                </g>
            </svg>

            <div className="absolute inset-0 flex flex-col items-center justify-center text-center pointer-events-none">
                {centerLabel && <div className="text-3xl font-extrabold text-slate-900 leading-none font-display">{centerLabel}</div>}
                {centerSubLabel && <div className="text-xs font-bold text-slate-500 uppercase tracking-wider mt-1">{centerSubLabel}</div>}
            </div>
        </div>
    )
}

const FileCard: React.FC<FileCardProps> = ({ file, onClick, onDownload, formatBytes, selected, onSelect }) => {
    return (
        <motion.div
            layout
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            whileHover={{ translateY: -2 }}
            className={`card p-4 cursor-pointer group relative flex flex-col overflow-hidden hover:border-blue-200 file-card`}
            onClick={onClick}
            role="listitem"
            tabIndex={0}
            aria-selected={selected}
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    e.preventDefault()
                    onClick()
                }
                if (e.key === ' ' || e.key === 'Spacebar') {
                    e.preventDefault()
                    onSelect()
                }
            }}
        >
            <div className="flex items-start justify-between mb-3">
                <div className="p-2 rounded-lg bg-blue-50 group-hover:bg-blue-100 transition-colors">
                    {getFileIcon(file.name, file.isDirectory)}
                </div>
                <input
                    type="checkbox"
                    checked={!!selected}
                    onChange={(e) => { e.stopPropagation(); onSelect() }}
                    onClick={(e) => e.stopPropagation()}
                    className="w-4 h-4 rounded border-slate-300 text-blue-600 cursor-pointer"
                    aria-label={`Select ${file.name}`}
                />
            </div>

            <h3 className="font-semibold text-slate-900 text-sm line-clamp-2 mb-2 flex-1" title={file.name}>{file.name}</h3>

            <div className="flex items-center justify-between text-xs text-slate-500 mb-3 pt-2 border-t border-slate-100">
                <span>{file.isDirectory ? 'Folder' : formatBytes(file.size)}</span>
                {!file.isDirectory && <span>{file.name.split('.').pop()?.toUpperCase()}</span>}
            </div>

            {!file.isDirectory && (
                <button
                    onClick={(e) => { e.stopPropagation(); onDownload() }}
                    className="btn-primary w-full py-2 text-xs opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label={`Download ${file.name}`}
                >
                    <Download className="w-3 h-3" aria-hidden="true" />
                    <span className="ml-2">Download</span>
                </button>
            )}
        </motion.div>
    )
}
