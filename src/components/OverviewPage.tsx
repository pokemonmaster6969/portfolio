import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    ArrowLeft,
    ChevronDown,
    ChevronRight,
    Download,
    Folder,
    File,
    FileText,
    FolderOpen,
    LayoutGrid,
    Loader2,
    RefreshCw,
    Search,
    AlertCircle,
} from 'lucide-react'
import { sftpApi } from '../api/sftp'
import type { SFTPFile } from '../types'
import { useDebouncedValue } from '../hooks'

type ProjectStatus = 'Live' | 'Archived'

type ProjectMetadata = {
    projectId?: string
    projectPi?: string
    application?: string
    samples?: string
}

const OverviewSkeleton: React.FC<{ rootPath: string; onClose?: () => void }> = ({ rootPath, onClose }) => {
    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            <header className="bg-white border-b border-slate-200 px-4 sm:px-6 md:px-8 py-3 sm:py-0 sm:h-20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-slate-100 rounded-lg transition-all"
                            aria-label="Back"
                        >
                            <ArrowLeft className="w-5 h-5 text-slate-600" aria-hidden="true" />
                        </button>
                    )}
                    <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                        <LayoutGrid className="w-5 h-5 text-blue-600" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-lg font-bold text-slate-900 truncate">Projects</h2>
                        <p className="text-xs text-slate-500 truncate">Root: {rootPath}</p>
                    </div>
                </div>

                <button className="btn-secondary px-3 py-2 text-sm font-semibold" disabled aria-label="Refresh projects">
                    <RefreshCw className="w-4 h-4" aria-hidden="true" />
                    <span className="hidden sm:inline">Refresh</span>
                </button>
            </header>

            <div className="px-4 sm:px-6 md:px-8 py-4 bg-white border-b border-slate-200">
                <div className="relative max-w-xl">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-300" aria-hidden="true" />
                    <div className="h-10 rounded-lg bg-slate-100 border border-slate-200 animate-pulse" />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 sm:px-6 md:px-8 py-6 custom-scrollbar">
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                        <thead>
                            <tr className="text-left text-xs text-slate-500">
                                <th className="py-2 pr-4">Project ID</th>
                                <th className="py-2 pr-4">PI</th>
                                <th className="py-2 pr-4">Application</th>
                                <th className="py-2 pr-4">Samples</th>
                                <th className="py-2 pr-4">Status</th>
                                <th className="py-2 pr-4">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {new Array(10).fill(0).map((_, i) => (
                                <tr key={i} className="border-t border-slate-100">
                                    <td className="py-3 pr-4">
                                        <div className="h-4 w-28 bg-slate-100 rounded animate-pulse" />
                                    </td>
                                    <td className="py-3 pr-4">
                                        <div className="h-4 w-24 bg-slate-100 rounded animate-pulse" />
                                    </td>
                                    <td className="py-3 pr-4">
                                        <div className="h-4 w-40 bg-slate-100 rounded animate-pulse" />
                                    </td>
                                    <td className="py-3 pr-4">
                                        <div className="h-4 w-20 bg-slate-100 rounded animate-pulse" />
                                    </td>
                                    <td className="py-3 pr-4">
                                        <div className="h-4 w-16 bg-slate-100 rounded animate-pulse" />
                                    </td>
                                    <td className="py-3 pr-4">
                                        <div className="h-9 w-28 bg-slate-100 rounded-lg animate-pulse" />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}

type TreeSection = {
    title: string
    lines: string[]
}

type DeliverableNode = {
    id: string
    name: string
    children: DeliverableNode[]
}

function nodeMatchesQuery(node: DeliverableNode, q: string): boolean {
    if (!q) return true
    return node.name.toLowerCase().includes(q)
}

function filterTree(node: DeliverableNode, q: string): DeliverableNode | null {
    if (!q) return node
    const keptChildren: DeliverableNode[] = []
    for (const c of node.children) {
        const kept = filterTree(c, q)
        if (kept) keptChildren.push(kept)
    }
    if (nodeMatchesQuery(node, q) || keptChildren.length > 0) {
        return { ...node, children: keptChildren }
    }
    return null
}

function buildDeliverableTree(sectionTitle: string, lines: string[]): DeliverableNode {
    const root: DeliverableNode = { id: sectionTitle, name: sectionTitle, children: [] }

    const stack: DeliverableNode[] = [root]
    for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, '')
        const connectorIdx = Math.max(line.indexOf('├'), line.indexOf('└'))
        if (connectorIdx === -1) continue
        const depth = Math.max(0, Math.floor(connectorIdx / 4))

        const nameMatch = line.match(/(?:├──|└──)\s*(.+)\s*$/)
        const name = (nameMatch?.[1] || '').trim()
        if (!name) continue

        // Ensure stack has correct parent at depth
        while (stack.length > depth + 1) stack.pop()
        const parent = stack[stack.length - 1] || root

        const node: DeliverableNode = {
            id: `${parent.id}/${name}`,
            name,
            children: [],
        }

        parent.children.push(node)
        stack.push(node)
    }

    return root
}

