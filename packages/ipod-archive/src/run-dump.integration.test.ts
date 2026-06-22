import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, mkdir, writeFile, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runDump, RAW_DUMP_SUBDIR, REPORT_MD_FILENAME, REPORT_JSON_FILENAME } from './run-dump.js';
import { MANIFEST_FILENAME } from './raw-dumper.js';
import { IpodArchiveError } from './errors.js';

const FIXED = new Date(Date.UTC(2026, 5, 22, 9, 7, 3));

describe('runDump', () => {
  let volume: string;
  let dest: string;

  beforeEach(async () => {
    volume = await mkdtemp(join(tmpdir(), 'ipod-archive-vol-'));
    dest = await mkdtemp(join(tmpdir(), 'ipod-archive-out-'));
  });

  afterEach(async () => {
    await rm(volume, { recursive: true, force: true });
    await rm(dest, { recursive: true, force: true });
  });

  async function seedStockIpod(): Promise<void> {
    await mkdir(join(volume, 'iPod_Control', 'Music', 'F00'), { recursive: true });
    await mkdir(join(volume, 'iPod_Control', 'iTunes'), { recursive: true });
    await mkdir(join(volume, 'Notes'), { recursive: true });
    await writeFile(join(volume, 'iPod_Control', 'Music', 'F00', 'song.m4a'), 'song');
    await writeFile(join(volume, 'iPod_Control', 'iTunes', 'iTunesDB'), 'db');
    await writeFile(join(volume, 'Notes', 'note.txt'), 'note');
    // junk + foreign at the root
    await writeFile(join(volume, '.DS_Store'), '');
    await writeFile(join(volume, 'home-movie.mov'), 'foreign');
  }

  test('produces <name>/raw dump/ layout with manifest and classified buckets', async () => {
    await seedStockIpod();

    const result = await runDump(volume, dest, {
      deviceName: 'TERAPOD',
      volumeLabel: 'IPOD',
      now: FIXED,
    });

    // Named output dir lives under dest; no serial fixture, so it degrades to
    // the volume label as the identity token.
    expect(result.outputDir).toBe(join(dest, 'TERAPOD-IPOD-20260622-090703'));
    expect(result.rawDumpDir).toBe(join(result.outputDir, RAW_DUMP_SUBDIR));
    expect(result.manifestPath).toBe(join(result.rawDumpDir, MANIFEST_FILENAME));

    // Whitelisted data copied into the raw dump tree.
    expect(await readFile(join(result.rawDumpDir, 'Notes', 'note.txt'), 'utf8')).toBe('note');
    expect(
      await readFile(join(result.rawDumpDir, 'iPod_Control', 'Music', 'F00', 'song.m4a'), 'utf8')
    ).toBe('song');
    const manifestText = await readFile(result.manifestPath, 'utf8');
    expect(manifestText).toContain('Notes/note.txt');
    expect(manifestText).toContain('iPod_Control/Music/F00/song.m4a');

    // Classification surfaced for the report stage.
    expect(result.classification.copy.sort()).toEqual(['Notes', 'iPod_Control']);
    expect(result.classification.junk).toEqual(['.DS_Store']);
    expect(result.classification.foreign).toEqual(['home-movie.mov']);

    // Foreign files and junk (hardcoded macOS system files) are NOT copied.
    await expect(stat(join(result.rawDumpDir, 'home-movie.mov'))).rejects.toThrow();
    await expect(stat(join(result.rawDumpDir, '.DS_Store'))).rejects.toThrow();

    expect(result.failures).toEqual([]);

    // A dump-only run still emits its paper trail: report.{md,json} at the
    // archive root listing the foreign file that was skipped.
    expect(result.reportMarkdownPath).toBe(join(result.outputDir, REPORT_MD_FILENAME));
    expect(result.reportJsonPath).toBe(join(result.outputDir, REPORT_JSON_FILENAME));

    const reportMd = await readFile(result.reportMarkdownPath, 'utf8');
    expect(reportMd).toContain('### Foreign files skipped (not copied) (1)');
    expect(reportMd).toContain('`home-movie.mov`');
    // Junk (.DS_Store) is intentionally not surfaced in the report.
    expect(reportMd).not.toContain('Junk skipped');
    expect(reportMd).not.toContain('`.DS_Store`');
    // No transform ran → stage-2 section reports "Not run".
    expect(reportMd).toContain('Not run (dump-only run)');

    const reportJson = JSON.parse(await readFile(result.reportJsonPath, 'utf8')) as {
      stage1: { foreignSkipped: string[] };
      stage2: unknown;
    };
    expect(reportJson.stage1.foreignSkipped).toEqual(['home-movie.mov']);
    expect(reportJson.stage1).not.toHaveProperty('junkSkipped');
    expect(reportJson.stage2).toBeNull();
  });

  test('degrades the directory name to timestamp-only when nothing identifies the device', async () => {
    await mkdir(join(volume, 'iPod_Control'), { recursive: true });

    const result = await runDump(volume, dest, { deviceName: '', volumeLabel: '', now: FIXED });
    expect(result.outputDir).toBe(join(dest, '20260622-090703'));
  });

  test('throws a typed error when the volume path is not a directory', async () => {
    const filePath = join(volume, 'not-a-dir');
    await writeFile(filePath, 'x');
    await expect(runDump(filePath, dest, { now: FIXED })).rejects.toBeInstanceOf(IpodArchiveError);
  });

  test('throws DEST_NOT_WRITABLE when the destination directory cannot be created', async () => {
    // chmod-based unwritability is meaningless as root — skip there.
    if (typeof process.getuid === 'function' && process.getuid() === 0) return;

    await mkdir(join(volume, 'iPod_Control'), { recursive: true });

    // Make dest itself unwritable so mkdir inside it fails with EACCES.
    const { chmod } = await import('node:fs/promises');
    await chmod(dest, 0o555);
    try {
      const err = await runDump(volume, dest, { now: FIXED }).catch((e) => e);
      expect(err).toBeInstanceOf(IpodArchiveError);
      expect((err as IpodArchiveError).code).toBe('DEST_NOT_WRITABLE');
    } finally {
      await chmod(dest, 0o755);
    }
  });
});
