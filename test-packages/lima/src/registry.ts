/**
 * Typed VM registry — the single source of truth for every Lima instance the
 * repo manages: the device-synthesis harness, the two per-libc builder VMs, the
 * two per-libc Linux test runners, the virtual-iPod demo, and the manual
 * ABI-check VM.
 *
 * Each entry pairs a clean TypeScript `id` with the concrete Lima `instanceName`
 * and a pointer to the declarative Lima YAML, all of which are consolidated
 * under this package's `vms/` directory. Callers look VMs up by `id` rather
 * than spelling instance names or YAML paths by hand.
 *
 * @module
 */

import * as path from 'node:path';
import { repoRoot } from './paths.js';

/**
 * Role a VM plays. Drives nothing mechanical here — it is metadata that lets
 * callers filter the registry (e.g. "all builders") without string-matching
 * instance names.
 */
export type VmCategory = 'device' | 'builder' | 'test-runner' | 'demo' | 'abi';

/**
 * Which libc a build/test VM targets, or `agnostic` for VMs whose purpose is
 * not libc-specific. Architecture itself stays a RUNTIME in-VM concern
 * (`uname -m`) — it is never a config axis — so it is deliberately absent here.
 */
export type VmArchRelevance = 'agnostic' | 'glibc' | 'musl';

/** One VM definition. */
export interface VmDefinition {
  /** Clean TS identifier used to look the VM up (`getVm('device')`). */
  id: string;
  /** The concrete `podkit-…` Lima instance name. */
  instanceName: string;
  /** Absolute host path to the declarative Lima YAML for this instance. */
  yamlPath: string;
  /** Role the VM plays. */
  category: VmCategory;
  /** libc relevance (or `agnostic`). */
  archRelevance: VmArchRelevance;
  /**
   * Whether this VM participates in baseline-drift tracking. Only the
   * device-synthesis harness seals a baseline hash today.
   */
  trackedForBaseline: boolean;
}

/**
 * Build a registry entry from its repo-RELATIVE YAML location. The absolute
 * `yamlPath` is resolved lazily on access (via `repoRoot()`), so merely
 * importing this module never anchors on the package's on-disk location.
 *
 * This matters because the device-testing shim re-exports this registry, and
 * the FunctionFS daemon bundles that shim into a single-file binary whose
 * `import.meta.url` (`/$bunfs/root/…`) has no `test-packages/lima/` marker for
 * `repoRoot()` to anchor on. Resolving `yamlPath` eagerly at module load would
 * throw on daemon startup; deferring it to access keeps import side-effect-free
 * (only host-side callers that actually need a YAML path ever resolve one).
 */
function defineVm(entry: Omit<VmDefinition, 'yamlPath'> & { yamlRelPath: string }): VmDefinition {
  const { yamlRelPath, ...rest } = entry;
  return {
    ...rest,
    get yamlPath(): string {
      return path.resolve(repoRoot(), yamlRelPath);
    },
  };
}

/**
 * The registry. Instance names follow a single scheme — `podkit-<role>`, with
 * the libc suffix where a VM is libc-specific — and every YAML lives in this
 * package's `vms/` directory.
 */
const REGISTRY: readonly VmDefinition[] = [
  defineVm({
    id: 'device',
    instanceName: 'podkit-device',
    yamlRelPath: 'test-packages/lima/vms/podkit-device.yaml',
    category: 'device',
    archRelevance: 'agnostic',
    trackedForBaseline: true,
  }),
  defineVm({
    id: 'builderGlibc',
    instanceName: 'podkit-builder-glibc',
    yamlRelPath: 'test-packages/lima/vms/podkit-builder-glibc.yaml',
    category: 'builder',
    archRelevance: 'glibc',
    trackedForBaseline: false,
  }),
  defineVm({
    id: 'builderMusl',
    instanceName: 'podkit-builder-musl',
    yamlRelPath: 'test-packages/lima/vms/podkit-builder-musl.yaml',
    category: 'builder',
    archRelevance: 'musl',
    trackedForBaseline: false,
  }),
  defineVm({
    id: 'testGlibc',
    instanceName: 'podkit-test-glibc',
    yamlRelPath: 'test-packages/lima/vms/podkit-test-glibc.yaml',
    category: 'test-runner',
    archRelevance: 'glibc',
    trackedForBaseline: false,
  }),
  defineVm({
    id: 'testMusl',
    instanceName: 'podkit-test-musl',
    yamlRelPath: 'test-packages/lima/vms/podkit-test-musl.yaml',
    category: 'test-runner',
    archRelevance: 'musl',
    trackedForBaseline: false,
  }),
  defineVm({
    id: 'virtualIpod',
    instanceName: 'podkit-virtual-ipod',
    yamlRelPath: 'test-packages/lima/vms/podkit-virtual-ipod.yaml',
    category: 'demo',
    archRelevance: 'agnostic',
    trackedForBaseline: false,
  }),
  defineVm({
    id: 'abiVerify',
    instanceName: 'podkit-abi-verify',
    yamlRelPath: 'test-packages/lima/vms/podkit-abi-verify.yaml',
    category: 'abi',
    archRelevance: 'agnostic',
    trackedForBaseline: false,
  }),
];

/** Every registered VM, in declaration order. */
export function listVms(): readonly VmDefinition[] {
  return REGISTRY;
}

/**
 * Look a VM up by `id` OR by concrete `instanceName`. Throws a descriptive
 * error listing the known ids when nothing matches — a mistyped id should fail
 * loudly rather than silently no-op.
 */
export function getVm(idOrInstance: string): VmDefinition {
  const found = REGISTRY.find((vm) => vm.id === idOrInstance || vm.instanceName === idOrInstance);
  if (!found) {
    const known = REGISTRY.map((vm) => `${vm.id} (${vm.instanceName})`).join(', ');
    throw new Error(`getVm: no VM registered for '${idOrInstance}'. Known VMs: ${known}.`);
  }
  return found;
}

/** Convenience: the device-synthesis harness definition. */
export function deviceVm(): VmDefinition {
  return getVm('device');
}

/**
 * The device-synthesis harness instance name. Kept as a named constant so the
 * many existing call sites that reference it by value continue to resolve
 * through the registry. Derived from the registry rather than restated, so a
 * future rename has exactly one edit site.
 *
 * Reading `instanceName` is a plain property read — it does NOT trip the lazy
 * `yamlPath` getter — so this module-scope initialisation stays free of any
 * on-disk path resolution.
 */
export const LIMA_DEVICE_HARNESS_VM_NAME = deviceVm().instanceName;
