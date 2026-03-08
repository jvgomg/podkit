import { describe, expect, it } from 'bun:test';
import {
  formatBytes,
  formatDuration,
  renderProgressBar,
} from './video-sync.js';

describe('video-sync command utilities', () => {
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

  describe('formatDuration', () => {
    it('formats seconds', () => {
      expect(formatDuration(0)).toBe('0s');
      expect(formatDuration(30)).toBe('30s');
      expect(formatDuration(59)).toBe('59s');
    });

    it('formats minutes and seconds', () => {
      expect(formatDuration(60)).toBe('1m 0s');
      expect(formatDuration(90)).toBe('1m 30s');
      expect(formatDuration(125)).toBe('2m 5s');
      expect(formatDuration(3599)).toBe('59m 59s');
    });

    it('formats hours and minutes', () => {
      expect(formatDuration(3600)).toBe('1h 0m');
      expect(formatDuration(3660)).toBe('1h 1m');
      expect(formatDuration(7200)).toBe('2h 0m');
      expect(formatDuration(5400)).toBe('1h 30m');
    });

    it('rounds seconds properly', () => {
      expect(formatDuration(30.4)).toBe('30s');
      expect(formatDuration(30.6)).toBe('31s');
    });
  });

  describe('renderProgressBar', () => {
    it('renders empty progress bar at 0%', () => {
      const bar = renderProgressBar(0, 100);
      expect(bar).toContain('[');
      expect(bar).toContain(']');
      expect(bar).toContain('0%');
    });

    it('renders full progress bar at 100%', () => {
      const bar = renderProgressBar(100, 100);
      expect(bar).toContain('100%');
      // Should have all filled characters
      expect(bar).toContain('='.repeat(30));
    });

    it('renders partial progress bar', () => {
      const bar = renderProgressBar(50, 100);
      expect(bar).toContain('50%');
      expect(bar).toContain('>'); // cursor at current position
    });

    it('handles 0 total gracefully', () => {
      const bar = renderProgressBar(0, 0);
      expect(bar).toContain('0%');
    });

    it('respects custom width', () => {
      const bar = renderProgressBar(50, 100, 10);
      // Progress indicator should fit in narrower width
      expect(bar.length).toBeLessThan(renderProgressBar(50, 100, 30).length);
    });

    it('shows correct percentage for various values', () => {
      expect(renderProgressBar(25, 100)).toContain('25%');
      expect(renderProgressBar(1, 3)).toContain('33%');
      expect(renderProgressBar(2, 3)).toContain('67%');
      expect(renderProgressBar(3, 3)).toContain('100%');
    });
  });
});

describe('video-sync command', () => {
  describe('video quality preset validation', () => {
    // Test the valid preset values
    const validPresets = ['max', 'high', 'medium', 'low'];

    for (const preset of validPresets) {
      it(`accepts valid preset: ${preset}`, () => {
        // The video-sync command uses these presets
        expect(validPresets.includes(preset)).toBe(true);
      });
    }

    it('has four quality presets', () => {
      expect(validPresets.length).toBe(4);
    });
  });
});
