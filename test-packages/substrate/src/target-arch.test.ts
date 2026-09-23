/**
 * Unit tests for target-architecture resolution.
 *
 * The cases worth pinning are the ones no single machine reaches naturally: a
 * target that differs from the host, the no-substrate default, and the
 * disagreement between a configured target and the substrate that has to run
 * the result. All three are reachable here because every input is a parameter
 * — `resolveTargetArch` takes the environment, the substrate's machine type
 * and the host's arch, and probes nothing.
 */

import { describe, it, expect } from 'bun:test';

import {
  TARGET_ARCH_ENV_VAR,
  TargetArchError,
  hostTargetArch,
  normalizeTargetArch,
  primeTargetArchFromSubstrate,
  probeSubstrateMachine,
  resolveTargetArch,
  targetArch,
} from './target-arch.js';
import type {
  SubstrateCommand,
  SubstrateExecResult,
  SubstrateLink,
  SubstrateProcess,
} from './link.js';
import { SubstrateLinkError } from './link.js';

// ---------------------------------------------------------------------------
// A link that answers one scripted `uname -m` and records what it was asked
// ---------------------------------------------------------------------------

function scriptedLink(
  answer: SubstrateExecResult | Error,
  description = 'Lima instance `podkit-device`'
): { link: SubstrateLink; calls: SubstrateCommand[] } {
  const calls: SubstrateCommand[] = [];
  const link: SubstrateLink = {
    substrateId: 'device',
    description,
    async exec(command) {
      calls.push(command);
      if (answer instanceof Error) throw answer;
      return answer;
    },
    async copyIn() {
      throw new Error('copyIn: not expected in these tests');
    },
    async copyOut() {
      throw new Error('copyOut: not expected in these tests');
    },
    async stageTree() {
      throw new Error('stageTree: not expected in these tests');
    },
    spawn(): SubstrateProcess {
      throw new Error('spawn: not expected in these tests');
    },
  };
  return { link, calls };
}

const uname = (stdout: string, exitCode = 0): SubstrateExecResult => ({
  stdout,
  stderr: '',
  exitCode,
});

// ---------------------------------------------------------------------------
// normalizeTargetArch
// ---------------------------------------------------------------------------

describe('normalizeTargetArch', () => {
  it('maps every spelling the repo receives onto the filename convention', () => {
    // `uname -m` on the substrate, `process.arch` on the host and TARGETARCH
    // in a Docker build all name the same two CPUs differently, and all three
    // strings reach this function from somewhere.
    expect(normalizeTargetArch('aarch64')).toBe('arm64');
    expect(normalizeTargetArch('arm64')).toBe('arm64');
    expect(normalizeTargetArch('x86_64')).toBe('x64');
    expect(normalizeTargetArch('amd64')).toBe('x64');
    expect(normalizeTargetArch('x64')).toBe('x64');
  });

  it('tolerates surrounding whitespace and case, as command output carries both', () => {
    expect(normalizeTargetArch(' X86_64\n')).toBe('x64');
  });

  it('throws rather than guessing for anything else', () => {
    expect(() => normalizeTargetArch('riscv64')).toThrow(TargetArchError);
    expect(() => normalizeTargetArch('')).toThrow(/Unsupported target architecture/);
  });

  it('names the caller-supplied context so the reader knows which input was wrong', () => {
    expect(() => normalizeTargetArch('ppc64le', 'substrate machine type')).toThrow(
      /Unsupported substrate machine type 'ppc64le'/
    );
  });
});

// ---------------------------------------------------------------------------
// resolveTargetArch — the pure decision
// ---------------------------------------------------------------------------

describe('resolveTargetArch', () => {
  it('uses the substrate machine type when nothing is configured', () => {
    expect(resolveTargetArch({ env: {}, substrateMachine: 'x86_64', hostArch: 'arm64' })).toEqual({
      arch: 'x64',
      source: 'substrate',
    });
  });

  it('falls back to the host only when no substrate was consulted', () => {
    expect(resolveTargetArch({ env: {}, hostArch: 'arm64' })).toEqual({
      arch: 'arm64',
      source: 'host-default',
    });
    expect(resolveTargetArch({ env: {}, substrateMachine: null, hostArch: 'x64' })).toEqual({
      arch: 'x64',
      source: 'host-default',
    });
  });

  it('lets an explicit configuration win over the substrate', () => {
    // The only way to build for a box that is not reachable right now. The
    // disagreement is caught where it costs something — at transfer — rather
    // than by refusing to name a path.
    expect(
      resolveTargetArch({
        env: { [TARGET_ARCH_ENV_VAR]: 'x86_64' },
        substrateMachine: 'aarch64',
        hostArch: 'arm64',
      })
    ).toEqual({ arch: 'x64', source: 'configured' });
  });

  it('ignores a blank configuration rather than treating it as a choice', () => {
    expect(resolveTargetArch({ env: { [TARGET_ARCH_ENV_VAR]: '  ' }, hostArch: 'arm64' })).toEqual({
      arch: 'arm64',
      source: 'host-default',
    });
  });

  it('refuses an unbuildable machine type from any of its three inputs', () => {
    expect(() =>
      resolveTargetArch({ env: { [TARGET_ARCH_ENV_VAR]: 'sparc' }, hostArch: 'arm64' })
    ).toThrow(TargetArchError);
    expect(() =>
      resolveTargetArch({ env: {}, substrateMachine: 'sparc', hostArch: 'arm64' })
    ).toThrow(TargetArchError);
    expect(() => resolveTargetArch({ env: {}, hostArch: 'sparc' })).toThrow(TargetArchError);
  });
});

