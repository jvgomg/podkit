/**
 * Tests for the transcode-tmp debris walker.
 *
 * The walker walks `os.tmpdir()` for `podkit-transcode-<uuid>/` dirs and
 * decides whether each one is abandoned via the `.owner` sibling file:
 *
 * - missing `.owner`, dir older than the grace window → reap (pre-`.owner`
 *   legacy debris OR crash before write)
 * - missing `.owner`, dir freshly touched → skip (a sibling between its
 *   `mkdir` and its `writeOwnership`)
 * - malformed `.owner` → same two cases as missing
 * - `.owner` PID is dead → reap immediately (SIGKILLed prior process)
 * - `.owner` PID live but unverifiable (start-time mismatch) → reap only once
 *   nothing in the dir has been touched for the grace window
 * - `.owner` is the live current process → skip (sibling protection)
 */

import { describe, it, expect } from 'bun:test';
import { mkdtemp, mkdir, readdir, rm, utimes, writeFile } from 'node:fs/promises';
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

/**
 * Push the mtime of a directory and everything in it back so it reads as
 * debris rather than as live work. A day is far outside any grace window.
 */
async function ageOut(dir: string): Promise<void> {
  const old = new Date(Date.now() - 24 * 60 * 60 * 1000);
  for (const entry of await readdir(dir, { recursive: true })) {
    await utimes(join(dir, entry), old, old);
  }
  await utimes(dir, old, old);
}

/** A live PID paired with a start time it cannot have — probes as `unknown`. */
function unverifiableOwner() {
  return { pid: process.pid, startTimeMs: 1_000_000 };
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

  it('reaps aged dirs with no .owner file (legacy debris / pre-owner crash)', async () => {
    await withFakeTmp(async (root) => {
      const dir = await makeTranscodeDir(root, 'aaaa', { 'output.m4a': 'partial' });
      // No `.owner` written.
      await ageOut(dir);
      const result = await walkAbandonedTranscodeDirs(root);
      expect(result).toHaveLength(1);
      expect(result[0]!.path).toContain('podkit-transcode-aaaa');
      expect(result[0]!.bytes).toBe('partial'.length);
    });
  });

  it('reaps aged dirs with malformed .owner', async () => {
    await withFakeTmp(async (root) => {
      const dir = await makeTranscodeDir(root, 'bad-json', { 'output.m4a': 'partial' });
      await writeFile(join(dir, '.owner'), 'not json {');
      await ageOut(dir);
      const result = await walkAbandonedTranscodeDirs(root);
      expect(result).toHaveLength(1);
      expect(result[0]!.path).toContain('podkit-transcode-bad-json');
    });
  });

  // `.owner` cannot be written in the same syscall as the mkdir
  // that precedes it, so there is always a window where a live scratch dir
  // has no owner marker. Reaping in that window deletes the output
  // directory of a running sync, and every transcode after it fails with
  // FFmpeg exit 254 (ENOENT). A missing `.owner` is only ever legitimate on
  // debris, which is by definition not brand new — so age is what separates
  // the two.
  it('SKIPS a fresh dir with no .owner (sibling between mkdir and stamp)', async () => {
    await withFakeTmp(async (root) => {
      await makeTranscodeDir(root, 'mid-setup', { 'wip.m4a': 'still writing' });
      const result = await walkAbandonedTranscodeDirs(root);
      expect(result).toEqual([]);
    });
  });

  it('SKIPS a fresh dir with a half-written .owner', async () => {
    await withFakeTmp(async (root) => {
      const dir = await makeTranscodeDir(root, 'half-stamped', { 'wip.m4a': 'still writing' });
      await writeFile(join(dir, '.owner'), '{"pid":');
      const result = await walkAbandonedTranscodeDirs(root);
      expect(result).toEqual([]);
    });
  });

  it('reaps a fresh dir whose .owner PID is dead, without waiting out the grace window', async () => {
    // The grace window exists only because a missing `.owner` is ambiguous.
    // A dead owner is not ambiguous, so freshness must not protect it —
    // otherwise a SIGKILL leaves debris that the next sync cannot clear.
    await withFakeTmp(async (root) => {
      const dir = await makeTranscodeDir(root, 'fresh-dead', { 'output.m4a': 'partial' });
      await writeOwnership(join(dir, '.owner'), { pid: 999_999, startTimeMs: Date.now() });
      const result = await walkAbandonedTranscodeDirs(root);
      expect(result).toHaveLength(1);
      expect(result[0]!.path).toContain('podkit-transcode-fresh-dead');
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

  it('reaps an aged dir whose .owner PID is reused (start time mismatch)', async () => {
    await withFakeTmp(async (root) => {
      const dir = await makeTranscodeDir(root, 'reused', { 'output.m4a': 'partial' });
      await writeOwnership(join(dir, '.owner'), unverifiableOwner());
      await ageOut(dir);
      const result = await walkAbandonedTranscodeDirs(root);
      expect(result).toHaveLength(1);
      expect(result[0]!.path).toBe(dir);
    });
  });

  // A start-time mismatch is what PID reuse looks like, but it is also what a
  // live owner looks like after a wall-clock step or a slow `ps` probe. Reaping
  // on it would delete a running sync's output directory — so activity, not
  // the probe, has to prove the owner gone.
  it('SKIPS a fresh dir whose live .owner PID cannot be verified', async () => {
    await withFakeTmp(async (root) => {
      const dir = await makeTranscodeDir(root, 'skewed', { 'wip.m4a': 'still writing' });
      await writeOwnership(join(dir, '.owner'), unverifiableOwner());
      const result = await walkAbandonedTranscodeDirs(root);
      expect(result).toEqual([]);
    });
  });

  it('SKIPS an unverifiable-owner dir while a file inside it is still being written', async () => {
    // One long transcode writes into an existing file without touching the
    // directory entry, so the directory's own mtime goes stale mid-run.
    await withFakeTmp(async (root) => {
      const dir = await makeTranscodeDir(root, 'long-transcode', { 'wip.m4a': 'early' });
      await writeOwnership(join(dir, '.owner'), unverifiableOwner());
      await ageOut(dir);
      await writeFile(join(dir, 'wip.m4a'), 'early and later');
      const result = await walkAbandonedTranscodeDirs(root);
      expect(result).toEqual([]);
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
      const dir = await makeTranscodeDir(root, 'cccc', {
        'a.m4a': 'a'.repeat(100),
        'b.m4a': 'b'.repeat(50),
      });
      // No `.owner` + aged out → abandoned.
      await ageOut(dir);
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
      await ageOut(dir);
      const result = await walkAbandonedTranscodeDirs(root);
      expect(result).toHaveLength(1);

      const freed = await removeAbandonedDir(result[0]!);
      expect(freed).toBe(42);
      expect(existsSync(dir)).toBe(false);
    });
  });
});
