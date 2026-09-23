/**
 * Typed VM registry — the single source of truth for every substrate the repo
 * manages: the device-synthesis harness, the two per-libc builder VMs, the two
 * per-libc Linux test runners, the virtual-iPod demo, the manual ABI-check VM,
 * and the remote device substrate reached over SSH.
 *
 * Each entry pairs a clean TypeScript `id` with the concrete name its
 * provisioner knows the box by, plus whatever that provisioner needs to reach
 * it. Callers look substrates up by `id` rather than spelling instance names,
 * YAML paths or ssh aliases by hand.
 *
 * ## Why the registry lives here and not in `@podkit/lima`
 *
 * Lima is *a* provisioner, not the substrate. A registry that can describe an
 * SSH-reachable Debian box has no business living in a package named after one
 * hypervisor driver — see ADR-029 §1, which defines a substrate by an executable
 * contract rather than by whatever created it. `@podkit/lima` depends on this
 * package and re-exports what it used to own, so existing import sites resolve
 * unchanged.
 *
 * ## The provisioner discriminator
 *
 * `provisioner` splits the registry into two shapes that carry genuinely
 * different data:
 *
 * - `lima` entries carry the path to a declarative Lima YAML under
 *   `test-packages/lima/vms/`.
 * - `ssh` entries carry the NAME of an ssh_config `Host` alias and nothing
 *   else. Never a hostname, never a user, never a key path, never a jump host.
 *   Those live in the developer's own `~/.ssh/config`, which is how this public
 *   repository contains no infrastructure detail by construction rather than by
 *   vigilance (ADR-029 §2).
 *
 * An `ssh` entry has no Lima YAML *at all*, which is why `yamlPath` is a
 * property of the `lima` variant rather than an optional field on both: there
 * is no path to resolve, no path to fake, and nothing that should throw when
 * something reads it.
 *
 * @module
 */

import * as path from 'node:path';
import { repoRoot } from './paths.js';
import type { TargetArch } from './target-arch.js';

/**
 * Role a substrate plays. Drives nothing mechanical here — it is metadata that
 * lets callers filter the registry (e.g. "all builders", "every device
 * substrate") without string-matching instance names.
 */
export type VmCategory = 'device' | 'builder' | 'test-runner' | 'demo' | 'abi';

/**
 * Which libc a build/test VM targets, or `agnostic` for VMs whose purpose is
 * not libc-specific.
 *
 * Architecture is deliberately NOT folded in here, and the reason changed once
 * a remote builder existed. For a Lima entry it remains a runtime in-VM concern
 * (`uname -m`) and is never a config axis — the VM is created on this host and
 * is this host's architecture. For an `ssh` entry it is declared, because the
 * machine is somewhere else and nothing local can infer it; see
 * {@link SshVmDefinition.targetArch}. Keeping the two on separate fields is
 * what lets that asymmetry be stated rather than averaged away.
 */
export type VmArchRelevance = 'agnostic' | 'glibc' | 'musl';

/**
 * Whatever creates and lifecycles a substrate. A provisioner's entire output is
 * an SSH-reachable Debian box; it has no role once the substrate exists.
 *
 * `ssh` is deliberately named for how the substrate is *reached* rather than
 * for Proxmox, libvirt or any other thing that might have produced it — a
 * hand-built spare box that a human installed Debian on is the same kind of
 * entry as one a hypervisor API created.
 */
export type VmProvisioner = 'lima' | 'ssh';

/** Fields every substrate carries regardless of who provisioned it. */
interface VmDefinitionBase {
  /** Clean TS identifier used to look the substrate up (`getVm('device')`). */
  id: string;
  /**
   * The concrete name this substrate's provisioner knows it by — the
   * `podkit-…` Lima instance name, or the guest name on a remote hypervisor.
   * Distinct from an `ssh` entry's {@link SshVmDefinition.sshAlias}, which
   * names an ssh_config stanza rather than a machine.
   */
  instanceName: string;
  /** Role the substrate plays. */
  category: VmCategory;
  /** libc relevance (or `agnostic`). */
  archRelevance: VmArchRelevance;
  /**
   * Whether this substrate participates in baseline-drift tracking. Only the
   * Lima device-synthesis harness seals a baseline hash today.
   */
  trackedForBaseline: boolean;
}

/** A substrate provisioned by Lima from a declarative YAML in this repo. */
export interface LimaVmDefinition extends VmDefinitionBase {
  provisioner: 'lima';
  /**
   * Absolute host path to the declarative Lima YAML for this instance.
   * Resolved lazily — see {@link defineLimaVm}.
   */
  readonly yamlPath: string;
}

/**
 * A substrate reached over SSH, whatever produced it — a Proxmox guest, a
 * libvirt VM, a cloud instance, a spare box under a desk.
 */