// ---------------------------------------------------------------------------
// targetArch — the synchronous accessor every path resolver calls
// ---------------------------------------------------------------------------

describe('targetArch', () => {
  it('reads the environment and defaults to the host', () => {
    expect(targetArch({ [TARGET_ARCH_ENV_VAR]: 'x86_64' })).toBe('x64');
    expect(targetArch({ [TARGET_ARCH_ENV_VAR]: 'aarch64' })).toBe('arm64');
    expect(targetArch({})).toBe(hostTargetArch());
  });
});

// ---------------------------------------------------------------------------
// probeSubstrateMachine — the one place that pays for a round trip
// ---------------------------------------------------------------------------

describe('probeSubstrateMachine', () => {
  it('asks the substrate for `uname -m` and returns it verbatim', async () => {
    const { link, calls } = scriptedLink(uname('aarch64\n'));
    expect(await probeSubstrateMachine(link)).toBe('aarch64');
    expect(calls).toEqual([['uname', '-m']]);
  });

  it('throws a typed error when the substrate answered but said nothing usable', async () => {
    const { link } = scriptedLink(uname('', 127));
    await expect(probeSubstrateMachine(link)).rejects.toThrow(TargetArchError);
  });

  it('lets a link failure through untouched — unreachable is not unbuildable', async () => {
    // An unreachable substrate is a reason to skip; a substrate that answered
    // something unusable is a reason to fail. Collapsing the two here would
    // undo the distinction the link exists to make.
    const { link } = scriptedLink(
      new SubstrateLinkError({
        substrateId: 'device',
        operation: 'exec',
        message: 'instance does not exist',
      })
    );
    await expect(probeSubstrateMachine(link)).rejects.toThrow(SubstrateLinkError);
  });
});

// ---------------------------------------------------------------------------
// primeTargetArchFromSubstrate — the async half of the bootstrapping boundary
// ---------------------------------------------------------------------------

describe('primeTargetArchFromSubstrate', () => {
  it('publishes the substrate architecture into the environment it was handed', async () => {
    // The env IS the carrier: it is what reaches the synchronous path
    // resolvers in this process and the turbo child process that hashes it
    // into its cache key.
    const { link } = scriptedLink(uname('x86_64\n'));
    const env: NodeJS.ProcessEnv = {};

    const resolution = await primeTargetArchFromSubstrate({ link, env });

    expect(resolution).toEqual({ arch: 'x64', source: 'substrate' });
    expect(env[TARGET_ARCH_ENV_VAR]).toBe('x64');
    expect(targetArch(env)).toBe('x64');
  });

  it('leaves a matching explicit configuration alone', async () => {
    const { link } = scriptedLink(uname('aarch64\n'));
    const env: NodeJS.ProcessEnv = { [TARGET_ARCH_ENV_VAR]: 'arm64' };
    expect(await primeTargetArchFromSubstrate({ link, env })).toEqual({
      arch: 'arm64',
      source: 'configured',
    });
  });

  it('refuses to pick a winner when the configuration contradicts the substrate', async () => {
    const { link } = scriptedLink(uname('aarch64\n'));
    const env: NodeJS.ProcessEnv = { [TARGET_ARCH_ENV_VAR]: 'x86_64' };

    let caught: unknown;
    try {
      await primeTargetArchFromSubstrate({ link, env });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(TargetArchError);
    // Both halves of the contradiction must appear, or the reader cannot tell
    // which one to change.
    expect((caught as Error).message).toContain('PODKIT_TARGET_ARCH');
    expect((caught as Error).message).toContain('aarch64');
    expect((caught as Error).message).toContain('podkit-device');
    // And the wrong value must not have been quietly overwritten.
    expect(env[TARGET_ARCH_ENV_VAR]).toBe('x86_64');
  });
});
