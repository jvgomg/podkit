import type { ServerWebSocket } from 'bun';
import { createApi } from './api.js';
import { createGadget } from './gadget.js';
import { createStorageRegistry } from './storage.js';
import { createUsbBus } from './usb.js';
import { watchDatabase } from './watcher.js';
import { DEFAULT_CONFIG } from './types.js';
import type { ServerEvent, ServerConfig } from './types.js';

// --- Configuration ---

const config: ServerConfig = {
  ...DEFAULT_CONFIG,
  port: parseInt(process.env.PORT ?? String(DEFAULT_CONFIG.port), 10),
  storageRoot: process.env.STORAGE_ROOT ?? DEFAULT_CONFIG.storageRoot,
  mountRoot: process.env.MOUNT_ROOT ?? DEFAULT_CONFIG.mountRoot,
  gadgetMountPoint: process.env.GADGET_MOUNT_POINT ?? DEFAULT_CONFIG.gadgetMountPoint,
};

// --- WebSocket client tracking ---

const wsClients = new Set<ServerWebSocket<unknown>>();

const EVENT_LABELS: Record<ServerEvent['type'], string> = {
  plugged: 'iPod plugged in',
  unplugged: 'iPod unplugged',
  'storage-created': 'iPod storage created',
  'storage-wiped': 'iPod storage wiped',
  'database-changed': 'iTunesDB changed',
};

function broadcastEvent(event: ServerEvent): void {
  console.log(`[event] ${EVENT_LABELS[event.type]}`);
  const msg = JSON.stringify(event);
  for (const ws of wsClients) {
    ws.send(msg);
  }
}

// --- Initialize ---

const registry = createStorageRegistry(config);
await registry.initialize();

const gadget = createGadget(config.gadgetPath);
const watchers = new Map<string, () => void>();

// Watcher lifecycle functions — defined here so USB bus can call them
// during plug/unplug to avoid "target is busy" on unmount
function startWatcherForStorage(id: string): void {
  const storage = registry.get(id);
  if (!storage?.mounted) return;
  if (watchers.has(id)) return;

  const stop = watchDatabase(storage.mountPoint, () => {
    broadcastEvent({ type: 'database-changed' });
  });
  watchers.set(id, stop);
}

function stopWatcherForStorage(id: string): void {
  const stop = watchers.get(id);
  if (stop) {
    stop();
    watchers.delete(id);
  }
}

const usbBus = createUsbBus(registry, gadget, config.storageRoot, config.gadgetMountPoint, {
  onBeforeUnmount: stopWatcherForStorage,
  onAfterMount: startWatcherForStorage,
});
await usbBus.recoverStaleState();

const app = createApi(registry, usbBus, broadcastEvent);

// --- Start server ---

const server = Bun.serve({
  port: config.port,

  fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade for /events
    if (url.pathname === '/events') {
      const success = server.upgrade(req);
      if (success) return undefined;
      return new Response('WebSocket upgrade failed', { status: 400 });
    }

    // All other requests go to Hono
    return app.fetch(req);
  },

  websocket: {
    open(ws) {
      wsClients.add(ws);
    },
    close(ws) {
      wsClients.delete(ws);
    },
    message(_ws, _msg) {
      // No incoming messages expected from clients currently
    },
  },
});

// --- Start database watchers for all currently mounted storages ---
for (const storage of registry.list()) {
  if (storage.mounted) {
    startWatcherForStorage(storage.id);
  }
}

console.log(`Virtual iPod server running on http://localhost:${server.port}`);

// --- Graceful shutdown ---

process.on('SIGINT', () => {
  console.log('Shutting down...');
  for (const stop of watchers.values()) stop();
  server.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  for (const stop of watchers.values()) stop();
  server.stop();
  process.exit(0);
});
