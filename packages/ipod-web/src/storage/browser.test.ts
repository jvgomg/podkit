import { describe, test, expect } from 'bun:test';
import { BrowserStorage } from './browser.js';

describe('BrowserStorage', () => {
  test('throws on all methods', () => {
    const storage = new BrowserStorage();
    expect(() => storage.status).toThrow('not yet implemented');
    expect(storage.getAudioUrl('test')).rejects.toThrow('not yet implemented');
    expect(() => storage.onStatusChange(() => {})).toThrow('not yet implemented');
    expect(storage.reload()).rejects.toThrow('not yet implemented');
  });
});
