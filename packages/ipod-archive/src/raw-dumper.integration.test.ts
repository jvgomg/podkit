import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, readFile, symlink, chmod, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dump, formatManifest, MANIFEST_FILENAME } from './raw-dumper.js';

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

describe('RawDumper.dump', () => {
  let src: string;
  let dest: string;

  beforeEach(async () => {
    src = await mkdtemp(join(tmpdir(), 'ipod-archive-src-'));
    dest = await mkdtemp(join(tmpdir(), 'ipod-archive-dest-'));
  });

  afterEach(async () => {
    await rm(src, { recursive: true, force: true });
    await rm(dest, { recursive: true, force: true });
  });

  test('copies whitelisted trees, preserving nested structure and bytes', async () => {
    // Build a small iPod-shaped tree.
    await mkdir(join(src, 'iPod_Control', 'Music', 'F00'), { recursive: true });
    await mkdir(join(src, 'iPod_Control', 'iTunes'), { recursive: true });
    await mkdir(join(src, 'Notes'), { recursive: true });

    await writeFile(join(src, 'iPod_Control', 'Music', 'F00', 'ABCD.m4a'), 'audio-bytes');
    await writeFile(join(src, 'iPod_Control', 'iTunes', 'iTunesDB'), 'db-bytes');
    await writeFile(join(src, 'Notes', 'note.txt'), 'hello');
    // a zero-byte file must be copied + hashed too
    await writeFile(join(src, 'iPod_Control', 'iTunes', 'empty'), '');

    const result = await dump(src, ['iPod_Control', 'Notes'], dest);

    expect(result.failures).toEqual([]);

    // Files exist at the mirrored locations with identical bytes.
    expect(await readFile(join(dest, 'iPod_Control', 'Music', 'F00', 'ABCD.m4a'), 'utf8')).toBe(
      'audio-bytes'
    );
    expect(await readFile(join(dest, 'iPod_Control', 'iTunes', 'iTunesDB'), 'utf8')).toBe(
      'db-bytes'
    );
    expect(await readFile(join(dest, 'Notes', 'note.txt'), 'utf8')).toBe('hello');
    expect(await readFile(join(dest, 'iPod_Control', 'iTunes', 'empty'), 'utf8')).toBe('');

    // Manifest has one entry per file with correct hashes + POSIX paths.
    const byPath = new Map(result.manifest.map((e) => [e.relativePath, e.sha256]));
    expect(byPath.get('iPod_Control/Music/F00/ABCD.m4a')).toBe(sha256Hex('audio-bytes'));
    expect(byPath.get('iPod_Control/iTunes/iTunesDB')).toBe(sha256Hex('db-bytes'));
    expect(byPath.get('Notes/note.txt')).toBe(sha256Hex('hello'));
    expect(byPath.get('iPod_Control/iTunes/empty')).toBe(sha256Hex(''));
    expect(result.manifest).toHaveLength(4);
  });

  test('writes a manifest verifiable by shasum -c', async () => {
    await mkdir(join(src, 'iPod_Control', 'Music', 'F00'), { recursive: true });
    await writeFile(join(src, 'iPod_Control', 'Music', 'F00', 'one.m4a'), 'one');
    await writeFile(join(src, 'iPod_Control', 'Music', 'F00', 'two.m4a'), 'two');

    await dump(src, ['iPod_Control'], dest);

    const manifestText = await readFile(join(dest, MANIFEST_FILENAME), 'utf8');
    // Two-space separator + sorted, trailing newline.
    expect(manifestText.endsWith('\n')).toBe(true);
    for (const line of manifestText.trimEnd().split('\n')) {
      expect(line).toMatch(/^[0-9a-f]{64} {2}\S/);
    }

    // Resolve `shasum` (macOS) or `sha256sum` (Linux); skip if neither exists.
    const checker = ['shasum', 'sha256sum'].find(
      (bin) => spawnSync('sh', ['-c', `command -v ${bin}`]).status === 0
    );
    if (!checker) return;

    const args =
      checker === 'shasum' ? ['-a', '256', '-c', MANIFEST_FILENAME] : ['-c', MANIFEST_FILENAME];
    const check = spawnSync(checker, args, { cwd: dest, encoding: 'utf8' });
    expect(check.status).toBe(0);
    expect(check.stdout).toContain('OK');
  });

  test('records a missing whitelist entry as a failure without aborting', async () => {
    await mkdir(join(src, 'Notes'), { recursive: true });
    await writeFile(join(src, 'Notes', 'kept.txt'), 'kept');

    const result = await dump(src, ['iPod_Control', 'Notes'], dest);

    // The present entry still copied.
    expect(await readFile(join(dest, 'Notes', 'kept.txt'), 'utf8')).toBe('kept');
    expect(result.manifest.map((e) => e.relativePath)).toEqual(['Notes/kept.txt']);
    // The absent one is a recorded failure.
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.path).toBe('iPod_Control');
  });

  test('records an unreadable file as a failure but copies its siblings', async () => {
    // chmod-based unreadability is meaningless as root — skip there.
    if (typeof process.getuid === 'function' && process.getuid() === 0) return;

    await mkdir(join(src, 'iPod_Control', 'Music', 'F00'), { recursive: true });
    await writeFile(join(src, 'iPod_Control', 'Music', 'F00', 'good.m4a'), 'good');
    const badFile = join(src, 'iPod_Control', 'Music', 'F00', 'bad.m4a');
    await writeFile(badFile, 'secret');
    await chmod(badFile, 0o000);

    try {
      const result = await dump(src, ['iPod_Control'], dest);

      // Sibling copied + hashed.
      expect(await readFile(join(dest, 'iPod_Control', 'Music', 'F00', 'good.m4a'), 'utf8')).toBe(
        'good'
      );
      expect(result.manifest.map((e) => e.relativePath)).toContain(
        'iPod_Control/Music/F00/good.m4a'
      );
      expect(result.manifest.map((e) => e.relativePath)).not.toContain(
        'iPod_Control/Music/F00/bad.m4a'
      );

      // The unreadable file is recorded, not thrown.
      expect(result.failures.map((f) => f.path)).toContain('iPod_Control/Music/F00/bad.m4a');
    } finally {
      // Restore perms so cleanup can remove it.
      await chmod(badFile, 0o644);
    }
  });

  test('skips symlinks and records them as failures', async () => {
    await mkdir(join(src, 'Notes'), { recursive: true });
    await writeFile(join(src, 'Notes', 'real.txt'), 'real');
    await symlink(join(src, 'Notes', 'real.txt'), join(src, 'Notes', 'link.txt'));

    const result = await dump(src, ['Notes'], dest);

    expect(result.manifest.map((e) => e.relativePath)).toEqual(['Notes/real.txt']);
    // The link is not copied.
    const destNotes = await readdir(join(dest, 'Notes'));
    expect(destNotes).toEqual(['real.txt']);
    expect(result.failures.map((f) => f.path)).toContain('Notes/link.txt');
  });
});

describe('formatManifest', () => {
  test('sorts by path and uses a two-space separator', () => {
    const text = formatManifest([
      { sha256: 'b'.repeat(64), relativePath: 'z/file' },
      { sha256: 'a'.repeat(64), relativePath: 'a/file' },
    ]);
    expect(text).toBe(`${'a'.repeat(64)}  a/file\n${'b'.repeat(64)}  z/file\n`);
  });

  test('empty manifest is the empty string (no stray newline)', () => {
    expect(formatManifest([])).toBe('');
  });
});
