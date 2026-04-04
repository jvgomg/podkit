import type { StorageProvider, StorageStatus } from './types.js';

export class BrowserStorage implements StorageProvider {
  get status(): StorageStatus {
    throw new Error('BrowserStorage is not yet implemented');
  }
  async getAudioUrl(_ipodPath: string): Promise<string> {
    throw new Error('BrowserStorage is not yet implemented');
  }
  onStatusChange(_cb: (status: StorageStatus) => void): () => void {
    throw new Error('BrowserStorage is not yet implemented');
  }
  async reload(): Promise<void> {
    throw new Error('BrowserStorage is not yet implemented');
  }
}
