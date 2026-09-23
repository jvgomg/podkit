/**
 * Unit tests for the set of architectures one run has to produce.
 *
 * The cross-architecture case is the whole reason this module exists and no
 * single machine can reach it naturally, so every input is passed in — the
 * same discipline `build-host.test.ts` and `selection.test.ts` apply.
 */

import { describe, expect, it } from 'bun:test';

import {
  HOST_ARCH_ENV_VAR,
  requiredArches,
  resolveRequiredArches,
  type ResolveRequiredArchesInput,
} from './required-arches.js';

function input(overrides: Partial<ResolveRequiredArchesInput> = {}): ResolveRequiredArchesInput {
  return { libc: 'musl', targetArch: 'arm64', hostArch: 'arm64', ...overrides };
}

describe('resolveRequiredArches — one architecture', () => {
  it('needs only the target architecture for glibc, even across architectures', () => {
    const reqs = resolveRequiredArches(input({ libc: 'glibc', targetArch: 'x64' }));
    expect(reqs.map((req) => req.arch)).toEqual(['x64']);
    expect(reqs[0]!.consumer).toBe('substrate');
  });

  it('needs only the target architecture for musl when the host agrees', () => {
    const reqs = resolveRequiredArches(input({ targetArch: 'x64', hostArch: 'x64' }));
    expect(reqs.map((req) => req.arch)).toEqual(['x64']);
    expect(reqs[0]!.consumer).toBe('substrate');
  });

  it('does not report the host twice when it is the substrate', () => {
    expect(resolveRequiredArches(input())).toHaveLength(1);
  });
});

describe('resolveRequiredArches — both architectures', () => {
  it('adds the host architecture for musl when it differs from the target', () => {
    const reqs = resolveRequiredArches(input({ targetArch: 'x64', hostArch: 'arm64' }));
    expect(reqs.map((req) => req.arch)).toEqual(['x64', 'arm64']);
    expect(reqs.map((req) => req.consumer)).toEqual(['substrate', 'host-docker']);
  });

  it('puts the target architecture first, so a failure there stops the run early', () => {
    const reqs = resolveRequiredArches(input({ targetArch: 'arm64', hostArch: 'x64' }));
    expect(reqs[0]!.arch).toBe('arm64');
  });

  it('leaves glibc alone on a cross-architecture host', () => {
    const reqs = resolveRequiredArches(
      input({ libc: 'glibc', targetArch: 'x64', hostArch: 'arm64' })
    );
    expect(reqs.map((req) => req.arch)).toEqual(['x64']);
  });

  it('gives every requirement a reason naming what consumes it', () => {
    for (const req of resolveRequiredArches(input({ targetArch: 'x64', hostArch: 'arm64' }))) {
      expect(req.reason.length).toBeGreaterThan(0);
    }
  });
});

describe('requiredArches — the environment-reading wrapper', () => {
  it('reads the host architecture from the environment when one is published', () => {
    const reqs = requiredArches('musl', {
      PODKIT_TARGET_ARCH: 'x64',
      [HOST_ARCH_ENV_VAR]: 'aarch64',
    });
    expect(reqs.map((req) => req.arch)).toEqual(['x64', 'arm64']);
  });

  it('falls back to this process when nothing published a host architecture', () => {
    const reqs = requiredArches('musl', { PODKIT_TARGET_ARCH: 'x64' }, 'arm64');
    expect(reqs.map((req) => req.arch)).toEqual(['x64', 'arm64']);
  });

  it('accepts every machine-type spelling the repo accepts', () => {
    const reqs = requiredArches('musl', {
      PODKIT_TARGET_ARCH: 'x86_64',
      [HOST_ARCH_ENV_VAR]: 'amd64',
    });
    expect(reqs.map((req) => req.arch)).toEqual(['x64']);
  });

  it('refuses a host architecture this repo does not build for', () => {
    expect(() => requiredArches('musl', { [HOST_ARCH_ENV_VAR]: 'riscv64' })).toThrow(/riscv64/);
  });
});
