/**
 * Substrate selection — which substrate *this machine* drives the device
 * harness on.
 *
 * ## Why this is configuration and not inference
 *
 * The obvious implementation is `process.platform === 'darwin' ? lima : ssh`,
 * and it is wrong in a way that only shows up once a second substrate exists.
 * Platform is not the question being asked: a Linux developer with no Proxmox
 * box wants Lima, a macOS developer with a remote box may want the remote one,
 * and CI wants whatever its runner can reach. Branching on `process.platform`
 * answers a question nobody asked and then cannot be overridden, which is the
 * conflation ADR-029 §2 removes. Nothing in this module reads
 * `process.platform`, and `selection.test.ts` pins that.
 *
 * ## The fallback, and why it announces itself
 *
 * With nothing configured, selection falls back to the Lima substrate — but
 * only when `limactl` is actually on PATH, because the fallback is a statement
 * about capability ("this machine can provision a substrate right now"), not
 * about operating system. A macOS developer's zero-config onboarding keeps
 * working because `limactl` is installed, not because anything special-cased
 * darwin.
 *
 * The fallback ANNOUNCES itself. The failure it exists to prevent is specific:
 * someone configures a remote substrate, forgets to select it, runs the suite,
 * and reads a Lima result as if it came from the remote box. A silent default
 * makes those two runs indistinguishable. Per the warning-channel convention
 * (`docs/architecture/conventions.md` §1–2) the announcement is *returned* as
 * data rather than printed — this is library code and does not own a TTY — and
 * the caller decides where it goes.
 *
 * ## Connection detail is not here
 *
 * An `ssh` substrate's address, user, key and jump host live in the developer's
 * `~/.ssh/config` under the alias the registry names. The only machine-specific
 * value this module reads is *which* substrate, never *how to reach* it.
 *
 * @module
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { listVms, type VmDefinition } from './registry.js';

/**
 * Environment variable naming the selected substrate, by registry id.
 *
 * Set it in a gitignored env file that the runtime auto-loads (`.env.local`;
 * see the committed `.env.example`), or export it directly in CI, which has no
 * `~/.ssh/config` and no dotfile to inherit.
 */
export const SUBSTRATE_ENV_VAR = 'PODKIT_SUBSTRATE';

/** Where the selection came from. */
export type SubstrateSelectionSource =
  /** `PODKIT_SUBSTRATE` named it explicitly. */
  | 'configured'
  /** Nothing was configured and `limactl` is available, so Lima it is. */
  | 'lima-fallback';

/** The outcome of resolving a substrate selection. */
export interface SubstrateSelection {
  /** The selected substrate's registry entry. */
  readonly substrate: VmDefinition;
  /** How it came to be selected. */
  readonly source: SubstrateSelectionSource;
  /**
   * Human-readable notice the caller MUST surface, or `null` when there is
   * nothing to say. Non-null exactly when {@link source} is `lima-fallback`.
   *
   * Returned rather than printed: this is library code, and a default that
   * nobody can see is the whole defect this field exists to prevent. Swallowing
   * it re-creates that defect.
   */
  readonly announcement: string | null;
}

/**
 * No substrate could be selected. Carries an actionable message naming the
 * configuration step — an unconfigured machine is an onboarding state, not a
 * crash, and the error is the only documentation the operator is guaranteed to
 * read.
 */
export class SubstrateSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SubstrateSelectionError';
  }
}

/** Inputs to {@link resolveSubstrateSelection}. Everything is explicit; nothing is probed. */
export interface SubstrateSelectionInput {
  /** The process environment, or any stand-in with the same shape. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The substrate registry to select from. */
  readonly substrates: readonly VmDefinition[];
  /**
   * Whether `limactl` can be invoked on this machine. A capability, passed in
   * rather than probed, so the resolver stays a pure `(inputs) → decision`
   * function and every branch — including "no limactl anywhere" — is reachable
   * from a unit test on a machine that happens to have Lima installed.
   */
  readonly limactlAvailable: boolean;
}

