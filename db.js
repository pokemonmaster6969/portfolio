import { Pool } from 'pg';

let pool = null;
let dbEnabled = false;

function maskDatabaseUrl(url) {
    if (!url) return '';
    try {
        const u = new URL(String(url));
        if (u.password) u.password = '***';
        return u.toString();
    } catch {
        return String(url).replace(/(postgres(?:ql)?:\/\/[^:]+:)([^@]+)(@)/i, '$1***$3');
    }
}

export function isDbEnabled() {
    return dbEnabled;
}

export async function upsertTransferTasks({ sessionId, tasks }) {
    if (!dbEnabled || !pool) return;
    if (!Array.isArray(tasks) || tasks.length === 0) return;

    const now = new Date();
    const values = [];
    const params = [];
    let i = 1;

    for (const t of tasks) {
        values.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
        params.push(
            t.id,
            sessionId || t.sessionId || null,
            t.name,
            t.url || null,
            typeof t.size === 'number' ? Math.trunc(t.size) : null,
            typeof t.progress === 'number' ? t.progress : null,
            t.status || null,
            typeof t.startTime === 'number' ? Math.trunc(t.startTime) : null,
            typeof t.bytesDownloaded === 'number' ? Math.trunc(t.bytesDownloaded) : null,
            typeof t.speed === 'number' ? t.speed : null,
            t.errorMessage || null,
            now
        );
    }

    try {
        await pool.query(
            `insert into public.transfer_tasks (
                id, session_id, name, url, size, progress, status, start_time, bytes_downloaded, speed, error_message, updated_at
            ) values ${values.join(',')}
            on conflict (id) do update set
                session_id = excluded.session_id,
                name = excluded.name,
                url = excluded.url,
                size = excluded.size,
                progress = excluded.progress,
                status = excluded.status,
                start_time = excluded.start_time,
                bytes_downloaded = excluded.bytes_downloaded,
                speed = excluded.speed,
                error_message = excluded.error_message,
                updated_at = excluded.updated_at
            `,
            params
        );
    } catch (err) {
        console.error('[DB] upsertTransferTasks failed:', err && err.message ? err.message : err);
    }
}

