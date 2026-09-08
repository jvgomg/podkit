/**
 * Pins the capability report's contract.
 *
 * The report is the only place a partial quality run explains itself, so the
 * property that matters is that an unavailable capability *names the surfaces
 * it cost* — a report that said "docker missing" without saying what went
 * untested would leave the reader no better off than a bare exit code.
 */

import { describe, it, expect } from 'bun:test';
import {
  formatCapabilityReport,
  probeCapabilities,
  type SurfaceCapability,
} from './capabilities.js';

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

describe('probeCapabilities', () => {
  it('probes both gate capabilities', () => {
    const ids = probeCapabilities().map((capability) => capability.id);
    expect(ids).toEqual(['container-runtime', 'device-substrate']);
  });

  it('always explains an unavailable capability', () => {
    // Whichever way this machine is configured, "unavailable with no reason"
    // is never an acceptable state — that is the report's whole job.
    for (const capability of probeCapabilities()) {
      if (!capability.available) {
        expect(capability.reason).toBeTruthy();
        expect(capability.surfaces.length).toBeGreaterThan(0);
      }
    }
  });
});
