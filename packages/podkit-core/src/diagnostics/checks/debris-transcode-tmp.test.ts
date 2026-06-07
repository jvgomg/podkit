/**
 * Tests for the transcode-tmp debris check.
 *
 * The check walks `os.tmpdir()` for `podkit-transcode-<uuid>/` dirs older
 * than the current session and reaps them. The mtime safety floor protects
 * concurrent sibling podkit processes — a dir younger than the floor is
 * left alone.
 */

import { describe, it, expect } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile, utimes } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  walkAbandonedTranscodeDirs,
  removeAbandonedDir,
} from '../scanners/transcode-tmp-walker.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build an isolated host-tmp root for each test so we don't pollute the
 * real /tmp. The walker accepts an explicit root via its first arg.
 */
async function withFakeTmp<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(join(tmpdir(), 'podkit-tt-test-'));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function makeTranscodeDir(
  root: string,
  uuid: string,
  ageMs: number,
  files: Record<string, string> = {}
): Promise<string> {
  const dir = join(root, `podkit-transcode-${uuid}`);
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content);
  }
  // Stamp mtime to `ageMs` ago.
  const stampSec = (Date.now() - ageMs) / 1000;
  await utimes(dir, stampSec, stampSec);
  return dir;
}

// ── Walker ───────────────────────────────────────────────────────────────────

describe('walkAbandonedTranscodeDirs', () => {
  it('returns empty when tmpdir has no podkit-transcode-* entries', async () => {
    await withFakeTmp(async (root) => {
      await mkdir(join(root, 'unrelated-dir'), { recursive: true });
      await writeFile(join(root, 'some-file.txt'), 'data');
      const sessionStartMs = Date.now();
      const result = await walkAbandonedTranscodeDirs(root, sessionStartMs);
      expect(result).toEqual([]);
    });
  });

  it('flags directories older than sessionStartMs', async () => {
    await withFakeTmp(async (root) => {
      // 60 seconds older than now.
      await makeTranscodeDir(root, 'aaaa', 60_000, { 'output.m4a': 'partial' });
      const result = await walkAbandonedTranscodeDirs(root, Date.now());
      expect(result).toHaveLength(1);
      expect(result[0]!.path).toContain('podkit-transcode-aaaa');
      expect(result[0]!.bytes).toBe('partial'.length);
    });
  });

  it('SKIPS directories younger than sessionStartMs (sibling process is live)', async () => {
    await withFakeTmp(async (root) => {
      // mtime is "now" — session start was 10 seconds ago, so this dir is
      // newer than the floor.
      const tenSecAgo = Date.now() - 10_000;
      await makeTranscodeDir(root, 'live-bbbb', 0, { 'wip.m4a': 'still writing' });
      const result = await walkAbandonedTranscodeDirs(root, tenSecAgo);
      expect(result).toEqual([]);
    });
  });

  it('does not match dirs that lack the podkit-transcode- prefix', async () => {
    await withFakeTmp(async (root) => {
      // Look-alike dirs from other tools must not be touched.
      const dir = join(root, 'transcode-leftover-xxxx');
      await mkdir(dir, { recursive: true });
      const stampSec = (Date.now() - 60_000) / 1000;
      await utimes(dir, stampSec, stampSec);
      const result = await walkAbandonedTranscodeDirs(root, Date.now());
      expect(result).toEqual([]);
    });
  });

  it('aggregates sizes across multiple files within a dir', async () => {
    await withFakeTmp(async (root) => {
      await makeTranscodeDir(root, 'cccc', 60_000, {
        'a.m4a': 'a'.repeat(100),
        'b.m4a': 'b'.repeat(50),
      });
      const result = await walkAbandonedTranscodeDirs(root, Date.now());
      expect(result).toHaveLength(1);
      expect(result[0]!.bytes).toBe(150);
    });
  });

  it('handles a missing tmpdir gracefully', async () => {
    const result = await walkAbandonedTranscodeDirs('/nonexistent-path-7f7f7f', Date.now());
    expect(result).toEqual([]);
  });
});

// ── Reaper ───────────────────────────────────────────────────────────────────

describe('removeAbandonedDir', () => {
  it('removes the directory and reports bytes freed', async () => {
    await withFakeTmp(async (root) => {
      const dir = await makeTranscodeDir(root, 'dddd', 60_000, {
        'out.m4a': 'x'.repeat(42),
      });
      const result = await walkAbandonedTranscodeDirs(root, Date.now());
      expect(result).toHaveLength(1);

      const freed = await removeAbandonedDir(result[0]!);
      expect(freed).toBe(42);
      expect(existsSync(dir)).toBe(false);
    });
  });
});
