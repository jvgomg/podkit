import { describe, test, expect } from 'bun:test';
import { BrowserStorage } from './browser.js';

describe('BrowserStorage', () => {
  test('throws on all methods', () => {
    const storage = new BrowserStorage();
    expect(() => storage.connected).toThrow('not yet implemented');
    expect(storage.loadDatabase()).rejects.toThrow('not yet implemented');
    expect(storage.getAudioUrl('test')).rejects.toThrow('not yet implemented');
    expect(() => storage.onConnectionChange(() => {})).toThrow('not yet implemented');
    expect(storage.reload()).rejects.toThrow('not yet implemented');
  });
});
