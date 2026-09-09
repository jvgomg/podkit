import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { watchDatabase } from './watcher.js';

/**
 * Wait until `predicate` holds, or fail loudly naming what was awaited.
 *
 * The debounce *window* is a legitimate thing to sleep through (see below),
 * but "the fs watcher noticed the write and the debounced callback fired" is
 * a condition, and conditions get waited for: a fixed sleep here races both
 * the platform's fs-event latency and the scheduler, and under load timer
 * callbacks coalesce. The ceiling keeps a watcher that never fires failing —
 * with a message saying so — instead of hanging to the suite timeout.
 */
async function waitFor(what: string, predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error(`Timed out after ${timeoutMs}ms waiting for ${what}`);
}

describe('watchDatabase', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = join(tmpdir(), `virtual-ipod-test-${Date.now()}`);
    mkdirSync(join(tempDir, 'iPod_Control/iTunes'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  test('returns noop unsubscribe when directory does not exist', () => {
    const nonExistent = join(tmpdir(), 'nonexistent-dir-12345');
    const unsubscribe = watchDatabase(nonExistent, () => {});
    // Should not throw
    unsubscribe();
  });

  test('detects iTunesDB changes with debounce', async () => {
    let callCount = 0;
    const unsubscribe = watchDatabase(
      tempDir,
      () => {
        callCount++;
      },
      100 // short debounce for testing
    );

    // Write iTunesDB file
    writeFileSync(join(tempDir, 'iPod_Control/iTunes/iTunesDB'), 'test data');

    await waitFor('the debounced iTunesDB change callback to fire', () => callCount > 0);

    expect(callCount).toBe(1);
    unsubscribe();
  });

  test('debounces rapid changes into single callback', async () => {
    let callCount = 0;
    const unsubscribe = watchDatabase(
      tempDir,
      () => {
        callCount++;
      },
      200
    );

    // Rapid writes. The 50ms gaps are deliberate fixed sleeps: they space the
    // writes far enough apart that the platform reports three separate change
    // events, while staying inside the 200ms debounce window that is the whole
    // point of the test. They are the passage of time being asserted, not a
    // stand-in for a condition.
    const dbPath = join(tempDir, 'iPod_Control/iTunes/iTunesDB');
    writeFileSync(dbPath, 'data1');
    await new Promise((r) => setTimeout(r, 50));
    writeFileSync(dbPath, 'data2');
    await new Promise((r) => setTimeout(r, 50));
    writeFileSync(dbPath, 'data3');

    await waitFor('the debounced callback to fire after the burst', () => callCount > 0);
    // ...and then hold still past another full debounce window to prove the
    // burst collapsed into exactly one call rather than trickling in.
    await new Promise((r) => setTimeout(r, 400));

    expect(callCount).toBe(1);
    unsubscribe();
  });

  test('unsubscribe stops further callbacks', async () => {
    let callCount = 0;
    const unsubscribe = watchDatabase(
      tempDir,
      () => {
        callCount++;
      },
      100
    );

    unsubscribe();

    // Write after unsubscribe. Negative assertion — nothing is supposed to
    // happen, so there is no condition to wait for and a fixed sleep is the
    // honest instrument. It runs well past the 100ms debounce so a callback
    // that *was* still armed has ample room to fire and be caught.
    writeFileSync(join(tempDir, 'iPod_Control/iTunes/iTunesDB'), 'test data');
    await new Promise((r) => setTimeout(r, 500));

    expect(callCount).toBe(0);
  });
});
