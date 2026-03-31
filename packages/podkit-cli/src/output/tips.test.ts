import { describe, expect, it, jest, beforeEach, afterEach } from 'bun:test';
import { collectTips, formatTips, printTips } from './tips.js';
import { OutputContext } from './context.js';

// =============================================================================
// collectTips
// =============================================================================

describe('collectTips', () => {
  describe('sound check tip', () => {
    it('returns tip for partial sound check coverage', () => {
      const tips = collectTips({
        stats: { tracks: 100, normalizedTracks: 50 },
      });
      expect(tips).toHaveLength(1);
      expect(tips[0]!.message).toContain('Sound Check');
      expect(tips[0]!.url).toContain('sound-check');
    });

    it('returns no tip when all tracks have sound check', () => {
      const tips = collectTips({
        stats: { tracks: 100, normalizedTracks: 100 },
      });
      expect(tips).toHaveLength(0);
    });

    it('returns no tip when no tracks have sound check', () => {
      const tips = collectTips({
        stats: { tracks: 100, normalizedTracks: 0 },
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

  describe('artwork baseline tip', () => {
    it('returns tip when tracks missing artwork baseline', () => {
      const tips = collectTips({ artworkMissingBaseline: 50 });
      expect(tips).toHaveLength(1);
      expect(tips[0]!.message).toContain('artwork hash in their sync tag');
      expect(tips[0]!.message).toContain('--force-sync-tags --check-artwork');
    });

    it('returns no tip when artworkMissingBaseline is 0', () => {
      const tips = collectTips({ artworkMissingBaseline: 0 });
      expect(tips).toHaveLength(0);
    });

    it('does not trigger without artworkMissingBaseline context', () => {
      const tips = collectTips({});
      expect(tips).toHaveLength(0);
    });
  });

  describe('no sync tags tip', () => {
    it('returns tip when tracks exist but no sync tags', () => {
      const tips = collectTips({
        syncTagInfo: { trackCount: 100, syncTagCount: 0, missingArt: 0 },
      });
      expect(tips).toHaveLength(1);
      expect(tips[0]!.message).toContain('--force-sync-tags');
    });

    it('returns no tip when sync tags exist', () => {
      const tips = collectTips({
        syncTagInfo: { trackCount: 100, syncTagCount: 50, missingArt: 10 },
      });
      // Should not trigger the no-sync-tags tip (may trigger missing-artwork-hash)
      const noTagTips = tips.filter((t) => t.message.includes('no sync tags'));
      expect(noTagTips).toHaveLength(0);
    });

    it('returns no tip when no tracks', () => {
      const tips = collectTips({
        syncTagInfo: { trackCount: 0, syncTagCount: 0, missingArt: 0 },
      });
      expect(tips).toHaveLength(0);
    });
  });

  describe('missing artwork hash tip', () => {
    it('returns tip when sync tags exist but some missing artwork hash', () => {
      const tips = collectTips({
        syncTagInfo: { trackCount: 100, syncTagCount: 80, missingArt: 30 },
      });
      const artTips = tips.filter((t) => t.message.includes('no artwork hash'));
      expect(artTips).toHaveLength(1);
      expect(artTips[0]!.message).toContain('--check-artwork --force-sync-tags');
    });

    it('returns no tip when no sync tags missing artwork hash', () => {
      const tips = collectTips({
        syncTagInfo: { trackCount: 100, syncTagCount: 80, missingArt: 0 },
      });
      const artTips = tips.filter((t) => t.message.includes('no artwork hash'));
      expect(artTips).toHaveLength(0);
    });
  });

  describe('transfer mode mismatch tip', () => {
    it('returns tip when tracks have mismatched transfer mode', () => {
      const tips = collectTips({ transferModeMismatch: 25 });
      expect(tips).toHaveLength(1);
      expect(tips[0]!.message).toContain('25 tracks were synced with a different transfer mode');
      expect(tips[0]!.message).toContain('--force-transfer-mode');
    });

    it('returns no tip when transferModeMismatch is 0', () => {
      const tips = collectTips({ transferModeMismatch: 0 });
      expect(tips).toHaveLength(0);
    });

    it('does not trigger without transferModeMismatch context', () => {
      const tips = collectTips({});
      expect(tips).toHaveLength(0);
    });

    it('uses singular form for 1 track', () => {
      const tips = collectTips({ transferModeMismatch: 1 });
      expect(tips).toHaveLength(1);
      expect(tips[0]!.message).toContain('1 track was synced');
    });
  });

  describe('multiple tips', () => {
    it('returns multiple tips when multiple conditions match', () => {
      const tips = collectTips({
        stats: { tracks: 100, normalizedTracks: 50 },
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

// =============================================================================
// OutputContext.tip and OutputContext.printTips
// =============================================================================

describe('OutputContext tip methods', () => {
  let logSpy: ReturnType<typeof jest.fn>;
  let originalLog: typeof console.log;

  beforeEach(() => {
    originalLog = console.log;
    logSpy = jest.fn();
    console.log = logSpy;
  });

  afterEach(() => {
    console.log = originalLog;
  });

  function makeOut(opts: { tips?: boolean; quiet?: boolean; json?: boolean } = {}) {
    return OutputContext.fromGlobalOpts({
      json: opts.json ?? false,
      quiet: opts.quiet ?? false,
      verbose: 0,
      color: true,
      tips: opts.tips ?? true,
    });
  }

  describe('tip()', () => {
    it('prints tip in text mode with tips enabled', () => {
      const out = makeOut();
      out.tip('Use --eject next time.');
      expect(logSpy).toHaveBeenCalledWith('Tip: Use --eject next time.');
    });

    it('prints tip with url', () => {
      const out = makeOut();
      out.tip('Learn more.', 'https://example.com');
      expect(logSpy).toHaveBeenCalledWith('Tip: Learn more.');
      expect(logSpy).toHaveBeenCalledWith('  See: https://example.com');
    });

    it('suppresses tip when tips disabled', () => {
      const out = makeOut({ tips: false });
      out.tip('Use --eject next time.');
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('suppresses tip in quiet mode', () => {
      const out = makeOut({ quiet: true });
      out.tip('Use --eject next time.');
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('suppresses tip in json mode', () => {
      const out = makeOut({ json: true });
      out.tip('Use --eject next time.');
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe('printTips()', () => {
    it('prints matching tips with leading newline', () => {
      const out = makeOut();
      out.printTips({ mountRequiresSudo: true });
      // First call is newline, then at least one tip line
      expect(logSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(logSpy.mock.calls[0]![0]).toBe('');
      expect(logSpy.mock.calls[1]![0]).toMatch(/^Tip:/);
    });

    it('suppresses tips when tips disabled', () => {
      const out = makeOut({ tips: false });
      out.printTips({ mountRequiresSudo: true });
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('prints nothing when no tips match', () => {
      const out = makeOut();
      out.printTips({});
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe('tipsEnabled', () => {
    it('returns true by default', () => {
      const out = makeOut();
      expect(out.tipsEnabled).toBe(true);
    });

    it('returns false when tips disabled via CLI', () => {
      const out = makeOut({ tips: false });
      expect(out.tipsEnabled).toBe(false);
    });

    it('returns false when tips disabled via config', () => {
      const out = OutputContext.fromGlobalOpts(
        { json: false, quiet: false, verbose: 0, color: true },
        { tips: false }
      );
      expect(out.tipsEnabled).toBe(false);
    });
  });
});
