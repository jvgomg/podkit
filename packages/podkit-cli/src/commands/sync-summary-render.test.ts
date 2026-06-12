/**
 * Tests for `commands/sync-summary-render.ts`.
 *
 * These pin the orchestrator-level summary blocks that run once at the
 * end of `runSync` — covering both the interrupted-mid-flight and the
 * clean-completion paths, plus the grouped-warnings sub-block with its
 * verbose-mode expansion.
 */

import { describe, it, expect } from 'bun:test';
import type { Warning } from '@podkit/core';
import { OutputContext } from '../output/index.js';
import { BufferSink } from '../test-utils/buffer-sink.js';
import { printInterruptedSummary, printSuccessSummary } from './sync-summary-render.js';

function makeOut(opts: { verbose?: number } = {}): {
  out: OutputContext;
  stdout: BufferSink;
  stderr: BufferSink;
} {
  const stdout = new BufferSink();
  const stderr = new BufferSink();
  const out = OutputContext.fromGlobalOpts(
    {
      json: false,
      quiet: false,
      verbose: opts.verbose ?? 0,
      color: false,
      tips: false,
      tty: false,
    },
    {},
    { stdout, stderr }
  );
  return { out, stdout, stderr };
}

describe('printInterruptedSummary', () => {
  it('renders the header + completed/failed/duration block', () => {
    const { out, stdout } = makeOut();
    printInterruptedSummary(out, {
      dryRun: false,
      totalCompleted: 5,
      totalFailed: 2,
      durationSeconds: 12,
    });
    const text = stdout.text();
    expect(text).toContain('=== Sync Interrupted ===');
    expect(text).toContain('Saved 5 completed items to device.');
    expect(text).toContain('2 items failed before interruption.');
    expect(text).toContain('Duration:');
  });

  it('omits the "Saved N" line when totalCompleted is 0', () => {
    const { out, stdout } = makeOut();
    printInterruptedSummary(out, {
      dryRun: false,
      totalCompleted: 0,
      totalFailed: 0,
      durationSeconds: 1,
    });
    expect(stdout.text()).not.toContain('Saved');
  });

  it('omits the "N failed" line when totalFailed is 0', () => {
    const { out, stdout } = makeOut();
    printInterruptedSummary(out, {
      dryRun: false,
      totalCompleted: 3,
      totalFailed: 0,
      durationSeconds: 1,
    });
    expect(stdout.text()).not.toContain('failed before interruption');
  });

  it('emits nothing under --dry-run (no real device writes happened)', () => {
    const { out, stdout } = makeOut();
    printInterruptedSummary(out, {
      dryRun: true,
      totalCompleted: 5,
      totalFailed: 0,
      durationSeconds: 1,
    });
    expect(stdout.text()).toBe('');
  });
});

describe('printSuccessSummary — totals line', () => {
  it('renders "Synced N items successfully" when nothing failed', () => {
    const { out, stdout } = makeOut();
    printSuccessSummary(out, {
      dryRun: false,
      totalCompleted: 42,
      totalFailed: 0,
      durationSeconds: 5,
      allWarnings: [],
    });
    expect(stdout.text()).toContain('Synced 42 items successfully');
  });

  it('renders "Synced N items (M failed)" when totalFailed > 0', () => {
    const { out, stdout } = makeOut();
    printSuccessSummary(out, {
      dryRun: false,
      totalCompleted: 10,
      totalFailed: 3,
      durationSeconds: 5,
      allWarnings: [],
    });
    expect(stdout.text()).toContain('Synced 10 items (3 failed)');
  });

  it('renders "Everything already in sync!" when nothing happened', () => {
    const { out, stdout } = makeOut();
    printSuccessSummary(out, {
      dryRun: false,
      totalCompleted: 0,
      totalFailed: 0,
      durationSeconds: 1,
      allWarnings: [],
    });
    expect(stdout.text()).toContain('Everything already in sync!');
  });

  it('always emits the Duration line', () => {
    const { out, stdout } = makeOut();
    printSuccessSummary(out, {
      dryRun: false,
      totalCompleted: 1,
      totalFailed: 0,
      durationSeconds: 1,
      allWarnings: [],
    });
    expect(stdout.text()).toMatch(/Duration:/);
  });

  it('emits nothing under --dry-run', () => {
    const { out, stdout } = makeOut();
    printSuccessSummary(out, {
      dryRun: true,
      totalCompleted: 0,
      totalFailed: 0,
      durationSeconds: 1,
      allWarnings: [],
    });
    expect(stdout.text()).toBe('');
  });
});

