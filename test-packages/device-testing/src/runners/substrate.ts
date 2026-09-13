/**
 * Which substrate this machine drives, how to reach it, and how to get it
 * ready.
 *
 * Three things live here, and they are together because each is the previous
 * one's only consumer:
 *
 *   1. **Dispatch** — turn a registry entry into a {@link SubstrateLink},
 *      choosing `limactl` or `ssh` from the provisioner discriminator.
 *   2. **Selection** — decide WHICH substrate, via `@podkit/substrate`'s
 *      resolver, and render the announcement it hands back.
 *   3. **Readiness** — probe and, where this repo owns the provisioner, start.
 *
 * ## Why the dispatch is here and not in `@podkit/substrate`
 *
 * It needs both implementations, and the dependency arrow forbids the
 * provisioner-agnostic package from importing a provisioner. `@podkit/lima`
 * cannot own it either — a package named after one hypervisor driver deciding
 * when to use a different one is the exact conflation ADR-029 §1 removes. The
 * harness is the only layer that legitimately knows about both, so the two-line
 * switch lives at the bottom of the harness rather than being pushed into a
 * package that would have to invert to hold it.
 *
 * ## Why the selection is lazy and memoised
 *
 * `@podkit/device-testing`'s entry point constructs the device-harness
 * singleton at import time, and 29 test files import that singleton by name.
 * Resolving the selection eagerly would mean every one of those imports —
 * including a pure unit run on a machine with no substrate at all — throws
 * `SubstrateSelectionError` before a single test loads. So selection happens on
 * first USE and is cached: one resolution per process, one announcement per
 * process, and no cost at all for a run that never touches a substrate.
 *
 * @module
 */

import { createLimactlLink, ensureRunning, instanceStatus, type VmLockOptions } from '@podkit/lima';
import {
  createSshLink,
  isLimaVm,
  isSshVm,
  isSubstrateLinkError,
  selectSubstrate,
  type SubstrateLink,
  type SubstrateSelection,
  type VmDefinition,
} from '@podkit/substrate';

import type { SubprocessRunner } from '../subprocess.js';

/**
 * Where a developer-facing line about the substrate goes.
 *
 * A sink rather than a `console.log`, for the reason the selection resolver
 * returns its announcement as data: the modules below are library code and do
 * not own a TTY. Entry points that do — `harness.ts`, `preflight.ts`,
 * `vm-doctor.ts` — pass their own prefixed writer so the line reads as part of
 * their output instead of arriving unattributed.
 */
export type SubstrateNotice = (line: string) => void;

/**
 * Fallback sink for callers that are not an entry point — chiefly the harness
 * singleton, which is reached from 29 test files and owns no output surface of
 * its own.
 *
 * stderr rather than stdout because it is diagnostic, and because the VM
 * preflight already puts its own developer-facing lines there. A silent default
 * is the one option ruled out: the announcement exists precisely to stop a Lima
 * result being read as if it came from a remote box, and an announcement nobody
 * prints is worse than none because the code then reads as though the user was
 * told.
 */
const defaultNotice: SubstrateNotice = (line) => {
  process.stderr.write(`[substrate] ${line}\n`);
};

/**
 * Budget for one link round trip on a busy host.
 *
 * The figure every "this should finish in milliseconds" call in the harness is
 * bounded by: `mkdir -p`, `rm -f`, `systemctl start`, a `/bin/true` probe.
 * None of them can legitimately take anywhere near this long — the entire
 * budget is the SSH session in front of them on a host deep in swap with a
 * contended channel. Anything past it is a wedged session, not slow work.
 *
 * It lives here, once, because three modules had independently arrived at the
 * same number for the same stated reason, and three copies of a constant whose
 * justification is identical is three places for it to drift.
 */
export const SUBSTRATE_ROUND_TRIP_TIMEOUT_MS = 45_000;

