/**
 * Unit tests for build-host selection.
 *
 * The interesting cases are the ones a developer's laptop cannot reach
 * naturally — an arm64 host building amd64, an amd64 host with two capable
 * builders — so every input is passed in and nothing is probed. That is the
 * same discipline `selection.test.ts` applies to substrate selection, and for
 * the same reason: a resolver that reads `process.arch` has branches no test on
 * a single machine can enter.
 */

import { describe, expect, it } from 'bun:test';

import {
  BUILD_HOST_ENV_VAR,
  BuildHostSelectionError,
  resolveBuildHostSelection,
  type ResolveBuildHostInput,
} from './build-host.js';
import { listVms, type VmDefinition } from './registry.js';

/** The real registry, so the shapes under test stay the shipped ones. */
const REAL = listVms();

function input(overrides: Partial<ResolveBuildHostInput> = {}): ResolveBuildHostInput {
  return {
    env: {},
    substrates: REAL,
    libc: 'glibc',
    arch: 'arm64',
    hostArch: 'arm64',
    limactlAvailable: true,
    ...overrides,
  };
}

describe('resolveBuildHostSelection — the macOS status quo', () => {
  it('keeps an arm64 Mac with a Lima substrate on its Lima builders', () => {
    const glibc = resolveBuildHostSelection(input({ substrateProvisioner: 'lima' }));
    expect(glibc.buildHost.id).toBe('builderGlibc');
    expect(glibc.source).toBe('substrate-provisioner');
    expect(glibc.containerised).toBe(false);
    expect(glibc.announcement).toBeNull();

    const musl = resolveBuildHostSelection(input({ libc: 'musl', substrateProvisioner: 'lima' }));
    expect(musl.buildHost.id).toBe('builderMusl');
    // macOS has a second VM to spare and uses it — no container involved.
    expect(musl.containerised).toBe(false);
  });
});

describe('resolveBuildHostSelection — the case this slice exists for', () => {
  // The headline: an arm64 Mac driving an amd64 substrate. Before this,
  // `targetArch()` resolved to x64 and every builder was a local arm64 Lima
  // instance, so the build refused with "run this on an x64 build host" and
  // named no such host.
  it('sends an arm64 host targeting x64 to the remote builder', () => {
    const selection = resolveBuildHostSelection(
      input({ arch: 'x64', hostArch: 'arm64', substrateProvisioner: 'ssh' })
    );
    expect(selection.buildHost.id).toBe('builderRemote');
    expect(selection.source).toBe('substrate-provisioner');
  });

  it('reaches musl on the remote builder through its Alpine container', () => {
    const selection = resolveBuildHostSelection(
      input({ arch: 'x64', hostArch: 'arm64', libc: 'musl', substrateProvisioner: 'ssh' })
    );
    expect(selection.buildHost.id).toBe('builderRemote');
    // The whole point of doc-060's musl decision: one box, not a third guest.
    expect(selection.containerised).toBe(true);
  });

  it('announces itself when the only capable builder is not the substrate’s sibling', () => {
    const selection = resolveBuildHostSelection(
      input({ arch: 'x64', hostArch: 'arm64', substrateProvisioner: 'lima' })
    );
    expect(selection.buildHost.id).toBe('builderRemote');
    expect(selection.source).toBe('capability');
    expect(selection.announcement).toContain('builderRemote');
    expect(selection.announcement).toContain(BUILD_HOST_ENV_VAR);
  });
});

describe('resolveBuildHostSelection — two capable builders', () => {
  // An amd64 Linux box driving an amd64 remote substrate. Capability cannot
  // separate the two; building locally would produce artifacts on a machine
  // whose toolchain and glibc floor nobody asserted anything about.
  it('prefers the builder provisioned like the selected substrate', () => {
    const remote = resolveBuildHostSelection(
      input({ arch: 'x64', hostArch: 'x64', substrateProvisioner: 'ssh' })
    );
    expect(remote.buildHost.id).toBe('builderRemote');

    const lima = resolveBuildHostSelection(
      input({ arch: 'x64', hostArch: 'x64', substrateProvisioner: 'lima' })
    );
    expect(lima.buildHost.id).toBe('builderGlibc');
  });

  it('falls back to capability alone when no substrate is in play', () => {
    const selection = resolveBuildHostSelection(input({ arch: 'x64', hostArch: 'x64' }));
    expect(selection.source).toBe('capability');
    expect(selection.announcement).not.toBeNull();
  });
});

