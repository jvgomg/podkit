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
 * Probes are cheap — they answer "could this run?", never "did it pass?".
 *
 * @module
 */

import { spawnSync } from 'node:child_process';

import { isLimaVm, type SubstrateLink, type VmDefinition } from '@podkit/substrate';

import {
  probeSubstrate,
  resolveDeviceSubstrate,
  type SubstrateNotice,
  type SubstrateReadiness,
} from './runners/substrate.js';

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

function probeContainerRuntime(): SurfaceCapability {
  const runtime = process.env[CONTAINER_RUNTIME_ENV]?.trim() || 'docker';
  const base: Omit<SurfaceCapability, 'available' | 'reason'> = {
    id: 'container-runtime',
    label: `container runtime (${runtime})`,
    surfaces: ['host-binary · docker-sidecar · dir'],
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

/** The taxonomy cells that run inside the device substrate. */
const DEVICE_SUBSTRATE_SURFACES = [
  'vm-binary · local-dir · usb-synth',
  'vm-docker-image · local-dir · usb-synth',
  'vm-docker-image · local-dir · loopback-fat',
];

/** Seams for {@link probeDeviceSubstrate}; production leaves every one unset. */
export interface DeviceSubstrateProbeDeps {
  /** Where the selection resolver's announcement goes. */
  notice?: SubstrateNotice;
  /** Which substrate this machine drives, and a link to it. */
  resolve?: (notice: SubstrateNotice) => { definition: VmDefinition; link: SubstrateLink };
  /** Whether that substrate answers. */
  probe?: (definition: VmDefinition) => Promise<SubstrateReadiness>;
}

const gateNotice: SubstrateNotice = (line) => {
  process.stderr.write(`[quality] ${line}\n`);
};

/**
 * Probe the substrate the selection resolver picks — the same one the suites
 * will drive — rather than assuming a Lima VM. Never throws: an unconfigured
 * machine is a capability it lacks, and the resolver's error says how to add it.
 */
export async function probeDeviceSubstrate(
  deps: DeviceSubstrateProbeDeps = {}
): Promise<SurfaceCapability> {
  const notice = deps.notice ?? gateNotice;
  const resolve = deps.resolve ?? ((sink) => resolveDeviceSubstrate({ notice: sink }));
  const probe = deps.probe ?? ((definition) => probeSubstrate(definition));

  let resolved: { definition: VmDefinition; link: SubstrateLink };
  try {
    resolved = resolve(notice);
  } catch (err) {
    return {
      id: 'device-substrate',
      label: 'device substrate',
      surfaces: DEVICE_SUBSTRATE_SURFACES,
      available: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  const { definition, link } = resolved;
  const base: Omit<SurfaceCapability, 'available' | 'reason'> = {
    id: 'device-substrate',
    label: `device substrate (${definition.id})`,
    surfaces: DEVICE_SUBSTRATE_SURFACES,
  };
  const readiness = await probe(definition);
  if (readiness === 'ready') return { ...base, available: true };
  let reason: string;
  if (readiness === 'startable') {
    reason = `exists but is not running — bun run vm:up ${definition.id}`;
  } else if (isLimaVm(definition)) {
    // An unreachable Lima substrate is one that was never created, and a bare
    // instance has no contract, binaries or seal.
    reason = `${link.description} does not exist — bun run harness:setup`;
  } else {
    reason = `not answering over ${link.description} — bun run vm:up ${definition.id}`;
  }
  return { ...base, available: false, reason };
}

/** Probe every capability the quality gate depends on. */
export async function probeCapabilities(
  deps: DeviceSubstrateProbeDeps = {}
): Promise<SurfaceCapability[]> {
  return [probeContainerRuntime(), await probeDeviceSubstrate(deps)];
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
