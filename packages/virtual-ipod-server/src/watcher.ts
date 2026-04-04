import { watch, existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Watch the iTunesDB file for changes, with debouncing.
 * Returns an unsubscribe function to stop watching.
 *
 * The debounce is important because iTunesDB writes often happen
 * as multiple rapid filesystem operations (podkit sync, iTunes, etc.).
 */
export function watchDatabase(
  mountPoint: string,
  onChange: () => void,
  debounceMs: number = 3000
): () => void {
  const dbDir = join(mountPoint, 'iPod_Control/iTunes');

  if (!existsSync(dbDir)) {
    // Directory doesn't exist yet; nothing to watch
    return () => {};
  }

  let timer: ReturnType<typeof setTimeout> | null = null;

  const watcher = watch(dbDir, { recursive: false }, (_event, filename) => {
    if (filename === 'iTunesDB') {
      if (timer) clearTimeout(timer);
      timer = setTimeout(onChange, debounceMs);
    }
  });

  return () => {
    watcher.close();
    if (timer) clearTimeout(timer);
  };
}
