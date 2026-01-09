export interface SFTPFile {
    name: string;
    type: string;
    size: number;
    modifyTime: number;
    isDirectory: boolean;
    path: string;
}

export interface SessionInfo {
    sessionId: string;
    server: string;
    username: string;
    currentPath: string;
    isAdmin?: boolean;
}