export interface SshVmDefinition extends VmDefinitionBase {
  provisioner: 'ssh';
  /**
   * Name of the `Host` stanza in the developer's `~/.ssh/config` that resolves
   * this substrate. A NAME, never a hostname: everything that identifies the
   * machine — address, user, key, jump host — stays on the machine that has to
   * reach it, so a Tailscale or bastion route works without this repo modelling
   * it and no infrastructure detail can reach a public repository by accident.
   */
  sshAlias: string;
  /**
   * The architecture this machine is, and therefore the one it runs or
   * produces artifacts for.
   *
   * Declared on the `ssh` variant only, and that asymmetry is the point. A Lima
   * entry is created on this host from this host's image, so its architecture
   * is the host's by construction and naming it would be a value that can only
   * ever be redundant or wrong. An `ssh` entry names a machine somewhere else,
   * and nothing local can infer its CPU — which matters because "can this
   * builder produce the artifact I want?" is asked *before* there is a
   * connection to probe `uname -m` over.
   *
   * Declared, not authoritative: what the box actually reports still wins at
   * the point it costs something. `probeSubstrateMachine` reads the live value
   * and `assertArtifactArch` refuses a mismatched ELF at transfer time, so a
   * stale declaration here is caught rather than shipped.
   */
  targetArch: TargetArch;
}

/** One substrate definition, discriminated by {@link VmProvisioner}. */
export type VmDefinition = LimaVmDefinition | SshVmDefinition;

/**
 * Build a Lima registry entry from its repo-RELATIVE YAML location. The
 * absolute `yamlPath` is resolved lazily on access (via `repoRoot()`), so
 * merely importing this module never anchors on the package's on-disk location.
 *
 * This matters because the device-testing shim re-exports this registry, and
 * the FunctionFS daemon bundles that shim into a single-file binary whose
 * `import.meta.url` (`/$bunfs/root/…`) has no `test-packages/substrate/` marker
 * for `repoRoot()` to anchor on. Resolving `yamlPath` eagerly at module load
 * would throw on daemon startup; deferring it to access keeps import
 * side-effect-free (only host-side callers that actually need a YAML path ever
 * resolve one).
 *
 * Nothing cheap catches a regression here: unit tests, `typecheck` and `lint`
 * all pass when it is broken, and only a real VM run fails. `registry.test.ts`
 * asserts the property descriptor for that reason.
 */
function defineLimaVm(
  entry: Omit<LimaVmDefinition, 'yamlPath' | 'provisioner'> & { yamlRelPath: string }
): LimaVmDefinition {
  const { yamlRelPath, ...rest } = entry;
  return {
    ...rest,
    provisioner: 'lima',
    get yamlPath(): string {
      return path.resolve(repoRoot(), yamlRelPath);
    },
  };
}

/**
 * Build an SSH registry entry. No lazy anything: an `ssh` substrate has no
 * repo-relative file to resolve, so this is a plain object literal by nature
 * rather than by restraint.
 */
function defineSshVm(entry: Omit<SshVmDefinition, 'provisioner'>): SshVmDefinition {
  return { ...entry, provisioner: 'ssh' };
}

/**
 * The registry. Instance names follow a single scheme — `podkit-<role>`, with
 * the libc suffix where a VM is libc-specific — and every Lima YAML lives in
 * `test-packages/lima/vms/`.
 */
