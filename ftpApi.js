import express from 'express';
import FTPService from './ftpService.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();
const ftpService = new FTPService();

// Rate limiting for security
const ftpLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // limit each IP to 10 requests per windowMs
    message: 'Too many FTP requests, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
});

// Authentication endpoint
router.post('/auth', ftpLimiter, async (req, res) => {
    try {
        const { host, port, username, password } = req.body;
        
        // Validate input
        if (!host || !username || !password) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: host, username, password'
            });
        }

        // Basic security checks
        if (username.length < 3 || password.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'Invalid credentials format'
            });
        }

        const result = await ftpService.authenticate(host, port, username, password);
        
        if (result.success) {
            res.json(result);
        } else {
            res.status(401).json(result);
        }
    } catch (error) {
        console.error('FTP Auth Error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// List files endpoint
router.post('/list', ftpLimiter, async (req, res) => {
    try {
        const { sessionId, path = '/' } = req.body;
        
        if (!sessionId) {
            return res.status(400).json({
                success: false,
                error: 'Session ID is required'
            });
        }

        const result = await ftpService.listFiles(sessionId, path);
        
        if (result.success) {
            res.json(result);
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        console.error('FTP List Error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// Download file endpoint
router.post('/download', ftpLimiter, async (req, res) => {
    try {
        const { sessionId, filePath } = req.body;
        
        if (!sessionId || !filePath) {
            return res.status(400).json({
                success: false,
                error: 'Session ID and file path are required'
            });
        }

        // Security: Prevent path traversal attacks
        if (filePath.includes('..') || filePath.includes('~')) {
            return res.status(400).json({
                success: false,
                error: 'Invalid file path'
            });
        }

        const result = await ftpService.downloadFile(sessionId, filePath);
        
        if (result.success) {
            res.json(result);
        } else {
            res.status(400).json(result);
        }
    } catch (error) {
        console.error('FTP Download Error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// Disconnect endpoint
router.post('/disconnect', async (req, res) => {
    try {
        const { sessionId } = req.body;
        
        if (sessionId) {
            await ftpService.disconnect(sessionId);
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('FTP Disconnect Error:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
});

// Health check endpoint
router.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        activeConnections: ftpService.connections.size,
        timestamp: new Date().toISOString()
    });
});

// Cleanup old connections periodically (every 5 minutes)
setInterval(() => {
    ftpService.cleanup();
}, 5 * 60 * 1000);

export default router;
