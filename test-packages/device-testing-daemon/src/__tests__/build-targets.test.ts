import { describe, expect, it } from 'bun:test';

import { resolveBuildTargets } from '../build-targets.js';

describe('resolveBuildTargets', () => {
  it('builds for PODKIT_TARGET_ARCH, not the host, when no target is named', () => {
    expect(
      resolveBuildTargets({ arg: undefined, env: { PODKIT_TARGET_ARCH: 'x64' }, hostArch: 'arm64' })
    ).toEqual(['linux-x64']);
  });

  it('accepts any machine-type spelling the substrate accepts', () => {
    expect(
      resolveBuildTargets({ arg: 'auto', env: { PODKIT_TARGET_ARCH: 'aarch64' }, hostArch: 'x64' })
    ).toEqual(['linux-arm64']);
  });

  it("falls back to the host's architecture when nothing names one", () => {
    expect(resolveBuildTargets({ arg: undefined, env: {}, hostArch: 'arm64' })).toEqual([
      'linux-arm64',
    ]);
  });

  it('builds an explicitly named target regardless of PODKIT_TARGET_ARCH', () => {
    expect(
      resolveBuildTargets({
        arg: 'linux-arm64',
        env: { PODKIT_TARGET_ARCH: 'x64' },
        hostArch: 'x64',
      })
    ).toEqual(['linux-arm64']);
  });

  it('builds both architectures for `all`', () => {
    expect(resolveBuildTargets({ arg: 'all', env: {}, hostArch: 'arm64' })).toEqual([
      'linux-x64',
      'linux-arm64',
    ]);
  });

  it('rejects an unknown target', () => {
    expect(() => resolveBuildTargets({ arg: 'linux-riscv64', env: {}, hostArch: 'x64' })).toThrow(
      /unknown target 'linux-riscv64'/
    );
  });

  it('rejects a PODKIT_TARGET_ARCH this repo does not build for', () => {
    expect(() =>
      resolveBuildTargets({
        arg: undefined,
        env: { PODKIT_TARGET_ARCH: 'riscv64' },
        hostArch: 'x64',
      })
    ).toThrow(/riscv64/);
  });
});
