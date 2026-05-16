/**
 * Unit tests for the centralised HFS+-on-Linux filesystem policy.
 *
 * The helper has three callers — the readiness pipeline (warns at scan
 * time), `device add` --path, and `device add` scan-found. Each calls
 * `isFilesystemUnsupportedHere` rather than re-implementing the
 * platform/fstype check, so this test file pins the matrix of cases.
 *
 * Pure: no I/O, no `process.platform` mutation — the helper accepts an
 * explicit `platform` argument that lets us exercise the macOS branch from
 * a Darwin or Linux test runner without monkey-patching globals.
 */
import { describe, expect, it } from 'bun:test';
import {
  isFilesystemUnsupportedHere,
  formatHfsplusOnLinuxRefusal,
  LINUX_FILESYSTEMS_DOCS_URL,
} from './filesystem-policy.js';

describe('isFilesystemUnsupportedHere', () => {
  it('refuses HFS+ on Linux', () => {
    expect(isFilesystemUnsupportedHere('hfsplus', 'linux')).toBe(true);
  });

  it('case-insensitive on the filesystem string', () => {
    // lsblk normally lower-cases, but blkid and friends sometimes shout.
    // Keep the helper tolerant — the policy is filesystem-not-string-case based.
    expect(isFilesystemUnsupportedHere('HFSPLUS', 'linux')).toBe(true);
    expect(isFilesystemUnsupportedHere('HfsPlus', 'linux')).toBe(true);
  });

  it('allows HFS+ on macOS — refusal is Linux-only', () => {
    expect(isFilesystemUnsupportedHere('hfsplus', 'darwin')).toBe(false);
  });

  it('allows HFS+ on Windows (no policy defined there yet)', () => {
    // win32 has its own story — podkit does not currently support iPod sync
    // on Windows, but the *filesystem* check should not fire there.
    expect(isFilesystemUnsupportedHere('hfsplus', 'win32')).toBe(false);
  });

  it('allows FAT32 (vfat) on Linux', () => {
    expect(isFilesystemUnsupportedHere('vfat', 'linux')).toBe(false);
  });

  it('allows ExFAT on Linux', () => {
    expect(isFilesystemUnsupportedHere('exfat', 'linux')).toBe(false);
  });

  it('returns false for undefined filesystem (no policy when nothing is known)', () => {
    expect(isFilesystemUnsupportedHere(undefined, 'linux')).toBe(false);
    expect(isFilesystemUnsupportedHere(null, 'linux')).toBe(false);
    expect(isFilesystemUnsupportedHere('', 'linux')).toBe(false);
  });

  it('defaults the platform argument to process.platform', () => {
    // No assertion on the boolean — just that the call shape with no
    // platform argument is supported and does not throw.
    expect(() => isFilesystemUnsupportedHere('vfat')).not.toThrow();
  });
});

describe('formatHfsplusOnLinuxRefusal', () => {
  it('emits the spec wording verbatim, line for line', () => {
    const lines = formatHfsplusOnLinuxRefusal();
    expect(lines).toEqual([
      'Cannot add iPod: this iPod is formatted as HFS+, which podkit does not support on Linux.',
      '',
      'To use this iPod with podkit on Linux, reformat it to FAT32. See:',
      `  ${LINUX_FILESYSTEMS_DOCS_URL}`,
      '',
      '(podkit fully supports HFS+ iPods on macOS — this is a Linux-only limitation.)',
    ]);
  });

  it('points at the canonical docs URL', () => {
    const text = formatHfsplusOnLinuxRefusal().join('\n');
    expect(text).toContain('https://jvgomg.github.io/podkit/devices/linux-filesystems');
  });

  it('does not leak the word "libgpod" — refusal is filesystem-level, not binding-level', () => {
    const text = formatHfsplusOnLinuxRefusal().join('\n');
    expect(text.toLowerCase()).not.toContain('libgpod');
  });
});
