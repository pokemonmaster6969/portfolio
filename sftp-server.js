import express from 'express';
import cors from 'cors';
import multer from 'multer';
import Client from 'ssh2-sftp-client';
import * as ftp from 'basic-ftp';
const { Client: FTPClient } = ftp;
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import stream from 'stream';
import archiver from 'archiver';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import {
    initDb,
    isDbEnabled,
    logAppLog,
    logConnectionEvent,
    logDownloadEvent,
    upsertTransferTasks,
    listConnectionEvents,
    listDownloadEvents,
    listAppLogs,
    listTransferTasks,
    insertAnalyticsSnapshot,
    listAnalyticsSnapshots,
} from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const LOG_LEVEL = (process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'info')).toLowerCase();
const LOG_LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const logLevelValue = LOG_LEVELS[LOG_LEVEL] ?? LOG_LEVELS.info;
const log = {
    debug: (...args) => { if (logLevelValue <= LOG_LEVELS.debug) console.log('[DEBUG]', ...args); },
    info: (...args) => { if (logLevelValue <= LOG_LEVELS.info) console.log('[INFO]', ...args); },
    warn: (...args) => { if (logLevelValue <= LOG_LEVELS.warn) console.warn('[WARN]', ...args); },
    error: (...args) => { if (logLevelValue <= LOG_LEVELS.error) console.error('[ERROR]', ...args); },
};

const app = express();
app.set('trust proxy', true);
const PORT = process.env.PORT || 3001;

// Initialize DB (optional)
await initDb();
if (isDbEnabled()) {
    log.info('[DB] PostgreSQL enabled');
} else {
    log.info('[DB] PostgreSQL disabled (set DATABASE_URL to enable)');
}

// Middleware
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

app.use(cors({
    origin: (origin, cb) => {
        // allow non-browser clients (no origin)
        if (!origin) return cb(null, true);
        // in development, allow all origins to avoid breaking local dev setups
        if (process.env.NODE_ENV !== 'production') return cb(null, true);
        if (allowedOrigins.includes(origin)) return cb(null, true);
        return cb(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Range'],
    credentials: false
}));
app.use(express.json());
app.use(express.static(__dirname));

// Rate limiting (safe defaults)
const sftpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
});
const connectLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
});

app.use('/api/sftp', sftpLimiter);

const dbLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
});

app.use('/api/db', dbLimiter);

// Prevents favicon 404 errors
app.get('/favicon.ico', (req, res) => res.status(204).end());

// Configure multer
const upload = multer({ dest: 'uploads/' });

// Store active sessions
const sessions = new Map();


// Helper: Promise timeout
const withTimeout = (promise, ms, errMsg) => {
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error(errMsg || `Operation timed out after ${ms}ms`)), ms));
    return Promise.race([promise, timeout]);
}

// Lightweight connection checks
async function testFtpConnection({ host, port = 21, user, password, timeout = 8000 }) {
    const client = new FTPClient();
    client.ftp.verbose = false;
    const start = Date.now();
    try {
        await withTimeout(client.access({ host, port, user, password, secure: false }), timeout, 'FTP connect timeout');
        // lightweight check - PWD
        const pwd = await withTimeout(client.pwd(), 2000, 'FTP pwd timeout');
        const took = Date.now() - start;
        return { ok: true, client, pwd, took };
    } catch (err) {
        try { client.close(); } catch (e) {}
        return { ok: false, error: err.message || String(err) };
    }
}

async function testSftpConnection({ host, port = 22, user, password, privateKey, timeout = 8000 }) {
    const sftp = new Client();
    const start = Date.now();
    try {
        await withTimeout(sftp.connect({ host, port: Number(port) || 22, username: user, password, privateKey: privateKey ? Buffer.from(privateKey, 'base64') : undefined, readyTimeout: timeout }), timeout, 'SFTP connect timeout');
        // lightweight check - cwd
        const cwd = await withTimeout(sftp.cwd(), 2000, 'SFTP cwd timeout');
        const took = Date.now() - start;
        return { ok: true, sftp, cwd, took };
    } catch (err) {
        try { await sftp.end(); } catch (e) {}
        return { ok: false, error: err.message || String(err) };
    }
}

