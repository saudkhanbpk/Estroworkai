import { io, Socket } from 'socket.io-client';

// Determine WebSocket URL dynamically
function getWsUrl(): string {
  // Use environment variable if set
  if (process.env.NEXT_PUBLIC_WS_URL) {
    return process.env.NEXT_PUBLIC_WS_URL;
  }
  
  // In browser, derive from current location
  if (typeof window !== 'undefined') {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    // For production, WebSocket goes through nginx on same host
    return `${protocol}//${host}`;
  }
  
  // Default for SSR
  return 'http://localhost:5000';
}

class WebSocketService {
  private socket: Socket | null = null;
  private workspaceId: string | null = null;
  private listeners: Map<string, Set<Function>> = new Map();

  connect(workspaceId: string): void {
    if (this.socket?.connected && this.workspaceId === workspaceId) {
      return;
    }

    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;
    const wsUrl = getWsUrl();

    this.socket = io(wsUrl, {
      auth: { token },
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      transports: ['websocket', 'polling'],
    });

    this.workspaceId = workspaceId;

    this.socket.on('connect', () => {
      console.log('WebSocket connected');
      this.socket?.emit('workspace:join', workspaceId);
    });

    this.socket.on('disconnect', () => {
      console.log('WebSocket disconnected');
    });

    this.socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error);
    });

    // Setup event forwarding
    this.setupEventForwarding();
  }

  private setupEventForwarding(): void {
    if (!this.socket) return;

    const events = [
      'agent:update',
      'editor:update',
      'editor:cursor',
      'terminal:output',
      'file:change',
    ];

    events.forEach((event) => {
      this.socket?.on(event, (data: any) => {
        this.emit(event, data);
      });
    });
  }

  disconnect(): void {
    if (this.socket && this.workspaceId) {
      this.socket.emit('workspace:leave', this.workspaceId);
      this.socket.disconnect();
      this.socket = null;
      this.workspaceId = null;
    }
  }

  on(event: string, callback: Function): void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)?.add(callback);
  }

  off(event: string, callback: Function): void {
    this.listeners.get(event)?.delete(callback);
  }

  private emit(event: string, data: any): void {
    this.listeners.get(event)?.forEach((callback) => {
      callback(data);
    });
  }

  // Editor events
  sendEditorChange(filePath: string, changes: any): void {
    this.socket?.emit('editor:change', {
      workspaceId: this.workspaceId,
      filePath,
      changes,
    });
  }

  sendCursorPosition(filePath: string, position: any): void {
    this.socket?.emit('editor:cursor', {
      workspaceId: this.workspaceId,
      filePath,
      position,
    });
  }

  // Terminal events
  sendTerminalInput(input: string): void {
    this.socket?.emit('terminal:input', {
      workspaceId: this.workspaceId,
      input,
    });
  }

  isConnected(): boolean {
    return this.socket?.connected ?? false;
  }
}

const websocket = new WebSocketService();
export default websocket;
