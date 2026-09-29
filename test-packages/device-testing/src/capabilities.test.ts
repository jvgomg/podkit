/**
 * Pins the capability report's contract.
 *
 * The report is the only place a partial quality run explains itself, so the
 * property that matters is that an unavailable capability *names the surfaces
 * it cost* — a report that said "docker missing" without saying what went
 * untested would leave the reader no better off than a bare exit code.
 */

import { describe, it, expect } from 'bun:test';
import { getVm, SubstrateSelectionError, type VmDefinition } from '@podkit/substrate';

import {
  formatCapabilityReport,
  probeCapabilities,
  probeDeviceSubstrate,
  type DeviceSubstrateProbeDeps,
  type SurfaceCapability,
} from './capabilities.js';
import { createSubstrateLink, type SubstrateReadiness } from './runners/substrate.js';

const available: SurfaceCapability = {
  id: 'container-runtime',
  label: 'container runtime (podman)',
  surfaces: ['host-binary · docker-sidecar · dir'],
  available: true,
};

const missing: SurfaceCapability = {
  id: 'device-substrate',
  label: 'device substrate (podkit-device)',
  surfaces: ['vm-binary · local-dir · usb-synth', 'vm-docker-image · local-dir · usb-synth'],
  available: false,
  reason: 'instance does not exist',
};

describe('formatCapabilityReport', () => {
  it('marks an available capability without listing surfaces', () => {
    const report = formatCapabilityReport([available]);
    expect(report).toContain('✓ container runtime (podman)');
    expect(report).not.toContain('not covered');
  });

  it('names every surface an unavailable capability costs, with the reason', () => {
    const report = formatCapabilityReport([missing]);
    expect(report).toContain('✗ device substrate (podkit-device) — instance does not exist');
    expect(report).toContain('not covered: vm-binary · local-dir · usb-synth');
    expect(report).toContain('not covered: vm-docker-image · local-dir · usb-synth');
  });

  it('reports mixed availability in one pass', () => {
    const report = formatCapabilityReport([available, missing]);
    expect(report).toContain('✓ container runtime');
    expect(report).toContain('✗ device substrate');
  });
});

// ---------------------------------------------------------------------------
// The device-substrate probe
//
// Injected rather than live: the real probe opens an SSH session, and a unit
// test that depends on a box being up is a test of the box.
// ---------------------------------------------------------------------------

/** Deps that select `id` and report it as `readiness`, recording any notice. */
function selecting(
  id: string,
  readiness: SubstrateReadiness
): DeviceSubstrateProbeDeps & { notices: string[] } {
  const definition: VmDefinition = getVm(id);
  const notices: string[] = [];
  return {
    notices,
    notice: (line) => notices.push(line),
    resolve: (notice) => {
      notice(`selected ${id}`);
      return { definition, link: createSubstrateLink(definition) };
    },
    probe: async (def) => {
      expect(def).toBe(definition);
      return readiness;
    },
  };
}

const VM_SURFACES = [
  'vm-binary · local-dir · usb-synth',
  'vm-docker-image · local-dir · usb-synth',
  'vm-docker-image · local-dir · loopback-fat',
];

describe('probeDeviceSubstrate', () => {
  it('reports the selected remote substrate available when it answers', async () => {
    const capability = await probeDeviceSubstrate(selecting('deviceRemote', 'ready'));

    expect(capability.available).toBe(true);
    expect(capability.label).toContain('deviceRemote');
    expect(capability.surfaces).toEqual(VM_SURFACES);
  });

  it('reports a selected Lima substrate available when it answers', async () => {
    const capability = await probeDeviceSubstrate(selecting('device', 'ready'));
    expect(capability.available).toBe(true);
    expect(capability.label).toContain('device');
  });

  it('names the link and the way up when the substrate does not answer', async () => {
    const capability = await probeDeviceSubstrate(selecting('deviceRemote', 'unreachable'));

    expect(capability.available).toBe(false);
    expect(capability.reason).toContain('podkit-substrate');
    expect(capability.reason).toContain('bun run vm:up deviceRemote');
    expect(capability.surfaces).toEqual(VM_SURFACES);
  });

  it('points an uncreated Lima substrate at first-time setup, not vm:up', async () => {
    const capability = await probeDeviceSubstrate(selecting('device', 'unreachable'));

    expect(capability.available).toBe(false);
    expect(capability.reason).toContain('bun run harness:setup');
    expect(capability.reason).not.toContain('vm:up');
  });

  it('says a stopped substrate exists but is not running', async () => {
    const capability = await probeDeviceSubstrate(selecting('device', 'startable'));

    expect(capability.available).toBe(false);
    expect(capability.reason).toMatch(/not running.*bun run vm:up device/);
  });

  it('carries the selection error through as the reason rather than throwing', async () => {
    const capability = await probeDeviceSubstrate({
      resolve: () => {
        throw new SubstrateSelectionError('No substrate selected and `limactl` is not on PATH');
      },
    });

    expect(capability.available).toBe(false);
    expect(capability.reason).toContain('No substrate selected');
    expect(capability.surfaces).toEqual(VM_SURFACES);
  });

  it("renders the resolver's announcement through the supplied sink", async () => {
    const deps = selecting('device', 'ready');
    await probeDeviceSubstrate(deps);
    expect(deps.notices).toEqual(['selected device']);
  });
});

describe('probeCapabilities', () => {
  it('probes both gate capabilities', async () => {
    const ids = (await probeCapabilities(selecting('deviceRemote', 'ready'))).map(
      (capability) => capability.id
    );
    expect(ids).toEqual(['container-runtime', 'device-substrate']);
  });

  it('always explains an unavailable capability', async () => {
    // "Unavailable with no reason" is never an acceptable state — that is the
    // report's whole job.
    for (const capability of await probeCapabilities(selecting('deviceRemote', 'unreachable'))) {
      if (!capability.available) {
        expect(capability.reason).toBeTruthy();
        expect(capability.surfaces.length).toBeGreaterThan(0);
      }
    }
  });
});