// Session cleanup
setInterval(() => {
    const now = Date.now();
    for (const [sessionId, session] of sessions.entries()) {
        if (now - session.lastActivity > 30 * 60 * 1000) {
            if (session.type === 'sftp') session.client.end();
            else session.client.close();
            sessions.delete(sessionId);
            log.info(`[SESSION] ${sessionId} expired`);
        }
    }
}, 5 * 60 * 1000);

// Session creation utility: attach event handlers and defaults
function createSession(sessionId, { type, client, server, username, timeout = 120000, isAdmin = false } = {}) { // increased default timeout
    // Do NOT store credentials (password/port) on the session.
    const session = { type, client, server, username, isAdmin: Boolean(isAdmin), lastActivity: Date.now(), timeout };

    const cleanup = (reason) => {
        try {
            if (session.type === 'sftp') {
                // ssh2-sftp-client has .end()
                try { session.client.end(); } catch (e) {}
            } else {
                try { session.client.close(); } catch (e) {}
            }
        } catch (e) {}
        sessions.delete(sessionId);
        log.info(`[SESSION] ${sessionId} cleaned up (${reason})`);
    };

    // Attach common handlers for safety
    try {
        if (client && typeof client.on === 'function') {
            client.on('error', (err) => {
                log.error(`[SESSION][${sessionId}] client error`, err && err.message ? err.message : err);
                cleanup('error');
            });
            // Some clients emit 'close' and/or 'end'
            client.on('close', () => cleanup('close'));
            client.on('end', () => cleanup('end'));
        }
    } catch (e) {
        console.warn(`[SESSION][${sessionId}] failed to attach handlers`, e && e.message ? e.message : e);
    }

    // Best-effort: set basic-ftp internal socket timeout to session timeout
    try {
        if (type === 'ftp' && client && client.ftp) {
            if (typeof client.ftp.socketTimeout === 'number' || client.ftp.socketTimeout === undefined) {
                client.ftp.socketTimeout = timeout;
            }
            if (typeof client.ftp.timeout === 'number' || client.ftp.timeout === undefined) {
                client.ftp.timeout = timeout;
            }
        }
    } catch (e) {
        // ignore if properties don't exist
    }

    sessions.set(sessionId, session);
    return session;
}

// Per-session op queue helper to avoid concurrent FTP client operations
function runSessionOp(sessionId, fn, opTimeout) {
	const session = sessions.get(sessionId);
	if (!session) throw new Error('Session expired');
	// initialize queue promise
	if (!session._queue) session._queue = Promise.resolve();
	const timeoutMs = typeof opTimeout === 'number' ? opTimeout : (session.timeout || 120000);

	// Capture the previous queue so we can return the real operation promise to the caller,
	// but keep session._queue in a resolved state even if the operation fails (prevents queue from getting stuck rejected).
	const prev = session._queue;
	const opPromise = prev.then(async () => {
		session.lastActivity = Date.now();
		return withTimeout(fn(session), timeoutMs, `Session operation timed out after ${timeoutMs}ms`);
	});

	// Ensure the queue continues even if opPromise rejects: log the error but do NOT leave session._queue rejected.
	session._queue = opPromise.catch(err => {
		log.error('[SESSION-OP] error', err && err.message ? err.message : err);
		void logAppLog({
			level: 'error',
			message: err && err.message ? err.message : 'session op error',
			sessionId,
			context: {
				op: 'session_op',
				type: session.type,
				server: session.server,
				username: session.username,
			},
		});
		// swallow here to keep queue healthy; callers still receive the original opPromise result/rejection.
	});

	return opPromise;
}

