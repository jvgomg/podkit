import type { StorageProvider } from './types.js';

export class BrowserStorage implements StorageProvider {
  get connected(): boolean {
    throw new Error('BrowserStorage is not yet implemented');
  }
  async loadDatabase(): Promise<any> {
    throw new Error('BrowserStorage is not yet implemented');
  }
  async getAudioUrl(_ipodPath: string): Promise<string> {
    throw new Error('BrowserStorage is not yet implemented');
  }
  onConnectionChange(_cb: (connected: boolean) => void): () => void {
    throw new Error('BrowserStorage is not yet implemented');
  }
  async reload(): Promise<any> {
    throw new Error('BrowserStorage is not yet implemented');
  }
}
