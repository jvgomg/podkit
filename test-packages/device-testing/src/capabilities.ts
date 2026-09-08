/**
 * What can this machine actually test?
 *
 * The quality gate spans six E2E surface cells (see
 * docs/architecture/testing/taxonomy.md), and no single machine reaches all of
 * them: an unprivileged container cannot load `dummy_hcd`, a laptop away from
 * its substrate cannot drive `usb-synth`, a host without a container runtime
 * cannot start a Navidrome sidecar.
 *
 * Per ADR-028 §5 the response is to skip loudly and **still fail the gate**. A
 * green result that quietly covered four of six surfaces is worse than no gate
 * at all, because it is indistinguishable from a real pass. This module
 * supplies the report; `run-mirror-body.ts` supplies the non-zero exit.
 *
 * Probes are synchronous and cheap — they answer "could this run?", never "did
 * it pass?".
 *
 * @module
 */

import { spawnSync } from 'node:child_process';

/** A capability the gate depends on, and the surfaces it gates. */
export interface SurfaceCapability {
  /** Stable identifier. */
  id: 'container-runtime' | 'device-substrate';
  /** Human-readable name. */
  label: string;
  /** Taxonomy cells that cannot run without it. */
  surfaces: string[];
  /** Whether the capability is usable here. */
  available: boolean;
  /** Why not, when unavailable. */
  reason?: string;
}

/** Environment variable selecting the container runtime binary. */
const CONTAINER_RUNTIME_ENV = 'PODKIT_CONTAINER_RUNTIME';

/** Instance name of the device substrate. */
const DEVICE_SUBSTRATE_ENV = 'PODKIT_DEVICE_SUBSTRATE';
const DEFAULT_DEVICE_SUBSTRATE = 'podkit-device';

function probeContainerRuntime(): SurfaceCapability {
  const runtime = process.env[CONTAINER_RUNTIME_ENV]?.trim() || 'docker';
  const base: Omit<SurfaceCapability, 'available' | 'reason'> = {
    id: 'container-runtime',
    label: `container runtime (${runtime})`,
    surfaces: [
      'host-binary · docker-sidecar · dir',
      'host-docker-image · local-dir · loopback-fat',
    ],
  };

  const result = spawnSync(runtime, ['version'], { stdio: 'ignore', timeout: 30000 });

  if (result.error) {
    const missing = (result.error as NodeJS.ErrnoException).code === 'ENOENT';
    return {
      ...base,
      available: false,
      reason: missing
        ? `'${runtime}' is not on $PATH (set ${CONTAINER_RUNTIME_ENV} to choose another runtime)`
        : result.error.message,
    };
  }
  if (result.status !== 0) {
    return {
      ...base,
      available: false,
      reason: `'${runtime} version' exited ${result.status ?? 'null'} — installed but not responding`,
    };
  }
  return { ...base, available: true };
}

function probeDeviceSubstrate(): SurfaceCapability {
  const instance = process.env[DEVICE_SUBSTRATE_ENV]?.trim() || DEFAULT_DEVICE_SUBSTRATE;
  const base: Omit<SurfaceCapability, 'available' | 'reason'> = {
    id: 'device-substrate',
    label: `device substrate (${instance})`,
    surfaces: ['vm-binary · local-dir · usb-synth', 'vm-docker-image · local-dir · usb-synth'],
  };

  const result = spawnSync('limactl', ['list', '--format', '{{.Status}}', instance], {
    encoding: 'utf8',
    timeout: 30000,
  });

  if (result.error) {
    const missing = (result.error as NodeJS.ErrnoException).code === 'ENOENT';
    return {
      ...base,
      available: false,
      reason: missing
        ? "'limactl' is not on $PATH — no substrate provisioner available"
        : result.error.message,
    };
  }

  const status = (result.stdout ?? '').trim();
  if (status.toLowerCase() !== 'running') {
    return {
      ...base,
      available: false,
      reason:
        status.length > 0 ? `instance is '${status}', not running` : 'instance does not exist',
    };
  }
  return { ...base, available: true };
}

/** Probe every capability the quality gate depends on. */
export function probeCapabilities(): SurfaceCapability[] {
  return [probeContainerRuntime(), probeDeviceSubstrate()];
}

/**
 * Render the capability report shown before and after a gate run.
 *
 * Names every surface that will not be covered, so a partial run is legible
 * from the output alone rather than from a passing exit code.
 */
export function formatCapabilityReport(capabilities: SurfaceCapability[]): string {
  const lines: string[] = ['[quality] environment capability report:'];

  for (const capability of capabilities) {
    if (capability.available) {
      lines.push(`[quality]   ✓ ${capability.label}`);
      continue;
    }
    lines.push(`[quality]   ✗ ${capability.label} — ${capability.reason}`);
    for (const surface of capability.surfaces) {
      lines.push(`[quality]       not covered: ${surface}`);
    }
  }

  return lines.join('\n');
}
