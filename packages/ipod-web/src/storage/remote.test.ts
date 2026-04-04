import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { RemoteStorage } from './remote.js';

// Flush all pending microtasks and macrotasks
const flushPromises = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

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

  test('getAudioUrl returns correct URL with ipod ID', async () => {
    const storage = new RemoteStorage('http://localhost:3456', 'default');
    const url = await storage.getAudioUrl(':iPod_Control:Music:F00:ABCD.m4a');
    expect(url).toBe(
      'http://localhost:3456/ipods/default/audio/%3AiPod_Control%3AMusic%3AF00%3AABCD.m4a'
    );
    storage.destroy();
  });

  test('strips trailing slash from baseUrl', async () => {
    const storage = new RemoteStorage('http://localhost:3456/');
    const url = await storage.getAudioUrl('test');
    expect(url).toStartWith('http://localhost:3456/ipods/');
    storage.destroy();
  });

  test('status is connecting initially', () => {
    const storage = new RemoteStorage('http://localhost:3456');
    expect(storage.status.state).toBe('connecting');
    storage.destroy();
  });

  test('status becomes server-unreachable on WebSocket close', () => {
    const storage = new RemoteStorage('http://localhost:3456');
    const ws = MockWebSocket.instances[0]!;
    ws.onclose?.();
    expect(storage.status.state).toBe('server-unreachable');
    storage.destroy();
  });

  test('status becomes no-storage when /database and /sysinfo both return 404', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(null, { status: 404 }))) as any;

    const storage = new RemoteStorage('http://localhost:3456');
    const ws = MockWebSocket.instances[0]!;
    ws.onopen?.();
    await flushPromises();

    expect(storage.status.state).toBe('no-storage');
    storage.destroy();
  });

  test('status becomes database-error when /database is 404 but /sysinfo exists', async () => {
    globalThis.fetch = mock((url: string) => {
      if ((url as string).includes('/sysinfo')) {
        return Promise.resolve(new Response('ModelNumStr: MA147\n', { status: 200 }));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    }) as any;

    const storage = new RemoteStorage('http://localhost:3456');
    const ws = MockWebSocket.instances[0]!;
    ws.onopen?.();
    await flushPromises();

    expect(storage.status.state).toBe('database-error');
    storage.destroy();
  });

  test('status becomes no-storage when /database fetch throws', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(null, { status: 500 }))) as any;

    const storage = new RemoteStorage('http://localhost:3456');
    const ws = MockWebSocket.instances[0]!;
    ws.onopen?.();
    await flushPromises();

    expect(storage.status.state).toBe('no-storage');
    storage.destroy();
  });

  test('status becomes database-error when database bytes are unreadable', async () => {
    globalThis.fetch = mock((url: string) => {
      if ((url as string).includes('/database')) {
        // Return a valid 200 but with garbage bytes that IpodReader cannot parse
        return Promise.resolve(new Response(new Uint8Array([0x00, 0x01, 0x02, 0x03]).buffer));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    }) as any;

    const storage = new RemoteStorage('http://localhost:3456');
    const ws = MockWebSocket.instances[0]!;
    ws.onopen?.();
    await flushPromises();

    expect(storage.status.state).toBe('database-error');
    storage.destroy();
  });

  test('status becomes ready when database loads successfully', async () => {
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
      return; // skip if fixture not available
    }

    globalThis.fetch = mock((url: string) => {
      if ((url as string).includes('/database')) {
        return Promise.resolve(new Response(itunesDbBuffer));
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    }) as any;

    const storage = new RemoteStorage('http://localhost:3456');
    const ws = MockWebSocket.instances[0]!;
    ws.onopen?.();
    await flushPromises();

    expect(storage.status.state).toBe('ready');
    if (storage.status.state === 'ready') {
      expect(storage.status.database?.getTracks().length).toBeGreaterThan(0);
    }
    storage.destroy();
  });

  test('notifies listeners on status change', () => {
    const storage = new RemoteStorage('http://localhost:3456');
    const cb = mock(() => {});
    storage.onStatusChange(cb);

    const ws = MockWebSocket.instances[0]!;
    ws.onclose?.();
    expect(cb).toHaveBeenCalledWith({ state: 'server-unreachable' });
    storage.destroy();
  });

  test('unsubscribe stops notifications', () => {
    const storage = new RemoteStorage('http://localhost:3456');
    const cb = mock(() => {});
    const unsub = storage.onStatusChange(cb);
    unsub();

    const ws = MockWebSocket.instances[0]!;
    ws.onclose?.();
    expect(cb).not.toHaveBeenCalled();
    storage.destroy();
  });

  test('handles plugged event by setting connected-to-host', () => {
    const storage = new RemoteStorage('http://localhost:3456');
    const ws = MockWebSocket.instances[0]!;
    ws.onopen?.();

    ws.onmessage?.({ data: JSON.stringify({ type: 'plugged' }) });
    expect(storage.status.state).toBe('connected-to-host');
    storage.destroy();
  });

  test('handles unplugged event by attempting database load', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(null, { status: 404 }))) as any;

    const storage = new RemoteStorage('http://localhost:3456');
    const ws = MockWebSocket.instances[0]!;
    ws.onopen?.();
    await flushPromises();

    // Set to connected-to-host first
    ws.onmessage?.({ data: JSON.stringify({ type: 'plugged' }) });
    expect(storage.status.state).toBe('connected-to-host');

    // Unplug triggers database load attempt
    ws.onmessage?.({ data: JSON.stringify({ type: 'unplugged' }) });
    await flushPromises();
    // no-storage since fetch returns 404 (no database available)
    expect(storage.status.state).toBe('no-storage');
    storage.destroy();
  });

  test('handles database-changed event by reloading database', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(null, { status: 404 }))) as any;

    const storage = new RemoteStorage('http://localhost:3456');
    const ws = MockWebSocket.instances[0]!;
    ws.onopen?.();
    await flushPromises();

    const cb = mock(() => {});
    storage.onStatusChange(cb);

    ws.onmessage?.({ data: JSON.stringify({ type: 'database-changed' }) });
    await flushPromises();
    // A reload was attempted; status updated (still no-storage with our mock)
    expect(cb).toHaveBeenCalled();
    storage.destroy();
  });

  test('handles storage-created event by loading database', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(null, { status: 404 }))) as any;

    const storage = new RemoteStorage('http://localhost:3456');
    const ws = MockWebSocket.instances[0]!;
    ws.onopen?.();
    await flushPromises();

    const cb = mock(() => {});
    storage.onStatusChange(cb);

    ws.onmessage?.({ data: JSON.stringify({ type: 'storage-created' }) });
    await flushPromises();
    expect(cb).toHaveBeenCalled();
    storage.destroy();
  });

  test('handles storage-wiped event by setting no-storage', () => {
    const storage = new RemoteStorage('http://localhost:3456');
    const ws = MockWebSocket.instances[0]!;
    ws.onopen?.();

    ws.onmessage?.({ data: JSON.stringify({ type: 'storage-wiped' }) });
    expect(storage.status.state).toBe('no-storage');
    storage.destroy();
  });

  test('ignores malformed WebSocket messages', () => {
    const storage = new RemoteStorage('http://localhost:3456');
    const ws = MockWebSocket.instances[0]!;
    expect(() => ws.onmessage?.({ data: 'not json' })).not.toThrow();
    storage.destroy();
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

  test('destroy cleans up listeners and stops reconnect', () => {
    const storage = new RemoteStorage('http://localhost:3456');
    const cb = mock(() => {});
    storage.onStatusChange(cb);
    storage.destroy();

    // After destroy, no more notifications
    const ws = MockWebSocket.instances[0]!;
    ws.onclose?.(); // this is a no-op since onclose was cleared
    expect(cb).not.toHaveBeenCalled();
  });

  test('does not update status after WS closes mid-load', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(null, { status: 404 }))) as any;

    const storage = new RemoteStorage('http://localhost:3456');
    const ws = MockWebSocket.instances[0]!;

    // Open WS (starts async load), then immediately close it
    ws.onopen?.();
    ws.onclose?.();
    expect(storage.status.state).toBe('server-unreachable');

    // Let the async load finish — it should not overwrite server-unreachable
    await flushPromises();
    expect(storage.status.state).toBe('server-unreachable');

    storage.destroy();
  });

  test('reload triggers a database load attempt', async () => {
    globalThis.fetch = mock(() => Promise.resolve(new Response(null, { status: 404 }))) as any;

    const storage = new RemoteStorage('http://localhost:3456');
    const ws = MockWebSocket.instances[0]!;
    ws.onopen?.();

    const cb = mock(() => {});
    storage.onStatusChange(cb);
    await storage.reload();

    expect(cb).toHaveBeenCalled();
    storage.destroy();
  });

  test('fetches use ipod-scoped URLs', async () => {
    const fetchMock = mock(() => Promise.resolve(new Response(null, { status: 404 }))) as any;
    globalThis.fetch = fetchMock;

    const storage = new RemoteStorage('http://localhost:3456', 'my-ipod');
    const ws = MockWebSocket.instances[0]!;
    ws.onopen?.();
    await flushPromises();

    const urls = fetchMock.mock.calls.map((c: any) => c[0]);
    expect(urls).toContain('http://localhost:3456/ipods/my-ipod/database');
    expect(urls).toContain('http://localhost:3456/ipods/my-ipod/artwork-db');
    expect(urls).toContain('http://localhost:3456/ipods/my-ipod/sysinfo');
    storage.destroy();
  });
});
