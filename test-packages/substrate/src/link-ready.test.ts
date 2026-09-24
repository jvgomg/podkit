/**
 * Waiting for a substrate to answer: what counts as ready, what is worth
 * waiting through, and what the bound says when it fires.
 */

import { describe, it, expect } from 'bun:test';

import {
  SUBSTRATE_READY_TIMEOUT_MS,
  SubstrateNotReadyError,
  waitForSubstrateReady,
} from './link-ready.js';
import { SubstrateLinkError, type SubstrateExecResult, type SubstrateLink } from './link.js';

const DESCRIPTION = 'ssh_config alias `podkit-substrate`';
const OK: SubstrateExecResult = { stdout: '', stderr: '', exitCode: 0 };

/** A link whose `exec` replays a script, repeating its last answer forever. */
function scriptedLink(answers: ReadonlyArray<SubstrateExecResult | Error>) {
  let probes = 0;
  const link: SubstrateLink = {
    substrateId: 'deviceRemote',
    description: DESCRIPTION,
    async exec() {
      const answer = answers[Math.min(probes, answers.length - 1)]!;
      probes += 1;
      if (answer instanceof Error) throw answer;
      return answer;
    },
    copyIn: async () => {},
    copyOut: async () => {},
    stageTree: async () => {},
    spawn: () => {
      throw new Error('not used');
    },
  };
  return { link, probes: () => probes };
}

function unreachable(detail: string): SubstrateLinkError {
  return new SubstrateLinkError({
    substrateId: 'deviceRemote',
    operation: 'exec',
    detail,
    message: `substrate 'deviceRemote' is unreachable over ${DESCRIPTION}: ${detail}`,
  });
}

/** A clock that advances a second per read, so the bound is reachable at once. */
function tickingClock(stepMs = 1_000): () => number {
  let clock = 0;
  return () => (clock += stepMs);
}

describe('waitForSubstrateReady', () => {
  it('returns on the first probe when the substrate already answers', async () => {
    const { link, probes } = scriptedLink([OK]);
    let slept = 0;
    await waitForSubstrateReady(link, { sleep: async () => void (slept += 1) });
    expect(probes()).toBe(1);
    expect(slept).toBe(0);
  });

  it('waits through a refused connection and returns once sshd answers', async () => {
    const { link, probes } = scriptedLink([
      unreachable('ssh: connect to host 192.0.2.10 port 22: Connection refused'),
      unreachable('kex_exchange_identification: Connection closed by remote host'),
      OK,
    ]);
    await waitForSubstrateReady(link, { sleep: async () => {} });
    expect(probes()).toBe(3);
  });

  it('keeps waiting while the guest answers but the probe fails', async () => {
    // sshd up, userland not: a session opens and the command still fails.
    const { link, probes } = scriptedLink([
      { stdout: '', stderr: 'bash: fork: retry: Resource temporarily unavailable', exitCode: 1 },
      OK,
    ]);
    await waitForSubstrateReady(link, { sleep: async () => {} });
    expect(probes()).toBe(2);
  });

  it('waits through a rejected key, because cloud-init installs it mid-boot', async () => {
    const { link, probes } = scriptedLink([
      unreachable('podkit@192.0.2.10: Permission denied (publickey).'),
      OK,
    ]);
    await waitForSubstrateReady(link, { sleep: async () => {} });
    expect(probes()).toBe(2);
  });

  it('gives up at the bound, naming the link, the bound and the last diagnostic', async () => {
    const { link } = scriptedLink([
      unreachable('ssh: connect to host 192.0.2.10 port 22: Connection refused'),
    ]);
    const err = await waitForSubstrateReady(link, {
      timeoutMs: 5_000,
      now: tickingClock(),
      sleep: async () => {},
    }).then(
      () => null,
      (e: unknown) => e as SubstrateNotReadyError
    );
    expect(err).toBeInstanceOf(SubstrateNotReadyError);
    expect(err!.reason).toBe('timeout');
    expect(err!.message).toContain(DESCRIPTION);
    expect(err!.message).toContain('5000ms');
    expect(err!.message).toContain('Connection refused');
  });

  it('stops at once on a refusal waiting cannot fix, rather than burning the bound', async () => {
    // What a recreated guest looks like: new host keys, stale known_hosts.
    const { link, probes } = scriptedLink([unreachable('Host key verification failed.')]);
    const err = await waitForSubstrateReady(link, {
      now: tickingClock(),
      sleep: async () => {},
    }).then(
      () => null,
      (e: unknown) => e as SubstrateNotReadyError
    );
    expect(err).toBeInstanceOf(SubstrateNotReadyError);
    expect(err!.reason).toBe('refused');
    expect(err!.message).toContain('Host key verification failed');
    expect(probes()).toBe(1);
  });

  it('stops at once when the alias does not resolve', async () => {
    const { link, probes } = scriptedLink([
      unreachable('ssh: Could not resolve hostname podkit-substrate: Name or service not known'),
    ]);
    const err = await waitForSubstrateReady(link, { sleep: async () => {} }).then(
      () => null,
      (e: unknown) => e as SubstrateNotReadyError
    );
    expect(err!.reason).toBe('refused');
    expect(probes()).toBe(1);
  });

  it('announces the wait once, not once per poll', async () => {
    const { link } = scriptedLink([
      unreachable('ssh: connect to host 192.0.2.10 port 22: Connection refused'),
      unreachable('ssh: connect to host 192.0.2.10 port 22: Connection refused'),
      OK,
    ]);
    const reported: string[] = [];
    await waitForSubstrateReady(link, {
      sleep: async () => {},
      report: (m) => void reported.push(m),
    });
    expect(reported).toHaveLength(1);
    expect(reported[0]).toContain(DESCRIPTION);
  });

  it('bounds the wait generously enough for a cloud-init first boot', () => {
    expect(SUBSTRATE_READY_TIMEOUT_MS).toBeGreaterThanOrEqual(120_000);
  });
});
