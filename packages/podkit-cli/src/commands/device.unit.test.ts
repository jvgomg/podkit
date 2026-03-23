import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  formatBytes,
  formatNumber,
  formatGeneration,
  getStorageInfo,
  formatSyncTagSummary,
} from './device.js';

describe('device utility functions', () => {
  describe('formatBytes', () => {
    it('returns "0 B" for 0 bytes', () => {
      expect(formatBytes(0)).toBe('0 B');
    });

    it('formats bytes under 1KB correctly', () => {
      expect(formatBytes(512)).toBe('512.0 B');
      expect(formatBytes(1)).toBe('1.0 B');
      expect(formatBytes(999)).toBe('999.0 B');
    });

    it('formats kilobytes with decimal', () => {
      expect(formatBytes(1024)).toBe('1.0 KB');
      expect(formatBytes(1536)).toBe('1.5 KB');
      expect(formatBytes(2048)).toBe('2.0 KB');
      expect(formatBytes(10240)).toBe('10.0 KB');
    });

    it('formats megabytes correctly', () => {
      expect(formatBytes(1048576)).toBe('1.0 MB');
      expect(formatBytes(1572864)).toBe('1.5 MB');
      expect(formatBytes(104857600)).toBe('100.0 MB');
    });

    it('formats gigabytes correctly', () => {
      expect(formatBytes(1073741824)).toBe('1.0 GB');
      expect(formatBytes(1610612736)).toBe('1.5 GB');
      expect(formatBytes(107374182400)).toBe('100.0 GB');
    });

    it('formats terabytes correctly', () => {
      expect(formatBytes(1099511627776)).toBe('1.0 TB');
      expect(formatBytes(1649267441664)).toBe('1.5 TB');
      expect(formatBytes(2199023255552)).toBe('2.0 TB');
    });

    it('respects custom decimal places', () => {
      expect(formatBytes(1536, 2)).toBe('1.50 KB');
      expect(formatBytes(1536, 0)).toBe('2 KB');
      expect(formatBytes(1234567890, 3)).toBe('1.150 GB');
    });
  });

  describe('formatNumber', () => {
    it('formats small numbers without separators', () => {
      expect(formatNumber(0)).toBe('0');
      expect(formatNumber(1)).toBe('1');
      expect(formatNumber(999)).toBe('999');
    });

    it('formats thousands with comma separator', () => {
      expect(formatNumber(1000)).toBe('1,000');
      expect(formatNumber(1234)).toBe('1,234');
      expect(formatNumber(12345)).toBe('12,345');
      expect(formatNumber(123456)).toBe('123,456');
    });

    it('formats millions with comma separators', () => {
      expect(formatNumber(1000000)).toBe('1,000,000');
      expect(formatNumber(1234567)).toBe('1,234,567');
      expect(formatNumber(12345678)).toBe('12,345,678');
    });
  });

  describe('formatGeneration', () => {
    it('returns "Unknown Generation" for unknown', () => {
      expect(formatGeneration('unknown')).toBe('Unknown Generation');
    });

    it('formats classic generations correctly', () => {
      expect(formatGeneration('classic_1')).toBe('Classic (6th Generation)');
      expect(formatGeneration('classic_2')).toBe('Classic (6.5th Generation)');
      expect(formatGeneration('classic_3')).toBe('Classic (7th Generation)');
    });

    it('formats nano generations correctly', () => {
      expect(formatGeneration('nano_1')).toBe('Nano (1st Generation)');
      expect(formatGeneration('nano_2')).toBe('Nano (2nd Generation)');
      expect(formatGeneration('nano_3')).toBe('Nano (3rd Generation)');
      expect(formatGeneration('nano_4')).toBe('Nano (4th Generation)');
      expect(formatGeneration('nano_5')).toBe('Nano (5th Generation)');
      expect(formatGeneration('nano_6')).toBe('Nano (6th Generation)');
    });

    it('formats video generations correctly', () => {
      expect(formatGeneration('video_1')).toBe('Video (5th Generation)');
      expect(formatGeneration('video_2')).toBe('Video (5.5th Generation)');
    });

    it('formats touch generations correctly', () => {
      expect(formatGeneration('touch_1')).toBe('Touch (1st Generation)');
      expect(formatGeneration('touch_2')).toBe('Touch (2nd Generation)');
      expect(formatGeneration('touch_3')).toBe('Touch (3rd Generation)');
      expect(formatGeneration('touch_4')).toBe('Touch (4th Generation)');
    });

    it('formats mini generations correctly', () => {
      expect(formatGeneration('mini_1')).toBe('Mini (1st Generation)');
      expect(formatGeneration('mini_2')).toBe('Mini (2nd Generation)');
    });

    it('formats shuffle generations correctly', () => {
      expect(formatGeneration('shuffle_1')).toBe('Shuffle (1st Generation)');
      expect(formatGeneration('shuffle_2')).toBe('Shuffle (2nd Generation)');
      expect(formatGeneration('shuffle_3')).toBe('Shuffle (3rd Generation)');
      expect(formatGeneration('shuffle_4')).toBe('Shuffle (4th Generation)');
    });

    it('returns original string for unmapped generations', () => {
      expect(formatGeneration('future_model')).toBe('future_model');
      expect(formatGeneration('custom')).toBe('custom');
    });

    it('formats early iPod generations correctly', () => {
      expect(formatGeneration('first')).toBe('1st Generation');
      expect(formatGeneration('second')).toBe('2nd Generation');
      expect(formatGeneration('third')).toBe('3rd Generation');
      expect(formatGeneration('fourth')).toBe('4th Generation');
      expect(formatGeneration('photo')).toBe('Photo');
    });

    it('formats iPhone and iPad generations correctly', () => {
      expect(formatGeneration('iphone_1')).toBe('iPhone (1st Generation)');
      expect(formatGeneration('iphone_2')).toBe('iPhone 3G');
      expect(formatGeneration('iphone_3')).toBe('iPhone 3GS');
      expect(formatGeneration('iphone_4')).toBe('iPhone 4');
      expect(formatGeneration('ipad_1')).toBe('iPad (1st Generation)');
    });
  });

  describe('getStorageInfo', () => {
    let tempDir: string;

    beforeEach(() => {
      // Create a temporary directory for testing
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'podkit-storage-test-'));
    });

    afterEach(() => {
      // Clean up temporary directory
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true });
      }
    });

    it('returns storage info for a valid path', () => {
      const info = getStorageInfo(tempDir);

      expect(info).not.toBeNull();
      expect(info).toHaveProperty('total');
      expect(info).toHaveProperty('free');
      expect(info).toHaveProperty('used');
    });

    it('returns null for an invalid path', () => {
      const info = getStorageInfo('/nonexistent/path/that/does/not/exist');

      expect(info).toBeNull();
    });

    it('returns object with total, free, and used properties', () => {
      const info = getStorageInfo(tempDir);

      expect(info).not.toBeNull();
      expect(typeof info!.total).toBe('number');
      expect(typeof info!.free).toBe('number');
      expect(typeof info!.used).toBe('number');

      // Verify used = total - free
      expect(info!.used).toBe(info!.total - info!.free);
    });

    it('returns positive values for total and free', () => {
      const info = getStorageInfo(tempDir);

      expect(info).not.toBeNull();
      expect(info!.total).toBeGreaterThan(0);
      expect(info!.free).toBeGreaterThanOrEqual(0);
      expect(info!.used).toBeGreaterThanOrEqual(0);
    });

    it('returns storage info for root path', () => {
      // Test with root directory which should always exist
      const info = getStorageInfo('/');

      expect(info).not.toBeNull();
      expect(info!.total).toBeGreaterThan(0);
    });
  });

  describe('formatSyncTagSummary', () => {
    it('returns just track count for zero tracks', () => {
      expect(formatSyncTagSummary(0, 0, 0, 0)).toBe('0 tracks');
    });

    it('shows checkmark when all tracks are consistent', () => {
      expect(formatSyncTagSummary(2289, 2289, 0, 0)).toBe('2,289 tracks \u2713 all consistent');
    });

    it('shows no sync tags when all tracks have no tag', () => {
      expect(formatSyncTagSummary(2289, 0, 0, 2289)).toBe('2,289 tracks (\u2717 no sync tags)');
    });

    it('shows missing artwork hash when all tags exist but none have art hash', () => {
      expect(formatSyncTagSummary(2289, 0, 2289, 0)).toBe(
        '2,289 tracks (\u25D0 2,289 missing artwork hash)'
      );
    });

    it('shows mixed breakdown with only non-zero categories', () => {
      expect(formatSyncTagSummary(2289, 100, 200, 1989)).toBe(
        '2,289 tracks (\u2713 100 consistent, \u25D0 200 missing artwork hash, \u2717 1,989 no sync tag)'
      );
    });

    it('omits zero categories in mixed case', () => {
      expect(formatSyncTagSummary(500, 300, 0, 200)).toBe(
        '500 tracks (\u2713 300 consistent, \u2717 200 no sync tag)'
      );
    });

    it('shows only missing art when complete and no-tag are zero', () => {
      expect(formatSyncTagSummary(100, 0, 100, 0)).toBe(
        '100 tracks (\u25D0 100 missing artwork hash)'
      );
    });

    it('includes missing transfer mode when provided', () => {
      expect(formatSyncTagSummary(500, 300, 0, 100, 100)).toBe(
        '500 tracks (\u2713 300 consistent, \u2717 100 no sync tag, \u25D0 100 missing transfer mode)'
      );
    });

    it('does not include missing transfer mode when zero', () => {
      expect(formatSyncTagSummary(500, 500, 0, 0, 0)).toBe('500 tracks \u2713 all consistent');
    });

    it('does not include missing transfer mode when undefined', () => {
      expect(formatSyncTagSummary(500, 500, 0, 0)).toBe('500 tracks \u2713 all consistent');
    });
  });
});
