/**
 * Unit tests for the host binary path resolvers. Assert the external contract:
 * an env override wins verbatim, otherwise the per-arch default path is
 * produced under the repo build-output tree.
 */

import { describe, it, expect } from 'bun:test';

import {
  vmArch,
  resolveDefaultPodkitBinary,
  resolveDefaultPodkitDebugBinary,
  resolveDefaultDaemonLinuxBinary,
  resolveDefaultPodkitMuslBinary,
  resolveDefaultDaemonLinuxMuslBinary,
  resolveDefaultGpodToolBinary,
} from './binary-paths.js';

const ARCH = vmArch();

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
    expect(resolved).toContain(`packages/podkit-cli/bin/podkit-linux-${ARCH}`);
  });

  it('produces per-arch default paths matching the turbo build layout', () => {
    expect(resolveDefaultPodkitBinary({})).toContain(
      `packages/podkit-cli/bin/podkit-linux-${ARCH}`
    );
    expect(resolveDefaultPodkitDebugBinary({})).toContain(
      `packages/podkit-cli/bin/podkit-debug-linux-${ARCH}`
    );
    expect(resolveDefaultPodkitMuslBinary({})).toContain(
      `packages/podkit-cli/bin/podkit-linux-${ARCH}-musl`
    );
    expect(resolveDefaultDaemonLinuxMuslBinary({})).toContain(
      `packages/podkit-daemon/bin/podkit-daemon-linux-${ARCH}-musl`
    );
    expect(resolveDefaultGpodToolBinary({})).toContain(
      `test-packages/gpod-testing/bin/gpod-tool-linux-${ARCH}`
    );
  });

  it('resolves absolute paths', () => {
    expect(resolveDefaultPodkitBinary({}).startsWith('/')).toBe(true);
  });
});
