/**
 * Target architecture — the architecture an artifact is built **for**.
 *
 * ## Why this is not `process.arch`
 *
 * This module replaces a one-line function that mapped `process.arch` to a
 * binary filename suffix. Seven path resolvers called it, which made host
 * architecture and target architecture the same value by construction: an
 * arm64 macOS host could not *name* an amd64 artifact, let alone produce one,
 * so every host was silently pinned to a substrate of its own architecture —
 * a constraint nobody chose (ADR-029 §4).
 *
 * Target architecture is a property of the **substrate**: the box the binary
 * has to start on decides what the binary must be. The host is only the
 * default for the case where no substrate has been consulted.
 *
 * ## The bootstrapping boundary, and why it is drawn here
 *
 * Resolving the target arch from a substrate means *talking to* the substrate
 * (`uname -m`). Some callers — every path resolver in `./binary-paths.ts` —
 * want a filename before anything is reachable, and several of them run inside
 * turbo tasks where a link may not exist at all. A probe hidden inside a
 * synchronous path helper would turn "where would the binary be?" into a
 * network round trip, and would fail on a stopped substrate for callers that
 * only wanted a string.
 *
 * So the boundary is explicit and has exactly two halves:
 *
 * - {@link targetArch} is **synchronous and never probes**. It reads the
 *   answer somebody else already resolved, from {@link TARGET_ARCH_ENV_VAR},
 *   and falls back to the host arch when nothing did. Safe to call anywhere,
 *   at any time, including in a child process of whoever resolved it.
 * - {@link primeTargetArchFromSubstrate} is **asynchronous and does probe**.
 *   It is called once, by an entry point that already holds a link, *before*
 *   any artifact path is resolved or any build is spawned. It writes the
 *   answer into the environment, which is what carries it to every downstream
 *   path resolver and every child process — turbo included.
 *
 * The environment variable is the carrier rather than a module-level cache
 * because the consumers are not all in this process: the turbo tasks that
 * compile the binaries are child processes, and the same value has to reach
 * them *and* be hashed into their cache key. One mechanism doing both beats a
 * private cache plus an env var that can disagree with it.
 *
 * ## Naming
 *
 * The filename convention is Bun's (`arm64` / `x64`), because Bun's
 * `--compile --target=bun-linux-<arch>` is what produces most of these
 * artifacts and its spelling is already baked into every output glob in
 * `turbo.json`. `uname -m` spellings (`aarch64` / `x86_64`) and Docker's
 * (`amd64`) are accepted on input and normalised, so a developer can write
 * `PODKIT_TARGET_ARCH=$(uname -m)` and be right.
 *
 * @module
 */

import type { SubstrateLink } from './link.js';

/**
 * Architecture an artifact is built for, in the filename spelling every
 * `turbo.json` output glob and every `bun build --compile --target` already
 * uses.
 */
export type TargetArch = 'arm64' | 'x64';

/**
 * Environment variable carrying the resolved target architecture.
 *
 * It is declared in `turbo.json` as an input of every task that produces a
 * Linux binary. That declaration is the load-bearing part: the artifact
 * *filenames* already carry the arch, so the outputs are distinct, but a cache
 * key that does not would let turbo replay an arm64 binary into an amd64 run.
 * The result is a silently wrong artifact rather than an error — which is why
 * `./artifact-arch.ts` exists as a backstop for the case where this is wrong
 * anyway.
 *
 * Accepts `arm64`/`aarch64` and `x64`/`x86_64`/`amd64`; normalised on read.
 */
export const TARGET_ARCH_ENV_VAR = 'PODKIT_TARGET_ARCH';

/**
 * A machine type could not be turned into a target architecture, or a
 * configured target architecture contradicts the substrate that has to run the
 * artifact.
 *
 * Typed rather than a bare `Error` because the callers that can do something
 * about it — the turbo wrapper, the harness installer — need to tell "this
 * repo does not build for that CPU" apart from any other failure on the same
 * line (see `docs/architecture/conventions.md` §1).
 */
export class TargetArchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TargetArchError';
  }
}

/**
 * Every spelling of a machine type this repo accepts, mapped to the one it
 * writes. `uname -m` on the substrate, `process.arch` on the host and
 * `TARGETARCH` in a Docker build all name the same two CPUs differently, and
 * every one of those strings reaches this module from somewhere.
 */
