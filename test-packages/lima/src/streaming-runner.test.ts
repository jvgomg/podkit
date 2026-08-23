/**
 * Unit tests for the output-streaming subprocess runners. These spawn real
 * (trivial, instant) child processes — `echo`, `sh -c`, `false` — because the
 * whole point of the module is what happens to a child's stdio, which a
 * scripted runner cannot express. No VM and no `limactl` are involved.
 */

import { describe, it, expect } from 'bun:test';

import {
  createStreamingSubprocessRunner,
  createVmProvisioningRunner,
  streamsOutput,
} from './streaming-runner.js';

function collector(): { sink: (chunk: string) => void; text: () => string } {
  const chunks: string[] = [];
  return { sink: (chunk) => chunks.push(chunk), text: () => chunks.join('') };
}

describe('createStreamingSubprocessRunner', () => {
  it('echoes output to the sink AND returns it', async () => {
    const { sink, text } = collector();
    const result = await createStreamingSubprocessRunner(sink).run('echo', ['hello']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello');
    expect(text().trim()).toBe('hello');
  });

  it('streams stderr too, and keeps it separate in the result', async () => {
    const { sink, text } = collector();
    const result = await createStreamingSubprocessRunner(sink).run('sh', [
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
    const result = await createStreamingSubprocessRunner(sink).run('sh', ['-c', 'exit 7']);
    expect(result.exitCode).toBe(7);
  });

  it('rejects when the binary does not exist', async () => {
    const { sink } = collector();
    await expect(
      createStreamingSubprocessRunner(sink).run('podkit-no-such-binary-xyz', [])
    ).rejects.toThrow();
  });

  it('rejects when the child outlives its timeout', async () => {
    const { sink } = collector();
    await expect(
      createStreamingSubprocessRunner(sink).run('sh', ['-c', 'sleep 5'], { timeoutMs: 50 })
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
      createStreamingSubprocessRunner(sink).run('sh', ['-c', 'sleep 5 & wait'], { timeoutMs: 50 })
    ).rejects.toThrow(/timed out/);
    // Generous bound: the point is "promptly", not the exact latency. The
    // child lives 5s, so anything near that means we waited for the grandchild.
    expect(Date.now() - started).toBeLessThan(2_000);
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
    const runner = createVmProvisioningRunner(sink);
    const result = await runner.run('echo', ['list', '--json']);
    expect(result.stdout.trim()).toBe('list --json');
    expect(text()).toBe('');
  });

  it('does not stream non-limactl commands even when the first arg is `start`', async () => {
    const { sink, text } = collector();
    const runner = createVmProvisioningRunner(sink);
    await runner.run('echo', ['start', 'something']);
    expect(text()).toBe('');
  });
});
