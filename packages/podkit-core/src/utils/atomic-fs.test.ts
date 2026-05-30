import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { atomicCopyFile, atomicWriteFile, PODKIT_TEMP_SUFFIX } from './atomic-fs.js';

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
