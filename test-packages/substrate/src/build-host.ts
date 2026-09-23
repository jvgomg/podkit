/**
 * Build-host selection — which box compiles this run's Linux artifacts.
 *
 * The mirror of `./selection.ts`, and deliberately a separate resolver rather
 * than a second mode of it. They answer different questions about different
 * boxes whose contracts *contradict* each other: a substrate must carry no
 * toolchain, a builder must carry one, and the day those two selections share
 * a definition is the day the wrong box can satisfy either (ADR-029 §4).
 *
 * ## What this replaces
 *
 * Half of ADR-029 §4 landed first: `targetArch()` stopped being `process.arch`
 * and became a property of the substrate the binary has to start on. That left
 * the builders behind — each one a Lima instance on the developer's own
 * machine, producing its own architecture and nothing else — so a run that
 * targeted the other architecture hit a bash guard that refused with
 * *"run the build on a `<arch>` build host"*. True, and a dead end: the repo
 * knew of no such host and had no way to reach one.
 *
 * This is that sentence made actionable. A build host is a ROLE, filled by any
 * box that passes `builder-doctor.sh` and is reachable over the same
 * {@link SubstrateLink} as a substrate. Selection asks one question — *can this
 * box produce `(targetArch, libc)`?* — and the answer no longer depends on what
 * the developer's laptop is.
 *
 * ## Why the substrate's provisioner is an input
 *
 * Capability alone decides the headline case: an arm64 Mac driving an amd64
 * substrate has no local builder that can produce amd64, so the remote one is
 * the only candidate. It does NOT decide the case where host and substrate
 * happen to share an architecture — an amd64 Linux box driving an amd64 remote
 * substrate has two capable builders, and picking the local one would build
 * artifacts on a machine whose libc and toolchain nobody asserted anything
 * about.
 *
 * So a capable builder provisioned the same way as the selected substrate wins.
 * "Where the tests run is where the artifacts are built" is the rule, and it
 * needs no configuration in either of the two setups that exist.
 *
 * ## musl
 *
 * The build-host role carries `(arch, libc)`, and the two provisioners reach
 * musl differently by design. macOS has a second Lima VM to spare and uses it.
 * A hypervisor that cannot comfortably hold a 2 GiB substrate and a 4 GiB
 * builder at once certainly cannot hold a third guest, and the Alpine userland
 * is the *entire* difference between the two builds — which is what a container
 * is for (doc-060). So a remote glibc builder serves musl through the Alpine
 * image its own contract builds, and {@link BuildHostSelection.containerised}
 * is how the driver learns which it got.
 *
 * @module
 */

import { commandOnPath } from './selection.js';
import { isLimaVm, isSshVm, listVms, type VmDefinition, type VmProvisioner } from './registry.js';
import { hostTargetArch, targetArch, type TargetArch } from './target-arch.js';

/**
 * Environment variable naming the build host, by registry id.
 *
 * Normally unset: the rules below pick correctly for both setups that exist.
 * Set it to build on a specific box — a second amd64 machine, a builder that
 * is not the substrate's sibling — in the same gitignored env file that names
 * the substrate (`.env.local`; see the committed `.env.example`).
 */
export const BUILD_HOST_ENV_VAR = 'PODKIT_BUILD_HOST';

/** The C library an artifact links against. */
export type BuildLibc = 'glibc' | 'musl';

/** Where the selection came from. */
export type BuildHostSelectionSource =
  /** {@link BUILD_HOST_ENV_VAR} named it explicitly. */
  | 'configured'
  /** It is the builder provisioned the same way as the selected substrate. */
  | 'substrate-provisioner'
  /** Nothing else applied; it is the one that can produce what this run needs. */
  | 'capability';

/** The outcome of resolving a build host. */
export interface BuildHostSelection {
  /** The selected build host's registry entry. */
  readonly buildHost: VmDefinition;
  /** The libc the run asked for. */
  readonly libc: BuildLibc;
  /** The architecture the run asked for. */
  readonly arch: TargetArch;
  /**
   * Whether the build must run inside the build host's Alpine container rather
   * than in its own userland. True exactly when a musl artifact is wanted from
   * a glibc box — see the note on musl above.
   */
  readonly containerised: boolean;
  /** How it came to be selected. */
  readonly source: BuildHostSelectionSource;
  /**
   * Human-readable notice the caller MUST surface, or `null` when there is
   * nothing to say. Returned rather than printed, per the warning-channel
   * convention (`docs/architecture/conventions.md` §1–2): this is library code
   * and does not own a TTY.
   *
   * Non-null when the build host is not the obvious partner of the selected
   * substrate. A build that silently went to a different machine than the one
   * the developer has in mind is the confusion this field exists to prevent.
   */
  readonly announcement: string | null;
}

