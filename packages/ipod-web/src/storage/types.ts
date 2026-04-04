export interface StorageProvider {
  loadDatabase(): Promise<any>; // Will be IpodReader when ipod-db is ready
  getAudioUrl(ipodPath: string): Promise<string>;
  connected: boolean;
  onConnectionChange(cb: (connected: boolean) => void): () => void;
  reload(): Promise<any>;
}
