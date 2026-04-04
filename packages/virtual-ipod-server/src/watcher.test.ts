import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { watchDatabase } from './watcher.js';

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

    // Wait for debounce
    await new Promise((r) => setTimeout(r, 250));

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

    // Rapid writes
    const dbPath = join(tempDir, 'iPod_Control/iTunes/iTunesDB');
    writeFileSync(dbPath, 'data1');
    await new Promise((r) => setTimeout(r, 50));
    writeFileSync(dbPath, 'data2');
    await new Promise((r) => setTimeout(r, 50));
    writeFileSync(dbPath, 'data3');

    // Wait for debounce to settle
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

    // Write after unsubscribe
    writeFileSync(join(tempDir, 'iPod_Control/iTunes/iTunesDB'), 'test data');
    await new Promise((r) => setTimeout(r, 250));

    expect(callCount).toBe(0);
  });
});