// helper to attach handlers when replacing a session's client (used for reconnect)
function attachClientHandlersToSession(sessionId, client) {
	const session = sessions.get(sessionId);
	if (!session) return;
	try {
		if (client && typeof client.on === 'function') {
			client.on('error', (err) => {
				log.error(`[SESSION][${sessionId}] client error`, err && err.message ? err.message : err);
				// close session on client errors
				try {
					if (session.type === 'sftp') session.client.end();
					else session.client.close();
				} catch(e) {}
				sessions.delete(sessionId);
			});
			client.on('close', () => {
				log.info(`[SESSION][${sessionId}] client closed`);
				sessions.delete(sessionId);
			});
			client.on('end', () => {
				log.info(`[SESSION][${sessionId}] client ended`);
				sessions.delete(sessionId);
			});
		}
		// update session client ref
		session.client = client;
	} catch (e) {
		log.warn(`[SESSION][${sessionId}] attach handlers failed`, e && e.message ? e.message : e);
	}
}

// Remove reconnect-on-timeout behavior: retry transient FTP errors without storing credentials
async function ftpOpWithRetries(sessionId, opFn, { retries = 3, baseDelay = 2000 } = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            // run via the session queue to maintain serialization
            return await runSessionOp(sessionId, opFn);
        } catch (err) {
            lastErr = err;
            const msg = (err && err.message) ? err.message : '';
            const isTransient = msg.includes('Timeout (data socket)') || msg.includes('ETIMEDOUT') || /timed out/i.test(msg) || /timeout/i.test(msg);

            log.warn(`[FTP-RETRY] session=${sessionId} attempt=${attempt} transient=${isTransient} msg=${msg}`);

            // If the session/client has been closed, don't attempt silent reconnect here — surface error
            const session = sessions.get(sessionId);
            if (!session || !session.client) {
                log.warn(`[FTP-RETRY] session ${sessionId} has no client; aborting retries`);
                break;
            }

            // If transient, backoff and retry on the same client
            if (isTransient && attempt < retries) {
                await new Promise(r => setTimeout(r, baseDelay * (attempt + 1)));
                continue;
            }

            // otherwise break and throw
            break;
        }
    }
    throw lastErr;
}

/**
 * Universal Connect Handler
 */