describe('printSuccessSummary — execute-phase warnings block', () => {
  const planWarning: Warning = {
    phase: 'plan',
    type: 'lossy-to-lossy',
    message: 'plan-phase noise',
    tracks: [],
  };
  const execWarn = (type: Warning['type'], message: string, trackCount = 1): Warning => ({
    phase: 'execute',
    type,
    message,
    tracks: Array.from({ length: trackCount }, (_, i) => ({
      artist: `artist-${i}`,
      title: `title-${i}`,
    })),
  });

  it('omits the warnings block when no execute-phase warnings exist', () => {
    const { out, stdout } = makeOut();
    printSuccessSummary(out, {
      dryRun: false,
      totalCompleted: 1,
      totalFailed: 0,
      durationSeconds: 1,
      allWarnings: [planWarning], // plan-phase only — filtered out
    });
    expect(stdout.text()).not.toContain('Warnings:');
  });

  it('groups counts by warning type', () => {
    const { out, stdout } = makeOut();
    printSuccessSummary(out, {
      dryRun: false,
      totalCompleted: 1,
      totalFailed: 0,
      durationSeconds: 1,
      allWarnings: [
        execWarn('artwork', 'a'),
        execWarn('artwork', 'b'),
        execWarn('artwork', 'c'),
        execWarn('tag-write', 'd'),
        execWarn('tag-write', 'e'),
      ],
    });
    const text = stdout.text();
    expect(text).toContain('Warnings: 5');
    expect(text).toMatch(/artwork:\s+3/);
    expect(text).toMatch(/tag-write:\s+2/);
  });

  it('prints "(re-run with -v for details)" when not verbose', () => {
    const { out, stdout } = makeOut({ verbose: 0 });
    printSuccessSummary(out, {
      dryRun: false,
      totalCompleted: 1,
      totalFailed: 0,
      durationSeconds: 1,
      allWarnings: [execWarn('artwork', 'first warning message')],
    });
    expect(stdout.text()).toContain('(re-run with -v for details)');
    expect(stdout.text()).not.toContain('first warning message');
  });

  it('expands to per-warning detail at verbose=1 with single-track hint', () => {
    const { out, stdout } = makeOut({ verbose: 1 });
    printSuccessSummary(out, {
      dryRun: false,
      totalCompleted: 1,
      totalFailed: 0,
      durationSeconds: 1,
      allWarnings: [execWarn('artwork', 'cover.jpg unreadable', 1)],
    });
    expect(stdout.text()).toContain('[artwork] (artist-0 — title-0): cover.jpg unreadable');
    expect(stdout.text()).not.toContain('(re-run with -v');
  });

  it('expands to per-warning detail at verbose=1 with multi-track hint', () => {
    const { out, stdout } = makeOut({ verbose: 1 });
    printSuccessSummary(out, {
      dryRun: false,
      totalCompleted: 1,
      totalFailed: 0,
      durationSeconds: 1,
      allWarnings: [execWarn('artwork', 'cover unreadable', 5)],
    });
    expect(stdout.text()).toContain('[artwork] (5 tracks): cover unreadable');
  });

  it('omits the track hint at verbose=1 when tracks is empty', () => {
    const { out, stdout } = makeOut({ verbose: 1 });
    printSuccessSummary(out, {
      dryRun: false,
      totalCompleted: 1,
      totalFailed: 0,
      durationSeconds: 1,
      allWarnings: [execWarn('debris-cleanup-failure', 'config issue', 0)],
    });
    expect(stdout.text()).toContain('[debris-cleanup-failure]: config issue');
  });
});