describe('resolveBuildHostSelection — limactl absent', () => {
  it('disqualifies every Lima builder, however well its architecture matches', () => {
    const selection = resolveBuildHostSelection(
      input({ arch: 'x64', hostArch: 'x64', limactlAvailable: false })
    );
    expect(selection.buildHost.provisioner).toBe('ssh');
  });

  it('errors with the provisioning step when nothing at all can build', () => {
    // arm64 wanted, no Lima, and the only ssh builder declares x64.
    let caught: unknown;
    try {
      resolveBuildHostSelection(input({ arch: 'arm64', limactlAvailable: false }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BuildHostSelectionError);
    const message = (caught as Error).message;
    expect(message).toContain('linux-arm64 (glibc)');
    expect(message).toContain('builder-proxmox.md');
    // Every candidate is named WITH its reason — "nothing matched" alone sends
    // the reader to open a shell on three machines.
    expect(message).toContain('builderGlibc (rejected: `limactl` is not on PATH)');
    expect(message).toContain('builderRemote (rejected: it declares x64)');
  });
});

describe('resolveBuildHostSelection — configured explicitly', () => {
  it('honours a named build host', () => {
    const selection = resolveBuildHostSelection(
      input({
        arch: 'x64',
        hostArch: 'x64',
        env: { [BUILD_HOST_ENV_VAR]: 'builderRemote' },
        substrateProvisioner: 'lima',
      })
    );
    expect(selection.buildHost.id).toBe('builderRemote');
    expect(selection.source).toBe('configured');
    expect(selection.announcement).toBeNull();
  });

  it('accepts the concrete instance name as well as the registry id', () => {
    const selection = resolveBuildHostSelection(
      input({
        arch: 'x64',
        hostArch: 'x64',
        env: { [BUILD_HOST_ENV_VAR]: 'podkit-builder-remote' },
      })
    );
    expect(selection.buildHost.id).toBe('builderRemote');
  });

  it('refuses a name that is not a build host', () => {
    expect(() =>
      resolveBuildHostSelection(input({ env: { [BUILD_HOST_ENV_VAR]: 'deviceRemote' } }))
    ).toThrow(/does not name a build host/);
  });

  // The configured value is somebody's deliberate statement, and so is the
  // target architecture. Honouring it anyway would write x64 bytes under an
  // arm64 name — the exact silent-wrong-artifact failure this whole task exists
  // to remove.
  it('refuses a named build host that cannot produce the target', () => {
    expect(() =>
      resolveBuildHostSelection(
        input({ arch: 'arm64', env: { [BUILD_HOST_ENV_VAR]: 'builderRemote' } })
      )
    ).toThrow(/cannot produce linux-arm64 \(glibc\): it declares x64/);
  });

  it('refuses the glibc Lima builder for a musl target rather than guessing', () => {
    expect(() =>
      resolveBuildHostSelection(
        input({ libc: 'musl', env: { [BUILD_HOST_ENV_VAR]: 'builderGlibc' } })
      )
    ).toThrow(/it is the glibc builder/);
  });
});

describe('resolveBuildHostSelection — registry hygiene', () => {
  it('never considers a substrate that is not a builder', () => {
    const nonBuilders = REAL.filter((vm: VmDefinition) => vm.category !== 'builder');
    for (const vm of nonBuilders) {
      expect(() =>
        resolveBuildHostSelection(input({ env: { [BUILD_HOST_ENV_VAR]: vm.id } }))
      ).toThrow(/does not name a build host/);
    }
  });
});