/** Candidate substrates: only the ones that can host the device harness. */
function deviceSubstrates(substrates: readonly VmDefinition[]): readonly VmDefinition[] {
  return substrates.filter((vm) => vm.category === 'device');
}

function describeCandidates(candidates: readonly VmDefinition[]): string {
  return candidates.map((vm) => `${vm.id} (${vm.provisioner})`).join(', ');
}

/**
 * Resolve which substrate to use. Pure: same inputs, same answer, no I/O, no
 * environment reads beyond the `env` handed in, and no platform check.
 *
 * @throws {SubstrateSelectionError} when the configured id names nothing, when
 * it names a substrate that cannot host the device harness, or when nothing is
 * configured and `limactl` is absent.
 */
export function resolveSubstrateSelection(input: SubstrateSelectionInput): SubstrateSelection {
  const candidates = deviceSubstrates(input.substrates);
  const configured = input.env[SUBSTRATE_ENV_VAR]?.trim();

  if (configured) {
    const chosen = candidates.find((vm) => vm.id === configured || vm.instanceName === configured);
    if (!chosen) {
      throw new SubstrateSelectionError(
        `${SUBSTRATE_ENV_VAR}='${configured}' does not name a device substrate. ` +
          `Known device substrates: ${describeCandidates(candidates)}.`
      );
    }
    return { substrate: chosen, source: 'configured', announcement: null };
  }

  const limaCandidates = candidates.filter((vm) => vm.provisioner === 'lima');
  if (limaCandidates.length !== 1) {
    // Not an operator error — the registry itself is ambiguous, and guessing
    // which of two Lima device substrates was meant is exactly the silent
    // default this module exists to refuse.
    throw new SubstrateSelectionError(
      `Cannot fall back to a Lima substrate: the registry declares ${limaCandidates.length} ` +
        `Lima-provisioned device substrates, expected exactly 1. ` +
        `Set ${SUBSTRATE_ENV_VAR} to choose explicitly. ` +
        `Known device substrates: ${describeCandidates(candidates)}.`
    );
  }
  const lima = limaCandidates[0]!;

  if (!input.limactlAvailable) {
    throw new SubstrateSelectionError(
      `No substrate selected and \`limactl\` is not on PATH, so there is nothing to fall back to. ` +
        `Set ${SUBSTRATE_ENV_VAR} in .env.local to one of: ${describeCandidates(candidates)} ` +
        `(copy .env.example to get started), or install Lima to use '${lima.id}'.`
    );
  }

  return {
    substrate: lima,
    source: 'lima-fallback',
    announcement:
      `${SUBSTRATE_ENV_VAR} is unset — falling back to the Lima substrate '${lima.id}' ` +
      `(${lima.instanceName}) because \`limactl\` is on PATH. ` +
      `Set ${SUBSTRATE_ENV_VAR} in .env.local to select a substrate explicitly; ` +
      `see .env.example.`,
  };
}

/**
 * Whether an executable of this name is reachable on PATH.
 *
 * A PATH walk rather than a `which`/`command -v` subprocess: selection is
 * consulted on paths that must stay cheap and synchronous, and spawning a shell
 * to answer "does this file exist" would add a process and a shell-quoting
 * surface for nothing. `X_OK` is what matters — a non-executable file of the
 * right name on PATH is not a command.
 */
export function commandOnPath(
  command: string,
  env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
  const rawPath = env['PATH'];
  if (!rawPath) return false;
  return rawPath
    .split(path.delimiter)
    .filter(Boolean)
    .some((dir) => {
      try {
        fs.accessSync(path.join(dir, command), fs.constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
}

/**
 * The impure convenience wrapper: reads the real environment, the real
 * registry, and probes for `limactl`. Everything interesting happens in
 * {@link resolveSubstrateSelection}; this only supplies the facts.
 */
export function selectSubstrate(
  env: Readonly<Record<string, string | undefined>> = process.env,
  substrates: readonly VmDefinition[] = listVms()
): SubstrateSelection {
  return resolveSubstrateSelection({
    env,
    substrates,
    limactlAvailable: commandOnPath('limactl', env),
  });
}
