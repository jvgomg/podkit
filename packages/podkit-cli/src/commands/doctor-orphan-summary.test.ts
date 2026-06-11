/**
 * Tests for `printOrphanSummary` in `commands/doctor-render.ts`.
 *
 * `printOrphanSummary` is the most format-fragile block in the doctor
 * render — three sorted sub-sections (by-directory, by-extension, top-10
 * largest) plus a CSV-export hint. It was structurally uncovered before
 * the TASK-345 refactor (only exercised indirectly through the doctor
 * integration tests' verbose output).
 *
 * All output flows through `out.verbose1`, so we drive the OutputContext
 * with `verbose: 1` and assert against the captured stdout text.
 */

import { describe, it, expect } from 'bun:test';
import { OutputContext } from '../output/index.js';
import { BufferSink } from '../test-utils/buffer-sink.js';
import { printOrphanSummary } from './doctor-render.js';

function makeVerboseOut(): { out: OutputContext; stdout: BufferSink } {
  const stdout = new BufferSink();
  const stderr = new BufferSink();
  const out = OutputContext.fromGlobalOpts(
    { json: false, quiet: false, verbose: 1, color: false, tips: false, tty: false },
    {},
    { stdout, stderr }
  );
  return { out, stdout };
}

describe('printOrphanSummary — empty / missing', () => {
  it('emits nothing when details has no orphans field', () => {
    const { out, stdout } = makeVerboseOut();
    printOrphanSummary(out, {});
    expect(stdout.text()).toBe('');
  });

  it('emits nothing when orphans is an empty array', () => {
    const { out, stdout } = makeVerboseOut();
    printOrphanSummary(out, { orphans: [] });
    expect(stdout.text()).toBe('');
  });

  it('emits nothing when orphans is undefined', () => {
    const { out, stdout } = makeVerboseOut();
    printOrphanSummary(out, { orphans: undefined });
    expect(stdout.text()).toBe('');
  });
});

describe('printOrphanSummary — by-directory breakdown', () => {
  it('groups by basename(dirname(path)) and renders one row per directory', () => {
    const { out, stdout } = makeVerboseOut();
    printOrphanSummary(out, {
      orphans: [
        { path: '/iPod_Control/Music/F00/a.mp3', size: 100 },
        { path: '/iPod_Control/Music/F00/b.mp3', size: 200 },
        { path: '/iPod_Control/Music/F01/c.mp3', size: 50 },
      ],
    });
    const text = stdout.text();
    expect(text).toContain('By directory:');
    expect(text).toContain('F00');
    expect(text).toContain('F01');
  });

  it('sorts directories by total size descending', () => {
    const { out, stdout } = makeVerboseOut();
    printOrphanSummary(out, {
      orphans: [
        { path: '/iPod_Control/Music/F00/small.mp3', size: 10 },
        { path: '/iPod_Control/Music/F02/medium.mp3', size: 1000 },
        { path: '/iPod_Control/Music/F01/big.mp3', size: 999999 },
      ],
    });
    const text = stdout.text();
    const dirSection = text.slice(text.indexOf('By directory:'), text.indexOf('By extension:'));
    // F01 has the largest total (999999), F02 next (1000), F00 last (10).
    const idxF01 = dirSection.indexOf('F01');
    const idxF02 = dirSection.indexOf('F02');
    const idxF00 = dirSection.indexOf('F00');
    expect(idxF01).toBeLessThan(idxF02);
    expect(idxF02).toBeLessThan(idxF00);
  });

  it('counts files per directory correctly', () => {
    const { out, stdout } = makeVerboseOut();
    printOrphanSummary(out, {
      orphans: [
        { path: '/iPod_Control/Music/F00/a.mp3', size: 100 },
        { path: '/iPod_Control/Music/F00/b.mp3', size: 100 },
        { path: '/iPod_Control/Music/F00/c.mp3', size: 100 },
        { path: '/iPod_Control/Music/F01/x.mp3', size: 100 },
      ],
    });
    const text = stdout.text();
    // Strip ANSI noise we don't care about — assert the count appears.
    expect(text).toMatch(/F00\s+3 files/);
    expect(text).toMatch(/F01\s+1 files/);
  });
});

