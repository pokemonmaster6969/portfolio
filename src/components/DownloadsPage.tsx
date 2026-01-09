import React from 'react'
import { Download, ArrowLeft, X, Pause, Play, CheckCircle2, FileText } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { TransferTask } from './TransferManager'

interface DownloadsPageProps {
    tasks: TransferTask[]
    onCancel: (id: string) => void
    onCancelAll: () => void
    onClearCompleted: () => void
    onPause: (id: string) => void
    onResume: (id: string) => void
    onClose: () => void
}

export const DownloadsPage: React.FC<DownloadsPageProps> = ({
    tasks,
    onCancel,
    onCancelAll,
    onClearCompleted,
    onPause,
    onResume,
    onClose,
}) => {

    const [filter, setFilter] = React.useState<'all' | 'active' | 'completed' | 'errors'>('all')
    const [selectedId, setSelectedId] = React.useState<string | null>(null)

    const selectedTask = React.useMemo(() => {
        if (!selectedId) return null
        return tasks.find(t => t.id === selectedId) || null
    }, [tasks, selectedId])

    const activeCount = React.useMemo(() => {
        return tasks.filter(t => t.status === 'downloading' || t.status === 'ready' || t.status === 'paused').length
    }, [tasks])

    const completedCount = React.useMemo(() => {
        return tasks.filter(t => t.status === 'completed').length
    }, [tasks])

    const errorCount = React.useMemo(() => {
        return tasks.filter(t => t.status === 'error').length
    }, [tasks])

    const filteredTasks = React.useMemo(() => {
        if (filter === 'active') return tasks.filter(t => t.status === 'downloading' || t.status === 'ready' || t.status === 'paused')
        if (filter === 'completed') return tasks.filter(t => t.status === 'completed')
        if (filter === 'errors') return tasks.filter(t => t.status === 'error')
        return tasks
    }, [tasks, filter])

    const formatBytes = React.useCallback((bytes: number) => {
        if (!bytes) return '--'
        const k = 1024
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
    }, [])

    const formatSpeed = React.useCallback((bytesPerSec: number) => {
        if (!bytesPerSec) return '--'
        return `${formatBytes(bytesPerSec)}/s`
    }, [formatBytes])

    const eta = React.useMemo(() => {
        if (!selectedTask) return '--:--'
        if (selectedTask.status !== 'downloading' || !selectedTask.speed) return '--:--'
        const remaining = Math.max(0, selectedTask.size - selectedTask.bytesDownloaded)
        const seconds = Math.floor(remaining / selectedTask.speed)
        const m = Math.floor(seconds / 60)
        const s = seconds % 60
        return `${m}:${s.toString().padStart(2, '0')}`
    }, [selectedTask])

    return (
        <div className="min-h-screen bg-slate-50">
            <div className="w-full p-4 sm:p-6 lg:p-8">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
                    <div className="flex items-center gap-3 min-w-0">
                        <button onClick={onClose} className="p-2 rounded hover:bg-slate-100">
                            <ArrowLeft className="w-5 h-5 text-slate-600" />
                        </button>
                        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-3 truncate"><Download className="w-5 h-5" /> Downloads</h2>
                    </div>
                    <div className="flex items-center gap-3 sm:justify-end">
                        <p className="text-sm text-slate-500 hidden lg:block">Manage active and completed downloads</p>
                        <button
                            onClick={onClearCompleted}
                            disabled={completedCount === 0}
                            className="btn-secondary px-3 sm:px-4 py-2 text-sm"
                            aria-label="Clear completed downloads"
                        >
                            <CheckCircle2 className="w-4 h-4" />
                            <span>Clear completed</span>
                        </button>
                        <button
                            onClick={onCancelAll}
                            disabled={tasks.length === 0}
                            className="btn-danger px-3 sm:px-4 py-2 text-sm"
                            aria-label="Cancel all downloads"
                        >
                            <X className="w-4 h-4" />
                            <span>Cancel all</span>
                        </button>
                    </div>
                </div>

                <div className="card p-3 mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                        <button
                            type="button"
                            onClick={() => setFilter('all')}
                            className={filter === 'all' ? 'btn-primary px-3 py-2 text-xs' : 'btn-secondary px-3 py-2 text-xs'}
                            aria-label="Show all downloads"
                        >
                            All ({tasks.length})
                        </button>
                        <button
                            type="button"
                            onClick={() => setFilter('active')}
                            className={filter === 'active' ? 'btn-primary px-3 py-2 text-xs' : 'btn-secondary px-3 py-2 text-xs'}
                            aria-label="Show active downloads"
                        >
                            Active ({activeCount})
                        </button>
                        <button
                            type="button"
                            onClick={() => setFilter('completed')}
                            className={filter === 'completed' ? 'btn-primary px-3 py-2 text-xs' : 'btn-secondary px-3 py-2 text-xs'}
                            aria-label="Show completed downloads"
                        >
                            Completed ({completedCount})
                        </button>
                        <button
                            type="button"
                            onClick={() => setFilter('errors')}
                            className={filter === 'errors' ? 'btn-primary px-3 py-2 text-xs' : 'btn-secondary px-3 py-2 text-xs'}
                            aria-label="Show failed downloads"
                        >
                            Errors ({errorCount})
                        </button>
                    </div>
                    <div className="text-xs text-slate-500">Click a row for details</div>
                </div>

                <div className="space-y-4">
                    <AnimatePresence>
                        {filteredTasks.length === 0 && (
                            <div className="card p-6 text-center text-sm text-slate-500">No active downloads</div>
                        )}

                        {filteredTasks.map(task => (
                            <motion.button
                                type="button"
                                key={task.id}
                                layout
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0 }}
                                className="card p-4 flex items-start gap-4 w-full text-left"
                                onClick={() => setSelectedId(task.id)}
                                aria-label={`Open details for ${task.name}`}
                            >
                                <div className={`flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center ${
                                    task.status === 'completed' ? 'bg-green-100 text-green-600' :
                                    task.status === 'error' ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'
                                }`}>
                                    {task.status === 'completed' ? <CheckCircle2 className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                                </div>

                                <div className="flex-1">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-sm font-semibold text-slate-900 truncate">{task.name}</h3>
                                        <div className="text-xs text-slate-500">{task.status}</div>
                                    </div>

                                    <div className="mt-2">
                                        <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                                            <motion.div className={`h-full ${task.status === 'completed' ? 'bg-green-500' : task.status === 'paused' ? 'bg-amber-500' : task.status === 'error' ? 'bg-red-500' : 'bg-blue-500'}`} initial={{ width: 0 }} animate={{ width: `${task.progress}%` }} />
                                        </div>
                                        <div className="flex items-center justify-between text-xs text-slate-500 mt-2">
                                            <span>{Math.round(task.progress)}%</span>
                                            <span>{task.bytesDownloaded ? `${(task.bytesDownloaded/1024/1024).toFixed(2)} MB` : '--'}</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="flex-shrink-0 flex items-center gap-1 sm:gap-2">
                                    {task.status === 'downloading' && (
                                        <button type="button" onClick={(e) => { e.stopPropagation(); onPause(task.id) }} className="p-2 hover:bg-slate-100 rounded" aria-label={`Pause ${task.name}`}>
                                            <Pause className="w-4 h-4 text-slate-600" />
                                        </button>
                                    )}
                                    {task.status === 'paused' && (
                                        <button type="button" onClick={(e) => { e.stopPropagation(); onResume(task.id) }} className="p-2 hover:bg-slate-100 rounded" aria-label={`Resume ${task.name}`}>
                                            <Play className="w-4 h-4 text-slate-600" />
                                        </button>
                                    )}
                                    <button type="button" onClick={(e) => { e.stopPropagation(); onCancel(task.id) }} className="p-2 hover:bg-red-50 rounded" aria-label={`Remove ${task.name}`}>
                                        <X className="w-4 h-4 text-red-500" />
                                    </button>
                                </div>
                            </motion.button>
                        ))}
                    </AnimatePresence>
                </div>
            </div>

            <AnimatePresence>
                {selectedTask && (
                    <motion.div
                        className="fixed inset-0 z-50"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        role="dialog"
                        aria-modal="true"
                        aria-label="Download details"
                    >
                        <button
                            type="button"
                            className="absolute inset-0 bg-black/40"
                            aria-label="Close details"
                            onClick={() => setSelectedId(null)}
                        />

                        <motion.aside
                            initial={{ x: 420, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            exit={{ x: 420, opacity: 0 }}
                            transition={{ type: 'tween', duration: 0.18 }}
                            className="absolute inset-y-0 right-0 w-full sm:w-[28rem] bg-white border-l border-slate-200 flex flex-col overflow-hidden"
                        >
                            <div className="p-5 border-b border-slate-200 flex items-start justify-between gap-4">
                                <div className="min-w-0">
                                    <h3 className="font-semibold text-slate-900 truncate" title={selectedTask.name}>{selectedTask.name}</h3>
                                    <p className="text-xs text-slate-500 mt-1 truncate" title={selectedTask.url}>{selectedTask.url}</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setSelectedId(null)}
                                    className="p-2 hover:bg-slate-100 rounded-lg text-slate-500"
                                    aria-label="Close details"
                                >
                                    <X className="w-5 h-5" aria-hidden="true" />
                                </button>
                            </div>

                            <div className="flex-1 p-5 bg-slate-50 overflow-auto custom-scrollbar">
                                <div className="card p-4">
                                    <div className="flex items-center justify-between gap-4">
                                        <div className="text-sm font-semibold text-slate-900">Status</div>
                                        <div className="text-sm text-slate-700 font-mono">{selectedTask.status}</div>
                                    </div>
                                    {selectedTask.status === 'error' && selectedTask.errorMessage && (
                                        <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                                            {selectedTask.errorMessage}
                                        </div>
                                    )}
                                    <div className="mt-4">
                                        <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full ${selectedTask.status === 'completed' ? 'bg-green-500' : selectedTask.status === 'paused' ? 'bg-amber-500' : selectedTask.status === 'error' ? 'bg-red-500' : 'bg-blue-500'}`}
                                                style={{ width: `${selectedTask.progress}%` }}
                                            />
                                        </div>
                                        <div className="flex items-center justify-between text-xs text-slate-500 mt-2">
                                            <span>{Math.round(selectedTask.progress)}%</span>
                                            <span>{formatBytes(selectedTask.bytesDownloaded)} / {formatBytes(selectedTask.size)}</span>
                                        </div>
                                    </div>

                                    <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                                        <div className="bg-white rounded-lg border border-slate-200 p-3">
                                            <div className="text-slate-500">Speed</div>
                                            <div className="mt-1 font-mono text-slate-900">{formatSpeed(selectedTask.speed)}</div>
                                        </div>
                                        <div className="bg-white rounded-lg border border-slate-200 p-3">
                                            <div className="text-slate-500">ETA</div>
                                            <div className="mt-1 font-mono text-slate-900">{eta}</div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="p-5 border-t border-slate-200 flex items-center gap-2">
                                {selectedTask.status === 'downloading' && (
                                    <button type="button" onClick={() => onPause(selectedTask.id)} className="btn-secondary px-4 py-2 text-sm" aria-label="Pause download">
                                        <Pause className="w-4 h-4" />
                                        Pause
                                    </button>
                                )}
                                {selectedTask.status === 'paused' && (
                                    <button type="button" onClick={() => onResume(selectedTask.id)} className="btn-secondary px-4 py-2 text-sm" aria-label="Resume download">
                                        <Play className="w-4 h-4" />
                                        Resume
                                    </button>
                                )}
                                <button type="button" onClick={() => onCancel(selectedTask.id)} className="btn-danger ml-auto px-4 py-2 text-sm" aria-label="Remove download">
                                    <X className="w-4 h-4" />
                                    Remove
                                </button>
                            </div>
                        </motion.aside>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}
