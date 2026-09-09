/**
 * Unit tests for the elapsed-time heartbeat. The clock is injected, so the
 * assertions are on the RENDERED LINES rather than on wall time — a test that
 * had to sleep for a real heartbeat interval would be both slow and flaky.
 */

import { describe, it, expect } from 'bun:test';

import { formatElapsed, startHeartbeat, DEFAULT_HEARTBEAT_MS } from './progress.js';

/**
 * Wait for the heartbeat to have reported `count` lines, or fail loudly.
 *
 * Sleeping a fixed span and then asserting a tick count races the scheduler:
 * under load timer callbacks coalesce, so an interval does not reliably fire
 * N times inside N × interval of wall clock. The ceiling keeps a heartbeat
 * that never ticks failing — and saying what it was waiting for — rather than
 * hanging to the suite timeout.
 */
async function waitForLines(lines: string[], count: number, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (lines.length < count && Date.now() < deadline) {
    await Bun.sleep(5);
  }
  if (lines.length < count) {
    throw new Error(
      `Timed out after ${timeoutMs}ms waiting for ${count} heartbeat line(s); saw ${lines.length}`
    );
  }
}

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
    // Wait for two ticks rather than sleeping a fixed span and hoping — see
    // waitForLines above for why.
    await waitForLines(lines, 2);
    beat.stop();
    const seen = lines.length;
    expect(seen).toBeGreaterThanOrEqual(2);
    expect(lines[0]).toMatch(/^still waiting on `limactl stop podkit-device` \(\d+s elapsed\)$/);

    // stop() really stops: no further lines after the handle is released. Sleep
    // well past the interval so a *failure* to stop is actually observed — at
    // 3x the interval a slow tick could otherwise read as a clean stop.
    await Bun.sleep(200);
    expect(lines).toHaveLength(seen);
  });

  it('adds time-since-last-output when the caller can observe activity', async () => {
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
    // The *clock* is deterministic (injected `now`), but the tick still is not:
    // waiting a fixed 5ms for a 1ms interval is the same bet a6964fcd removed
    // from the test above, just with more margin. Wait for the line instead.
    await waitForLines(lines, 1);
    beat.stop();
    expect(lines[0]).toBe(
      'still waiting on `limactl start podkit-device` (4m12s elapsed, 3m50s since last output)'
    );
  });

  it('omits the idle clause when there is no activity signal to report', async () => {
    const lines: string[] = [];
    let clock = 0;
    const beat = startHeartbeat({
      label: 'limactl delete --force podkit-device',
      report: (line) => lines.push(line),
      intervalMs: 1,
      now: () => clock,
    });
    clock += 90_000;
    await waitForLines(lines, 1);
    beat.stop();
    expect(lines[0]).toBe(
      'still waiting on `limactl delete --force podkit-device` (1m30s elapsed)'
    );
    expect(lines[0]).not.toContain('since last output');
  });

  it('starts no timer at all when the interval is non-positive', async () => {
    const lines: string[] = [];
    const beat = startHeartbeat({
      label: 'limactl list --json',
      report: (line) => lines.push(line),
      intervalMs: 0,
    });
    // Legitimate fixed sleep: negative assertion — the guarantee is that no
    // timer exists, so there is no event to wait for. A timer created with a
    // non-positive interval would be clamped to ~1ms and would have fired many
    // times over by now, so 20ms is ample room for the failure to show itself.
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