const MACHINE_ALIASES: Readonly<Record<string, TargetArch>> = {
  arm64: 'arm64',
  aarch64: 'arm64',
  x64: 'x64',
  x86_64: 'x64',
  amd64: 'x64',
};

/** Accepted spellings, for error messages. Derived, never restated. */
const KNOWN_MACHINES = Object.keys(MACHINE_ALIASES).join(', ');

/**
 * Normalise any accepted machine-type spelling to a {@link TargetArch}.
 *
 * @throws {TargetArchError} for anything else. There is no "assume x64"
 * fallback: a machine type this repo has never built for is a fact worth
 * stopping on, and guessing produces a binary that cannot start.
 */
export function normalizeTargetArch(raw: string, context = 'target architecture'): TargetArch {
  const key = raw.trim().toLowerCase();
  const arch = MACHINE_ALIASES[key];
  if (!arch) {
    throw new TargetArchError(
      `Unsupported ${context} '${raw.trim()}'. Known machine types: ${KNOWN_MACHINES}.`
    );
  }
  return arch;
}

/**
 * The host's own architecture — the default when no substrate has been
 * consulted, and nothing more than that.
 *
 * `nodeArch` is a parameter so the foreign-host case is reachable from a unit
 * test on a machine that only has one architecture. That is the whole point of
 * this slice: the interesting cases are the ones the developer's laptop cannot
 * reach naturally.
 */
export function hostTargetArch(nodeArch: string = process.arch): TargetArch {
  return normalizeTargetArch(nodeArch, 'host architecture');
}

/** Where a resolved target architecture came from. */
export type TargetArchSource =
  /** {@link TARGET_ARCH_ENV_VAR} named it. */
  | 'configured'
  /** A substrate reported it. */
  | 'substrate'
  /** Nothing named it and no substrate was consulted, so: the host's own. */
  | 'host-default';

/** The outcome of resolving a target architecture. */
export interface TargetArchResolution {
  /** The architecture artifacts must be built for. */
  readonly arch: TargetArch;
  /** How it came to be chosen. */
  readonly source: TargetArchSource;
}

/** Inputs to {@link resolveTargetArch}. Everything is explicit; nothing is probed. */
export interface ResolveTargetArchInput {
  /** The process environment, or any stand-in with the same shape. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /**
   * What the selected substrate reports for `uname -m`, or `null`/absent when
   * no substrate has been consulted. Passed in rather than probed so this
   * stays a pure `(inputs) → decision` function.
   */
  readonly substrateMachine?: string | null;
  /** The host's own `process.arch`, for the no-substrate default. */
  readonly hostArch: string;
}

/**
 * Resolve a target architecture. Pure: same inputs, same answer, no I/O and no
 * environment reads beyond the `env` handed in.
 *
 * Precedence is configured → substrate → host. An explicit
 * {@link TARGET_ARCH_ENV_VAR} wins over the substrate because it is the only
 * way to build for a box that is not reachable right now — a release artifact
 * for a machine nobody has plugged in. It is *checked against* the substrate
 * at the point of transfer instead (see `./artifact-arch.ts`), which is where
 * disagreeing with it actually costs something.
 *
 * @throws {TargetArchError} when any of the supplied spellings is not a
 * machine type this repo builds for.
 */
export function resolveTargetArch(input: ResolveTargetArchInput): TargetArchResolution {
  const configured = input.env[TARGET_ARCH_ENV_VAR]?.trim();
  if (configured) {
    return {
      arch: normalizeTargetArch(configured, `${TARGET_ARCH_ENV_VAR} value`),
      source: 'configured',
    };
  }

  const machine = input.substrateMachine?.trim();
  if (machine) {
    return {
      arch: normalizeTargetArch(machine, 'substrate machine type'),
      source: 'substrate',
    };
  }

  return { arch: hostTargetArch(input.hostArch), source: 'host-default' };
}

/**
 * The architecture artifacts are currently being built for.
 *
 * **Synchronous, and never talks to a substrate.** This is the function every
 * path resolver calls, so it has to answer from facts already in hand: the
 * environment, or the host as the default. Whoever knows better — an entry
 * point holding a link — resolves it first via
 * {@link primeTargetArchFromSubstrate} and leaves the answer in the
 * environment for this function and for every child process to find.
 *
 * @throws {TargetArchError} when {@link TARGET_ARCH_ENV_VAR} holds a machine
 * type this repo does not build for. A typo there must not silently resolve to
 * the host's architecture — that is the wrong-artifact failure wearing a
 * different hat.
 */
