import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { GadgetController, ServerConfig, ServerEvent, StatusResponse } from './types.js';

/**
 * Convert a colon-separated iPod path to a filesystem path.
 * e.g. ":iPod_Control:Music:F00:ABCD.m4a" -> "/mnt/ipod/iPod_Control/Music/F00/ABCD.m4a"
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

/**
 * Count audio files in the iPod Music directory.
 */
function countTracks(mountPoint: string): number {
  const musicDir = join(mountPoint, 'iPod_Control/Music');
  if (!existsSync(musicDir)) return 0;

  let count = 0;
  try {
    const subdirs = readdirSync(musicDir, { withFileTypes: true });
    for (const subdir of subdirs) {
      if (subdir.isDirectory()) {
        const files = readdirSync(join(musicDir, subdir.name));
        count += files.length;
      }
    }
  } catch {
    // Music directory may not be readable
  }
  return count;
}

const MIME_TYPES: Record<string, string> = {
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  aac: 'audio/aac',
  wav: 'audio/wav',
  aiff: 'audio/aiff',
};

export function createApi(
  gadget: GadgetController,
  config: ServerConfig,
  broadcastEvent: (event: ServerEvent) => void
): Hono {
  const app = new Hono();
  const { mountPoint } = config;

  app.use('*', cors());

  // --- Status ---

  app.get('/status', (c) => {
    const status: StatusResponse = {
      connected: gadget.isPluggedIn(),
      mounted: gadget.isMounted(),
      mountPoint,
      trackCount: countTracks(mountPoint),
    };
    return c.json(status);
  });

  // --- Plug/Unplug ---

  app.post('/plug', async (c) => {
    await gadget.plug();
    broadcastEvent({ type: 'plugged' });
    return c.json({ ok: true });
  });

  app.post('/unplug', async (c) => {
    await gadget.unplug();
    broadcastEvent({ type: 'unplugged' });
    return c.json({ ok: true });
  });

  // --- Database files ---

  app.get('/database', async (c) => {
    const path = join(mountPoint, 'iPod_Control/iTunes/iTunesDB');
    const file = Bun.file(path);
    if (!(await file.exists())) {
      return c.json({ error: 'iTunesDB not found' }, 404);
    }
    return new Response(file);
  });

  app.get('/artwork-db', async (c) => {
    const path = join(mountPoint, 'iPod_Control/Artwork/ArtworkDB');
    const file = Bun.file(path);
    if (!(await file.exists())) {
      return c.json({ error: 'ArtworkDB not found' }, 404);
    }
    return new Response(file);
  });

  app.get('/sysinfo', async (c) => {
    const path = join(mountPoint, 'iPod_Control/Device/SysInfo');
    const file = Bun.file(path);
    if (!(await file.exists())) {
      return c.json({ error: 'SysInfo not found' }, 404);
    }
    const content = await file.text();
    return c.text(content);
  });

  // --- Audio streaming with range request support ---

  app.get('/audio/:path{.+}', async (c) => {
    const ipodPath = decodeURIComponent(c.req.param('path'));
    const fsPath = ipodPathToFs(ipodPath, mountPoint);

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

  return app;
}
