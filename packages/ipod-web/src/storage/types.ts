import type { IpodDatabase } from '../firmware/types.js';

export type StorageStatus =
  | { state: 'connecting' }
  | { state: 'server-unreachable' }
  | { state: 'no-storage' }
  | { state: 'connected-to-host' }
  | { state: 'database-error'; message: string }
  | { state: 'ready'; database?: IpodDatabase };

export interface StorageProvider {
  readonly status: StorageStatus;
  onStatusChange(cb: (status: StorageStatus) => void): () => void;
  getAudioUrl(ipodPath: string): Promise<string>;
  reload(): Promise<void>;
}
