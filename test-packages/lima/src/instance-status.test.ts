/**
 * Unit tests for the Lima instance status probe. Feeds scripted
 * `limactl list --json` (NDJSON) outputs through the injected runner and
 * asserts the tri-state result, with no real `limactl`.
 */

import { describe, it, expect } from 'bun:test';

import { instanceStatus } from './instance-status.js';
import type { SubprocessRunner, SubprocessRunResult } from '@podkit/device-types';

function runnerReturning(result: SubprocessRunResult | (() => never)): SubprocessRunner {
  return {
    async run() {
      if (typeof result === 'function') return result();
      return result;
    },
  };
}

const ndjson = (...entries: Array<{ name: string; status: string }>): string =>
  entries.map((e) => JSON.stringify(e)).join('\n');

describe('instanceStatus', () => {
  it('returns running when the instance status is Running', async () => {
    const runner = runnerReturning({
      stdout: ndjson({ name: 'podkit-device-harness', status: 'Running' }),
      stderr: '',
      exitCode: 0,
    });
    expect(await instanceStatus('podkit-device-harness', runner)).toBe('running');
  });

  it('returns stopped for any non-running status', async () => {
    const runner = runnerReturning({
      stdout: ndjson({ name: 'podkit-device-harness', status: 'Stopped' }),
      stderr: '',
      exitCode: 0,
    });
    expect(await instanceStatus('podkit-device-harness', runner)).toBe('stopped');
  });

  it('returns missing when the instance is not in the list', async () => {
    const runner = runnerReturning({
      stdout: ndjson({ name: 'some-other-vm', status: 'Running' }),
      stderr: '',
      exitCode: 0,
    });
    expect(await instanceStatus('podkit-device-harness', runner)).toBe('missing');
  });

  it('returns missing when limactl itself throws (not installed)', async () => {
    const runner = runnerReturning(() => {
      throw new Error('spawn limactl ENOENT');
    });
    expect(await instanceStatus('podkit-device-harness', runner)).toBe('missing');
  });

  it('returns missing on a non-zero exit', async () => {
    const runner = runnerReturning({ stdout: '', stderr: 'boom', exitCode: 1 });
    expect(await instanceStatus('podkit-device-harness', runner)).toBe('missing');
  });

  it('tolerates a malformed NDJSON line and keeps scanning', async () => {
    const runner = runnerReturning({
      stdout: `not-json\n${JSON.stringify({ name: 'podkit-device-harness', status: 'Running' })}`,
      stderr: '',
      exitCode: 0,
    });
    expect(await instanceStatus('podkit-device-harness', runner)).toBe('running');
  });
});