/**
 * No build host could be selected. Carries what was wanted, what was
 * considered, and why each candidate was rejected — an unbuildable target is
 * an onboarding or configuration state, and this error is the only
 * documentation the operator is guaranteed to read.
 */
export class BuildHostSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuildHostSelectionError';
  }
}

/** Inputs to {@link resolveBuildHostSelection}. Everything is explicit; nothing is probed. */
export interface ResolveBuildHostInput {
  /** The process environment, or any stand-in with the same shape. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The substrate registry to select from. */
  readonly substrates: readonly VmDefinition[];
  /** The libc this run needs artifacts for. */
  readonly libc: BuildLibc;
  /** The architecture this run needs artifacts for. */
  readonly arch: TargetArch;
  /**
   * The host's own architecture. A Lima builder is created on this machine
   * from this machine's image, so this is what one can produce — the asymmetry
   * `SshVmDefinition.targetArch` documents, seen from the other side.
   */
  readonly hostArch: TargetArch;
  /**
   * Whether `limactl` can be invoked here. A Lima builder that cannot be
   * reached is not a candidate, however well its architecture matches.
   */
  readonly limactlAvailable: boolean;
  /**
   * How the selected device substrate is provisioned, when one has been
   * selected. Absent for a build with no substrate in play — a release
   * artifact, say — in which case capability alone decides.
   */
  readonly substrateProvisioner?: VmProvisioner | undefined;
}

/** Why a candidate build host cannot serve this run. `null` when it can. */
function rejectionReason(candidate: VmDefinition, input: ResolveBuildHostInput): string | null {
  if (isLimaVm(candidate)) {
    if (!input.limactlAvailable) return '`limactl` is not on PATH';
    if (input.hostArch !== input.arch) {
      return `it is a Lima instance on this ${input.hostArch} host, so it produces ${input.hostArch}`;
    }
    // A Lima builder is libc-specific by construction: macOS has a second VM
    // for musl and uses it, so there is no container path to fall back on here.
    if (candidate.archRelevance !== input.libc) {
      return `it is the ${candidate.archRelevance} builder`;
    }
    return null;
  }
  if (isSshVm(candidate)) {
    if (candidate.targetArch !== input.arch) {
      return `it declares ${candidate.targetArch}`;
    }
    // A glibc box reaches musl through its Alpine container; a musl box cannot
    // reach glibc the same way, because the container is the *narrower*
    // userland and nothing in the contract builds a glibc image on a musl host.
    if (candidate.archRelevance !== input.libc && candidate.archRelevance !== 'glibc') {
      return `it is a ${candidate.archRelevance} box and cannot produce ${input.libc}`;
    }
    return null;
  }
  return 'it is provisioned by something this repo does not know how to reach';
}

/** Whether a musl build on this host has to go through the Alpine container. */
function needsContainer(candidate: VmDefinition, libc: BuildLibc): boolean {
  return libc === 'musl' && candidate.archRelevance !== 'musl';
}

function describeCandidates(
  candidates: readonly VmDefinition[],
  input: ResolveBuildHostInput
): string {
  return candidates
    .map((vm) => {
      const reason = rejectionReason(vm, input);
      return reason ? `${vm.id} (rejected: ${reason})` : `${vm.id} (eligible)`;
    })
    .join(', ');
}

/**
 * Resolve which box builds this run's artifacts. Pure: same inputs, same
 * answer, no I/O, no environment reads beyond the `env` handed in, and no
 * platform check.
 *
 * @throws {BuildHostSelectionError} when the configured id names nothing, when
 * it names a box that cannot produce what the run needs, or when no registered
 * builder can.
 */
