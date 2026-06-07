/**
 * Unit tests for the mass-storage manifest rewrite utility (pruneManifestRows).
 *
 * Uses real temp directories with actual files. No adapter is opened —
 * these tests exercise the pure on-disk utility in isolation.
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';
import { pruneManifestRows } from './mass-storage-manifest.js';
import { PODKIT_DIR, MANIFEST_FILE, type MassStorageManifest } from './mass-storage-utils.js';

// =============================================================================
// Helpers
// =============================================================================

function makeStateDir(mountPoint: string): string {
  return path.join(mountPoint, PODKIT_DIR);
}

function seedManifest(stateDir: string, rows: string[]): void {
  fs.mkdirSync(stateDir, { recursive: true });
  const manifest: MassStorageManifest = {
    version: 1,
    managedFiles: rows,
    lastSync: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(stateDir, MANIFEST_FILE), JSON.stringify(manifest) + '\n', 'utf-8');
}

function readManifest(stateDir: string): MassStorageManifest {
  const raw = fs.readFileSync(path.join(stateDir, MANIFEST_FILE), 'utf-8');
  return JSON.parse(raw) as MassStorageManifest;
}

function readManifestRaw(stateDir: string): string {
  return fs.readFileSync(path.join(stateDir, MANIFEST_FILE), 'utf-8');
}

// =============================================================================
// Tests
// =============================================================================

describe('pruneManifestRows()', () => {
  let mountPoint: string;
  let stateDir: string;

  beforeEach(() => {
    mountPoint = fs.mkdtempSync(path.join(tmpdir(), 'podkit-manifest-test-'));
    stateDir = makeStateDir(mountPoint);
  });

  afterEach(() => {
    fs.rmSync(mountPoint, { recursive: true, force: true });
  });

  // ── No-op paths ─────────────────────────────────────────────────────────────

  test('empty pathsToRemove is a no-op — returns { pruned: 0, errors: [] } without touching disk', async () => {
    seedManifest(stateDir, ['Music/keep.m4a']);
    const rawBefore = readManifestRaw(stateDir);

    const result = await pruneManifestRows(stateDir, []);

    expect(result).toEqual({ pruned: 0, errors: [] });
    expect(readManifestRaw(stateDir)).toBe(rawBefore);
  });

  test('missing manifest file — returns { pruned: 0, errors: [] } (nothing to prune)', async () => {
    // stateDir doesn't even exist
    const result = await pruneManifestRows(stateDir, ['Music/ghost.m4a']);

    expect(result).toEqual({ pruned: 0, errors: [] });
  });

  // ── Removal paths ────────────────────────────────────────────────────────────

  test('single row removal — row is gone, others preserved', async () => {
    const keep = 'Music/Artist/Album/01 - Keep.flac';
    const remove = 'Music/Artist/Album/02 - Remove.flac';
    seedManifest(stateDir, [keep, remove]);

    const result = await pruneManifestRows(stateDir, [remove]);

    expect(result.pruned).toBe(1);
    expect(result.errors).toEqual([]);

    const manifest = readManifest(stateDir);
    expect(manifest.managedFiles).toEqual([keep]);
  });

  test('multiple row removal — only specified rows removed', async () => {
    const keep = 'Music/Artist/Album/01 - Keep.flac';
    const removeA = 'Music/Artist/Album/02 - GoneA.flac';
    const removeB = 'Music/Other/Solo/01 - GoneB.mp3';
    seedManifest(stateDir, [keep, removeA, removeB]);

    const result = await pruneManifestRows(stateDir, [removeA, removeB]);

    expect(result.pruned).toBe(2);
    expect(result.errors).toEqual([]);

    const manifest = readManifest(stateDir);
    expect(manifest.managedFiles).toEqual([keep]);
  });

  test('row not in manifest is silently skipped — pruned count reflects actual removals', async () => {
    const keep = 'Music/keep.m4a';
    seedManifest(stateDir, [keep]);

    const result = await pruneManifestRows(stateDir, ['Music/not-in-manifest.m4a']);

    expect(result.pruned).toBe(0);
    expect(result.errors).toEqual([]);

    const manifest = readManifest(stateDir);
    expect(manifest.managedFiles).toEqual([keep]);
  });

  // ── Error / atomic-safety paths ─────────────────────────────────────────────

  test('read-only stateDir — atomic write fails — original manifest preserved', async () => {
    const phantom = 'Music/ghost.m4a';
    const keep = 'Music/keep.m4a';
    seedManifest(stateDir, [phantom, keep]);
    const rawBefore = readManifestRaw(stateDir);

    // Make the stateDir read-only so the atomic tmp-write fails.
    fs.chmodSync(stateDir, 0o500);
    try {
      const result = await pruneManifestRows(stateDir, [phantom]);

      expect(result.pruned).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);
    } finally {
      fs.chmodSync(stateDir, 0o755);
    }

    // Original manifest must be intact — no torn write.
    expect(readManifestRaw(stateDir)).toBe(rawBefore);
  });

  test('unrecognised manifest shape — returns error per path, file untouched', async () => {
    // Write a manifest with a shape the util doesn't understand.
    fs.mkdirSync(stateDir, { recursive: true });
    const weirdManifest = { version: 99, something: 'else' };
    fs.writeFileSync(path.join(stateDir, MANIFEST_FILE), JSON.stringify(weirdManifest), 'utf-8');

    const result = await pruneManifestRows(stateDir, ['Music/ghost.m4a', 'Music/ghost2.m4a']);

    expect(result.pruned).toBe(0);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]!.error.message).toMatch(/Unrecognised manifest shape/);
    expect(result.errors[1]!.error.message).toMatch(/Unrecognised manifest shape/);

    // File must be untouched.
    const raw = fs.readFileSync(path.join(stateDir, MANIFEST_FILE), 'utf-8');
    expect(JSON.parse(raw)).toEqual(weirdManifest);
  });

  // ── Manifest version / structure preserved ──────────────────────────────────

  test('rewritten manifest retains version and other fields', async () => {
    const keep = 'Music/keep.m4a';
    const remove = 'Music/remove.m4a';
    const lastSync = '2025-01-01T00:00:00.000Z';
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(stateDir, MANIFEST_FILE),
      JSON.stringify({ version: 1, managedFiles: [keep, remove], lastSync }),
      'utf-8'
    );

    await pruneManifestRows(stateDir, [remove]);

    const manifest = readManifest(stateDir);
    expect(manifest.version).toBe(1);
    expect(manifest.lastSync).toBe(lastSync);
    expect(manifest.managedFiles).toEqual([keep]);
  });
});
