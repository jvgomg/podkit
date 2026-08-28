/**
 * Unit tests for the output-streaming subprocess runners. These spawn real
 * (trivial, fast) child processes — `echo`, `sh -c`, `false` — because the
 * whole point of the module is what happens to a child's stdio and to a child
 * that will not die, neither of which a scripted runner can express. No VM and
 * no `limactl` are involved.
 *
 * The liveness assertions use millisecond-scale thresholds. That is not a
 * shortcut: the property under test is "the bound is rearmed by output, not by
 * the clock", and that property is scale-free. The production thresholds are
 * asserted separately, as values.
 */

import { describe, it, expect } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  createStreamingSubprocessRunner,
  createVmProvisioningRunner,
  streamsOutput,
  DEFAULT_KILL_GRACE_MS,
  PROVISIONING_IDLE_TIMEOUT_MS,
  PROVISIONING_KILL_GRACE_MS,
} from './streaming-runner.js';

function collector(): { sink: (chunk: string) => void; text: () => string } {
  const chunks: string[] = [];
  return { sink: (chunk) => chunks.push(chunk), text: () => chunks.join('') };
}

describe('createStreamingSubprocessRunner', () => {
  it('echoes output to the sink AND returns it', async () => {
    const { sink, text } = collector();
    const result = await createStreamingSubprocessRunner({ sink }).run('echo', ['hello']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello');
    expect(text().trim()).toBe('hello');
  });

  it('streams stderr too, and keeps it separate in the result', async () => {
    const { sink, text } = collector();
    const result = await createStreamingSubprocessRunner({ sink }).run('sh', [
      '-c',
      'echo out; echo err >&2',
    ]);
    expect(result.stdout).toContain('out');
    expect(result.stderr).toContain('err');
    expect(text()).toContain('out');
    expect(text()).toContain('err');
  });

  it('resolves (not rejects) on a non-zero exit — a failed child is a normal outcome', async () => {
    const { sink } = collector();
    const result = await createStreamingSubprocessRunner({ sink }).run('sh', ['-c', 'exit 7']);
    expect(result.exitCode).toBe(7);
  });

  it('rejects when the binary does not exist', async () => {
    const { sink } = collector();
    await expect(
      createStreamingSubprocessRunner({ sink }).run('podkit-no-such-binary-xyz', [])
    ).rejects.toThrow();
  });

  it('rejects when the child outlives its timeout', async () => {
    const { sink } = collector();
    await expect(
      createStreamingSubprocessRunner({ sink }).run('sh', ['-c', 'sleep 5'], { timeoutMs: 50 })
    ).rejects.toThrow(/timed out/);
  });

  // `sleep 5 & wait` forces the shell to fork rather than exec, so a grandchild
  // inherits the stdio pipes and holds them open after the direct child is
  // signalled. Settling on `close` would therefore defer the rejection until
  // the grandchild exits — the deadline would be advisory, not real. Some
  // shells exec a bare `sleep 5` and hide this entirely, so the fork is forced
  // rather than assumed.
  it('honours the deadline even when a grandchild holds the pipes open', async () => {
    const { sink } = collector();
    const started = Date.now();
    await expect(
      createStreamingSubprocessRunner({ sink }).run('sh', ['-c', 'sleep 5 & wait'], {
        timeoutMs: 50,
      })
    ).rejects.toThrow(/timed out/);
    // Generous bound: the point is "promptly", not the exact latency. The
    // child lives 5s, so anything near that means we waited for the grandchild.
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  it('escalates to SIGKILL for a child that ignores SIGTERM', async () => {
    // Settling the promise means we stopped WAITING for the child; it does not
    // mean the child died. A process that traps SIGTERM would otherwise run on
    // unsupervised — so the escalation must survive the promise settling.
    // The marker file is the witness: it is written only if the shell lives
    // long enough to reach the `echo`.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lima-killgrace-'));
    const marker = path.join(dir, 'survived');
    try {
      const { sink } = collector();
      await expect(
        createStreamingSubprocessRunner({ sink, killGraceMs: 150 }).run(
          'sh',
          ['-c', `trap "" TERM; sleep 1; echo alive > ${marker}`],
          { timeoutMs: 50 }
        )
      ).rejects.toThrow(/timed out/);
      await Bun.sleep(1_400);
      expect(fs.existsSync(marker)).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('aborts a child that has produced no output for the idle window', async () => {
    const { sink } = collector();
    await expect(
      createStreamingSubprocessRunner({ sink, idleTimeoutMs: 80, killGraceMs: 50 }).run('sh', [
        '-c',
        'sleep 5',
      ])
    ).rejects.toThrow(/produced no output for/);
  });

  it('names `recover` in the wedge message, because a killed create may leave a partial instance', async () => {
    const { sink } = collector();
    await expect(
      createStreamingSubprocessRunner({ sink, idleTimeoutMs: 60, killGraceMs: 50 }).run('sh', [
        '-c',
        'sleep 5',
      ])
    ).rejects.toThrow(/podkit-vm recover/);
  });

  // THE property that makes progress-based liveness usable at all, and the
  // reason a plain wall-clock bound was rejected: a legitimately slow operation
  // must not be aborted however long it runs, as long as it keeps reporting.
  // Here the child runs for ~5x its own idle window and still completes.
  it('does NOT abort a slow child that keeps producing output', async () => {
    const { sink, text } = collector();
    const started = Date.now();
    const result = await createStreamingSubprocessRunner({ sink, idleTimeoutMs: 120 }).run('sh', [
      '-c',
      'i=0; while [ $i -lt 10 ]; do echo "[hostagent] step $i"; sleep 0.06; i=$((i+1)); done',
    ]);
    const elapsed = Date.now() - started;
    expect(result.exitCode).toBe(0);
    expect(elapsed).toBeGreaterThan(400);
    expect(text()).toContain('[hostagent] step 9');
  });

  it('leaves the child unbounded when no idle window is configured', async () => {
    const { sink } = collector();
    const result = await createStreamingSubprocessRunner({ sink }).run('sh', [
      '-c',
      'sleep 0.3; echo done',
    ]);
    expect(result.stdout.trim()).toBe('done');
  });
});

describe('createVmProvisioningRunner', () => {
  it('routes the provisioning subcommands to the streaming path', () => {
    // Asserted on the predicate rather than by spawning: a real
    // `limactl start` would provision a VM.
    expect(streamsOutput('limactl', ['start', 'podkit-device'])).toBe(true);
    expect(streamsOutput('limactl', ['create', '--name', 'podkit-device', 'x.yaml'])).toBe(true);
  });

  it('leaves probes and teardown buffered', () => {
    expect(streamsOutput('limactl', ['list', '--json'])).toBe(false);
    expect(streamsOutput('limactl', ['stop', 'podkit-device'])).toBe(false);
    expect(streamsOutput('limactl', ['delete', '--force', 'podkit-device'])).toBe(false);
    expect(streamsOutput('limactl', [])).toBe(false);
    expect(streamsOutput('rsync', ['start'])).toBe(false);
  });

  it('does not stream a status probe — that output is machine-readable noise', async () => {
    const { sink, text } = collector();
    const runner = createVmProvisioningRunner({ sink });
    const result = await runner.run('echo', ['list', '--json']);
    expect(result.stdout.trim()).toBe('list --json');
    expect(text()).toBe('');
  });

  it('does not stream non-limactl commands even when the first arg is `start`', async () => {
    const { sink, text } = collector();
    const runner = createVmProvisioningRunner({ sink });
    await runner.run('echo', ['start', 'something']);
    expect(text()).toBe('');
  });

  it('reports progress for a buffered call — the silent-stop case', async () => {
    // A `limactl stop` that hangs produces no output of its own; without a
    // heartbeat the operator sees nothing at all while it runs.
    const lines: string[] = [];
    const runner = createVmProvisioningRunner({
      sink: () => {},
      report: (line) => lines.push(line),
      heartbeatMs: 15,
    });
    await runner.run('sh', ['-c', 'sleep 0.2']);
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines[0]).toContain('still waiting on `sh -c sleep 0.2`');
    // No output stream to observe for a buffered call, so no idle clause.
    expect(lines[0]).not.toContain('since last output');
  });

  it('stops reporting once the call completes', async () => {
    const lines: string[] = [];
    const runner = createVmProvisioningRunner({
      sink: () => {},
      report: (line) => lines.push(line),
      heartbeatMs: 15,
    });
    await runner.run('sh', ['-c', 'sleep 0.1']);
    const seen = lines.length;
    await Bun.sleep(60);
    expect(lines).toHaveLength(seen);
  });

  it('starts no heartbeat when no report sink is supplied — library callers stay quiet', async () => {
    // Nothing to assert on an absent sink beyond "it does not throw and does
    // not print"; the meaningful guarantee is that the timer is never created,
    // which is what keeps `bun run vm:*`-free library use silent.
    const runner = createVmProvisioningRunner({ sink: () => {} });
    const result = await runner.run('echo', ['quiet']);
    expect(result.stdout.trim()).toBe('quiet');
  });

  it('applies the idle window only to the streamed provisioning subcommands', async () => {
    // A buffered call gets no idle watchdog: `defaultSubprocessRunner` has no
    // chunk-level view to rearm one from, and `stop`/`destroy` carry explicit
    // wall-clock bounds instead.
    const runner = createVmProvisioningRunner({ sink: () => {}, idleTimeoutMs: 40 });
    const result = await runner.run('sh', ['-c', 'sleep 0.25; echo done']);
    expect(result.stdout.trim()).toBe('done');
  });
});

describe('provisioning thresholds', () => {
  it('sizes the no-output window above a whole legitimate cold create', () => {
    // The safety argument for progress-based liveness rests on this
    // inequality: a create that is merely slow cannot trip the watchdog,
    // because it would have to be silent for longer than the SLOWEST healthy
    // create takes end to end (five to ten minutes, per this package's README
    // and ADR-027).
    const slowestDocumentedColdCreateMs = 10 * 60_000;
    expect(PROVISIONING_IDLE_TIMEOUT_MS).toBeGreaterThan(slowestDocumentedColdCreateMs);
    expect(PROVISIONING_IDLE_TIMEOUT_MS).toBe(15 * 60_000);
  });

  it('gives a wedged provisioner a longer unwind grace than an ordinary child', () => {
    // `limactl start` supervises a hostagent that owns the hypervisor process.
    // The promise has already settled by the time the grace runs, so the extra
    // wait costs the caller nothing and only buys an orderly teardown.
    expect(PROVISIONING_KILL_GRACE_MS).toBeGreaterThan(DEFAULT_KILL_GRACE_MS);
  });
});