export function resolveBuildHostSelection(input: ResolveBuildHostInput): BuildHostSelection {
  const candidates = input.substrates.filter((vm) => vm.category === 'builder');
  const wanted = `linux-${input.arch} (${input.libc})`;

  const configured = input.env[BUILD_HOST_ENV_VAR]?.trim();
  if (configured) {
    const chosen = candidates.find((vm) => vm.id === configured || vm.instanceName === configured);
    if (!chosen) {
      throw new BuildHostSelectionError(
        `${BUILD_HOST_ENV_VAR}='${configured}' does not name a build host. ` +
          `Known build hosts: ${describeCandidates(candidates, input)}.`
      );
    }
    const reason = rejectionReason(chosen, input);
    if (reason) {
      throw new BuildHostSelectionError(
        `${BUILD_HOST_ENV_VAR}='${configured}' names a build host that cannot produce ` +
          `${wanted}: ${reason}. Building anyway would write the wrong bytes under the ` +
          `right filename, which nothing downstream would notice. ` +
          `Known build hosts: ${describeCandidates(candidates, input)}.`
      );
    }
    return {
      buildHost: chosen,
      libc: input.libc,
      arch: input.arch,
      containerised: needsContainer(chosen, input.libc),
      source: 'configured',
      announcement: null,
    };
  }

  const eligible = candidates.filter((vm) => rejectionReason(vm, input) === null);
  if (eligible.length === 0) {
    throw new BuildHostSelectionError(
      `No registered build host can produce ${wanted}. ` +
        `Candidates: ${describeCandidates(candidates, input)}. ` +
        `Provision one (docs/environments/builder-proxmox.md) and point ` +
        `${BUILD_HOST_ENV_VAR} at it, or target a substrate this machine can build for.`
    );
  }

  // Where the tests run is where the artifacts are built. Only decides
  // anything when two builders are capable, which is precisely the case
  // capability cannot separate.
  if (input.substrateProvisioner) {
    const partner = eligible.find((vm) => vm.provisioner === input.substrateProvisioner);
    if (partner) {
      return {
        buildHost: partner,
        libc: input.libc,
        arch: input.arch,
        containerised: needsContainer(partner, input.libc),
        source: 'substrate-provisioner',
        announcement: null,
      };
    }
  }

  const chosen = eligible[0]!;
  return {
    buildHost: chosen,
    libc: input.libc,
    arch: input.arch,
    containerised: needsContainer(chosen, input.libc),
    source: 'capability',
    announcement:
      `Building ${wanted} on '${chosen.id}' (${chosen.instanceName}) — it is the only ` +
      `registered build host that can produce it` +
      (input.substrateProvisioner
        ? `, and it is not provisioned the same way as the selected substrate`
        : '') +
      `. Set ${BUILD_HOST_ENV_VAR} in .env.local to choose explicitly; see .env.example.`,
  };
}

/** Options for {@link selectBuildHost}. */
export interface SelectBuildHostOpts {
  /** The libc this run needs artifacts for. */
  readonly libc: BuildLibc;
  /**
   * The architecture this pass needs artifacts for. Defaults to the run's
   * target architecture.
   *
   * Passed explicitly by the build driver, which produces every architecture a
   * run needs rather than the single one it targets — and each of those
   * architectures selects its own build host (`./required-arches.ts`).
   */
  readonly arch?: TargetArch;
  /** How the selected device substrate is provisioned, when one is in play. */
  readonly substrateProvisioner?: VmProvisioner | undefined;
  /** The process environment. Defaults to the real one. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The substrate registry. Defaults to the real one. */
  readonly substrates?: readonly VmDefinition[];
}

/**
 * The impure convenience wrapper: reads the real environment, the real
 * registry, the already-resolved target architecture and probes for `limactl`.
 * Everything interesting happens in {@link resolveBuildHostSelection}; this
 * only supplies the facts.
 *
 * The target architecture comes from {@link targetArch}, which is synchronous
 * and never probes — so this is safe to call inside a turbo task, where no
 * link exists. Whoever holds a link primes the value first; see
 * `./target-arch.ts`.
 */
export function selectBuildHost(opts: SelectBuildHostOpts): BuildHostSelection {
  const env = opts.env ?? process.env;
  return resolveBuildHostSelection({
    env,
    substrates: opts.substrates ?? listVms(),
    libc: opts.libc,
    arch: opts.arch ?? targetArch(env),
    hostArch: hostTargetArch(),
    limactlAvailable: commandOnPath('limactl', env),
    substrateProvisioner: opts.substrateProvisioner,
  });
}
