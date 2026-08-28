/**
 * Unit tests for the shared `limactl` wrapper, focused on the one thing that
 * cannot be asserted from either side alone: that a rejection produced by the
 * STREAMING runner still reaches the operator as the wrapper's descriptive
 * message.
 *
 * The two runners fail differently. `execFile` kills the child with a signal,
 * so its rejection carries `killed`/`signal`. The streaming runner settles on
 * its own timer (a grandchild holding the stdio pipes open would otherwise
 * defer the rejection past the deadline), so its rejection is a plain `Error`
 * with neither field set. A wrapper that only recognised the first shape would
 * report a warm `limactl start` timeout — which IS routed through the streaming
 * runner — as an anonymous failure. So these tests compose the real streaming
 * runner with the real wrapper rather than hand-writing the error, substituting
 * `sh` for `limactl` so no VM is involved.
 */

import { describe, it, expect } from 'bun:test';

import { runLimactl, limactlError } from './limactl.js';
import { createStreamingSubprocessRunner } from './streaming-runner.js';
import type { SubprocessRunner } from '@podkit/device-types';

/**
 * The real streaming runner, with `sh -c <script>` standing in for whatever
 * `limactl` invocation the wrapper thinks it is making.
 */
function streamingRunnerRunning(script: string, idleTimeoutMs?: number): SubprocessRunner {
  const streaming = createStreamingSubprocessRunner({
    sink: () => {},
    killGraceMs: 50,
    ...(idleTimeoutMs === undefined ? {} : { idleTimeoutMs }),
  });
  return {
    run: (_command, _args, opts) => streaming.run('sh', ['-c', script], opts),
  };
}

describe('runLimactl over the streaming runner', () => {
  it('names the bound when the streaming runner settles on its deadline', async () => {
    await expect(
      runLimactl(streamingRunnerRunning('sleep 5'), ['stop', 'podkit-device'], { timeoutMs: 60 })
    ).rejects.toThrow(/limactl stop podkit-device timed out after 60ms/);
  });

  it('explains what a timeout means rather than just reporting one', async () => {
    await expect(
      runLimactl(streamingRunnerRunning('sleep 5'), ['start', 'podkit-device'], { timeoutMs: 60 })
    ).rejects.toThrow(/not answering/);
  });

  it('reads as one sentence when the liveness watchdog fires', async () => {
    // The watchdog's message deliberately omits the command, because this
    // wrapper prefixes it. A doubled command would read as a bug.
    let message = '';
    try {
      await runLimactl(streamingRunnerRunning('sleep 5', 60), [
        'start',
        '--tty=false',
        '--name=podkit-device',
        'podkit-device.yaml',
      ]);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain('produced no output for');
    expect(message).toContain('podkit-vm recover');
    expect(message.match(/limactl start/g)).toHaveLength(1);
  });

  it('still resolves a non-zero exit rather than throwing — a failed limactl is data', async () => {
    const result = await runLimactl(streamingRunnerRunning('echo nope >&2; exit 3'), ['stop', 'x']);
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain('nope');
  });
});

describe('limactlError', () => {
  it('prefers stderr for the trailing detail', () => {
    expect(
      limactlError('failed to stop', { stdout: 'out', stderr: 'boom', exitCode: 1 }).message
    ).toBe('failed to stop: exit=1: boom');
  });

  it('falls back to a placeholder when limactl said nothing at all', () => {
    expect(limactlError('failed to stop', { stdout: '', stderr: '', exitCode: 7 }).message).toBe(
      'failed to stop: exit=7: (no output, exit=7)'
    );
  });
});
