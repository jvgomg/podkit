import { describe, it, expect } from 'bun:test';
import { labelFromName, classifyVolumeFilesystem } from './label-from-name.js';

describe('labelFromName (FAT)', () => {
  it('uppercases a mixed-case name without flagging it lossy (case-folding is expected)', () => {
    const result = labelFromName('Party iPod', 'fat');
    expect(result.label).toBe('PARTY IPOD');
    // Pure case-folding is NOT lossy — the caller shows the label, so no warning.
    expect(result.lossy).toBe(false);
    expect(result.warning).toBeUndefined();
  });

  it('truncates to 11 characters (lossy, with a warning)', () => {
    const result = labelFromName('SUPERCALIFRAGILISTIC', 'fat');
    expect(result.label).toBe('SUPERCALIFR');
    expect(result.label.length).toBe(11);
    expect(result.lossy).toBe(true);
    expect(result.warning).toContain('SUPERCALIFR');
    expect(result.warning).toContain('11');
  });

  it('strips characters illegal in a FAT label', () => {
    const result = labelFromName('A:B*C?D', 'fat');
    // : * ? are stripped, then uppercased.
    expect(result.label).toBe('ABCD');
    expect(result.lossy).toBe(true);
  });

  it('is not lossy when the name is already a valid uppercase FAT label', () => {
    const result = labelFromName('TERAPOD', 'fat');
    expect(result.label).toBe('TERAPOD');
    expect(result.lossy).toBe(false);
    expect(result.warning).toBeUndefined();
  });

  it('handles an empty name without throwing', () => {
    const result = labelFromName('', 'fat');
    expect(result.label).toBe('');
    expect(result.lossy).toBe(false);
  });

  it('handles a whitespace-only name without throwing', () => {
    const result = labelFromName('   ', 'fat');
    expect(result.label).toBe('');
    expect(result.lossy).toBe(false);
  });

  it('trims trailing space introduced by truncation', () => {
    // The 11-char boundary lands on a space (char 11), which trimEnd() strips.
    const result = labelFromName('1234567890 X', 'fat');
    expect(result.label).toBe('1234567890');
    expect(result.label.length).toBe(10);
    expect(result.lossy).toBe(true);
  });
});

describe('labelFromName (HFS+)', () => {
  it('preserves case', () => {
    const result = labelFromName('Party iPod', 'hfs');
    expect(result.label).toBe('Party iPod');
    expect(result.lossy).toBe(false);
    expect(result.warning).toBeUndefined();
  });

  it('allows long labels', () => {
    const long = 'A Very Long Volume Name That Exceeds Eleven Characters';
    const result = labelFromName(long, 'hfs');
    expect(result.label).toBe(long);
    expect(result.lossy).toBe(false);
  });

  it('strips the HFS path separator (colon)', () => {
    const result = labelFromName('Music: Best', 'hfs');
    expect(result.label).toBe('Music Best');
    expect(result.lossy).toBe(true);
    expect(result.warning).toContain('Music Best');
  });

  it('handles empty/whitespace defensively', () => {
    expect(labelFromName('', 'hfs').label).toBe('');
    expect(labelFromName('   ', 'hfs').label).toBe('');
  });
});

describe('classifyVolumeFilesystem', () => {
  it('maps macOS FAT strings to fat', () => {
    expect(classifyVolumeFilesystem('MS-DOS FAT32')).toBe('fat');
    expect(classifyVolumeFilesystem('Windows_FAT_32')).toBe('fat');
    expect(classifyVolumeFilesystem('DOS_FAT_32')).toBe('fat');
  });

  it('maps Linux FAT strings to fat', () => {
    expect(classifyVolumeFilesystem('vfat')).toBe('fat');
    expect(classifyVolumeFilesystem('msdos')).toBe('fat');
  });

  it('maps HFS strings to hfs', () => {
    expect(classifyVolumeFilesystem('Apple_HFS')).toBe('hfs');
    expect(classifyVolumeFilesystem('Mac OS Extended')).toBe('hfs');
    expect(classifyVolumeFilesystem('hfsplus')).toBe('hfs');
    expect(classifyVolumeFilesystem('hfs')).toBe('hfs');
  });

  it('returns null for unsupported filesystems', () => {
    expect(classifyVolumeFilesystem('APFS')).toBeNull();
    expect(classifyVolumeFilesystem('exFAT')).toBeNull(); // exFAT is not FAT16/32
    expect(classifyVolumeFilesystem('ntfs')).toBeNull();
    expect(classifyVolumeFilesystem(undefined)).toBeNull();
    expect(classifyVolumeFilesystem('')).toBeNull();
  });
});
