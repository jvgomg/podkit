/**
 * Unit tests for the elapsed-time heartbeat. The clock is injected, so the
 * assertions are on the RENDERED LINES rather than on wall time — a test that
 * had to sleep for a real heartbeat interval would be both slow and flaky.
 */

import { describe, it, expect } from 'bun:test';

import { formatElapsed, startHeartbeat, DEFAULT_HEARTBEAT_MS } from './progress.js';

describe('formatElapsed', () => {
  it('renders sub-minute durations in seconds', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(45_000)).toBe('45s');
  });

  it('renders longer durations the way an operator reads a clock', () => {
    // The duration of the incident that motivated this: a stop that hung for
    // 2m47s with no output at all.
    expect(formatElapsed(167_000)).toBe('2m47s');
    expect(formatElapsed(600_000)).toBe('10m00s');
  });

  it('zero-pads the seconds so successive lines stay column-aligned', () => {
    expect(formatElapsed(61_000)).toBe('1m01s');
  });

  it('never renders a negative duration', () => {
    expect(formatElapsed(-5_000)).toBe('0s');
  });
});

describe('startHeartbeat', () => {
  it('reports elapsed time against the label at the configured interval', async () => {
    const lines: string[] = [];
    const beat = startHeartbeat({
      label: 'limactl stop podkit-device',
      report: (line) => lines.push(line),
      intervalMs: 10,
    });
    await Bun.sleep(35);
    beat.stop();
    const seen = lines.length;
    expect(seen).toBeGreaterThanOrEqual(2);
    expect(lines[0]).toMatch(/^still waiting on `limactl stop podkit-device` \(\d+s elapsed\)$/);

    // stop() really stops: no further lines after the handle is released.
    await Bun.sleep(30);
    expect(lines).toHaveLength(seen);
  });

  it('adds time-since-last-output when the caller can observe activity', () => {
    const lines: string[] = [];
    let clock = 1_000_000;
    const beat = startHeartbeat({
      label: 'limactl start podkit-device',
      report: (line) => lines.push(line),
      intervalMs: 1,
      now: () => clock,
      lastActivityAt: () => clock - 230_000,
    });
    clock += 252_000;
    // Force one tick deterministically rather than racing the interval.
    return Bun.sleep(5).then(() => {
      beat.stop();
      expect(lines[0]).toBe(
        'still waiting on `limactl start podkit-device` (4m12s elapsed, 3m50s since last output)'
      );
    });
  });

  it('omits the idle clause when there is no activity signal to report', () => {
    const lines: string[] = [];
    let clock = 0;
    const beat = startHeartbeat({
      label: 'limactl delete --force podkit-device',
      report: (line) => lines.push(line),
      intervalMs: 1,
      now: () => clock,
    });
    clock += 90_000;
    return Bun.sleep(5).then(() => {
      beat.stop();
      expect(lines[0]).toBe(
        'still waiting on `limactl delete --force podkit-device` (1m30s elapsed)'
      );
      expect(lines[0]).not.toContain('since last output');
    });
  });

  it('starts no timer at all when the interval is non-positive', async () => {
    const lines: string[] = [];
    const beat = startHeartbeat({
      label: 'limactl list --json',
      report: (line) => lines.push(line),
      intervalMs: 0,
    });
    await Bun.sleep(20);
    beat.stop();
    expect(lines).toEqual([]);
  });

  it('picks a default interval that is short enough to reassure and long enough to stay quiet', () => {
    // Below the fastest legitimate `limactl stop`, so a stop that is merely
    // slow still produces at least one line before an impatient operator
    // reaches for ^C; above the duration of a status probe, so routine calls
    // never emit anything.
    expect(DEFAULT_HEARTBEAT_MS).toBe(30_000);
  });
});