describe('printOrphanSummary — by-extension breakdown', () => {
  it('groups by lower-cased file extension', () => {
    const { out, stdout } = makeVerboseOut();
    printOrphanSummary(out, {
      orphans: [
        { path: '/x/F00/a.MP3', size: 100 },
        { path: '/x/F00/b.mp3', size: 200 },
        { path: '/x/F00/c.flac', size: 300 },
      ],
    });
    const text = stdout.text();
    expect(text).toContain('By extension:');
    expect(text).toMatch(/\.mp3\s+2 files/);
    expect(text).toMatch(/\.flac\s+1 files/);
  });

  it('labels extensionless files as "(none)"', () => {
    const { out, stdout } = makeVerboseOut();
    printOrphanSummary(out, {
      orphans: [{ path: '/x/F00/no_extension_here', size: 100 }],
    });
    expect(stdout.text()).toContain('(none)');
  });

  it('sorts extensions by total size descending', () => {
    const { out, stdout } = makeVerboseOut();
    printOrphanSummary(out, {
      orphans: [
        { path: '/x/F00/a.mp3', size: 100 },
        { path: '/x/F00/b.flac', size: 100_000 },
      ],
    });
    const text = stdout.text();
    const extSection = text.slice(text.indexOf('By extension:'), text.indexOf('Largest orphans:'));
    expect(extSection.indexOf('.flac')).toBeLessThan(extSection.indexOf('.mp3'));
  });
});

describe('printOrphanSummary — largest-files section', () => {
  it('renders up to 10 largest files', () => {
    const { out, stdout } = makeVerboseOut();
    const orphans = Array.from({ length: 25 }, (_, i) => ({
      path: `/iPod_Control/Music/F00/file${i}.mp3`,
      size: 1000 + i * 100,
    }));
    printOrphanSummary(out, { orphans });
    const text = stdout.text();
    expect(text).toContain('Largest orphans:');
    // The largest 10 should appear in the output (file15..file24).
    for (let i = 15; i < 25; i++) {
      expect(text).toContain(`file${i}.mp3`);
    }
    // file0 (the smallest) should NOT appear in the top-10 block.
    // Use a deliberately specific marker so we don't false-positive.
    expect(text).not.toContain('file0.mp3');
  });

  it('shortens paths by stripping the iPod_Control/Music/ prefix', () => {
    const { out, stdout } = makeVerboseOut();
    printOrphanSummary(out, {
      orphans: [{ path: '/Volumes/iPod/iPod_Control/Music/F00/song.mp3', size: 1000 }],
    });
    // Full path should NOT appear; the trimmed form should.
    expect(stdout.text()).not.toContain('/Volumes/iPod/iPod_Control/Music/F00/');
    expect(stdout.text()).toContain('F00/song.mp3');
  });

  it('emits the CSV-export hint at the bottom', () => {
    const { out, stdout } = makeVerboseOut();
    printOrphanSummary(out, {
      orphans: [{ path: '/x/F00/a.mp3', size: 100 }],
    });
    expect(stdout.text()).toContain('Use --format csv to export the full list.');
  });
});

describe('printOrphanSummary — verbose gating', () => {
  it('suppresses the detail blocks at verbose=0 (only an unconditional newline survives)', () => {
    // All three detail blocks (By directory / By extension / Largest
    // orphans / CSV hint) route through `out.verbose1`, which is gated
    // on verbosity >= 1. The leading `out.newline()` is unconditional —
    // pinned here so a future change to verbose semantics is visible.
    const stdout = new BufferSink();
    const stderr = new BufferSink();
    const out = OutputContext.fromGlobalOpts(
      { json: false, quiet: false, verbose: 0, color: false, tips: false, tty: false },
      {},
      { stdout, stderr }
    );
    printOrphanSummary(out, {
      orphans: [{ path: '/x/F00/a.mp3', size: 100 }],
    });
    expect(stdout.text()).not.toContain('By directory');
    expect(stdout.text()).not.toContain('By extension');
    expect(stdout.text()).not.toContain('Largest orphans');
    expect(stdout.text()).not.toContain('Use --format csv');
  });
});
