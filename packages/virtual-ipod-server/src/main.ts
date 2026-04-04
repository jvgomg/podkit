import type { ServerWebSocket } from 'bun';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
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

const EVENT_LABELS: Record<ServerEvent['type'], string> = {
  plugged: 'iPod plugged in',
  unplugged: 'iPod unplugged',
  reset: 'iPod reset to factory state',
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

const gadget = createGadget(config);

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

/**
 * Reset the virtual iPod to factory state.
 *
 * When plugged: unmount, reformat the partition in-place via the gadget's
 * block device, reinitialize the iPod directory structure, and remount.
 * This avoids tearing down the USB gadget (which causes block device
 * reappearance timing issues).
 *
 * When unplugged: delete and recreate the disk image from scratch.
 */
async function resetIpod(): Promise<void> {
  if (gadget.isPluggedIn()) {
    // Gadget has the image open as a block device — reformat in-place.
    // Deleting the image file while the gadget is bound would leave it
    // with a stale file handle, so we always use the block device path.
    if (gadget.isMounted()) {
      execSync(`umount ${config.mountPoint}`);
    }

    // Find the block device backing the gadget (sda1 or sda)
    const blockDev = existsSync('/dev/sda1') ? '/dev/sda1' : '/dev/sda';
    execSync(`mkfs.vfat -F 32 -n IPOD ${blockDev}`);

    mkdirSync(config.mountPoint, { recursive: true });
    execSync(`mount -o fmask=0000,dmask=0000 ${blockDev} ${config.mountPoint}`);
    initializeIpodStructure(config.mountPoint);
  } else {
    // Not plugged — safe to delete and recreate the image file
    rmSync(config.imagePath, { force: true });
    await ensureImage();
  }
}

await ensureImage();

// If the gadget was plugged in a previous session but the filesystem mount was
// lost (e.g. after a server restart), remount so the database is accessible.
if (gadget.isPluggedIn() && !gadget.isMounted()) {
  try {
    await gadget.plug();
    console.log('Remounted iPod filesystem on startup');
  } catch (e) {
    // Block device is gone — gadget state is stale from a previous session.
    // Unplug to clean up so the user can start fresh with POST /plug.
    console.warn('Stale gadget state on startup, cleaning up:', e instanceof Error ? e.message : e);
    try {
      await gadget.unplug();
    } catch {
      /* best effort */
    }
  }
}

const app = createApi(gadget, config, broadcastEvent, resetIpod);

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