const REGISTRY: readonly VmDefinition[] = [
  defineLimaVm({
    id: 'device',
    instanceName: 'podkit-device',
    yamlRelPath: 'test-packages/lima/vms/podkit-device.yaml',
    category: 'device',
    archRelevance: 'agnostic',
    trackedForBaseline: true,
  }),
  defineLimaVm({
    id: 'builderGlibc',
    instanceName: 'podkit-builder-glibc',
    yamlRelPath: 'test-packages/lima/vms/podkit-builder-glibc.yaml',
    category: 'builder',
    archRelevance: 'glibc',
    trackedForBaseline: false,
  }),
  defineLimaVm({
    id: 'builderMusl',
    instanceName: 'podkit-builder-musl',
    yamlRelPath: 'test-packages/lima/vms/podkit-builder-musl.yaml',
    category: 'builder',
    archRelevance: 'musl',
    trackedForBaseline: false,
  }),
  defineLimaVm({
    id: 'testGlibc',
    instanceName: 'podkit-test-glibc',
    yamlRelPath: 'test-packages/lima/vms/podkit-test-glibc.yaml',
    category: 'test-runner',
    archRelevance: 'glibc',
    trackedForBaseline: false,
  }),
  defineLimaVm({
    id: 'testMusl',
    instanceName: 'podkit-test-musl',
    yamlRelPath: 'test-packages/lima/vms/podkit-test-musl.yaml',
    category: 'test-runner',
    archRelevance: 'musl',
    trackedForBaseline: false,
  }),
  defineLimaVm({
    id: 'virtualIpod',
    instanceName: 'podkit-virtual-ipod',
    yamlRelPath: 'test-packages/lima/vms/podkit-virtual-ipod.yaml',
    category: 'demo',
    archRelevance: 'agnostic',
    trackedForBaseline: false,
  }),
  defineLimaVm({
    id: 'abiVerify',
    instanceName: 'podkit-abi-verify',
    yamlRelPath: 'test-packages/lima/vms/podkit-abi-verify.yaml',
    category: 'abi',
    archRelevance: 'agnostic',
    trackedForBaseline: false,
  }),
  // The remote device substrate. Reached through an ssh_config alias the
  // developer owns; the repo knows the alias NAME and nothing else. Whether
  // this entry currently resolves to a machine is a property of the reader's
  // `~/.ssh/config`, not of this file — an unreachable substrate is a skip
  // with a reason, never a silent pass (ADR-028 §5).
  //
  // It is registered even on machines that have no such box because the shape
  // has to be exercised rather than hypothetical: a discriminator with one
  // inhabitant is a discriminator nobody has type-checked the other branch of.
  defineSshVm({
    id: 'deviceRemote',
    instanceName: 'podkit-device-remote',
    sshAlias: 'podkit-substrate',
    // The reference recipe boots the amd64 Debian cloud image, and the whole
    // reason the remote substrate is interesting is that it is a different
    // architecture from the arm64 Mac driving it.
    targetArch: 'x64',
    category: 'device',
    archRelevance: 'agnostic',
    // Sealed over its cloud-init template, the three contract scripts,
    // `apply-state.sh` and the image pin. `bun run harness:seal` writes the
    // hash; `vm:doctor` reads it.
    trackedForBaseline: true,
  }),
  // The remote builder — where artifacts get built, as the remote substrate is
  // where they get run. A sibling Proxmox VM of that substrate by default, but
  // the role is what is registered: any amd64 machine that passes
  // `builder-doctor.sh` fills it, and the repo never learns which one did.
  //
  // It carries the INVERSE of the substrate's contract — the toolchain and the
  // `-dev` packages `substrate-contract.sh` forbids — so that the substrate's
  // verdict on a statically-linked binary keeps meaning something (ADR-029 §4).
  // Its musl artifacts come from an Alpine container on this same box rather
  // than from a second guest (doc-060), which is why there is one builder entry
  // here and two Lima builder VMs above.
  defineSshVm({
    id: 'builderRemote',
    instanceName: 'podkit-builder-remote',
    sshAlias: 'podkit-builder',
    targetArch: 'x64',
    category: 'builder',
    // The libc of the BOX, not of everything it can produce. The Alpine
    // container makes musl artifacts reachable from a glibc builder, and
    // recording `musl` here would misdescribe the machine that hosts it.
    archRelevance: 'glibc',
    trackedForBaseline: false,
  }),
];

/**
 * Registry ids that are statically known to be Lima-provisioned.
 *
 * This exists so `getVm('device')` — a literal, resolvable at compile time —
 * returns the narrowed {@link LimaVmDefinition} and `def.yamlPath` type-checks
 * without a runtime narrowing dance at every call site. `getVm(someString)`
 * still returns the union, because a runtime string genuinely could be either.
 *
 * `registry.test.ts` pins this list against the registry's actual `lima`
 * entries, so adding an `ssh` entry here (or forgetting a `lima` one) fails
 * loudly rather than quietly handing callers a lie about `yamlPath`.
 */
export const LIMA_VM_IDS = [
  'device',
  'builderGlibc',
  'builderMusl',
  'testGlibc',
  'testMusl',
  'virtualIpod',
  'abiVerify',
] as const;

/** Id of a statically-known Lima substrate. */
export type LimaVmId = (typeof LIMA_VM_IDS)[number];

/** Every registered substrate, in declaration order. */
export function listVms(): readonly VmDefinition[] {
  return REGISTRY;
}

/** Narrowing predicate for the Lima variant. */
export function isLimaVm(vm: VmDefinition): vm is LimaVmDefinition {
  return vm.provisioner === 'lima';
}

/** Narrowing predicate for the SSH variant. */
export function isSshVm(vm: VmDefinition): vm is SshVmDefinition {
  return vm.provisioner === 'ssh';
}

/**
 * Look a substrate up by `id` OR by concrete `instanceName`. Throws a
 * descriptive error listing the known ids when nothing matches — a mistyped id
 * should fail loudly rather than silently no-op.
 */
export function getVm(id: LimaVmId): LimaVmDefinition;
export function getVm(idOrInstance: string): VmDefinition;
export function getVm(idOrInstance: string): VmDefinition {
  const found = REGISTRY.find((vm) => vm.id === idOrInstance || vm.instanceName === idOrInstance);
  if (!found) {
    const known = REGISTRY.map((vm) => `${vm.id} (${vm.instanceName})`).join(', ');
    throw new Error(`getVm: no VM registered for '${idOrInstance}'. Known VMs: ${known}.`);
  }
  return found;
}

/** Convenience: the Lima device-synthesis harness definition. */
export function deviceVm(): LimaVmDefinition {
  return getVm('device');
}

/**
 * The Lima device-synthesis harness instance name. Kept as a named constant so
 * the many existing call sites that reference it by value continue to resolve
 * through the registry. Derived from the registry rather than restated, so a
 * future rename has exactly one edit site.
 *
 * Reading `instanceName` is a plain property read — it does NOT trip the lazy
 * `yamlPath` getter — so this module-scope initialisation stays free of any
 * on-disk path resolution.
 */
export const LIMA_DEVICE_HARNESS_VM_NAME = deviceVm().instanceName;
