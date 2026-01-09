import React, { useState, useEffect } from 'react'
import { Server, User, Lock as LockIcon, ArrowRight, Loader2, CheckCircle2 } from 'lucide-react'
import { sftpApi } from '../api/sftp'
import type { SessionInfo } from '../types'
import { useSessionError } from '../hooks/useSessionError'
import unigenomeLogo from '../assets/unigenome.png'

interface FormData {
    server: string
    port: number
    username: string
    password: string
    path: string
}

interface LoginPageProps {
    onLogin: (session: SessionInfo) => void
    initialPath?: string
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLogin, initialPath }) => {
    const [formData, setFormData] = useState<FormData>({
        server: '',
        port: 22,
        username: '',
        password: '',
        path: initialPath || '/'
    })
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    const { parseError, getErrorDisplay } = useSessionError()

    // Modes: 'client' uses the fixed host/port, 'admin' allows custom host/port
    type Mode = 'client' | 'admin'
    const [mode, setMode] = useState<Mode>('client')

    // Fixed client host/port as requested
    const CLIENT_HOST = '120.72.93.162'
    const CLIENT_PORT = 9091

    // Keep separate storage for admin server/port so switching doesn't lose edits
    const [adminServerBackup, setAdminServerBackup] = useState<string>('')
    const [adminPortBackup, setAdminPortBackup] = useState<number>(22)

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault()
        setLoading(true)
        setError('')

        // When client mode, force the fixed server/port regardless of input
        let server = mode === 'client' ? CLIENT_HOST : (formData.server || '').trim()
        const port = mode === 'client' ? CLIENT_PORT : (formData.port || 22)

        if (server.toLowerCase().startsWith('ftp://')) {
            server = server.replace(/ftp:\/\//i, '')
        } else if (server.toLowerCase().startsWith('sftp://')) {
            server = server.replace(/sftp:\/\//i, '')
        }

        try {
            const payload = {
                server,
                port,
                protocol: mode === 'client' ? 'ftp' : 'sftp',
                username: formData.username,
                password: formData.password,
                path: formData.path,
                isAdmin: mode === 'admin'
            }

            const response = await sftpApi.connect(payload)
            onLogin({
                sessionId: response.data.sessionId,
                server,
                username: formData.username,
                currentPath: formData.path,
                isAdmin: mode === 'admin'
            } as SessionInfo)
        } catch (err: unknown) {
            const parsed = parseError(err)
            setError(getErrorDisplay(parsed))
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (initialPath) setFormData(prev => ({ ...prev, path: initialPath }))
    }, [initialPath])

    // Ensure client mode pre-fills the fixed host/port when component mounts
    useEffect(() => {
        if (mode === 'client' && (!formData.server || formData.server === '')) {
            setFormData(prev => ({ ...prev, server: CLIENT_HOST, port: CLIENT_PORT }))
        }
    }, [mode, formData.server])

    // Handle switching mode (client <-> admin)
    const switchMode = (nextMode: Mode) => {
        if (nextMode === mode) return

        if (nextMode === 'client') {
            // store current admin values
            setAdminServerBackup(formData.server)
            setAdminPortBackup(formData.port || 22)
            // set fixed client host/port
            setFormData(prev => ({ ...prev, server: CLIENT_HOST, port: CLIENT_PORT }))
            setMode('client')
        } else {
            // restore admin values (or defaults)
            setFormData(prev => ({ ...prev, server: adminServerBackup || '', port: adminPortBackup || 22 }))
            setMode('admin')
        }
        // clear previous errors when switching
        setError('')
    }

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-50 flex items-center justify-center p-6 relative overflow-hidden">
            {/* Animated Background */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute -top-32 -right-32 w-[32rem] h-[32rem] bg-gradient-to-br from-primary-400/20 to-primary-600/10 rounded-full blur-3xl animate-pulse-subtle" />
                <div className="absolute -bottom-32 -left-32 w-[32rem] h-[32rem] bg-gradient-to-tr from-accent-400/20 to-accent-600/10 rounded-full blur-3xl animate-pulse-subtle" style={{ animationDelay: '1s' }} />
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[40rem] h-[40rem] bg-gradient-radial from-white/50 to-transparent rounded-full" />
                
                {/* DNA Helix Pattern */}
                <div className="absolute inset-0 opacity-[0.03]" style={{ 
                    backgroundImage: 'url("data:image/svg+xml,%3Csvg width="60" height="60" xmlns="http://www.w3.org/2000/svg"%3E%3Cpath d="M30 0 Q45 15 30 30 Q15 45 30 60 M30 0 Q15 15 30 30 Q45 45 30 60" stroke="%232B4570" fill="none" stroke-width="2"/%3E%3C/svg%3E")',
                    backgroundSize: '60px 60px'
                }} />
            </div>

            <div className="w-full max-w-4xl relative z-10 animate-fade-in-up">
                <div className="bg-white/90 backdrop-blur-xl border border-slate-200/60 shadow-elevated-lg rounded-3xl overflow-hidden transition-all duration-300 hover:shadow-2xl">
                    <div className="grid grid-cols-1 lg:grid-cols-5">
                        <div className="lg:col-span-2 bg-gradient-to-br from-primary-800 via-primary-700 to-primary-800 text-white p-8 lg:p-10 relative overflow-hidden">
                            {/* Animated Grid Pattern */}
                            <div className="absolute inset-0 opacity-5">
                                <div className="absolute inset-0" style={{ 
                                    backgroundImage: 'radial-gradient(circle, #ffffff 1px, transparent 1px)', 
                                    backgroundSize: '24px 24px',
                                    animation: 'slidePattern 20s linear infinite'
                                }} />
                            </div>
                            
                            {/* Glow Effect */}
                            <div className="absolute top-0 right-0 w-64 h-64 bg-accent-500/20 rounded-full blur-3xl" />
                            
                            <div className="relative">
                                <div className="mb-6 flex justify-center lg:justify-start">
                                    <div className="inline-flex items-center justify-center px-4 py-3 rounded-2xl bg-white/95 ring-1 ring-white/25 shadow-md">
                                        <img
                                            src={unigenomeLogo}
                                            alt="Unigenome"
                                            className="h-16 w-auto object-contain select-none"
                                            draggable={false}
                                        />
                                    </div>
                                </div>

                                <div className="space-y-4">
                                    {mode === 'client' ? (
                                        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold bg-gradient-to-r from-accent-500 to-accent-400 text-white shadow-glow-sm border border-accent-300/30 animate-fade-in">
                                            <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                                            <span>FTP Fast Client Mode</span>
                                        </div>
                                    ) : (
                                        <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold bg-white/20 backdrop-blur-sm text-white shadow-lg border border-white/30 animate-fade-in">
                                            <CheckCircle2 className="w-4 h-4 text-emerald-300" aria-hidden="true" />
                                            <span>SFTP Admin Mode</span>
                                        </div>
                                    )}

                                    <div className="text-sm text-white/95 leading-relaxed font-medium">
                                        Connect securely to upload, download, and audit genomic deliverables with enterprise-grade encryption.
                                    </div>
                                    
                                    {/* Feature Highlights */}
                                    <div className="mt-6 space-y-2">
                                        <div className="flex items-center gap-2 text-xs text-white/80">
                                            <div className="w-1.5 h-1.5 rounded-full bg-accent-400" />
                                            <span>End-to-end encryption</span>
                                        </div>
                                        <div className="flex items-center gap-2 text-xs text-white/80">
                                            <div className="w-1.5 h-1.5 rounded-full bg-accent-400" />
                                            <span>Concurrent file transfers</span>
                                        </div>
                                        <div className="flex items-center gap-2 text-xs text-white/80">
                                            <div className="w-1.5 h-1.5 rounded-full bg-accent-400" />
                                            <span>Real-time progress tracking</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="lg:col-span-3 p-8 lg:p-10">
                            <div className="flex items-center justify-between gap-4 mb-8">
                                <div>
                                    <h1 className="text-2xl font-bold text-slate-900 font-display">Sign In</h1>
                                    <p className="text-sm text-slate-600 mt-1">Use Client for fixed FTP or Admin for custom SFTP access.</p>
                                </div>

                                <div className="bg-slate-100/80 p-1.5 rounded-xl inline-flex gap-1 shadow-inner">
                                    <button
                                        type="button"
                                        aria-pressed={mode === 'client'}
                                        onClick={() => switchMode('client')}
                                        className={`px-5 py-2 rounded-lg text-sm font-bold transition-all duration-200 ${
                                            mode === 'client' 
                                                ? 'bg-white text-primary-800 shadow-md scale-105' 
                                                : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                                        }`}
                                    >
                                        Client
                                    </button>
                                    <button
                                        type="button"
                                        aria-pressed={mode === 'admin'}
                                        onClick={() => switchMode('admin')}
                                        className={`px-5 py-2 rounded-lg text-sm font-bold transition-all duration-200 ${
                                            mode === 'admin' 
                                                ? 'bg-white text-primary-800 shadow-md scale-105' 
                                                : 'text-slate-600 hover:text-slate-900 hover:bg-white/50'
                                        }`}
                                    >
                                        Admin
                                    </button>
                                </div>
                            </div>

                            <div>
                                <form onSubmit={handleLogin} className="space-y-6" noValidate>
                                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                        <div className="md:col-span-3">
                                            <label htmlFor="server" className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">Server Address</label>
                                            <div className="relative">
                                                <Server className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden="true" />
                                                <input
                                                    id="server"
                                                    type="text"
                                                    required
                                                    className={`input-field pl-10 w-full ${mode === 'client' ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : ''}`}
                                                    placeholder={mode === 'client' ? `ftp://${CLIENT_HOST}` : 'sftp.example.com'}
                                                    value={formData.server}
                                                    onChange={(e) => setFormData({ ...formData, server: e.target.value })}
                                                    aria-label="SFTP server hostname"
                                                    disabled={mode === 'client'}
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label htmlFor="port" className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">Port</label>
                                            <input
                                                id="port"
                                                type="number"
                                                className={`input-field w-full ${mode === 'client' ? 'bg-slate-100 text-slate-500 cursor-not-allowed' : ''}`}
                                                value={formData.port || ''}
                                                onChange={(e) => {
                                                    const val = e.target.value
                                                    setFormData({ ...formData, port: val === '' ? 0 : parseInt(val) })
                                                }}
                                                aria-label="SFTP port number"
                                                disabled={mode === 'client'}
                                            />
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label htmlFor="username" className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">Username</label>
                                            <div className="relative">
                                                <User className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden="true" />
                                                <input
                                                    id="username"
                                                    type="text"
                                                    required
                                                    className="input-field pl-10 w-full"
                                                    placeholder="your.username"
                                                    value={formData.username}
                                                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                                                    aria-label="SFTP username"
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label htmlFor="password" className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">Password</label>
                                            <div className="relative">
                                                <LockIcon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" aria-hidden="true" />
                                                <input
                                                    id="password"
                                                    type="password"
                                                    required
                                                    className="input-field pl-10 w-full"
                                                    placeholder="••••••••"
                                                    value={formData.password}
                                                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                                    aria-label="SFTP password"
                                                />
                                            </div>
                                        </div>
                                    </div>

                                    <div>
                                        <label htmlFor="path" className="block text-xs font-semibold text-slate-600 uppercase tracking-wider mb-2">Initial Path</label>
                                        <input
                                            id="path"
                                            type="text"
                                            className="input-field w-full"
                                            placeholder="/"
                                            value={formData.path}
                                            onChange={(e) => setFormData({ ...formData, path: e.target.value })}
                                            aria-label="Initial SFTP path"
                                        />
                                    </div>

                                    {error && (
                                        <div className="flex items-start gap-3 p-4 bg-error-50 border-l-4 border-error-500 rounded-xl shadow-sm animate-shake" role="alert" aria-live="polite">
                                            <div className="flex-shrink-0 mt-0.5">
                                                <div className="flex items-center justify-center h-6 w-6 rounded-full bg-error-100">
                                                    <span className="text-error-600 text-sm font-bold">!</span>
                                                </div>
                                            </div>
                                            <div className="flex-1">
                                                <p className="text-sm font-semibold text-error-900">{error}</p>
                                            </div>
                                        </div>
                                    )}

                                    <button
                                        type="submit"
                                        disabled={loading}
                                        className="w-full btn-primary py-3.5 font-bold text-base flex items-center justify-center gap-2 group shadow-lg hover:shadow-xl transition-all duration-300"
                                        aria-busy={loading}
                                    >
                                        {loading ? (
                                            <>
                                                <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
                                                <span>Connecting...</span>
                                            </>
                                        ) : (
                                            <>
                                                <span>Initialize Secure Session</span>
                                                <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform duration-200" aria-hidden="true" />
                                            </>
                                        )}
                                    </button>
                                </form>
                            </div>

                            <div className="mt-10 pt-6 border-t border-slate-200">
                                <div className="text-center space-y-2">
                                    <p className="text-xs text-slate-400">
                                        Powered by <span className="font-bold text-primary-800">Unigenome</span> • <span className="font-bold italic text-accent-600">Unipath</span> Specialty Laboratory
                                    </p>
                                    <p className="text-xs text-slate-400">
                                        Leading Genomics Innovations
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}
