/**
 * E2E smoke for `podkit device archive`, run against the built CLI binary.
 *
 * Covers two binary-level paths end to end:
 *
 *  1. **Bare both-stages** — `podkit -d <fixture iPod> device archive <dest>`
 *     runs dump → transform in one invocation, producing a single
 *     self-contained `<name>-<id>-<timestamp>/` directory holding `raw/`
 *     (+ manifest) and `archive/` (+ library.sqlite, README, unified report).
 *  2. **`--from-dump`** — re-running just the transform against the dump the
 *     first run produced, with no device, lands a fresh `archive/` beside it.
 *
 * Coverage note: the dummy iPod target adds **metadata-only** tracks (no audio
 * body), so the archived tracks land in the report's "no audio" bucket and the
 * `Music/` tree carries no extracted files. The full audio-extraction path —
 * real `ipodPath`-backed tracks copied losslessly into `Music/.../NN Title.ext`
 * — needs libgpod-node track copying, which the host e2e harness cannot
 * synthesise; it is exercised at the integration level by
 * `packages/ipod-archive/src/run-archive.integration.test.ts` (and the
 * per-module transform suites). This smoke asserts the binary wiring + the
 * top-level structure, README, and unified two-stage report.
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runCliJson } from '../helpers/cli-runner';
import { createTestIpod } from '@podkit/gpod-testing';

/** The full test-iPod object (path + helper methods like `addTrack`). */
type TestIpodHandle = Awaited<ReturnType<typeof createTestIpod>>;

interface ArchiveBothJson {
  success: boolean;
  stage: string;
  outputDir: string;
  rawDumpDir: string;
  manifestPath: string;
  archiveDir: string;
  fileCount: number;
  written: number;
  noAudioCount: number;
  readmePath: string;
  reportMarkdownPath: string;
  reportJsonPath: string;
}

interface ArchiveTransformJson {
  success: boolean;
  stage: string;
  archiveDir: string;
  readmePath: string;
  reportMarkdownPath: string;
}

/** Whether a path exists as a file. */
async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

describe('podkit device archive (e2e smoke)', () => {
  let ipod: TestIpodHandle;
  let dest: string;

  beforeEach(async () => {
    ipod = await createTestIpod({ name: 'ARCHIVEPOD' });
    await ipod.addTrack({ title: 'Track One', artist: 'Artist A', album: 'Album A' });
    await ipod.addTrack({ title: 'Track Two', artist: 'Artist A', album: 'Album A' });
    dest = await mkdtemp(join(tmpdir(), 'podkit-archive-e2e-'));
  });

  afterEach(async () => {
    await ipod.cleanup();
    await rm(dest, { recursive: true, force: true });
  });

  it('bare invocation runs both stages into one self-contained directory', async () => {
    const { result, json } = await runCliJson<ArchiveBothJson>([
      '--json',
      '--device',
      ipod.path,
      'device',
      'archive',
      dest,
    ]);

    expect(result.exitCode).toBe(0);
    expect(json).not.toBeNull();
    expect(json!.success).toBe(true);
    // The both-stages envelope variant.
    expect(json!.stage).toBe('both');

    const outputDir = json!.outputDir;
    // One self-contained named dir under dest.
    expect(outputDir.startsWith(dest)).toBe(true);

    // ── Stage 1: raw dump tree + manifest ────────────────────────────────────
    expect(json!.rawDumpDir).toBe(join(outputDir, 'raw'));
    expect(json!.manifestPath).toBe(join(outputDir, 'raw', 'manifest.sha256'));
    expect(await isFile(json!.manifestPath)).toBe(true);
    expect(await isFile(join(outputDir, 'raw', 'iPod_Control', 'iTunes', 'iTunesDB'))).toBe(true);
    expect(json!.fileCount).toBeGreaterThan(0);

    // ── Stage 2: archive root with README + report + catalogue ────────────────
    expect(json!.archiveDir).toBe(join(outputDir, 'archive'));
    expect(await isFile(json!.readmePath)).toBe(true);
    expect(await isFile(join(outputDir, 'archive', 'library.sqlite'))).toBe(true);

    const readme = await readFile(json!.readmePath, 'utf8');
    expect(readme).toContain('# iPod Archive');

    // ── Unified report covers BOTH stages (not the transform-only placeholder) ─
    expect(await isFile(json!.reportMarkdownPath)).toBe(true);
    const reportMd = await readFile(json!.reportMarkdownPath, 'utf8');
    expect(reportMd).toContain('## Stage 1 — raw dump');
    expect(reportMd).toContain('## Stage 2 — archive transform');
    expect(reportMd).not.toContain('Not available (transform-only run)');

    const reportJson = JSON.parse(await readFile(json!.reportJsonPath, 'utf8')) as {
      stage1: unknown;
      stage2: unknown;
    };
    expect(reportJson.stage1).not.toBeNull();
    expect(reportJson.stage2).not.toBeNull();

    // Metadata-only dummy tracks → no audio body → no extracted Music files.
    expect(json!.written).toBe(0);
    expect(json!.noAudioCount).toBe(2);
  });

  it('--from-dump re-runs only the transform against an existing dump (device-free)', async () => {
    // First produce a dump-only artifact with the binary.
    const { result: dumpResult, json: dumpJson } = await runCliJson<{
      success: boolean;
      stage: string;
      outputDir: string;
    }>(['--json', '--device', ipod.path, 'device', 'archive', dest, '--dump-only']);

    expect(dumpResult.exitCode).toBe(0);
    expect(dumpJson!.stage).toBe('dump');
    const dumpDir = dumpJson!.outputDir;

    // Now re-run only the transform against that dump — no device involved.
    const { result, json } = await runCliJson<ArchiveTransformJson>([
      '--json',
      'device',
      'archive',
      '--from-dump',
      dumpDir,
    ]);

    expect(result.exitCode).toBe(0);
    expect(json).not.toBeNull();
    expect(json!.success).toBe(true);
    expect(json!.stage).toBe('transform');

    // archive/ landed inside the named dump dir, beside raw/.
    expect(json!.archiveDir).toBe(join(dumpDir, 'archive'));
    expect(await isFile(json!.readmePath)).toBe(true);
    expect(await isFile(json!.reportMarkdownPath)).toBe(true);

    const readme = await readFile(json!.readmePath, 'utf8');
    expect(readme).toContain('# iPod Archive');
  });
});
