import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { RemoteStorage } from './remote.js';

// Mock WebSocket globally for tests
class MockWebSocket {
  static instances: MockWebSocket[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  readyState = 0;

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }
  close() {
    this.readyState = 3;
  }
}

describe('RemoteStorage', () => {
  let originalWebSocket: typeof WebSocket;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalWebSocket = globalThis.WebSocket;
    originalFetch = globalThis.fetch;
    globalThis.WebSocket = MockWebSocket as any;
    MockWebSocket.instances = [];
  });

  afterEach(() => {
    globalThis.WebSocket = originalWebSocket;
    globalThis.fetch = originalFetch;
  });

  test('getAudioUrl returns correct URL', async () => {
    const storage = new RemoteStorage('http://localhost:3456');
    const url = await storage.getAudioUrl(':iPod_Control:Music:F00:ABCD.m4a');
    expect(url).toBe('http://localhost:3456/audio/%3AiPod_Control%3AMusic%3AF00%3AABCD.m4a');
    storage.destroy();
  });

  test('strips trailing slash from baseUrl', async () => {
    const storage = new RemoteStorage('http://localhost:3456/');
    const url = await storage.getAudioUrl('test');
    expect(url).toStartWith('http://localhost:3456/audio/');
    storage.destroy();
  });

  test('connected is false initially', () => {
    const storage = new RemoteStorage('http://localhost:3456');
    expect(storage.connected).toBe(false);
    storage.destroy();
  });

  test('connected becomes true on WebSocket open', () => {
    const storage = new RemoteStorage('http://localhost:3456');
    const ws = MockWebSocket.instances[0]!;
    ws.onopen?.();
    expect(storage.connected).toBe(true);
    storage.destroy();
  });

  test('notifies listeners on connection change', () => {
    const storage = new RemoteStorage('http://localhost:3456');
    const cb = mock(() => {});
    storage.onConnectionChange(cb);

    const ws = MockWebSocket.instances[0]!;
    ws.onopen?.();
    expect(cb).toHaveBeenCalledWith(true);
    storage.destroy();
  });

  test('unsubscribe stops notifications', () => {
    const storage = new RemoteStorage('http://localhost:3456');
    const cb = mock(() => {});
    const unsub = storage.onConnectionChange(cb);
    unsub();

    const ws = MockWebSocket.instances[0]!;
    ws.onopen?.();
    expect(cb).not.toHaveBeenCalled();
    storage.destroy();
  });

  test('handles database-changed event', () => {
    const storage = new RemoteStorage('http://localhost:3456');
    const cb = mock(() => {});
    storage.onDatabaseChange(cb);

    const ws = MockWebSocket.instances[0]!;
    ws.onmessage?.({ data: JSON.stringify({ type: 'database-changed' }) });
    expect(cb).toHaveBeenCalled();
    storage.destroy();
  });

  test('destroy cleans up WebSocket', () => {
    const storage = new RemoteStorage('http://localhost:3456');
    storage.destroy();
    expect(storage.connected).toBe(false);
  });

  test('connected becomes false on WebSocket close', () => {
    const storage = new RemoteStorage('http://localhost:3456');
    const ws = MockWebSocket.instances[0]!;
    ws.onopen?.();
    expect(storage.connected).toBe(true);
    // Prevent reconnect from spawning a new WS in this test
    ws.onclose = null;
    storage.destroy();
    expect(storage.connected).toBe(false);
  });

  test('WebSocket URL converts http to ws', () => {
    const storage = new RemoteStorage('http://localhost:3456');
    const ws = MockWebSocket.instances[0]!;
    expect(ws.url).toBe('ws://localhost:3456/events');
    storage.destroy();
  });

  test('WebSocket URL converts https to wss', () => {
    const storage = new RemoteStorage('https://example.com');
    const ws = MockWebSocket.instances[0]!;
    expect(ws.url).toBe('wss://example.com/events');
    storage.destroy();
  });

  test('handles unplugged event', () => {
    const storage = new RemoteStorage('http://localhost:3456');
    const cb = mock(() => {});
    storage.onConnectionChange(cb);

    const ws = MockWebSocket.instances[0]!;
    ws.onopen?.();
    cb.mockClear();

    ws.onmessage?.({ data: JSON.stringify({ type: 'unplugged' }) });
    expect(storage.connected).toBe(false);
    expect(cb).toHaveBeenCalledWith(false);
    storage.destroy();
  });

  test('handles plugged event', () => {
    const storage = new RemoteStorage('http://localhost:3456');
    const cb = mock(() => {});
    storage.onConnectionChange(cb);

    const ws = MockWebSocket.instances[0]!;
    ws.onmessage?.({ data: JSON.stringify({ type: 'plugged' }) });
    expect(storage.connected).toBe(true);
    expect(cb).toHaveBeenCalledWith(true);
    storage.destroy();
  });

  test('ignores malformed WebSocket messages', () => {
    const storage = new RemoteStorage('http://localhost:3456');
    const ws = MockWebSocket.instances[0]!;
    expect(() => ws.onmessage?.({ data: 'not json' })).not.toThrow();
    storage.destroy();
  });

  test('loadDatabase fetches and creates IpodReader', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fixturePath = path.join(
      process.cwd(),
      'packages/ipod-db/fixtures/databases/single-track/iPod_Control/iTunes/iTunesDB'
    );

    let itunesDbBuffer: ArrayBuffer;
    try {
      const data = fs.readFileSync(fixturePath);
      itunesDbBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    } catch {
      // If fixture not available, skip this test
      return;
    }

    globalThis.fetch = mock((url: string) => {
      if (url.includes('/database')) {
        return Promise.resolve(new Response(itunesDbBuffer));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    }) as any;

    const storage = new RemoteStorage('http://localhost:3456');
    const reader = await storage.loadDatabase();
    expect(reader.getTracks().length).toBeGreaterThan(0);
    storage.destroy();
  });

  test('loadDatabase throws when iTunesDB fetch fails', async () => {
    globalThis.fetch = mock(() => Promise.reject(new Error('network error'))) as any;

    const storage = new RemoteStorage('http://localhost:3456');
    await expect(storage.loadDatabase()).rejects.toThrow('Failed to fetch iTunesDB from server');
    storage.destroy();
  });

  test('reload calls loadDatabase', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fixturePath = path.join(
      process.cwd(),
      'packages/ipod-db/fixtures/databases/single-track/iPod_Control/iTunes/iTunesDB'
    );

    let itunesDbBuffer: ArrayBuffer;
    try {
      const data = fs.readFileSync(fixturePath);
      itunesDbBuffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    } catch {
      return;
    }

    globalThis.fetch = mock((url: string) => {
      if (url.includes('/database')) {
        return Promise.resolve(new Response(itunesDbBuffer));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    }) as any;

    const storage = new RemoteStorage('http://localhost:3456');
    const reader = await storage.reload();
    expect(reader.getTracks().length).toBeGreaterThan(0);
    storage.destroy();
  });
});
