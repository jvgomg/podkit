import { describe, expect, it } from 'bun:test';
import { collectTips, formatTips, printTips } from './tips.js';

// =============================================================================
// collectTips
// =============================================================================

describe('collectTips', () => {
  describe('sound check tip', () => {
    it('returns tip for partial sound check coverage', () => {
      const tips = collectTips({
        stats: { tracks: 100, soundCheckTracks: 50 },
      });
      expect(tips).toHaveLength(1);
      expect(tips[0]!.message).toContain('Sound Check');
      expect(tips[0]!.url).toContain('sound-check');
    });

    it('returns no tip when all tracks have sound check', () => {
      const tips = collectTips({
        stats: { tracks: 100, soundCheckTracks: 100 },
      });
      expect(tips).toHaveLength(0);
    });

    it('returns no tip when no tracks have sound check', () => {
      const tips = collectTips({
        stats: { tracks: 100, soundCheckTracks: 0 },
      });
      expect(tips).toHaveLength(0);
    });

    it('does not trigger without stats', () => {
      const tips = collectTips({});
      expect(tips).toHaveLength(0);
    });
  });

  describe('macOS mounting tip', () => {
    it('returns tip when mount requires sudo', () => {
      const tips = collectTips({ mountRequiresSudo: true });
      expect(tips).toHaveLength(1);
      expect(tips[0]!.message).toContain('iFlash');
      expect(tips[0]!.url).toContain('macos-mounting');
    });

    it('returns no tip when mount does not require sudo', () => {
      const tips = collectTips({ mountRequiresSudo: false });
      expect(tips).toHaveLength(0);
    });

    it('does not trigger without mount context', () => {
      const tips = collectTips({});
      expect(tips).toHaveLength(0);
    });
  });

  describe('multiple tips', () => {
    it('returns multiple tips when multiple conditions match', () => {
      const tips = collectTips({
        stats: { tracks: 100, soundCheckTracks: 50 },
        mountRequiresSudo: true,
      });
      expect(tips).toHaveLength(2);
    });

    it('returns empty array for empty context', () => {
      const tips = collectTips({});
      expect(tips).toHaveLength(0);
    });
  });
});

// =============================================================================
// formatTips
// =============================================================================

describe('formatTips', () => {
  it('returns empty array for no tips', () => {
    expect(formatTips([])).toEqual([]);
  });

  it('formats a tip without url', () => {
    const lines = formatTips([{ message: 'Hello world' }]);
    expect(lines).toEqual(['Tip: Hello world']);
  });

  it('formats a tip with url', () => {
    const lines = formatTips([{ message: 'See docs', url: 'https://example.com' }]);
    expect(lines).toEqual(['Tip: See docs', '  See: https://example.com']);
  });

  it('formats multiple tips', () => {
    const lines = formatTips([
      { message: 'First' },
      { message: 'Second', url: 'https://example.com' },
    ]);
    expect(lines).toEqual(['Tip: First', 'Tip: Second', '  See: https://example.com']);
  });
});

// =============================================================================
// printTips
// =============================================================================

describe('printTips', () => {
  it('prints nothing when no tips match', () => {
    const printed: string[] = [];
    let newlines = 0;
    const out = {
      newline: () => {
        newlines++;
      },
      print: (msg: string) => {
        printed.push(msg);
      },
    };

    printTips(out, {});

    expect(newlines).toBe(0);
    expect(printed).toHaveLength(0);
  });

  it('prints tips with leading newline when tips match', () => {
    const printed: string[] = [];
    let newlines = 0;
    const out = {
      newline: () => {
        newlines++;
      },
      print: (msg: string) => {
        printed.push(msg);
      },
    };

    printTips(out, { mountRequiresSudo: true });

    expect(newlines).toBe(1);
    expect(printed.length).toBeGreaterThan(0);
    expect(printed[0]).toMatch(/^Tip:/);
  });
});
