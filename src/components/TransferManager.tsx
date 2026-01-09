import React, { useState, useEffect, useMemo, useRef } from 'react'
import {
    Download,
    X,
    CheckCircle2,
    FileText,
    ChevronDown,
    ChevronUp
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

export interface TransferTask {
    id: string
    queueId?: string // Link to the server-side batch/queue ID
    name: string
    url: string
    size: number
    progress: number
    status: 'downloading' | 'paused' | 'completed' | 'error' | 'canceled' | 'ready'
    startTime: number
    bytesDownloaded: number
    speed: number
    browserStarted?: boolean // Tracking flag for browser-level download
    errorMessage?: string
}

interface TransferManagerProps {
    tasks: TransferTask[]
    onCancel: (id: string) => void
    onTaskUpdate: (id: string, updates: Partial<TransferTask>) => void
    isOpen: boolean
    onToggle: () => void
}

export const TransferManager: React.FC<TransferManagerProps> = ({
    tasks,
    onCancel,
    onTaskUpdate,
    isOpen,
    onToggle
}) => {
    const [isMinimized, setIsMinimized] = useState(false)

    const tasksRef = useRef<TransferTask[]>(tasks)
    const inFlightTaskIdRef = useRef<string | null>(null)
    const abortControllerRef = useRef<AbortController | null>(null)

    useEffect(() => {
        tasksRef.current = tasks
    }, [tasks])

    useEffect(() => {
        return () => {
            abortControllerRef.current?.abort()
        }
    }, [])

    const taskStateSignature = useMemo(() => {
        return tasks.map(t => `${t.id}:${t.status}`).join('|')
    }, [tasks])

    useEffect(() => {
        if (inFlightTaskIdRef.current) {
            return
        }

        const currentTasks = tasksRef.current
        const activeTask = currentTasks.find(t => t.status === 'downloading')
        if (activeTask) {
            inFlightTaskIdRef.current = activeTask.id
            return
        }

        const nextTask = currentTasks.find(t => t.status === 'ready')
        if (!nextTask) {
            return
        }

        const controller = new AbortController()
        abortControllerRef.current = controller
        inFlightTaskIdRef.current = nextTask.id

        ;(async () => {
            const startTime = Date.now()
            onTaskUpdate(nextTask.id, { status: 'downloading', startTime })

            try {
                const response = await fetch(nextTask.url, { signal: controller.signal })
                if (!response.ok) throw new Error('Download failed')
                if (!response.body) throw new Error('Response body is null')

                const reader = response.body.getReader()
                const contentLength = +(response.headers.get('Content-Length') || 0)
                let receivedLength = 0
                const chunks: ArrayBuffer[] = []

                while (true) {
                    const stillExists = tasksRef.current.some(t => t.id === nextTask.id)
                    if (!stillExists) {
                        controller.abort()
                        break
                    }

                    const { done, value } = await reader.read()
                    if (done) break
                    if (!value) continue

                    chunks.push(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength))
                    receivedLength += value.byteLength

                    const progress = contentLength > 0 ? (receivedLength / contentLength) * 100 : 0
                    const speed = receivedLength / ((Date.now() - startTime) / 1000)
                    onTaskUpdate(nextTask.id, { progress, bytesDownloaded: receivedLength, speed })
                }

                if (controller.signal.aborted) {
                    // If user removed the task mid-download, mark as canceled.
                    const stillExists = tasksRef.current.some(t => t.id === nextTask.id)
                    if (stillExists) {
                        onTaskUpdate(nextTask.id, { status: 'canceled' })
                    }
                    return
                }

                const blob = new Blob(chunks)
                const url = window.URL.createObjectURL(blob)
                triggerFileSave(url, nextTask.name)
                onTaskUpdate(nextTask.id, { status: 'completed', progress: 100 })
            } catch (err: unknown) {
                if (!controller.signal.aborted) {
                    const msg = typeof err === 'object' && err !== null && 'message' in err
                        ? String((err as { message?: unknown }).message || 'Download failed')
                        : 'Download failed'
                    onTaskUpdate(nextTask.id, { status: 'error', errorMessage: msg })
                }
            } finally {
                if (inFlightTaskIdRef.current === nextTask.id) {
                    inFlightTaskIdRef.current = null
                }
                if (abortControllerRef.current === controller) {
                    abortControllerRef.current = null
                }
            }
        })()
    }, [taskStateSignature, onTaskUpdate])

    // Helper to force the browser to trigger the 'Save As' / Download action
    const triggerFileSave = (url: string, fileName: string) => {
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', fileName);
        document.body.appendChild(link);
        link.click();
        link.remove();
    };

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 B'
        const k = 1024
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
        const i = Math.floor(Math.log(bytes) / Math.log(k))
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
    }

    const calculateETA = (task: TransferTask) => {
        if (task.status !== 'downloading' || task.speed === 0) return '--:--'
        const remaining = task.size - task.bytesDownloaded
        const seconds = Math.floor(remaining / task.speed)
        const m = Math.floor(seconds / 60)
        const s = seconds % 60
        return `${m}:${s.toString().padStart(2, '0')}`
    }

    if (tasks.length === 0) return null

    return (
        <motion.div
            initial={{ y: 400 }}
            animate={{ y: isOpen ? 0 : 400 }}
            className="fixed bottom-0 right-8 z-50 pointer-events-auto"
        >
            <div className="w-96 bg-white rounded-t-2xl border border-slate-200 border-b-0 shadow-2xl overflow-hidden flex flex-col">
                {/* Header */}
                <header
                    className="h-14 bg-gradient-to-r from-blue-600 to-blue-700 text-white px-5 flex items-center justify-between cursor-pointer"
                    onClick={() => setIsMinimized(!isMinimized)}
                >
                    <div className="flex items-center gap-3">
                        <Download className="w-5 h-5" />
                        <span className="font-semibold text-sm">Downloads ({tasks.filter(t => t.status === 'downloading').length})</span>
                    </div>
                    <div className="flex items-center gap-2">
                        {isMinimized ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        <button onClick={(e) => { e.stopPropagation(); onToggle() }} className="p-1 hover:bg-white/10 rounded">
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </header>

                {/* Task List */}
                {!isMinimized && (
                    <div className="max-h-80 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                        <AnimatePresence>
                            {tasks.map(task => (
                                <motion.div
                                    key={task.id}
                                    layout
                                    initial={{ opacity: 0, x: 20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    className="bg-slate-50 border border-slate-200 rounded-xl p-3"
                                >
                                    <div className="flex items-start gap-3 mb-2">
                                        <div className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
                                            task.status === 'completed' ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'
                                        }`}>
                                            {task.status === 'completed' ? <CheckCircle2 className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <h4 className="text-sm font-semibold text-slate-900 truncate">{task.name}</h4>
                                            <p className="text-xs text-slate-500 mt-0.5">
                                                {formatBytes(task.bytesDownloaded)} / {formatBytes(task.size)}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <button onClick={() => onCancel(task.id)} className="p-1 hover:bg-red-50 rounded">
                                                <X className="w-3 h-3 text-red-500" />
                                            </button>
                                        </div>
                                    </div>

                                    <div className="space-y-1.5">
                                        <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                            <motion.div
                                                className={`h-full ${task.status === 'completed' ? 'bg-green-500' : 'bg-blue-500'}`}
                                                initial={{ width: 0 }}
                                                animate={{ width: `${task.progress}%` }}
                                            />
                                        </div>
                                        {task.status === 'downloading' && (
                                            <div className="flex items-center justify-between text-xs text-slate-500">
                                                <span>{task.progress}%</span>
                                                <span>{formatBytes(task.speed)}/s</span>
                                                <span>{calculateETA(task)}</span>
                                            </div>
                                        )}
                                    </div>
                                </motion.div>
                            ))}
                        </AnimatePresence>
                    </div>
                )}
            </div>
        </motion.div>
    )
}