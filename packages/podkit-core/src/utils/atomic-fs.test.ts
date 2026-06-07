import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  atomicCopyFile,
  atomicWriteFile,
  atomicWriteFileWithSync,
  PODKIT_TEMP_SUFFIX,
} from './atomic-fs.js';

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'podkit-atomic-fs-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('atomicCopyFile', () => {
  test('copies file and leaves no temp at dest', () => {
    const src = path.join(tempDir, 'src.bin');
    const dest = path.join(tempDir, 'dest.bin');
    fs.writeFileSync(src, 'hello world');

    atomicCopyFile(src, dest);

    expect(fs.readFileSync(dest, 'utf8')).toBe('hello world');
    expect(fs.existsSync(dest + PODKIT_TEMP_SUFFIX)).toBe(false);
  });

  test('throws and cleans tmp when src missing', () => {
    const src = path.join(tempDir, 'missing.bin');
    const dest = path.join(tempDir, 'dest.bin');

    expect(() => atomicCopyFile(src, dest)).toThrow();

    // No partial dest, no leaked .podkit-tmp sibling
    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.existsSync(dest + PODKIT_TEMP_SUFFIX)).toBe(false);
  });

  test('preserves prior dest when copy fails', () => {
    const src = path.join(tempDir, 'missing.bin');
    const dest = path.join(tempDir, 'dest.bin');
    fs.writeFileSync(dest, 'previous version');

    expect(() => atomicCopyFile(src, dest)).toThrow();

    // Prior dest content intact — the failing copy never overwrote it
    expect(fs.readFileSync(dest, 'utf8')).toBe('previous version');
    expect(fs.existsSync(dest + PODKIT_TEMP_SUFFIX)).toBe(false);
  });
});

describe('atomicWriteFile', () => {
  test('writes file and leaves no temp at dest', () => {
    const dest = path.join(tempDir, 'manifest.json');

    atomicWriteFile(dest, '{"version":1}', 'utf-8');

    expect(fs.readFileSync(dest, 'utf8')).toBe('{"version":1}');
    expect(fs.existsSync(dest + PODKIT_TEMP_SUFFIX)).toBe(false);
  });

  test('preserves prior dest when write fails', () => {
    const dest = path.join(tempDir, 'subdir', 'manifest.json');
    // dest directory does not exist — writeFileSync throws

    expect(() => atomicWriteFile(dest, 'new')).toThrow();

    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.existsSync(dest + PODKIT_TEMP_SUFFIX)).toBe(false);
  });

  test('overwrites prior dest on successful write', () => {
    const dest = path.join(tempDir, 'manifest.json');
    fs.writeFileSync(dest, 'old');

    atomicWriteFile(dest, 'new', 'utf-8');

    expect(fs.readFileSync(dest, 'utf8')).toBe('new');
  });
});

describe('atomicWriteFileWithSync', () => {
  test('writes bytes to dest and leaves no .podkit-tmp', async () => {
    const dest = path.join(tempDir, 'cover.jpg');
    const data = Buffer.from('jpeg-bytes');

    await atomicWriteFileWithSync(dest, data);

    expect(fs.readFileSync(dest).equals(data)).toBe(true);
    expect(fs.existsSync(dest + PODKIT_TEMP_SUFFIX)).toBe(false);
  });

  test('overwrites prior dest on successful write', async () => {
    const dest = path.join(tempDir, 'cover.jpg');
    fs.writeFileSync(dest, 'old');

    await atomicWriteFileWithSync(dest, Buffer.from('new'));

    expect(fs.readFileSync(dest, 'utf8')).toBe('new');
    expect(fs.existsSync(dest + PODKIT_TEMP_SUFFIX)).toBe(false);
  });

  test('open failure: nothing to clean (open never succeeded)', async () => {
    // Destination directory does not exist — open() will fail before any tmp
    // file is created, so there is nothing to unlink.
    const dest = path.join(tempDir, 'nonexistent-subdir', 'cover.jpg');

    await expect(atomicWriteFileWithSync(dest, Buffer.from('data'))).rejects.toThrow();

    expect(fs.existsSync(dest)).toBe(false);
    expect(fs.existsSync(dest + PODKIT_TEMP_SUFFIX)).toBe(false);
  });

  test('fsync failure: tmp is created then cleaned up (not left as debris)', async () => {
    const dest = path.join(tempDir, 'cover.jpg');
    const realOpen = fs.promises.open;
    (fs.promises as { open: typeof fs.promises.open }).open = async (
      ...args: Parameters<typeof realOpen>
    ) => {
      const handle = await realOpen(...args);
      handle.sync = () => Promise.reject(new Error('simulated fsync failure'));
      return handle;
    };
    try {
      await expect(atomicWriteFileWithSync(dest, Buffer.from('data'))).rejects.toThrow(
        'simulated fsync failure'
      );
      // open + writeFile materialised the tmp; cleanup must have removed it.
      expect(fs.existsSync(dest + PODKIT_TEMP_SUFFIX)).toBe(false);
      expect(fs.existsSync(dest)).toBe(false);
    } finally {
      (fs.promises as { open: typeof fs.promises.open }).open = realOpen;
    }
  });

  test('rename failure: dest not created, no .podkit-tmp left', async () => {
    const dest = path.join(tempDir, 'cover.jpg');
    const realRename = fs.promises.rename;
    (fs.promises as { rename: typeof fs.promises.rename }).rename = () =>
      Promise.reject(new Error('simulated rename failure'));
    try {
      await expect(atomicWriteFileWithSync(dest, Buffer.from('data'))).rejects.toThrow(
        'simulated rename failure'
      );
      // No final dest written — rename never completed.
      expect(fs.existsSync(dest)).toBe(false);
      // Tmp cleaned up on rename failure so the next run sees no orphan.
      expect(fs.existsSync(dest + PODKIT_TEMP_SUFFIX)).toBe(false);
    } finally {
      (fs.promises as { rename: typeof fs.promises.rename }).rename = realRename;
    }
  });
});
