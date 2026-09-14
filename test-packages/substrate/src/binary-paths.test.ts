/**
 * Unit tests for the host binary path resolvers. Assert the external contract:
 * an env override wins verbatim, otherwise the per-arch default path is
 * produced under the repo build-output tree.
 *
 * The architecture the resolvers use comes from the SAME env object they are
 * handed, which is what makes the foreign-architecture case testable on a
 * machine that only has one. Without that, the only reachable branch would be
 * "whatever this laptop is" — and the whole point of the resolvers no longer
 * deriving the suffix from `process.arch` is the case a single machine cannot
 * reach naturally.
 */

import { describe, it, expect } from 'bun:test';

import {
  resolveDefaultPodkitBinary,
  resolveDefaultPodkitDebugBinary,
  resolveDefaultDaemonLinuxBinary,
  resolveDefaultPodkitMuslBinary,
  resolveDefaultDaemonLinuxMuslBinary,
  resolveDefaultDummyHcdDaemonBinary,
  resolveDefaultGpodToolBinary,
} from './binary-paths.js';
import { hostTargetArch, TargetArchError } from './target-arch.js';

const HOST_ARCH = hostTargetArch();
/** The architecture this host is NOT — every cross-arch case below uses it. */
const FOREIGN_ARCH = HOST_ARCH === 'arm64' ? 'x64' : 'arm64';

describe('binary path resolvers', () => {
  it('honours env overrides verbatim', () => {
    expect(resolveDefaultPodkitBinary({ PODKIT_LINUX_BINARY: '/custom/podkit' })).toBe(
      '/custom/podkit'
    );
    expect(resolveDefaultPodkitMuslBinary({ PODKIT_LINUX_MUSL_BINARY: '/custom/musl' })).toBe(
      '/custom/musl'
    );
    expect(resolveDefaultDaemonLinuxBinary({ PODKIT_DAEMON_LINUX_BINARY: '/custom/daemon' })).toBe(
      '/custom/daemon'
    );
  });

  it('ignores an empty override and falls back to the default', () => {
    const resolved = resolveDefaultPodkitBinary({ PODKIT_LINUX_BINARY: '' });
    expect(resolved).toContain(`packages/podkit-cli/bin/podkit-linux-${HOST_ARCH}`);
  });

  it('produces per-arch default paths matching the turbo build layout', () => {
    expect(resolveDefaultPodkitBinary({})).toContain(
      `packages/podkit-cli/bin/podkit-linux-${HOST_ARCH}`
    );
    expect(resolveDefaultPodkitDebugBinary({})).toContain(
      `packages/podkit-cli/bin/podkit-debug-linux-${HOST_ARCH}`
    );
    expect(resolveDefaultPodkitMuslBinary({})).toContain(
      `packages/podkit-cli/bin/podkit-linux-${HOST_ARCH}-musl`
    );
    expect(resolveDefaultDaemonLinuxMuslBinary({})).toContain(
      `packages/podkit-daemon/bin/podkit-daemon-linux-${HOST_ARCH}-musl`
    );
    expect(resolveDefaultGpodToolBinary({})).toContain(
      `test-packages/gpod-testing/bin/gpod-tool-linux-${HOST_ARCH}`
    );
  });

  it('resolves absolute paths', () => {
    expect(resolveDefaultPodkitBinary({}).startsWith('/')).toBe(true);
  });
});

describe('binary path resolvers — foreign target architecture', () => {
  const env = { PODKIT_TARGET_ARCH: FOREIGN_ARCH };

  it('names artifacts for a target architecture this host is not', () => {
    expect(resolveDefaultPodkitBinary(env)).toContain(
      `packages/podkit-cli/bin/podkit-linux-${FOREIGN_ARCH}`
    );
    expect(resolveDefaultPodkitDebugBinary(env)).toContain(
      `packages/podkit-cli/bin/podkit-debug-linux-${FOREIGN_ARCH}`
    );
    expect(resolveDefaultDaemonLinuxBinary(env)).toContain(
      `packages/podkit-daemon/bin/podkit-daemon-linux-${FOREIGN_ARCH}`
    );
    expect(resolveDefaultPodkitMuslBinary(env)).toContain(
      `packages/podkit-cli/bin/podkit-linux-${FOREIGN_ARCH}-musl`
    );
    expect(resolveDefaultDaemonLinuxMuslBinary(env)).toContain(
      `packages/podkit-daemon/bin/podkit-daemon-linux-${FOREIGN_ARCH}-musl`
    );
    expect(resolveDefaultDummyHcdDaemonBinary(env)).toContain(
      `test-packages/device-testing-daemon/dist/dummy-hcd-daemon-linux-${FOREIGN_ARCH}`
    );
    expect(resolveDefaultGpodToolBinary(env)).toContain(
      `test-packages/gpod-testing/bin/gpod-tool-linux-${FOREIGN_ARCH}`
    );
  });

  it('accepts the `uname -m` spelling, so `PODKIT_TARGET_ARCH=$(uname -m)` is right', () => {
    expect(resolveDefaultPodkitBinary({ PODKIT_TARGET_ARCH: 'x86_64' })).toContain(
      'podkit-linux-x64'
    );
    expect(resolveDefaultPodkitBinary({ PODKIT_TARGET_ARCH: 'aarch64' })).toContain(
      'podkit-linux-arm64'
    );
  });

  it('refuses a machine type nothing is built for rather than defaulting to the host', () => {
    // A typo here used to be unreachable, because the suffix came from
    // process.arch and nothing else. Now it is an input, and an input that
    // silently fell back to the host's architecture would produce a
    // correctly-named artifact full of the wrong bytes — the exact failure
    // this slice exists to make impossible.
    expect(() => resolveDefaultPodkitBinary({ PODKIT_TARGET_ARCH: 'riscv64' })).toThrow(
      TargetArchError
    );
    expect(() => resolveDefaultPodkitBinary({ PODKIT_TARGET_ARCH: 'arm46' })).toThrow(
      /Unsupported PODKIT_TARGET_ARCH value/
    );
  });

  it('lets an explicit binary override win over the target architecture', () => {
    // The override names a file, not an architecture. quality:rc points these
    // at fetched release artifacts; they must not be second-guessed.
    expect(
      resolveDefaultPodkitBinary({
        PODKIT_TARGET_ARCH: FOREIGN_ARCH,
        PODKIT_LINUX_BINARY: '/downloads/podkit',
      })
    ).toBe('/downloads/podkit');
  });
});