/** Options shared by the substrate helpers in this module. */
export interface SubstrateOpts {
  /** DI seam for the link's own subprocess calls; production leaves unset. */
  subprocess?: SubprocessRunner;
}

/**
 * Build a link to `def`, dispatching on its provisioner.
 *
 * The switch is exhaustive over the discriminator rather than defaulting to
 * Lima: a registry that grew a third provisioner should fail to compile here,
 * not silently reach for `limactl` and report "instance not found" about a box
 * Lima was never going to know.
 */
export function createSubstrateLink(def: VmDefinition, opts: SubstrateOpts = {}): SubstrateLink {
  const linkOpts = opts.subprocess ? { subprocess: opts.subprocess } : {};
  if (isLimaVm(def)) return createLimactlLink(def, linkOpts);
  if (isSshVm(def)) return createSshLink(def, linkOpts);
  // Unreachable while `VmProvisioner` has two inhabitants; `def` narrows to
  // `never` above, so adding a third turns this into a compile error.
  const unreachable: never = def;
  throw new Error(`createSubstrateLink: unhandled substrate ${JSON.stringify(unreachable)}`);
}

/** The selected substrate, its link, and how it came to be selected. */
export interface ResolvedSubstrate {
  /** The registry entry that was selected. */
  readonly definition: VmDefinition;
  /** A link to it, already dispatched on its provisioner. */
  readonly link: SubstrateLink;
  /** The resolver's verdict, including how the selection was reached. */
  readonly selection: SubstrateSelection;
}

/** Options for {@link resolveDeviceSubstrate}. */
export interface ResolveDeviceSubstrateOpts extends SubstrateOpts {
  /** Where the fallback announcement goes. Defaults to a stderr writer. */
  notice?: SubstrateNotice;
  /**
   * Ignore the process-wide cache and resolve afresh. Only useful to a test
   * that needs to observe the announcement; production callers leave it unset,
   * because a second resolution would mean a second announcement for a
   * decision that was already made.
   */
  fresh?: boolean;
}

let cached: ResolvedSubstrate | null = null;

/**
 * Resolve which substrate this machine drives, build a link to it, and render
 * the resolver's announcement exactly once.
 *
 * @throws {SubstrateSelectionError} when nothing is configured and there is no
 * Lima to fall back to. That is an onboarding state rather than a crash, and
 * the error carries the configuration step as its message.
 */
export function resolveDeviceSubstrate(opts: ResolveDeviceSubstrateOpts = {}): ResolvedSubstrate {
  // A resolution built over an INJECTED runner is never cached, whatever
  // `fresh` says. The cache is process-wide and shared with every helper that
  // falls back to the default, so letting a scripted runner into it would hand
  // the next caller a link that replays someone else's test script.
  const cacheable = !opts.fresh && !opts.subprocess;
  if (cached && cacheable) return cached;

  const selection = selectSubstrate();
  if (selection.announcement) {
    (opts.notice ?? defaultNotice)(selection.announcement);
  }
  const resolved: ResolvedSubstrate = {
    definition: selection.substrate,
    link: createSubstrateLink(selection.substrate, opts),
    selection,
  };
  if (cacheable) cached = resolved;
  return resolved;
}

/**
 * Forget the memoised selection. For tests that need a clean process-wide
 * state; production never calls it.
 */
export function resetDeviceSubstrate(): void {
  cached = null;
}

/**
 * A link to the selected device substrate. The default every harness helper
 * falls back to when the caller did not inject one.
 */
export function deviceSubstrateLink(): SubstrateLink {
  return resolveDeviceSubstrate().link;
}

/**
 * What a substrate can currently be asked to do.
 *
 * Deliberately not Lima's `InstanceStatus`: `missing` and `stopped` are facts
 * about an instance a provisioner in this repo created, and an SSH substrate
 * has neither. What every substrate does have is "answers" or "does not", which
 * is the only distinction the harness acts on.
 */