app.post('/api/sftp/connect', connectLimiter, async (req, res) => {
    const { server, port, username, password, path: remotePath, protocol, isAdmin } = req.body;
    if (!server || !username) return res.status(400).json({ error: 'Missing fields' });

    log.info(`[CONNECT] attempt ${username}@${server}:${port || '(default)'} protocol=${protocol || 'auto'}`);
    const sessionId = uuidv4();

    // If protocol is explicitly requested, honor it and do NOT fallback.
    try {
        if (protocol === 'ftp') {
            const start = Date.now();
            const result = await testFtpConnection({ host: server, port: Number(port) || 21, user: username, password, timeout: 8000 });
            if (!result.ok) {
                void logConnectionEvent({
                    sessionId,
                    requestedProtocol: protocol || 'auto',
                    protocol: 'ftp',
                    username,
                    server,
                    port: Number(port) || 21,
                    success: false,
                    errorMessage: result.error,
                    userAgent: req.headers['user-agent'],
                    ip: req.ip,
                });
                return res.status(502).json({ error: `FTP connection failed: ${result.error}` });
            }

            // keep ftp client open for session use (attach handlers via createSession)
            createSession(sessionId, { type: 'ftp', client: result.client, server, username, password, port: Number(port) || 21, isAdmin: Boolean(isAdmin) });
            log.info(`[CONNECT][FTP] success ${username}@${server}:${port} took=${result.took}ms`);

            void logConnectionEvent({
                sessionId,
                requestedProtocol: protocol || 'auto',
                protocol: 'ftp',
                username,
                server,
                port: Number(port) || 21,
                success: true,
                errorMessage: null,
                userAgent: req.headers['user-agent'],
                ip: req.ip,
            });

            // perform lightweight list for initial UI (non-recursive)
            const files = await result.client.list(remotePath || '/');
            return res.json({ success: true, sessionId, type: 'ftp', files: files.map(f => ({ name: f.name, size: f.size, isDirectory: f.type === 2, path: (remotePath || '/').endsWith('/') ? (remotePath || '/') + f.name : (remotePath || '/') + '/' + f.name })) });
        } else if (protocol === 'sftp') {
            const start = Date.now();
            const result = await testSftpConnection({ host: server, port: Number(port) || 22, user: username, password, timeout: 8000 });
            if (!result.ok) {
                void logConnectionEvent({
                    sessionId,
                    requestedProtocol: protocol || 'auto',
                    protocol: 'sftp',
                    username,
                    server,
                    port: Number(port) || 22,
                    success: false,
                    errorMessage: result.error,
                    userAgent: req.headers['user-agent'],
                    ip: req.ip,
                });
                return res.status(502).json({ error: `SFTP connection failed: ${result.error}` });
            }

            createSession(sessionId, { type: 'sftp', client: result.sftp, server, username, isAdmin: Boolean(isAdmin) });
            log.info(`[CONNECT][SFTP] success ${username}@${server}:${port} took=${result.took}ms`);

            void logConnectionEvent({
                sessionId,
                requestedProtocol: protocol || 'auto',
                protocol: 'sftp',
                username,
                server,
                port: Number(port) || 22,
                success: true,
                errorMessage: null,
                userAgent: req.headers['user-agent'],
                ip: req.ip,
            });

            const files = await result.sftp.list(remotePath || '/');
            return res.json({ success: true, sessionId, type: 'sftp', files: files.map(f => ({ name: f.name, size: f.size, isDirectory: f.type === 'd', path: (remotePath || '/').endsWith('/') ? (remotePath || '/') + f.name : (remotePath || '/') + '/' + f.name })) });
        } else {
            // Auto-detect: try SFTP first but with quicker behavior; if it fails with SSH-banner-like error, try FTP.
            try {
                const sres = await testSftpConnection({ host: server, port: Number(port) || 22, user: username, password, timeout: 8000 });
                if (sres.ok) {
                    createSession(sessionId, { type: 'sftp', client: sres.sftp, server, username, isAdmin: Boolean(isAdmin) });
                    log.info(`[CONNECT][SFTP-auto] success ${username}@${server}:${port} took=${sres.took}ms`);

                    void logConnectionEvent({
                        sessionId,
                        requestedProtocol: protocol || 'auto',
                        protocol: 'sftp',
                        username,
                        server,
                        port: Number(port) || 22,
                        success: true,
                        errorMessage: null,
                        userAgent: req.headers['user-agent'],
                        ip: req.ip,
                    });
                    const files = await sres.sftp.list(remotePath || '/');
                    return res.json({ success: true, sessionId, type: 'sftp', files: files.map(f => ({ name: f.name, size: f.size, isDirectory: f.type === 'd', path: (remotePath || '/').endsWith('/') ? (remotePath || '/') + f.name : (remotePath || '/') + '/' + f.name })) });
                } else {
                    log.info('[CONNECT] SFTP auto-detect failed', sres.error);
                    // if sres.error suggests non-SSH banner, try FTP
                    if (sres.error && (sres.error.includes('Expected SSH banner') || sres.error.includes('Unsupported protocol') || Number(port) !== 22)) {
                        const fres = await testFtpConnection({ host: server, port: Number(port) || 21, user: username, password, timeout: 8000 });
                        if (!fres.ok) {
                            void logConnectionEvent({
                                sessionId,
                                requestedProtocol: protocol || 'auto',
                                protocol: 'ftp',
                                username,
                                server,
                                port: Number(port) || 21,
                                success: false,
                                errorMessage: fres.error,
                                userAgent: req.headers['user-agent'],
                                ip: req.ip,
                            });
                            return res.status(502).json({ error: `FTP connection failed: ${fres.error}` });
                        }
                        createSession(sessionId, { type: 'ftp', client: fres.client, server, username, password, port: Number(port) || 21, isAdmin: Boolean(isAdmin) });
                        log.info(`[CONNECT][FTP-auto] success ${username}@${server}:${port} took=${fres.took}ms`);

                        void logConnectionEvent({
                            sessionId,
                            requestedProtocol: protocol || 'auto',
                            protocol: 'ftp',
                            username,
                            server,
                            port: Number(port) || 21,
                            success: true,
                            errorMessage: null,
                            userAgent: req.headers['user-agent'],
                            ip: req.ip,
                        });
                        const files = await fres.client.list(remotePath || '/');
                        return res.json({ success: true, sessionId, type: 'ftp', files: files.map(f => ({ name: f.name, size: f.size, isDirectory: f.type === 2, path: (remotePath || '/').endsWith('/') ? (remotePath || '/') + f.name : (remotePath || '/') + '/' + f.name })) });
                    }

                    void logConnectionEvent({
                        sessionId,
                        requestedProtocol: protocol || 'auto',
                        protocol: 'sftp',
                        username,
                        server,
                        port: Number(port) || 22,
                        success: false,
                        errorMessage: sres.error,
                        userAgent: req.headers['user-agent'],
                        ip: req.ip,
                    });
                    return res.status(502).json({ error: `SFTP connection failed: ${sres.error}` });
                }
            } catch (err) {
				void logConnectionEvent({
					sessionId,
					requestedProtocol: protocol || 'auto',
					protocol: null,
					username,
					server,
					port: port || null,
					success: false,
					errorMessage: err && err.message ? err.message : String(err),
					userAgent: req.headers['user-agent'],
					ip: req.ip,
				});
                return res.status(500).json({ error: 'Connection detection failed', details: err.message });
            }
        }
    } catch (err) {
		log.error('[CONNECT] unexpected error', err && err.message ? err.message : err);
		void logConnectionEvent({
			sessionId,
			requestedProtocol: protocol || 'auto',
			protocol: null,
			username,
			server,
			port: port || null,
			success: false,
			errorMessage: err && err.message ? err.message : String(err),
			userAgent: req.headers['user-agent'],
			ip: req.ip,
		});
        return res.status(500).json({ error: err.message || String(err) });
    }
});