export async function logConnectionEvent(event) {
    if (!dbEnabled || !pool) return;

    const errorMessage = event && event.errorMessage ? String(event.errorMessage).slice(0, 2000) : null;
    const requestedProtocol = event && event.requestedProtocol ? String(event.requestedProtocol) : null;
    const protocol = event && event.protocol ? String(event.protocol) : null;
    const port = event && (typeof event.port === 'number' || typeof event.port === 'string') ? Number(event.port) : null;
    const success = Boolean(event && event.success);

    try {
        await pool.query(
            `insert into public.connection_events (
                session_id, requested_protocol, protocol, username, server, port, success, error_message, user_agent, ip
            ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [
                event.sessionId || null,
                requestedProtocol,
                protocol,
                event.username || null,
                event.server || null,
                Number.isFinite(port) ? port : null,
                success,
                errorMessage,
                event.userAgent || null,
                event.ip || null,
            ]
        );
    } catch (err) {
        console.error('[DB] logConnectionEvent failed:', err && err.message ? err.message : err);
    }
}

export async function logAppLog(entry) {
    if (!dbEnabled || !pool) return;

    const level = entry && entry.level ? String(entry.level).slice(0, 20) : null;
    const message = entry && entry.message ? String(entry.message).slice(0, 4000) : 'log';
    const context = entry && entry.context !== undefined ? entry.context : null;

    try {
        await pool.query(
            `insert into public.app_logs (level, message, session_id, context) values ($1,$2,$3,$4)`,
            [level, message, entry.sessionId || null, context]
        );
    } catch (err) {
        console.error('[DB] logAppLog failed:', err && err.message ? err.message : err);
    }
}

export async function listTransferTasks({ sessionId, limit = 200 }) {
    if (!dbEnabled || !pool) return [];
    try {
        const res = await pool.query(
            `select * from public.transfer_tasks where ($1::text is null or session_id = $1)
             order by updated_at desc limit $2`,
            [sessionId || null, Math.min(1000, Math.max(1, Number(limit) || 200))]
        );
        return res.rows;
    } catch (err) {
        console.error('[DB] listTransferTasks failed:', err && err.message ? err.message : err);
        return [];
    }
}

export async function listConnectionEvents({ limit = 200 } = {}) {
    if (!dbEnabled || !pool) return [];
    try {
        const res = await pool.query(
            `select id, session_id, requested_protocol, protocol, username, server, port, success, error_message, user_agent, ip, created_at
             from public.connection_events
             order by created_at desc
             limit $1`,
            [Math.min(1000, Math.max(1, Number(limit) || 200))]
        );
        return res.rows;
    } catch (err) {
        console.error('[DB] listConnectionEvents failed:', err && err.message ? err.message : err);
        return [];
    }
}

export async function listDownloadEvents({ limit = 200 } = {}) {
    if (!dbEnabled || !pool) return [];
    try {
        const res = await pool.query(
            `select id, session_id, protocol, username, server, remote_path, user_agent, ip, created_at
             from public.download_events
             order by created_at desc
             limit $1`,
            [Math.min(1000, Math.max(1, Number(limit) || 200))]
        );
        return res.rows;
    } catch (err) {
        console.error('[DB] listDownloadEvents failed:', err && err.message ? err.message : err);
        return [];
    }
}

export async function listAppLogs({ limit = 200 } = {}) {
    if (!dbEnabled || !pool) return [];
    try {
        const res = await pool.query(
            `select id, level, message, session_id, context, created_at
             from public.app_logs
             order by created_at desc
             limit $1`,
            [Math.min(1000, Math.max(1, Number(limit) || 200))]
        );
        return res.rows;
    } catch (err) {
        console.error('[DB] listAppLogs failed:', err && err.message ? err.message : err);
        return [];
    }
}

export async function insertAnalyticsSnapshot({ sessionId, snapshotType, path, payload }) {
    if (!dbEnabled || !pool) return;
    try {
        await pool.query(
            `insert into public.analytics_snapshots (session_id, snapshot_type, path, payload)
             values ($1, $2, $3, $4)`,
            [sessionId || null, snapshotType, path || null, payload]
        );
    } catch (err) {
        console.error('[DB] insertAnalyticsSnapshot failed:', err && err.message ? err.message : err);
    }
}

export async function listAnalyticsSnapshots({ sessionId, snapshotType, limit = 50 }) {
    if (!dbEnabled || !pool) return [];
    try {
        const res = await pool.query(
            `select id, session_id, snapshot_type, path, payload, created_at
             from public.analytics_snapshots
             where ($1::text is null or session_id = $1)
               and ($2::text is null or snapshot_type = $2)
             order by created_at desc
             limit $3`,
            [sessionId || null, snapshotType || null, Math.min(500, Math.max(1, Number(limit) || 50))]
        );
        return res.rows;
    } catch (err) {
        console.error('[DB] listAnalyticsSnapshots failed:', err && err.message ? err.message : err);
        return [];
    }
}

export function getPool() {
    return pool;
}

export async function initDb() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        dbEnabled = false;
        return;
    }

    const safeDatabaseUrl = maskDatabaseUrl(databaseUrl);
    console.log('[DB] Connecting to PostgreSQL:', safeDatabaseUrl);

    pool = new Pool({
        connectionString: databaseUrl,
        // Prefer TLS in hosted environments; allow disabling via env for local/dev.
        ssl: process.env.PGSSLMODE === 'disable' ? false : (process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false),
        max: Number(process.env.PG_POOL_MAX || 10),
        idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
        connectionTimeoutMillis: Number(process.env.PG_CONN_TIMEOUT_MS || 5000),
    });

    try {
        await pool.query('select 1');
        dbEnabled = true;
    } catch (err) {
        dbEnabled = false;

        try {
            await pool.end();
        } catch (_) {
            // ignore
        }
        pool = null;

        const code = err && err.code ? String(err.code) : null;
        const message = err && err.message ? err.message : String(err);
        console.error('[DB] Connection failed:', message);
        if (code === '28P01') {
            console.error('[DB] Hint: password authentication failed. Verify username/password in DATABASE_URL:', safeDatabaseUrl);
        } else if (code === '3D000') {
            console.error('[DB] Hint: database does not exist. Create it and re-run:', safeDatabaseUrl);
        } else if (code) {
            console.error('[DB] Error code:', code);
        }
        return;
    }

    await pool.query(`
        create table if not exists public.download_events (
            id bigserial primary key,
            session_id text,
            protocol text,
            username text,
            server text,
            remote_path text,
            user_agent text,
            ip text,
            created_at timestamptz not null default now()
        );
    `);

    await pool.query(`
        create index if not exists idx_download_events_created_at on public.download_events(created_at desc);
    `);

    await pool.query(`
        create table if not exists public.connection_events (
            id bigserial primary key,
            session_id text,
            requested_protocol text,
            protocol text,
            username text,
            server text,
            port integer,
            success boolean not null,
            error_message text,
            user_agent text,
            ip text,
            created_at timestamptz not null default now()
        );
    `);

    await pool.query(`
        create index if not exists idx_connection_events_created_at on public.connection_events(created_at desc);
    `);
    await pool.query(`
        create index if not exists idx_connection_events_server_user on public.connection_events(server, username);
    `);

    await pool.query(`
        create table if not exists public.transfer_tasks (
            id text primary key,
            session_id text,
            name text not null,
            url text,
            size bigint,
            progress real,
            status text,
            start_time bigint,
            bytes_downloaded bigint,
            speed real,
            error_message text,
            updated_at timestamptz not null default now()
        );
    `);

    await pool.query(`
        create index if not exists idx_transfer_tasks_session_id on public.transfer_tasks(session_id);
    `);
    await pool.query(`
        create index if not exists idx_transfer_tasks_updated_at on public.transfer_tasks(updated_at desc);
    `);

    await pool.query(`
        create table if not exists public.analytics_snapshots (
            id bigserial primary key,
            session_id text,
            snapshot_type text not null,
            path text,
            payload jsonb not null,
            created_at timestamptz not null default now()
        );
    `);
    await pool.query(`
        create index if not exists idx_analytics_snapshots_session_id on public.analytics_snapshots(session_id);
    `);
    await pool.query(`
        create index if not exists idx_analytics_snapshots_created_at on public.analytics_snapshots(created_at desc);
    `);

    await pool.query(`
        create table if not exists public.app_logs (
            id bigserial primary key,
            level text,
            message text not null,
            session_id text,
            context jsonb,
            created_at timestamptz not null default now()
        );
    `);

    await pool.query(`
        create index if not exists idx_app_logs_created_at on public.app_logs(created_at desc);
    `);

    console.log('[DB] Schema ready (download_events, connection_events, app_logs, transfer_tasks, analytics_snapshots)');
}

export async function logDownloadEvent(event) {
    if (!dbEnabled || !pool) return;

    try {
        await pool.query(
            `insert into public.download_events (session_id, protocol, username, server, remote_path, user_agent, ip)
             values ($1, $2, $3, $4, $5, $6, $7)`,
            [
                event.sessionId || null,
                event.protocol || null,
                event.username || null,
                event.server || null,
                event.remotePath || null,
                event.userAgent || null,
                event.ip || null,
            ]
        );
    } catch (err) {
        console.error('[DB] logDownloadEvent failed:', err && err.message ? err.message : err);
    }
}
