import type { StorageProvider, StorageStatus } from './types.js';
import { IpodReader } from '@podkit/ipod-db';

export class RemoteStorage implements StorageProvider {
  private baseUrl: string;
  private ipodId: string;
  private ws: WebSocket | null = null;
  private _wsConnected = false;
  private _status: StorageStatus = { state: 'connecting' };
  private listeners = new Set<(status: StorageStatus) => void>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(baseUrl: string = 'http://localhost:3456', ipodId: string = 'default') {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.ipodId = ipodId;
    this.connectWebSocket();
  }

  // --- StorageProvider interface ---

  get status(): StorageStatus {
    return this._status;
  }

  onStatusChange(cb: (status: StorageStatus) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  async getAudioUrl(ipodPath: string): Promise<string> {
    return `${this.baseUrl}/ipods/${this.ipodId}/audio/${encodeURIComponent(ipodPath)}`;
  }

  async reload(): Promise<void> {
    await this.tryLoadDatabase();
  }

  // --- Internal ---

  private setStatus(status: StorageStatus): void {
    this._status = status;
    for (const cb of this.listeners) {
      cb(status);
    }
  }

  private async tryLoadDatabase(): Promise<void> {
    try {
      const [itunesDbRes, artworkDbRes, sysInfoRes] = await Promise.allSettled([
        fetch(`${this.baseUrl}/ipods/${this.ipodId}/database`),
        fetch(`${this.baseUrl}/ipods/${this.ipodId}/artwork-db`),
        fetch(`${this.baseUrl}/ipods/${this.ipodId}/sysinfo`),
      ]);

      if (!this._wsConnected) return;

      // A missing iTunesDB could mean no storage, or a connected but unsynced iPod.
      // SysInfo is written during iPod initialisation and serves as a presence
      // indicator: if it exists the filesystem is mounted but has no database yet.
      if (itunesDbRes.status !== 'fulfilled' || !itunesDbRes.value.ok) {
        const sysInfoPresent = sysInfoRes.status === 'fulfilled' && sysInfoRes.value.ok;
        if (sysInfoPresent) {
          this.setStatus({ state: 'database-error', message: 'No iTunes database found' });
        } else {
          this.setStatus({ state: 'no-storage' });
        }
        return;
      }

      const itunesDb = new Uint8Array(await itunesDbRes.value.arrayBuffer());

      if (!this._wsConnected) return;

      const artworkDb =
        artworkDbRes.status === 'fulfilled' && artworkDbRes.value.ok
          ? new Uint8Array(await artworkDbRes.value.arrayBuffer())
          : undefined;

      const sysInfo =
        sysInfoRes.status === 'fulfilled' && sysInfoRes.value.ok
          ? await sysInfoRes.value.text()
          : undefined;

      // Fetch ithmb files so IpodReader can decode artwork thumbnails
      let ithmbs: Map<string, Uint8Array> | undefined;
      if (artworkDb) {
        ithmbs = await this.fetchIthmbFiles();
      }

      // IpodReader.fromFiles throws if the database bytes are corrupt or unreadable
      const database = IpodReader.fromFiles({ itunesDb, artworkDb, sysInfo, ithmbs });
      this.setStatus({ state: 'ready', database });
    } catch (e) {
      if (!this._wsConnected) return;
      this.setStatus({
        state: 'database-error',
        message: e instanceof Error ? e.message : 'Failed to read iPod database',
      });
    }
  }

  private async fetchIthmbFiles(): Promise<Map<string, Uint8Array> | undefined> {
    try {
      const listRes = await fetch(`${this.baseUrl}/ipods/${this.ipodId}/artwork-files`);
      if (!listRes.ok) return undefined;

      const { files } = (await listRes.json()) as { files: string[] };
      if (!files.length) return undefined;

      const entries = await Promise.all(
        files.map(async (name) => {
          const res = await fetch(
            `${this.baseUrl}/ipods/${this.ipodId}/artwork-files/${encodeURIComponent(name)}`
          );
          if (!res.ok) return null;
          return [name, new Uint8Array(await res.arrayBuffer())] as const;
        })
      );

      const map = new Map<string, Uint8Array>();
      for (const entry of entries) {
        if (entry) map.set(entry[0], entry[1]);
      }
      return map.size > 0 ? map : undefined;
    } catch {
      return undefined;
    }
  }

  // --- WebSocket management ---

  private connectWebSocket(): void {
    const wsUrl = this.baseUrl.replace(/^http/, 'ws') + '/events';

    try {
      this.ws = new WebSocket(wsUrl);
    } catch {
      this.setStatus({ state: 'server-unreachable' });
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this._wsConnected = true;
      this.tryLoadDatabase();
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
      this._wsConnected = false;
      this.setStatus({ state: 'server-unreachable' });
      this.scheduleReconnect();
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror
    };
  }

  private handleEvent(event: { type: string; [key: string]: unknown }): void {
    switch (event.type) {
      case 'plugged':
        this.setStatus({ state: 'connected-to-host' });
        break;
      case 'unplugged':
        this.tryLoadDatabase();
        break;
      case 'database-changed':
        this.tryLoadDatabase();
        break;
      case 'storage-created':
        this.tryLoadDatabase();
        break;
      case 'storage-wiped':
        this.setStatus({ state: 'no-storage' });
        break;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectWebSocket();
    }, 1000);
  }

  // --- Lifecycle ---

  destroy(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null; // prevent reconnect on explicit destroy
      this.ws.close();
      this.ws = null;
    }
    this._wsConnected = false;
    this.listeners.clear();
  }
}
