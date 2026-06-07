/**
 * Tests for the transcode-tmp debris walker.
 *
 * The walker walks `os.tmpdir()` for `podkit-transcode-<uuid>/` dirs and
 * decides whether each one is abandoned via the `.owner` sibling file:
 *
 * - missing `.owner` → reap (pre-`.owner` legacy debris OR crash before write)
 * - malformed `.owner` → reap (treat as no owner)
 * - `.owner` PID is dead → reap (SIGKILLed prior process)
 * - `.owner` start-time mismatch → reap (PID reuse guard)
 * - `.owner` is the live current process → skip (sibling protection)
 */

import { describe, it, expect } from 'bun:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  walkAbandonedTranscodeDirs,
  removeAbandonedDir,
} from '../scanners/transcode-tmp-walker.js';
import { writeOwnership, getOwnIdentity } from '../../lib/pid-file.js';

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
  files: Record<string, string> = {}
): Promise<string> {
  const dir = join(root, `podkit-transcode-${uuid}`);
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(dir, name), content);
  }
  return dir;
}

// ── Walker ───────────────────────────────────────────────────────────────────

describe('walkAbandonedTranscodeDirs', () => {
  it('returns empty when tmpdir has no podkit-transcode-* entries', async () => {
    await withFakeTmp(async (root) => {
      await mkdir(join(root, 'unrelated-dir'), { recursive: true });
      await writeFile(join(root, 'some-file.txt'), 'data');
      const result = await walkAbandonedTranscodeDirs(root);
      expect(result).toEqual([]);
    });
  });

  it('reaps dirs with no .owner file (legacy debris / pre-owner crash)', async () => {
    await withFakeTmp(async (root) => {
      await makeTranscodeDir(root, 'aaaa', { 'output.m4a': 'partial' });
      // No `.owner` written.
      const result = await walkAbandonedTranscodeDirs(root);
      expect(result).toHaveLength(1);
      expect(result[0]!.path).toContain('podkit-transcode-aaaa');
      expect(result[0]!.bytes).toBe('partial'.length);
    });
  });

  it('reaps dirs with malformed .owner', async () => {
    await withFakeTmp(async (root) => {
      const dir = await makeTranscodeDir(root, 'bad-json', { 'output.m4a': 'partial' });
      await writeFile(join(dir, '.owner'), 'not json {');
      const result = await walkAbandonedTranscodeDirs(root);
      expect(result).toHaveLength(1);
      expect(result[0]!.path).toContain('podkit-transcode-bad-json');
    });
  });

  it('SKIPS dirs whose .owner is the current live process', async () => {
    await withFakeTmp(async (root) => {
      const dir = await makeTranscodeDir(root, 'live', { 'wip.m4a': 'still writing' });
      // Use our own real PID + start time.
      await writeOwnership(join(dir, '.owner'), getOwnIdentity());
      const result = await walkAbandonedTranscodeDirs(root);
      expect(result).toEqual([]);
    });
  });

  it('reaps dirs whose .owner PID is dead', async () => {
    await withFakeTmp(async (root) => {
      const dir = await makeTranscodeDir(root, 'dead', { 'output.m4a': 'partial' });
      // 999_999 is virtually never a live pid on test hosts.
      await writeOwnership(join(dir, '.owner'), {
        pid: 999_999,
        startTimeMs: Date.now() - 60_000,
      });
      const result = await walkAbandonedTranscodeDirs(root);
      expect(result).toHaveLength(1);
      expect(result[0]!.path).toBe(dir);
    });
  });

  it('reaps dirs whose .owner PID is reused (start time mismatch)', async () => {
    await withFakeTmp(async (root) => {
      const dir = await makeTranscodeDir(root, 'reused', { 'output.m4a': 'partial' });
      // Claim the current process's PID but with a start time from way
      // back — the liveness probe sees the PID is alive but the start time
      // doesn't match, so it must treat the owner as dead.
      await writeOwnership(join(dir, '.owner'), {
        pid: process.pid,
        startTimeMs: 1_000_000, // ~1970
      });
      const result = await walkAbandonedTranscodeDirs(root);
      expect(result).toHaveLength(1);
      expect(result[0]!.path).toBe(dir);
    });
  });

  it('does not match dirs that lack the podkit-transcode- prefix', async () => {
    await withFakeTmp(async (root) => {
      // Look-alike dirs from other tools must not be touched.
      const dir = join(root, 'transcode-leftover-xxxx');
      await mkdir(dir, { recursive: true });
      const result = await walkAbandonedTranscodeDirs(root);
      expect(result).toEqual([]);
    });
  });

  it('aggregates sizes across multiple files within an abandoned dir', async () => {
    await withFakeTmp(async (root) => {
      await makeTranscodeDir(root, 'cccc', {
        'a.m4a': 'a'.repeat(100),
        'b.m4a': 'b'.repeat(50),
      });
      // No `.owner` → abandoned.
      const result = await walkAbandonedTranscodeDirs(root);
      expect(result).toHaveLength(1);
      expect(result[0]!.bytes).toBe(150);
    });
  });

  it('handles a missing tmpdir gracefully', async () => {
    const result = await walkAbandonedTranscodeDirs('/nonexistent-path-7f7f7f');
    expect(result).toEqual([]);
  });
});

// ── Reaper ───────────────────────────────────────────────────────────────────

describe('removeAbandonedDir', () => {
  it('removes the directory and reports bytes freed', async () => {
    await withFakeTmp(async (root) => {
      const dir = await makeTranscodeDir(root, 'dddd', { 'out.m4a': 'x'.repeat(42) });
      const result = await walkAbandonedTranscodeDirs(root);
      expect(result).toHaveLength(1);

      const freed = await removeAbandonedDir(result[0]!);
      expect(freed).toBe(42);
      expect(existsSync(dir)).toBe(false);
    });
  });
});
