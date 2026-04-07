import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import type { ServerEvent } from './types.js';
import type { StorageRegistry } from './storage.js';
import type { UsbBus } from './usb.js';

/**
 * Convert a colon-separated iPod path to a filesystem path.
 * e.g. ":iPod_Control:Music:F00:ABCD.m4a" -> "/mnt/ipod/storages/default/iPod_Control/Music/F00/ABCD.m4a"
 */
export function ipodPathToFs(ipodPath: string, mountPoint: string): string {
  // The path may or may not have a leading colon; normalize by replacing all colons with slashes
  const relativePath = ipodPath.replace(/:/g, '/');
  // Ensure we don't double-slash between mountPoint and relativePath
  if (relativePath.startsWith('/')) {
    return mountPoint + relativePath;
  }
  return mountPoint + '/' + relativePath;
}

const MIME_TYPES: Record<string, string> = {
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  aac: 'audio/aac',
  wav: 'audio/wav',
  aiff: 'audio/aiff',
};

export function createApi(
  registry: StorageRegistry,
  usbBus: UsbBus,
  broadcastEvent: (event: ServerEvent) => void
): Hono {
  const app = new Hono();

  app.use('*', cors());

  // --- Storage Registry ---

  app.get('/ipods', (c) => {
    return c.json(registry.list());
  });

  app.post('/ipods', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const id = (body as { id?: string }).id ?? 'default';
    try {
      const storage = await registry.create(id);
      broadcastEvent({ type: 'storage-created' });
      return c.json(storage, 201);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'Create failed' }, 500);
    }
  });

  app.delete('/ipods/:id', async (c) => {
    const id = c.req.param('id');

    // Auto-unplug if this iPod is on the USB bus
    const usb = usbBus.status();
    if (usb.pluggedIn && usb.ipodId === id) {
      await usbBus.unplug();
      broadcastEvent({ type: 'unplugged' });
    }

    try {
      await registry.wipe(id);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'Wipe failed' }, 500);
    }
    broadcastEvent({ type: 'storage-wiped' });
    return c.json({ ok: true });
  });

  // --- iPod file access ---

  app.get('/ipods/:id/database', async (c) => {
    const id = c.req.param('id');
    const storage = registry.get(id);
    if (!storage) return c.json({ error: `iPod '${id}' not found` }, 404);
    if (!storage.mounted) return c.json({ error: 'iPod storage is not mounted' }, 404);

    const path = join(storage.mountPoint, 'iPod_Control/iTunes/iTunesDB');
    const file = Bun.file(path);
    if (!(await file.exists())) {
      return c.json({ error: 'iTunesDB not found' }, 404);
    }
    return new Response(file);
  });

  app.get('/ipods/:id/artwork-db', async (c) => {
    const id = c.req.param('id');
    const storage = registry.get(id);
    if (!storage) return c.json({ error: `iPod '${id}' not found` }, 404);
    if (!storage.mounted) return c.json({ error: 'iPod storage is not mounted' }, 404);

    const path = join(storage.mountPoint, 'iPod_Control/Artwork/ArtworkDB');
    const file = Bun.file(path);
    if (!(await file.exists())) {
      return c.json({ error: 'ArtworkDB not found' }, 404);
    }
    return new Response(file);
  });

  app.get('/ipods/:id/sysinfo', async (c) => {
    const id = c.req.param('id');
    const storage = registry.get(id);
    if (!storage) return c.json({ error: `iPod '${id}' not found` }, 404);
    if (!storage.mounted) return c.json({ error: 'iPod storage is not mounted' }, 404);

    const path = join(storage.mountPoint, 'iPod_Control/Device/SysInfo');
    const file = Bun.file(path);
    if (!(await file.exists())) {
      return c.json({ error: 'SysInfo not found' }, 404);
    }
    const content = await file.text();
    return c.text(content);
  });

  app.get('/ipods/:id/artwork-files', async (c) => {
    const id = c.req.param('id');
    const storage = registry.get(id);
    if (!storage) return c.json({ error: `iPod '${id}' not found` }, 404);
    if (!storage.mounted) return c.json({ error: 'iPod storage is not mounted' }, 404);

    const artworkDir = join(storage.mountPoint, 'iPod_Control/Artwork');
    try {
      const entries = readdirSync(artworkDir, { withFileTypes: true });
      const files = entries
        .filter((e) => e.isFile() && e.name.endsWith('.ithmb'))
        .map((e) => e.name)
        .sort();
      return c.json({ files });
    } catch {
      return c.json({ files: [] });
    }
  });

  app.get('/ipods/:id/artwork-files/:filename', async (c) => {
    const id = c.req.param('id');
    const filename = c.req.param('filename');
    const storage = registry.get(id);
    if (!storage) return c.json({ error: `iPod '${id}' not found` }, 404);
    if (!storage.mounted) return c.json({ error: 'iPod storage is not mounted' }, 404);

    if (!filename.endsWith('.ithmb') || filename.includes('/') || filename.includes('..')) {
      return c.json({ error: 'Invalid filename' }, 400);
    }

    const fsPath = join(storage.mountPoint, 'iPod_Control/Artwork', filename);
    const file = Bun.file(fsPath);
    if (!(await file.exists())) {
      return c.json({ error: 'File not found' }, 404);
    }
    return new Response(file, {
      headers: { 'Content-Type': 'application/octet-stream' },
    });
  });

  app.get('/ipods/:id/audio/:path{.+}', async (c) => {
    const id = c.req.param('id');
    const storage = registry.get(id);
    if (!storage) return c.json({ error: `iPod '${id}' not found` }, 404);
    if (!storage.mounted) return c.json({ error: 'iPod storage is not mounted' }, 404);

    const ipodPath = decodeURIComponent(c.req.param('path'));
    const fsPath = ipodPathToFs(ipodPath, storage.mountPoint);

    const file = Bun.file(fsPath);
    if (!(await file.exists())) {
      return c.json({ error: 'File not found' }, 404);
    }

    // Determine MIME type from extension
    const ext = fsPath.split('.').pop()?.toLowerCase() ?? '';
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';

    const fileSize = file.size;

    // Handle range requests for seeking
    const range = c.req.header('Range');
    if (range) {
      const match = range.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        const start = parseInt(match[1]!, 10);
        const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
        const chunkSize = end - start + 1;

        const slice = file.slice(start, end + 1);
        return new Response(slice, {
          status: 206,
          headers: {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': String(chunkSize),
            'Content-Type': contentType,
          },
        });
      }
    }

    return new Response(file, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(fileSize),
        'Accept-Ranges': 'bytes',
      },
    });
  });

  // --- USB Bus ---

  app.post('/usb/plug', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const ipodId = (body as { ipodId?: string }).ipodId;
    if (!ipodId) {
      return c.json({ error: 'ipodId is required' }, 400);
    }
    try {
      await usbBus.plug(ipodId);
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'Plug failed' }, 500);
    }
    broadcastEvent({ type: 'plugged' });
    return c.json({ ok: true });
  });

  app.post('/usb/unplug', async (c) => {
    try {
      await usbBus.unplug();
    } catch (e) {
      return c.json({ error: e instanceof Error ? e.message : 'Unplug failed' }, 500);
    }
    broadcastEvent({ type: 'unplugged' });
    return c.json({ ok: true });
  });

  app.get('/usb/status', (c) => {
    return c.json(usbBus.status());
  });

  return app;
}
