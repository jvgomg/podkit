import { describe, expect, it } from 'bun:test';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  formatBytes,
  formatNumber,
  formatGeneration,
  getStorageInfo,
} from './status.js';

describe('status command utilities', () => {
  describe('formatBytes', () => {
    it('formats 0 bytes', () => {
      expect(formatBytes(0)).toBe('0 B');
    });

    it('formats bytes', () => {
      expect(formatBytes(500)).toBe('500.0 B');
    });

    it('formats kilobytes', () => {
      expect(formatBytes(1024)).toBe('1.0 KB');
      expect(formatBytes(1536)).toBe('1.5 KB');
    });

    it('formats megabytes', () => {
      expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
      expect(formatBytes(1024 * 1024 * 10.5)).toBe('10.5 MB');
    });

    it('formats gigabytes', () => {
      expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
      expect(formatBytes(1024 * 1024 * 1024 * 45.2)).toBe('45.2 GB');
    });

    it('formats terabytes', () => {
      expect(formatBytes(1024 * 1024 * 1024 * 1024)).toBe('1.0 TB');
    });

    it('respects decimal places parameter', () => {
      expect(formatBytes(1536, 2)).toBe('1.50 KB');
      expect(formatBytes(1536, 0)).toBe('2 KB');
    });
  });

  describe('formatNumber', () => {
    it('formats small numbers', () => {
      expect(formatNumber(0)).toBe('0');
      expect(formatNumber(100)).toBe('100');
      expect(formatNumber(999)).toBe('999');
    });

    it('formats thousands with commas', () => {
      expect(formatNumber(1000)).toBe('1,000');
      expect(formatNumber(8432)).toBe('8,432');
      expect(formatNumber(12345)).toBe('12,345');
    });

    it('formats millions', () => {
      expect(formatNumber(1000000)).toBe('1,000,000');
      expect(formatNumber(1234567)).toBe('1,234,567');
    });
  });

  describe('formatGeneration', () => {
    it('formats known generations', () => {
      expect(formatGeneration('video_1')).toBe('Video (5th Generation)');
      expect(formatGeneration('video_2')).toBe('Video (5.5th Generation)');
      expect(formatGeneration('classic_1')).toBe('Classic (6th Generation)');
      expect(formatGeneration('nano_2')).toBe('Nano (2nd Generation)');
    });

    it('formats shuffle generations', () => {
      expect(formatGeneration('shuffle_1')).toBe('Shuffle (1st Generation)');
      expect(formatGeneration('shuffle_3')).toBe('Shuffle (3rd Generation)');
    });

    it('formats mini generations', () => {
      expect(formatGeneration('mini_1')).toBe('Mini (1st Generation)');
      expect(formatGeneration('mini_2')).toBe('Mini (2nd Generation)');
    });

    it('formats touch and phone generations', () => {
      expect(formatGeneration('touch_1')).toBe('Touch (1st Generation)');
      expect(formatGeneration('iphone_2')).toBe('iPhone 3G');
      expect(formatGeneration('ipad_1')).toBe('iPad (1st Generation)');
    });

    it('returns unknown identifier as-is', () => {
      expect(formatGeneration('some_unknown_gen')).toBe('some_unknown_gen');
    });

    it('formats unknown generation', () => {
      expect(formatGeneration('unknown')).toBe('Unknown Generation');
    });
  });

  describe('getStorageInfo', () => {
    it('returns storage info for valid path', () => {
      // Use tmpdir which should always exist
      const result = getStorageInfo(tmpdir());

      expect(result).not.toBeNull();
      expect(result!.total).toBeGreaterThan(0);
      expect(result!.free).toBeGreaterThan(0);
      expect(result!.used).toBe(result!.total - result!.free);
    });

    it('returns null for non-existent path', () => {
      const result = getStorageInfo('/nonexistent/path/that/does/not/exist');
      expect(result).toBeNull();
    });

    it('works with a temporary directory', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'status-test-'));

      try {
        const result = getStorageInfo(tempDir);

        expect(result).not.toBeNull();
        expect(result!.total).toBeGreaterThan(0);
        // Used should be non-negative
        expect(result!.used).toBeGreaterThanOrEqual(0);
      } finally {
        rmdirSync(tempDir);
      }
    });
  });
});
