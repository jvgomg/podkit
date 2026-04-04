import type { StorageProvider } from './types.js';
import { IpodReader } from '@podkit/ipod-db';

export class RemoteStorage implements StorageProvider {
  private baseUrl: string;
  private ws: WebSocket | null = null;
  private _connected = false;
  private listeners = new Set<(connected: boolean) => void>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectDelay = 1000; // exponential backoff starting point
  private onDatabaseChanged: (() => void) | null = null;

  constructor(baseUrl: string = 'http://localhost:3456') {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // strip trailing slash
    this.connectWebSocket();
  }

  // --- StorageProvider interface ---

  get connected(): boolean {
    return this._connected;
  }

  async loadDatabase(): Promise<IpodReader> {
    // Fetch iTunesDB, ArtworkDB, SysInfo in parallel
    const [itunesDbRes, artworkDbRes, sysInfoRes] = await Promise.allSettled([
      fetch(`${this.baseUrl}/database`),
      fetch(`${this.baseUrl}/artwork-db`),
      fetch(`${this.baseUrl}/sysinfo`),
    ]);

    const itunesDb =
      itunesDbRes.status === 'fulfilled'
        ? new Uint8Array(await itunesDbRes.value.arrayBuffer())
        : null;

    if (!itunesDb) {
      throw new Error('Failed to fetch iTunesDB from server');
    }

    const artworkDb =
      artworkDbRes.status === 'fulfilled' && artworkDbRes.value.ok
        ? new Uint8Array(await artworkDbRes.value.arrayBuffer())
        : undefined;

    const sysInfo =
      sysInfoRes.status === 'fulfilled' && sysInfoRes.value.ok
        ? await sysInfoRes.value.text()
        : undefined;

    // TODO: fetch ithmb files if artwork is present
    // For now, skip ithmbs — artwork display will show fallback

    return IpodReader.fromFiles({ itunesDb, artworkDb, sysInfo });
  }

  async getAudioUrl(ipodPath: string): Promise<string> {
    // The server streams audio at this URL
    // The browser's <audio> element will fetch it directly with range requests
    return `${this.baseUrl}/audio/${encodeURIComponent(ipodPath)}`;
  }

  onConnectionChange(cb: (connected: boolean) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async reload(): Promise<IpodReader> {
    return this.loadDatabase();
  }

  // --- WebSocket management ---

  private connectWebSocket(): void {
    const wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/events';

    try {
      this.ws = new WebSocket(wsUrl);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this._connected = true;
      this.reconnectDelay = 1000; // reset backoff
      this.notifyListeners();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleEvent(data);
      } catch {
        // ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this._connected = false;
      this.notifyListeners();
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror, so reconnect happens there
    };
  }

  private handleEvent(event: { type: string; [key: string]: unknown }): void {
    switch (event.type) {
      case 'plugged':
        this._connected = true;
        this.notifyListeners();
        break;
      case 'unplugged':
        this._connected = false;
        this.notifyListeners();
        break;
      case 'database-changed':
        this.onDatabaseChanged?.();
        break;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000); // cap at 30s
      this.connectWebSocket();
    }, this.reconnectDelay);
  }

  private notifyListeners(): void {
    for (const cb of this.listeners) {
      cb(this._connected);
    }
  }

  // --- Lifecycle ---

  /** Register a callback for database changes (used by the app to trigger reload) */
  onDatabaseChange(cb: () => void): void {
    this.onDatabaseChanged = cb;
  }

  /** Clean up WebSocket connection */
  destroy(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null; // prevent reconnect
      this.ws.close();
      this.ws = null;
    }
    this._connected = false;
    this.listeners.clear();
  }
}
