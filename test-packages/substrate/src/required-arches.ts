/**
 * Which architectures one run has to produce — not just the one it targets.
 *
 * ## The cell this exists to close
 *
 * `./target-arch.ts` made the target architecture a property of the substrate,
 * which is right for almost every artifact: the box a binary has to start on
 * decides what the binary must be. But a quality run has **two** architecture
 * roles, not one, and only the musl artifacts feel it.
 *
 * `test:e2e:docker-dist` builds the shipped image inside the substrate, so it
 * wants the substrate's musl binaries. `test:e2e:docker-loopback` builds the
 * same image on **this machine's** Docker daemon, so it wants the host's — and
 * `nativeImageArch()` in `e2e-tests/src/docker/podkit-image.ts` is written that
 * way on purpose. The two are siblings inside one turbo invocation. While a
 * musl build produced one architecture per run, no value of
 * `PODKIT_TARGET_ARCH` satisfied both, and a cross-architecture run was
 * internally unsatisfiable: whichever surface lost went looking for a musl
 * binary the run had not built.
 *
 * So the rule the build follows is *produce every architecture this run needs*
 * rather than *produce the architecture this run targets*. Both build hosts
 * required already exist and `./build-host.ts` resolves them without changes —
 * an arm64 Mac driving an amd64 substrate has `builderRemote` for amd64 musl
 * and the local `builderMusl` VM for arm64 musl — and the artifact filenames
 * already carry the architecture, so both sets coexist under the existing
 * output globs.
 *
 * ## Why glibc is untouched
 *
 * Every glibc consumer is inside the substrate: `vm:install` transfers them
 * there and the VM suites run them there. Nothing on the developer's own
 * machine ever executes one. Widening the rule to glibc would start a second
 * build host, and spend minutes, for artifacts with no reader.
 *
 * ## Why the host architecture travels in the environment
 *
 * Same reason the target architecture does (see `./target-arch.ts`): the
 * consumers are turbo tasks in child processes, and the value has to reach
 * them *and* be hashed into their cache key. Without {@link HOST_ARCH_ENV_VAR}
 * in the key, two dev hosts of different architectures sharing one substrate
 * hash identically — and the amd64 host's cache entry, which holds one set of
 * musl artifacts, replays into the arm64 host's run and leaves the loopback
 * surface with nothing it can execute.
 *
 * @module
 */

import type { BuildLibc } from './build-host.js';
import { hostTargetArch, normalizeTargetArch, targetArch, type TargetArch } from './target-arch.js';

/**
 * Environment variable carrying the host's own architecture.
 *
 * Published by `scripts/turbo.ts` alongside `PODKIT_TARGET_ARCH` and
 * declared in `turbo.json` as an input of every task whose outputs depend on
 * it — which is the musl pair and nothing else. A developer never sets it; the
 * spellings {@link normalizeTargetArch} accepts are honoured anyway, so a
 * hand-set `$(uname -m)` is not a trap.
 */
export const HOST_ARCH_ENV_VAR = 'PODKIT_HOST_ARCH';

/** What consumes an architecture's artifacts. */
export type ArchConsumer =
  /** The substrate: `vm:install`, the VM suites, and the in-VM shipped image. */
  | 'substrate'
  /** This machine's Docker daemon, building the shipped image for the loopback surface. */
  | 'host-docker';

/** One architecture a run must produce, and who is waiting for it. */
export interface ArchRequirement {
  /** The architecture to build for. */
  readonly arch: TargetArch;
  /** What will read the artifacts. */
  readonly consumer: ArchConsumer;
  /**
   * One line naming the consumer, for the driver's log and for the error a
   * missing build host raises. A developer watching an arm64 Mac compile a
   * second set of binaries should be able to see what asked for them.
   */
  readonly reason: string;
}

/** Inputs to {@link resolveRequiredArches}. Everything is explicit; nothing is probed. */
export interface ResolveRequiredArchesInput {
  /** The libc the artifacts link against. Only `musl` has two consumers. */
  readonly libc: BuildLibc;
  /** The architecture this run targets — the substrate's, in every real flow. */
  readonly targetArch: TargetArch;
  /** This machine's own architecture. */
  readonly hostArch: TargetArch;
}

/**
 * Resolve every architecture a run must produce for one libc. Pure: same
 * inputs, same answer, no I/O and no environment reads.
 *
 * The target architecture is always first, so a run that cannot build for the
 * substrate at all fails before spending minutes on the host's set.
 */
export function resolveRequiredArches(
  input: ResolveRequiredArchesInput
): readonly ArchRequirement[] {
  const required: ArchRequirement[] = [
    {
      arch: input.targetArch,
      consumer: 'substrate',
      reason:
        'they are what this run targets — the selected substrate, which runs them through ' +
        'vm:install, the VM suites and the in-VM shipped image, or this host when none is selected',
    },
  ];

  if (input.libc === 'musl' && input.hostArch !== input.targetArch) {
    required.push({
      arch: input.hostArch,
      consumer: 'host-docker',
      reason:
        "this host's Docker daemon builds the shipped image from them for test:e2e:docker-loopback",
    });
  }

  return required;
}

/**
 * The impure convenience wrapper: reads the already-resolved target
 * architecture and the published host architecture out of an environment.
 *
 * Synchronous and probe-free for the same reason {@link targetArch} is — it is
 * called inside turbo tasks, where no link exists.
 *
 * @throws {TargetArchError} when either architecture is a machine type this
 * repo does not build for.
 */
export function requiredArches(
  libc: BuildLibc,
  env: Readonly<Record<string, string | undefined>> = process.env,
  nodeArch: string = process.arch
): readonly ArchRequirement[] {
  const published = env[HOST_ARCH_ENV_VAR]?.trim();
  return resolveRequiredArches({
    libc,
    targetArch: targetArch(env),
    hostArch: published
      ? normalizeTargetArch(published, `${HOST_ARCH_ENV_VAR} value`)
      : hostTargetArch(nodeArch),
  });
}