/**
 * Universal List Handler
 */
app.get('/api/sftp/list-recursive', async (req, res) => {
    const { sessionId, path: remotePath } = req.query;
    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Session expired' });

    try {
        const fileList = [];
        const listFiles = async (currentPath) => {
            const items = await runSessionOp(sessionId, s => s.client.list(currentPath));

            for (const item of items) {
                const itemPath = path.posix.join(currentPath, item.name);
                const isDirectory = session.type === 'sftp'
                    ? (item && item.type === 'd')
                    : (item && item.type === 2);

                if (isDirectory) {
                    await listFiles(itemPath);
                } else {
                    fileList.push({
                        name: item.name,
                        size: item.size,
                        isDirectory: false,
                        path: itemPath,
                    });
                }
            }
        };

        await listFiles(remotePath || '/');
        res.json({ success: true, files: fileList });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/sftp/list', async (req, res) => {
    const { sessionId, path: remotePath } = req.query;
    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Session expired' });

    try {
        const files = await runSessionOp(sessionId, async (s) => {
            if (s.type === 'sftp') {
                const list = await s.client.list(remotePath || '/');
                return list.map(f => ({
                    name: f.name, size: f.size, isDirectory: f.type === 'd',
                    path: (remotePath || '/').endsWith('/') ? (remotePath || '/') + f.name : (remotePath || '/') + '/' + f.name
                }));
            } else {
                const list = await s.client.list(remotePath || '/');
                return list.map(f => ({
                    name: f.name, size: f.size, isDirectory: f.type === 2,
                    path: (remotePath || '/').endsWith('/') ? (remotePath || '/') + f.name : (remotePath || '/') + '/' + f.name
                }));
            }
        });
        res.json({ success: true, files });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * Universal Download Handler (with Range support)
 */
app.get('/api/sftp/download', async (req, res) => {
    const { sessionId, file: remotePath } = req.query;
    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Session expired' });

    try {
        log.debug(`[DOWNLOAD] ${sessionId} ${session.type} ${remotePath}`);

        // Best-effort event logging (async, does not block download)
        logDownloadEvent({
            sessionId,
            protocol: session.type,
            username: session.username,
            server: session.server,
            remotePath,
            userAgent: req.headers['user-agent'],
            ip: req.ip,
        });

        const fileName = path.basename(remotePath);
        let sftpReadStream = null;

        // If client disconnects mid-transfer, ensure upstream read stream is closed.
        res.on('close', () => {
            try {
                if (sftpReadStream && typeof sftpReadStream.destroy === 'function') {
                    sftpReadStream.destroy();
                }
            } catch (e) {
                // ignore
            }
        });

        // Perform size/stat under session queue to avoid concurrent client ops
        const fileSize = await runSessionOp(sessionId, async (s) => {
            if (s.type === 'sftp') {
                const stats = await s.client.stat(remotePath);
                return stats.size;
            } else {
                return await s.client.size(remotePath);
            }
        });

        const range = req.headers.range;
        if (range) {
            log.debug(`[DOWNLOAD] range ${sessionId} ${range}`);
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = (end - start) + 1;

            res.status(206).set({
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': `attachment; filename="${fileName}"`,
            });

            if (session.type === 'sftp') {
                // SFTP stream read doesn't need serialization here, but keep activity updated
                session.lastActivity = Date.now();
                sftpReadStream = session.client.sftp.createReadStream(remotePath, { start, end });
                sftpReadStream.pipe(res);
            } else {
                // FTP download must be serialized to avoid basic-ftp concurrent task error
                await runSessionOp(sessionId, async (s) => {
                    return s.client.downloadTo(res, remotePath, start);
                });
            }
        } else {
            res.set({
                'Content-Length': fileSize,
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': `attachment; filename="${fileName}"`,
                'Accept-Ranges': 'bytes',
            });
            if (session.type === 'sftp') {
                session.lastActivity = Date.now();
                sftpReadStream = session.client.sftp.createReadStream(remotePath);
                sftpReadStream.pipe(res);
            } else {
                await runSessionOp(sessionId, async (s) => s.client.downloadTo(res, remotePath));
            }
        }

    } catch (error) {
        const msg = error && error.message ? error.message : String(error)
        log.error(`[DOWNLOAD] failed session=${sessionId} path=${remotePath} err=${msg}`)
		void logAppLog({
			level: 'error',
			message: msg || 'download error',
			sessionId,
			context: {
				op: 'download',
				remotePath,
				protocol: session && session.type ? session.type : null,
				server: session && session.server ? session.server : null,
				username: session && session.username ? session.username : null,
				userAgent: req.headers['user-agent'],
				ip: req.ip,
			},
		});
        if (!res.headersSent) res.status(500).json({ error: error.message });
    }
});


/**
 * Universal Upload Handler
 */
app.post('/api/sftp/upload', upload.single('file'), async (req, res) => {
    const { sessionId, path: remoteDir } = req.body;
    const session = sessions.get(sessionId);
    if (!session || !req.file) return res.status(400).json({ error: 'Invalid request' });

    const remotePath = path.join(remoteDir || '/', req.file.originalname);
    try {
        // perform upload under session queue
        await runSessionOp(sessionId, async (s) => {
            if (s.type === 'sftp') {
                return s.client.put(req.file.path, remotePath);
            } else {
                return s.client.uploadFrom(req.file.path, remotePath);
            }
        });
        fs.unlinkSync(req.file.path);
        res.json({ success: true, message: 'Uploaded' });
    } catch (error) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        res.status(500).json({ error: error.message });
    }
});

/**
 * Universal Delete Handler
 */
app.post('/api/sftp/delete', async (req, res) => {
    const { sessionId, path: remotePath, isDirectory } = req.body;
    const session = sessions.get(sessionId);
    if (!session) return res.status(404).json({ error: 'Session expired' });

    try {
        // perform delete under session queue
        await runSessionOp(sessionId, async (s) => {
            if (s.type === 'sftp') {
                if (isDirectory) return s.client.rmdir(remotePath, true);
                return s.client.delete(remotePath);
            } else {
                if (isDirectory) return s.client.removeDir(remotePath);
                return s.client.remove(remotePath);
            }
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/sftp/disconnect', async (req, res) => {
    const { sessionId } = req.body;
    const session = sessions.get(sessionId);
    if (session) {
        if (session.type === 'sftp') {
            try { session.client.end(); } catch(e) {}
        } else {
            try { session.client.close(); } catch(e) {}
        }
        sessions.delete(sessionId);
    }
    res.json({ success: true });
});

app.get('/api/health', (req, res) => res.json({ status: 'ok', activeSessions: sessions.size }));

// --- DB endpoints (optional) ---
app.get('/api/db/health', (req, res) => {
    if (!isDbEnabled()) return res.status(503).json({ ok: false, db: 'disabled' });
    return res.json({ ok: true, db: 'enabled' });
});

app.get('/api/db/tasks', async (req, res) => {
    if (!isDbEnabled()) return res.status(503).json({ error: 'DB disabled' });
    const { sessionId, limit } = req.query;
    try {
        const rows = await listTransferTasks({ sessionId: sessionId || null, limit });
        res.json({ success: true, tasks: rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/db/tasks/upsert', async (req, res) => {
    if (!isDbEnabled()) return res.status(503).json({ error: 'DB disabled' });
    const { sessionId, tasks } = req.body || {};
    if (!Array.isArray(tasks)) return res.status(400).json({ error: 'tasks array is required' });
    try {
        await upsertTransferTasks({ sessionId, tasks });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/db/snapshots', async (req, res) => {
    if (!isDbEnabled()) return res.status(503).json({ error: 'DB disabled' });
    const { sessionId, snapshotType, limit } = req.query;
    try {
        const rows = await listAnalyticsSnapshots({ sessionId: sessionId || null, snapshotType: snapshotType || null, limit });
        res.json({ success: true, snapshots: rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/db/snapshots', async (req, res) => {
    if (!isDbEnabled()) return res.status(503).json({ error: 'DB disabled' });
    const { sessionId, snapshotType, path: snapshotPath, payload } = req.body || {};
    if (!snapshotType) return res.status(400).json({ error: 'snapshotType is required' });
    if (payload === undefined) return res.status(400).json({ error: 'payload is required' });
    try {
        await insertAnalyticsSnapshot({ sessionId, snapshotType, path: snapshotPath, payload });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/db/audit/recent', async (req, res) => {
    if (!isDbEnabled()) return res.status(503).json({ error: 'DB disabled' });

    const { sessionId, limit } = req.query;
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

    const session = sessions.get(sessionId);
    if (!session || !session.isAdmin) return res.status(403).json({ error: 'Admin access required' });

    try {
        const safeLimit = Math.min(500, Math.max(1, Number(limit) || 100));
        const [connections, downloads, logs] = await Promise.all([
            listConnectionEvents({ limit: safeLimit }),
            listDownloadEvents({ limit: safeLimit }),
            listAppLogs({ limit: safeLimit }),
        ]);

        res.json({ success: true, connections, downloads, logs });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Unified SFTP/FTP Portal running on http://localhost:${PORT}`);
});

process.on('SIGTERM', () => {
    for (const s of sessions.values()) {
        if (s.type === 'sftp') {
            try { s.client.end(); } catch(e) {}
        } else {
            try { s.client.close(); } catch(e) {}
        }
    }
    process.exit(0);
});