export type SubstrateReadiness =
  /** The link answers; the harness can drive it. */
  | 'ready'
  /** It exists but is not answering, and this repo's provisioner can start it. */
  | 'startable'
  /** Not reachable, and not this repo's to bring up. */
  | 'unreachable';

/**
 * Probe a substrate without changing it. Never throws — a probe that raises is
 * a probe the availability gate has to wrap in a `catch`, which is how "the
 * substrate is unavailable" turns into a suite-level error instead of a skip.
 */
export async function probeSubstrate(
  def: VmDefinition,
  opts: SubstrateOpts = {}
): Promise<SubstrateReadiness> {
  if (isLimaVm(def)) {
    // Lima's own metadata is cheaper than a round trip and distinguishes
    // "never created" from "created and stopped", which is what lets
    // `ensureSubstrateReady` refuse to conjure an unprovisioned instance.
    const status = await instanceStatus(def.instanceName, opts.subprocess).catch(
      () => 'missing' as const
    );
    if (status === 'missing') return 'unreachable';
    return status === 'running' ? 'ready' : 'startable';
  }
  // An SSH substrate has no metadata to read, so reachability IS the probe.
  // `true` is the cheapest guest command there is, and a link failure — the
  // only thing that can go wrong here — is a typed throw rather than an exit
  // code to second-guess.
  const link = createSubstrateLink(def, opts);
  try {
    const result = await link.exec(['true'], { timeoutMs: SUBSTRATE_ROUND_TRIP_TIMEOUT_MS });
    return result.exitCode === 0 ? 'ready' : 'unreachable';
  } catch {
    return 'unreachable';
  }
}

/** Options for {@link ensureSubstrateReady}. */
export interface EnsureSubstrateReadyOpts extends SubstrateOpts {
  /** Advisory-lock tuning for a Lima boot. Production callers leave unset. */
  lock?: VmLockOptions;
}

/**
 * Bring a substrate to the point where the harness can drive it, or explain
 * why that is not something this repo can do.
 *
 * The asymmetry between the two provisioners is real and is the whole reason
 * this dispatches rather than widening one path:
 *
 *   - A **Lima** substrate is this repo's to lifecycle, so a stopped instance
 *     is started through the shared advisory lock. A MISSING one is still not
 *     created here: an unprovisioned instance has no binaries, no systemd unit
 *     and no sealed baseline, so silently conjuring one trades a clear error
 *     for a confusing mid-suite failure.
 *   - An **SSH** substrate was created by something this repo does not drive —
 *     a hypervisor, a cloud, a human with a spare box. There is no start verb
 *     to call, so an unreachable one is reported as what it is.
 *
 * @throws {Error} naming the substrate and the command that fixes it.
 */
export async function ensureSubstrateReady(
  def: VmDefinition,
  opts: EnsureSubstrateReadyOpts = {}
): Promise<void> {
  const readiness = await probeSubstrate(def, opts);
  if (readiness === 'ready') return;

  if (isLimaVm(def)) {
    if (readiness === 'unreachable') {
      throw new Error(
        `[substrate] Lima instance '${def.instanceName}' is not registered. ` +
          'Create and provision it with: bun run harness:setup'
      );
    }
    await ensureRunning(def, {
      ...(opts.subprocess ? { subprocess: opts.subprocess } : {}),
      ...(opts.lock ? { lock: opts.lock } : {}),
    });
    return;
  }

  throw new Error(
    `[substrate] '${def.id}' is not answering over ssh_config alias '${def.sshAlias}'. ` +
      'Nothing in this repo provisions it — bring the host up, then check that ' +
      `\`ssh ${def.sshAlias} true\` succeeds.`
  );
}

/**
 * Whether `err` means the substrate could not be reached, as opposed to the
 * guest having answered with a failure. Re-exported from `@podkit/substrate`
 * so harness code has one import for everything substrate-shaped.
 */
export { isSubstrateLinkError };