function hasAnyDescendant(node: DeliverableNode): boolean {
    return node.children.length > 0
}

export type ProjectInfo = {
    name: string
    path: string
    readmePath: string
    status: ProjectStatus
    readmeText?: string
    metadata?: ProjectMetadata
    treeSections?: TreeSection[]
}

type FolderSummary = {
    name: string
    files: number
    size: number
    topTypes: Array<{ ext: string; count: number }>
}

interface OverviewPageProps {
    sessionId: string
    deliverablesRoot: string
    currentPath?: string
    onOpenFiles: (projectPath: string) => void
    onClose?: () => void
}

function normalizePathJoin(base: string, next: string) {
    const b = base.endsWith('/') ? base.slice(0, -1) : base
    const n = next.startsWith('/') ? next.slice(1) : next
    return `${b}/${n}`
}

function formatBytes(bytes: number) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`
}

function extOf(fileName: string) {
    const idx = fileName.lastIndexOf('.')
    if (idx === -1) return 'none'
    return fileName.slice(idx + 1).toLowerCase() || 'none'
}

function parseMetadata(readmeText: string): ProjectMetadata {
    const out: ProjectMetadata = {}
    const lines = readmeText.split(/\r?\n/)
    for (const line of lines) {
        const m = line.match(/^\s*([A-Za-z0-9 _/-]+?)\s*:\s*(.+?)\s*$/)
        if (!m) continue
        const key = m[1].trim().toLowerCase()
        const value = m[2].trim()
        if (key === 'project id') out.projectId = value
        else if (key === 'project pi') out.projectPi = value
        else if (key === 'application') out.application = value
        else if (key === 'no of samples' || key === 'number of samples' || key === 'no. of samples') out.samples = value
    }
    return out
}

function parseTreeSections(readmeText: string): TreeSection[] {
    const lines = readmeText.split(/\r?\n/)
    const startIdx = lines.findIndex(l => l.trim() === '.')
    if (startIdx === -1) return []
    const treeLines = lines.slice(startIdx)

    const sections: TreeSection[] = []
    let current: TreeSection | null = { title: 'Root', lines: [] }

    for (const line of treeLines) {
        const topLevelMatch = line.match(/^(├──|└──)\s+(.+)$/)
        if (topLevelMatch) {
            const name = topLevelMatch[2].trim()
            const isFolder = !name.toLowerCase().endsWith('.txt') && !name.includes('.')
            if (isFolder) {
                if (current && current.lines.length > 0) sections.push(current)
                current = { title: name, lines: [line] }
                continue
            }
        }
        current?.lines.push(line)
    }

    if (current && current.lines.length > 0) sections.push(current)
    return sections
}

export const OverviewPage: React.FC<OverviewPageProps> = ({ sessionId, deliverablesRoot, currentPath, onOpenFiles, onClose }) => {
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [projects, setProjects] = useState<ProjectInfo[]>([])
    const [query, setQuery] = useState('')
    const debouncedQuery = useDebouncedValue(query, 200)
    const [selected, setSelected] = useState<ProjectInfo | null>(null)
    const [rootPath, setRootPath] = useState(deliverablesRoot)
    const [selectedSectionsOpen, setSelectedSectionsOpen] = useState<Record<string, boolean>>({})
    const [expandedNodeIdsBySection, setExpandedNodeIdsBySection] = useState<Record<string, Record<string, boolean>>>({})
    const [treeQuery, setTreeQuery] = useState('')
    const [folderSummaries, setFolderSummaries] = useState<FolderSummary[]>([])
    const [summariesLoading, setSummariesLoading] = useState(false)

    const summaryAbortRef = useRef<AbortController | null>(null)

    const detectDeliverablesRoot = useCallback(async () => {
        // If the caller provided currentPath from File Manager, do not probe random roots.
        // This avoids 500s on servers where '/' or '/Deliverables' is invalid for the session.
        if (currentPath) return rootPath

        const tryList = async (p: string) => {
            const r = await sftpApi.list(sessionId, p)
            const entries = (r.data?.files as SFTPFile[] | undefined) || []
            return entries
        }

        const tryListFirst = async (candidates: string[]) => {
            for (const p of candidates) {
                try {
                    const entries = await tryList(p)
                    return { path: p, entries }
                } catch {
                    // ignore
                }
            }
            return null
        }

        try {
            const entries = await tryList(rootPath)
            // If configured root exists but is empty, fall through to auto-detect.
            if (entries.length > 0) return rootPath
        } catch {
            // ignore
        }

        try {
            const rootListed = await tryListFirst(['/', '.', ''])
            if (!rootListed) return rootPath

            const entries = rootListed.entries

            // If user connected into a "project root" that already contains Readme.txt,
            // treat '/' as the effective root so the project shows up.
            const hasRootReadme = entries.some(e => !e.isDirectory && /^readme\.txt$/i.test(e.name))
            if (hasRootReadme) return rootListed.path

            // Fallback: look for a directory named like *deliverables* at the connection root
            const candidates = entries
                .filter(e => e.isDirectory)
                .filter(e => /deliverables/i.test(e.name))
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
            if (candidates.length > 0) return candidates[0].path
        } catch {
            // ignore
        }

        return rootPath
    }, [currentPath, rootPath, sessionId])

    const loadProjects = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const effectiveRoot = await detectDeliverablesRoot()
            if (effectiveRoot !== rootPath) setRootPath(effectiveRoot)

            let entries: SFTPFile[] = []
            try {
                const listRes = await sftpApi.list(sessionId, effectiveRoot)
                entries = (listRes.data?.files as SFTPFile[] | undefined) || []
            } catch {
                setProjects([])
                setError('Navigate to your Deliverables folder in File Manager, then open Projects to load Readme.txt.')
                return
            }
            const dirs = entries.filter(e => e.isDirectory)

            const queue = [...dirs]
            const results: ProjectInfo[] = []

            // If Readme exists directly inside deliverables root, treat that folder itself as a project
            const rootReadme = entries.find(e => !e.isDirectory && /^readme\.txt$/i.test(e.name))
            if (rootReadme) {
                const readmePath = normalizePathJoin(effectiveRoot, rootReadme.name)
                try {
                    const readmeRes = await sftpApi.preview(sessionId, readmePath)
                    const readmeText = typeof readmeRes.data === 'string' ? readmeRes.data : String(readmeRes.data)
                    results.push({
                        name: effectiveRoot.split('/').filter(Boolean).pop() || effectiveRoot,
                        path: effectiveRoot,
                        readmePath,
                        status: 'Live',
                        readmeText,
                        metadata: parseMetadata(readmeText),
                        treeSections: parseTreeSections(readmeText),
                    })
                } catch {
                    // If the root readme can't be read, fall back to scanning subfolders.
                }

                // If we successfully loaded a root project, do NOT scan subfolders.
                if (results.length > 0) {
                    setProjects(results)
                    return
                }
            }

            const workers = new Array(Math.min(4, queue.length)).fill(0).map(async () => {
                while (queue.length > 0) {
                    const dir = queue.shift()
                    if (!dir) return

                    const readmePath = normalizePathJoin(dir.path, 'Readme.txt')
                    try {
                        const readmeRes = await sftpApi.preview(sessionId, readmePath)
                        const readmeText = typeof readmeRes.data === 'string' ? readmeRes.data : String(readmeRes.data)
                        results.push({
                            name: dir.name,
                            path: dir.path,
                            readmePath,
                            status: 'Live',
                            readmeText,
                            metadata: parseMetadata(readmeText),
                            treeSections: parseTreeSections(readmeText),
                        })
                    } catch {
                        // Skip folders that don't have a readable Readme.txt
                    }
                }
            })
            await Promise.all(workers)

            results.sort((a, b) => {
                const ap = a.metadata?.projectId || a.name
                const bp = b.metadata?.projectId || b.name
                return ap.localeCompare(bp, undefined, { numeric: true, sensitivity: 'base' })
            })

            setProjects(results)
        } catch (e: unknown) {
            setProjects([])
            setError('Navigate to your Deliverables folder in File Manager, then open Projects to load Readme.txt.')
        } finally {
            setLoading(false)
        }
    }, [detectDeliverablesRoot, rootPath, sessionId])

    // Keep Projects/Overview rooted to the same folder context as File Manager.
    // When user navigates in File Manager, refresh the Projects view against that folder.
    useEffect(() => {
        if (!currentPath) return
        if (currentPath === rootPath) return
        setRootPath(currentPath)
        setSelected(null)
        setFolderSummaries([])
        setSelectedSectionsOpen({})
        setExpandedNodeIdsBySection({})
        setTreeQuery('')
    }, [currentPath, rootPath])

    useEffect(() => {
        void loadProjects()
        return () => {
            summaryAbortRef.current?.abort()
        }
    }, [loadProjects])

    const filtered = useMemo(() => {
        const q = debouncedQuery.trim().toLowerCase()
        if (!q) return projects
        return projects.filter(p => {
            const id = p.metadata?.projectId || ''
            const pi = p.metadata?.projectPi || ''
            const app = p.metadata?.application || ''
            return (
                p.name.toLowerCase().includes(q) ||
                id.toLowerCase().includes(q) ||
                pi.toLowerCase().includes(q) ||
                app.toLowerCase().includes(q)
            )
        })
    }, [projects, debouncedQuery])

    const openDetails = useCallback((p: ProjectInfo) => {
        setSelected(p)
        setFolderSummaries([])
        setSelectedSectionsOpen({})
        setExpandedNodeIdsBySection({})
        setTreeQuery('')
    }, [])

    const computeFolderSummaries = useCallback(async (p: ProjectInfo) => {
        setSummariesLoading(true)
        summaryAbortRef.current?.abort()
        const controller = new AbortController()
        summaryAbortRef.current = controller

        try {
            const res = await sftpApi.listRecursive(sessionId, p.path, { signal: controller.signal })
            const items = (res.data?.files as SFTPFile[] | undefined) || []
            const files = items.filter(i => !i.isDirectory)

            const map = new Map<string, { files: number; size: number; extCounts: Map<string, number> }>()
            for (const f of files) {
                const rel = f.path.startsWith(p.path) ? f.path.slice(p.path.length) : f.path
                const seg = rel.replace(/^\/+/, '').split('/')[0] || 'Root'
                const cur = map.get(seg) || { files: 0, size: 0, extCounts: new Map<string, number>() }
                cur.files += 1
                cur.size += f.size || 0
                const ext = extOf(f.name)
                cur.extCounts.set(ext, (cur.extCounts.get(ext) || 0) + 1)
                map.set(seg, cur)
            }

            const summaries: FolderSummary[] = [...map.entries()].map(([name, v]) => {
                const topTypes = [...v.extCounts.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5)
                    .map(([ext, count]) => ({ ext, count }))
                return { name, files: v.files, size: v.size, topTypes }
            })

            summaries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
            setFolderSummaries(summaries)
        } catch {
            // ignore
        } finally {
            setSummariesLoading(false)
        }
    }, [sessionId])

    const refreshSelectedReadme = useCallback(async () => {
        if (!selected) return
        try {
            const readmeRes = await sftpApi.preview(sessionId, selected.readmePath)
            const readmeText = typeof readmeRes.data === 'string' ? readmeRes.data : String(readmeRes.data)
            setSelected(prev => {
                if (!prev) return prev
                return {
                    ...prev,
                    readmeText,
                    metadata: parseMetadata(readmeText),
                    treeSections: parseTreeSections(readmeText),
                }
            })
        } catch {
            // ignore
        }
    }, [selected, sessionId])

    if (loading) {
        return <OverviewSkeleton rootPath={rootPath} onClose={onClose} />
    }

    if (error) {
        return (
            <div className="flex-1 flex flex-col overflow-hidden">
                <header className="bg-white border-b border-slate-200 px-4 sm:px-6 md:px-8 py-3 sm:py-0 sm:h-20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        {onClose && (
                            <button
                                onClick={onClose}
                                className="p-2 hover:bg-slate-100 rounded-lg transition-all"
                                aria-label="Back"
                            >
                                <ArrowLeft className="w-5 h-5 text-slate-600" aria-hidden="true" />
                            </button>
                        )}
                        <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                            <LayoutGrid className="w-5 h-5 text-blue-600" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-lg font-bold text-slate-900 truncate">Projects</h2>
                            <p className="text-xs text-slate-500 truncate">Root: {rootPath}</p>
                        </div>
                    </div>

                    <button
                        onClick={() => void loadProjects()}
                        className="btn-secondary px-3 py-2 text-sm font-semibold"
                        aria-label="Refresh projects"
                    >
                        <RefreshCw className="w-4 h-4" aria-hidden="true" />
                        <span className="hidden sm:inline">Refresh</span>
                    </button>
                </header>

                <div className="flex-1 overflow-y-auto px-4 sm:px-6 md:px-8 py-10 custom-scrollbar">
                    <div className="empty-state">
                        <AlertCircle className="empty-state-icon" aria-hidden="true" />
                        <div className="empty-state-title">Unable to load projects</div>
                        <div className="empty-state-description">{error}</div>
                        <div className="mt-6 flex flex-col sm:flex-row gap-3">
                            <button
                                type="button"
                                onClick={() => onOpenFiles(rootPath)}
                                className="btn-primary px-4 py-2 text-sm"
                            >
                                <FolderOpen className="w-4 h-4" aria-hidden="true" />
                                <span>Open File Manager</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => void loadProjects()}
                                className="btn-secondary px-4 py-2 text-sm"
                            >
                                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                                <span>Retry</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    if (selected) {
        const md = selected.metadata || {}
        const sections = selected.treeSections || []

        return (
            <div className="flex-1 flex flex-col overflow-hidden">
                <header className="bg-white border-b border-slate-200 px-4 sm:px-6 md:px-8 py-3 sm:py-0 sm:h-20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <button
                            onClick={() => {
                                setSelected(null)
                                setFolderSummaries([])
                                setSelectedSectionsOpen({})
                                setExpandedNodeIdsBySection({})
                                setTreeQuery('')
                            }}
                            className="p-2 hover:bg-slate-100 rounded-lg transition-all"
                            aria-label="Back to projects"
                        >
                            <ArrowLeft className="w-5 h-5 text-slate-600" aria-hidden="true" />
                        </button>
                        <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                            <FileText className="w-5 h-5 text-blue-600" aria-hidden="true" />
                        </div>
                        <div className="min-w-0">
                            <h2 className="text-lg font-bold text-slate-900 truncate">Project Details</h2>
                            <p className="text-xs text-slate-500 truncate">Root: {rootPath} • {md.projectId ? `Project ${md.projectId}` : selected.name}</p>
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            type="button"
                            onClick={() => void refreshSelectedReadme()}
                            className="btn-secondary px-3 py-2 text-sm font-semibold"
                            aria-label="Refresh Readme"
                        >
                            <RefreshCw className="w-4 h-4" aria-hidden="true" />
                            <span className="hidden sm:inline">Refresh</span>
                        </button>
                        <a
                            href={sftpApi.getDownloadUrl(sessionId, selected.readmePath)}
                            className="btn-secondary px-3 py-2 text-sm font-semibold"
                        >
                            <Download className="w-4 h-4" aria-hidden="true" />
                            <span className="hidden sm:inline">Download Readme</span>
                            <span className="sm:hidden">Readme</span>
                        </a>
                        <button
                            onClick={() => onOpenFiles(selected.path)}
                            className="btn-primary px-3 py-2 text-sm font-semibold"
                        >
                            <FolderOpen className="w-4 h-4" aria-hidden="true" />
                            <span className="hidden sm:inline">Open Files</span>
                            <span className="sm:hidden">Files</span>
                        </button>
                    </div>
                </header>

                <div className="flex-1 overflow-y-auto px-4 sm:px-6 md:px-8 py-6 space-y-6 custom-scrollbar">
                    <section className="card p-5">
                        <h3 className="text-sm font-bold text-slate-900 mb-3">Metadata</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-sm">
                            <div>
                                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Project ID</p>
                                <p className="text-slate-700 font-medium">{md.projectId || '--'}</p>
                            </div>
                            <div>
                                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">PI</p>
                                <p className="text-slate-700 font-medium truncate" title={md.projectPi}>{md.projectPi || '--'}</p>
                            </div>
                            <div>
                                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Application</p>
                                <p className="text-slate-700 font-medium">{md.application || '--'}</p>
                            </div>
                            <div>
                                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">No. of Samples</p>
                                <p className="text-slate-700 font-medium">{md.samples || '--'}</p>
                            </div>
                        </div>
                    </section>

                    <section className="card p-5">
                        <div className="flex items-center justify-between gap-3 mb-3">
                            <h3 className="text-sm font-bold text-slate-900">Deliverables Tree</h3>
                            {!selected.readmeText && <span className="text-xs text-slate-500">Readme not loaded</span>}
                        </div>

                        <div className="mb-3">
                            <div className="relative max-w-md">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden="true" />
                                <input
                                    value={treeQuery}
                                    onChange={(e) => setTreeQuery(e.target.value)}
                                    className="input-field pl-9 w-full"
                                    placeholder="Search deliverables…"
                                />
                            </div>
                        </div>

                        {sections.length === 0 ? (
                            <pre className="text-xs bg-slate-50 text-slate-800 border border-slate-200 rounded-xl p-4 overflow-auto font-mono">{selected.readmeText || 'No tree found in Readme.txt'}</pre>
                        ) : (
                            <div className="space-y-3">
                                {sections.map(sec => {
                                    const open = selectedSectionsOpen[sec.title] ?? (sec.title === 'Root')
                                    const lineCount = sec.lines.length

                                    const sectionTree = buildDeliverableTree(sec.title, sec.lines)
                                    const filteredTree = filterTree(sectionTree, treeQuery.trim().toLowerCase())
                                    const expandedIds = expandedNodeIdsBySection[sec.title] || { [sectionTree.id]: true }

                                    const toggleNode = (nodeId: string) => {
                                        setExpandedNodeIdsBySection(prev => ({
                                            ...prev,
                                            [sec.title]: {
                                                ...((prev[sec.title] as Record<string, boolean> | undefined) || {}),
                                                [nodeId]: !(((prev[sec.title] as Record<string, boolean> | undefined) || {})[nodeId] ?? false),
                                            },
                                        }))
                                    }

                                    const renderNode = (node: DeliverableNode, depth: number) => {
                                        const isDir = hasAnyDescendant(node)
                                        const isExpanded = (expandedIds[node.id] ?? (depth === 0))
                                        const showChildren = isDir && isExpanded

                                        const leftPad = 12 + depth * 18
                                        return (
                                            <div key={node.id}>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        if (isDir) toggleNode(node.id)
                                                    }}
                                                    className="w-full flex items-center gap-2 py-1.5 pr-3 hover:bg-slate-100 rounded-md text-left"
                                                    style={{ paddingLeft: leftPad }}
                                                >
                                                    {isDir ? (
                                                        isExpanded ? (
                                                            <ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0" aria-hidden="true" />
                                                        ) : (
                                                            <ChevronRight className="w-4 h-4 text-slate-500 flex-shrink-0" aria-hidden="true" />
                                                        )
                                                    ) : (
                                                        <span className="w-4 h-4 flex-shrink-0" />
                                                    )}

                                                    {isDir ? (
                                                        <Folder className="w-4 h-4 text-blue-600 flex-shrink-0" aria-hidden="true" />
                                                    ) : (
                                                        <File className="w-4 h-4 text-slate-500 flex-shrink-0" aria-hidden="true" />
                                                    )}
                                                    <span className="text-sm text-slate-800 truncate">{node.name}</span>
                                                </button>

                                                {showChildren && (
                                                    <div>
                                                        {node.children.map(child => renderNode(child, depth + 1))}
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    }

                                    return (
                                        <div key={sec.title} className="border border-slate-200 rounded-xl overflow-hidden">
                                            <button
                                                type="button"
                                                className="w-full px-4 py-3 flex items-center justify-between text-left bg-slate-50 hover:bg-slate-100"
                                                onClick={() => setSelectedSectionsOpen(prev => ({ ...prev, [sec.title]: !open }))}
                                            >
                                                <span className="flex items-center gap-2 min-w-0">
                                                    {open ? (
                                                        <ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0" aria-hidden="true" />
                                                    ) : (
                                                        <ChevronRight className="w-4 h-4 text-slate-500 flex-shrink-0" aria-hidden="true" />
                                                    )}
                                                    <span className="text-sm font-semibold text-slate-800 truncate">{sec.title}</span>
                                                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-600 flex-shrink-0">
                                                        {lineCount}
                                                    </span>
                                                </span>
                                                <span className="text-xs text-slate-500">{open ? 'Collapse' : 'Expand'}</span>
                                            </button>
                                            {open && (
                                                <div className="bg-white border-t border-slate-200">
                                                    <div className="max-h-80 overflow-auto custom-scrollbar py-2">
                                                        {filteredTree ? (
                                                            filteredTree.children.length > 0 ? (
                                                                filteredTree.children.map(child => renderNode(child, 0))
                                                            ) : (
                                                                <p className="px-4 py-3 text-sm text-slate-500">No matches.</p>
                                                            )
                                                        ) : (
                                                            <p className="px-4 py-3 text-sm text-slate-500">No matches.</p>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </section>

                    <section className="card p-5">
                        <div className="flex items-center justify-between gap-3 mb-3">
                            <h3 className="text-sm font-bold text-slate-900">Folder Summaries</h3>
                            <button
                                type="button"
                                onClick={() => computeFolderSummaries(selected)}
                                disabled={summariesLoading}
                                className="btn-secondary px-3 py-2 text-sm font-semibold disabled:opacity-60"
                            >
                                {summariesLoading ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                                        <span>Computing…</span>
                                    </>
                                ) : (
                                    <span>Compute</span>
                                )}
                            </button>
                        </div>

                        {folderSummaries.length === 0 ? (
                            <p className="text-sm text-slate-500">Click “Compute” to calculate file counts, size, and top file types.</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="min-w-full text-sm">
                                    <thead>
                                        <tr className="text-left text-xs text-slate-500">
                                            <th className="py-2 pr-4">Folder</th>
                                            <th className="py-2 pr-4">Files</th>
                                            <th className="py-2 pr-4">Total Size</th>
                                            <th className="py-2 pr-4">Top Types</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {folderSummaries.map(s => (
                                            <tr key={s.name} className="border-t border-slate-100">
                                                <td className="py-2 pr-4 font-medium text-slate-800">{s.name}</td>
                                                <td className="py-2 pr-4 text-slate-700">{s.files}</td>
                                                <td className="py-2 pr-4 text-slate-700">{formatBytes(s.size)}</td>
                                                <td className="py-2 pr-4 text-slate-600">
                                                    {s.topTypes.map(t => `${t.ext}(${t.count})`).join(', ') || '--'}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </section>
                </div>
            </div>
        )
    }

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            <header className="bg-white border-b border-slate-200 px-4 sm:px-6 md:px-8 py-3 sm:py-0 sm:h-20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                    {onClose && (
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-slate-100 rounded-lg transition-all"
                            aria-label="Back"
                        >
                            <ArrowLeft className="w-5 h-5 text-slate-600" aria-hidden="true" />
                        </button>
                    )}
                    <div className="w-10 h-10 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                        <LayoutGrid className="w-5 h-5 text-blue-600" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                        <h2 className="text-lg font-bold text-slate-900 truncate">Projects</h2>
                        <p className="text-xs text-slate-500 truncate">Root: {rootPath}</p>
                    </div>
                </div>

                <button
                    onClick={() => void loadProjects()}
                    className="btn-secondary px-3 py-2 text-sm font-semibold"
                    aria-label="Refresh projects"
                >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
                    <span className="hidden sm:inline">Refresh</span>
                </button>
            </header>

            <div className="px-4 sm:px-6 md:px-8 py-4 bg-white border-b border-slate-200">
                <div className="relative max-w-xl">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden="true" />
                    <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        className="input-field pl-9 w-full"
                        placeholder="Search by Project ID / PI / Application"
                        aria-label="Search projects"
                    />
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 sm:px-6 md:px-8 py-6 custom-scrollbar">
                {filtered.length === 0 ? (
                    <div className="empty-state">
                        <Folder className="empty-state-icon" aria-hidden="true" />
                        <div className="empty-state-title">No projects found</div>
                        <div className="empty-state-description">
                            Ensure each project folder contains a readable <span className="font-semibold">Readme.txt</span>. If you're not in your Deliverables folder,
                            open File Manager and navigate there.
                        </div>
                        <div className="mt-6 flex flex-col sm:flex-row gap-3">
                            <button
                                type="button"
                                onClick={() => onOpenFiles(rootPath)}
                                className="btn-primary px-4 py-2 text-sm"
                            >
                                <FolderOpen className="w-4 h-4" aria-hidden="true" />
                                <span>Open File Manager</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => void loadProjects()}
                                className="btn-secondary px-4 py-2 text-sm"
                            >
                                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                                <span>Refresh</span>
                            </button>
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="sm:hidden space-y-3">
                            {filtered.map(p => (
                                <div key={p.path} className="card p-4">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="text-sm font-bold text-slate-900 truncate" title={String(p.metadata?.projectId || p.name)}>
                                                {p.metadata?.projectId || p.name}
                                            </div>
                                            <div className="mt-1 text-xs text-slate-600 space-y-1">
                                                <div className="truncate" title={String(p.metadata?.projectPi || '--')}>
                                                    <span className="font-semibold text-slate-500">PI:</span> {p.metadata?.projectPi || '--'}
                                                </div>
                                                <div className="truncate" title={String(p.metadata?.application || '--')}>
                                                    <span className="font-semibold text-slate-500">App:</span> {p.metadata?.application || '--'}
                                                </div>
                                                <div>
                                                    <span className="font-semibold text-slate-500">Samples:</span> {p.metadata?.samples || '--'}
                                                </div>
                                            </div>
                                        </div>
                                        <span className="text-xs font-semibold px-2 py-1 rounded-full bg-slate-50 border border-slate-200 text-slate-700 flex-shrink-0">
                                            {p.status}
                                        </span>
                                    </div>

                                    <div className="mt-3 flex flex-wrap gap-2">
                                        <button onClick={() => onOpenFiles(p.path)} className="btn-primary px-3 py-2 text-sm font-semibold">
                                            <FolderOpen className="w-4 h-4" aria-hidden="true" />
                                            <span>Files</span>
                                        </button>
                                        <button onClick={() => openDetails(p)} className="btn-secondary px-3 py-2 text-sm font-semibold">
                                            <FileText className="w-4 h-4" aria-hidden="true" />
                                            <span>Summary</span>
                                        </button>
                                        <a href={sftpApi.getDownloadUrl(sessionId, p.readmePath)} className="btn-secondary px-3 py-2 text-sm font-semibold">
                                            <Download className="w-4 h-4" aria-hidden="true" />
                                            <span>Readme</span>
                                        </a>
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="hidden sm:block overflow-x-auto">
                            <table className="min-w-full text-sm">
                                <thead>
                                    <tr className="text-left text-xs text-slate-500">
                                        <th className="py-2 pr-4">Project ID</th>
                                        <th className="py-2 pr-4">PI</th>
                                        <th className="py-2 pr-4">Application</th>
                                        <th className="py-2 pr-4">Samples</th>
                                        <th className="py-2 pr-4">Status</th>
                                        <th className="py-2 pr-4">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filtered.map(p => (
                                        <tr key={p.path} className="border-t border-slate-100">
                                            <td className="py-3 pr-4 font-semibold text-slate-900">{p.metadata?.projectId || p.name}</td>
                                            <td className="py-3 pr-4 text-slate-700">{p.metadata?.projectPi || '--'}</td>
                                            <td className="py-3 pr-4 text-slate-700">{p.metadata?.application || '--'}</td>
                                            <td className="py-3 pr-4 text-slate-700">{p.metadata?.samples || '--'}</td>
                                            <td className="py-3 pr-4 text-slate-700">{p.status}</td>
                                            <td className="py-3 pr-4">
                                                <div className="flex flex-wrap items-center gap-2">
                                                    <button
                                                        onClick={() => onOpenFiles(p.path)}
                                                        className="btn-primary px-3 py-2 text-sm font-semibold"
                                                    >
                                                        <FolderOpen className="w-4 h-4" aria-hidden="true" />
                                                        <span>Open Files</span>
                                                    </button>
                                                    <button
                                                        onClick={() => openDetails(p)}
                                                        className="btn-secondary px-3 py-2 text-sm font-semibold"
                                                    >
                                                        <FileText className="w-4 h-4" aria-hidden="true" />
                                                        <span>View Summary</span>
                                                    </button>
                                                    <a
                                                        href={sftpApi.getDownloadUrl(sessionId, p.readmePath)}
                                                        className="btn-secondary px-3 py-2 text-sm font-semibold"
                                                    >
                                                        <Download className="w-4 h-4" aria-hidden="true" />
                                                        <span>Readme</span>
                                                    </a>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </>
                )}
            </div>
        </div>
    )
}

export default OverviewPage
