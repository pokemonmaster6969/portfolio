import ftp from 'basic-ftp';
import fs from 'fs';
import path from 'path';

class FTPService {
    constructor() {
        this.connections = new Map(); // Store active FTP connections by session ID
    }

    async authenticate(host, port, username, password) {
        try {
            const client = new ftp.Client();
            client.ftp.verbose = false; // Set to true for debugging
            
            await client.access({
                host: host,
                port: port || 21,
                user: username,
                password: password,
                secure: false, // Set to true for FTPS
                secureOptions: { rejectUnauthorized: false }
            });

            const sessionId = this.generateSessionId();
            this.connections.set(sessionId, {
                client: client,
                host: host,
                username: username,
                connectedAt: new Date()
            });

            return {
                success: true,
                sessionId: sessionId,
                message: 'Connected successfully'
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                code: error.code || 'CONNECTION_ERROR'
            };
        }
    }

    async listFiles(sessionId, path = '/') {
        try {
            const connection = this.connections.get(sessionId);
            if (!connection) {
                throw new Error('Invalid session - please reconnect');
            }

            const client = connection.client;
            await client.cd(path);
            
            const list = await client.list();
            
            const files = list.map(item => ({
                name: item.name,
                type: item.type === 1 ? 'directory' : 'file',
                size: item.size ? this.formatBytes(item.size) : '0 B',
                rawSize: item.size || 0,
                modifiedDate: item.modifyAt ? new Date(item.modifyAt).toLocaleString() : 'Unknown',
                permissions: item.permissions || '',
                path: path === '/' ? `/${item.name}` : `${path}/${item.name}`
            })).filter(item => item.name !== '.' && item.name !== '..');

            return {
                success: true,
                files: files,
                currentPath: path
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                code: error.code || 'LIST_ERROR'
            };
        }
    }

    async downloadFile(sessionId, filePath) {
        try {
            const connection = this.connections.get(sessionId);
            if (!connection) {
                throw new Error('Invalid session - please reconnect');
            }

            const client = connection.client;
            
            // Get file info first
            const fileName = path.basename(filePath);
            const dirPath = path.dirname(filePath);
            
            if (dirPath && dirPath !== '.') {
                await client.cd(dirPath);
            }

            // Create a temporary file path
            const tempDir = path.join(__dirname, 'temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            
            const tempFilePath = path.join(tempDir, fileName);
            
            // Download the file
            await client.downloadTo(tempFilePath, fileName);
            
            // Read file and return as base64
            const fileBuffer = fs.readFileSync(tempFilePath);
            const base64Data = fileBuffer.toString('base64');
            
            // Clean up temp file
            fs.unlinkSync(tempFilePath);
            
            // Detect MIME type
            const mimeType = this.getMimeType(fileName);
            
            return {
                success: true,
                data: `data:${mimeType};base64,${base64Data}`,
                fileName: fileName,
                size: this.formatBytes(fileBuffer.length)
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                code: error.code || 'DOWNLOAD_ERROR'
            };
        }
    }

    async disconnect(sessionId) {
        try {
            const connection = this.connections.get(sessionId);
            if (connection) {
                connection.client.close();
                this.connections.delete(sessionId);
            }
            return { success: true };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    generateSessionId() {
        return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    }

    formatBytes(bytes, decimals = 2) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const dm = decimals < 0 ? 0 : decimals;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
    }

    getMimeType(fileName) {
        const ext = path.extname(fileName).toLowerCase();
        const mimeTypes = {
            '.txt': 'text/plain',
            '.csv': 'text/csv',
            '.json': 'application/json',
            '.xml': 'application/xml',
            '.pdf': 'application/pdf',
            '.doc': 'application/msword',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            '.xls': 'application/vnd.ms-excel',
            '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.zip': 'application/zip',
            '.tar': 'application/x-tar',
            '.gz': 'application/gzip',
            '.fastq': 'text/plain',
            '.fq': 'text/plain',
            '.bam': 'application/octet-stream',
            '.sam': 'text/plain',
            '.gtf': 'text/plain',
            '.gff': 'text/plain',
            '.bed': 'text/plain',
            '.wig': 'text/plain'
        };
        return mimeTypes[ext] || 'application/octet-stream';
    }

    // Cleanup old connections (call this periodically)
    cleanup() {
        const now = new Date();
        for (const [sessionId, connection] of this.connections.entries()) {
            const age = now - connection.connectedAt;
            // Disconnect sessions older than 30 minutes
            if (age > 30 * 60 * 1000) {
                connection.client.close();
                this.connections.delete(sessionId);
            }
        }
    }
}

export default FTPService;
