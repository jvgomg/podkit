import type { ServerWebSocket } from 'bun';
import { existsSync } from 'node:fs';
import { createApi } from './api.js';
import { createGadget } from './gadget.js';
import { createImage, initializeIpodStructure } from './image.js';
import { mountImage, unmountAndDetach, isMountPoint } from './mount.js';
import { watchDatabase } from './watcher.js';
import { DEFAULT_CONFIG } from './types.js';
import type { ServerEvent, ServerConfig } from './types.js';

// --- Configuration ---

const config: ServerConfig = {
  ...DEFAULT_CONFIG,
  port: parseInt(process.env.PORT ?? String(DEFAULT_CONFIG.port), 10),
  imagePath: process.env.IMAGE_PATH ?? DEFAULT_CONFIG.imagePath,
  mountPoint: process.env.MOUNT_POINT ?? DEFAULT_CONFIG.mountPoint,
};

// --- WebSocket client tracking ---

const wsClients = new Set<ServerWebSocket<unknown>>();

function broadcastEvent(event: ServerEvent): void {
  const msg = JSON.stringify(event);
  for (const ws of wsClients) {
    ws.send(msg);
  }
}

// --- Initialize ---

const gadget = createGadget(config);
const app = createApi(gadget, config, broadcastEvent);

/**
 * Ensure the FAT32 image exists. If the image is freshly created,
 * loop-mount it and initialize the iPod directory structure.
 */
async function ensureImage(): Promise<void> {
  const isNew = !existsSync(config.imagePath);
  createImage(config.imagePath, config.imageSizeMb);

  if (isNew) {
    // Temporarily loop-mount the new image to set up iPod structure,
    // then unmount. The gadget plug() will mount it via the USB block device.
    const loopDev = mountImage(config.imagePath, config.mountPoint);
    initializeIpodStructure(config.mountPoint);
    unmountAndDetach(config.mountPoint, loopDev);
  }
}

await ensureImage();

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

// --- Start database watcher if mounted ---

let stopWatcher: (() => void) | null = null;

if (isMountPoint(config.mountPoint)) {
  stopWatcher = watchDatabase(config.mountPoint, () => {
    broadcastEvent({ type: 'database-changed' });
  });
}

console.log(`Virtual iPod server running on http://localhost:${server.port}`);

// --- Graceful shutdown ---

process.on('SIGINT', () => {
  console.log('Shutting down...');
  stopWatcher?.();
  server.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('Shutting down...');
  stopWatcher?.();
  server.stop();
  process.exit(0);
});