export function targetArch(
  env: Readonly<Record<string, string | undefined>> = process.env
): TargetArch {
  return resolveTargetArch({ env, hostArch: process.arch }).arch;
}

/**
 * An environment stand-in that pins {@link TARGET_ARCH_ENV_VAR} to `arch`.
 *
 * For the one caller that resolves artifact paths for an architecture other
 * than the run's own: the build driver, which produces every architecture the
 * run needs rather than the single one it targets (`./required-arches.ts`).
 * Every path resolver already takes an environment and reads the architecture
 * out of it, so pinning the variable is the whole mechanism — no resolver
 * needs a second parameter, and none of them can disagree about which
 * architecture a pass is for.
 *
 * Note what it does NOT override: a `PODKIT_LINUX_MUSL_BINARY`-style explicit
 * path wins over the architecture in every resolver, so an override plus a
 * two-architecture run names one file for both passes. The driver refuses that
 * rather than letting the second pass overwrite the first.
 */
export function envForTargetArch(
  arch: TargetArch,
  env: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  return { ...env, [TARGET_ARCH_ENV_VAR]: arch };
}

/**
 * Ask a substrate what machine type it is, as `uname -m` spells it.
 *
 * Asynchronous by nature — it is a command on another machine. Kept separate
 * from every resolver so the one place that pays for a round trip is visible
 * in a call graph.
 *
 * @throws {SubstrateLinkError} when the substrate could not be reached, which
 * is a different outcome from a substrate that answered something unusable.
 * @throws {TargetArchError} when `uname -m` returned nothing.
 */
export async function probeSubstrateMachine(link: SubstrateLink): Promise<string> {
  const result = await link.exec(['uname', '-m']);
  const machine = result.stdout.trim();
  if (result.exitCode !== 0 || !machine) {
    throw new TargetArchError(
      `Could not read the machine type of ${link.description}: ` +
        `\`uname -m\` exited ${result.exitCode}` +
        (result.stderr.trim() ? ` (${result.stderr.trim()})` : '') +
        ". Without it, every artifact path would fall back to this host's architecture."
    );
  }
  return machine;
}

/** Options for {@link primeTargetArchFromSubstrate}. */
export interface PrimeTargetArchOpts {
  /** Link to the substrate whose architecture the artifacts must match. */
  readonly link: SubstrateLink;
  /**
   * The environment to publish the answer into. Mutated — that is the point:
   * it is what carries the value to the path resolvers in this process and to
   * every child process, turbo included. Defaults to `process.env`.
   */
  readonly env?: NodeJS.ProcessEnv;
}

/**
 * Probe a substrate and publish its architecture as the target architecture
 * for this process and everything it spawns.
 *
 * Call this **once**, from an entry point that already holds a link, before
 * resolving any artifact path or spawning any build. Everything downstream
 * then reads it synchronously through {@link targetArch}.
 *
 * When {@link TARGET_ARCH_ENV_VAR} was already set to something the substrate
 * contradicts, this throws rather than picking a winner. Both values are
 * somebody's deliberate statement about what is about to be built, and a build
 * that satisfies neither is worse than a build that does not start.
 *
 * @throws {TargetArchError} on an unusable or contradicted machine type.
 * @throws {SubstrateLinkError} when the substrate could not be reached.
 */
export async function primeTargetArchFromSubstrate(
  opts: PrimeTargetArchOpts
): Promise<TargetArchResolution> {
  const env = opts.env ?? process.env;
  const machine = await probeSubstrateMachine(opts.link);
  const fromSubstrate = normalizeTargetArch(machine, 'substrate machine type');

  const configured = env[TARGET_ARCH_ENV_VAR]?.trim();
  if (configured) {
    const fromEnv = normalizeTargetArch(configured, `${TARGET_ARCH_ENV_VAR} value`);
    if (fromEnv !== fromSubstrate) {
      throw new TargetArchError(
        `${TARGET_ARCH_ENV_VAR}='${configured}' asks for ${fromEnv} artifacts, but ` +
          `${opts.link.description} reports '${machine}' (${fromSubstrate}). ` +
          `Unset ${TARGET_ARCH_ENV_VAR} to build for the substrate, or point at a ` +
          `substrate that matches.`
      );
    }
    return { arch: fromEnv, source: 'configured' };
  }

  env[TARGET_ARCH_ENV_VAR] = fromSubstrate;
  return { arch: fromSubstrate, source: 'substrate' };
}
