/**
 * Lifecycle verbs for a Proxmox-hosted substrate.
 *
 * The registry declares the ROLE; `.env.local` declares which guest fills it.
 * Everything else here is derived rather than configured — the guest name and
 * its cloud-init snippet are the ssh alias, the node comes from the pool
 * listing, the image comes from the pin. A second place to spell any of those
 * is a second place for them to disagree.
 *
 * Nothing in this module prints. Callers own the terminal; see ADR-029 §2 and
 * `docs/architecture/conventions.md` §1.
 *
 * @module
 */

import { pveDebianImagePath, type DebianImageArch } from '../debian-image.js';
import { envWithRepoDotfile } from '../env-file.js';
import { isSshVm, type SshVmDefinition, type VmCategory, type VmDefinition } from '../registry.js';
import type { TargetArch } from '../target-arch.js';
import {
  createPveClient,
  type CreateGuestSpec,
  type PveClient,
  type PveGuestStatus,
  type PveSnapshot,
  type CreatePveClientOpts,
} from './client.js';
import { DEFAULT_PVE_POOL, resolvePveConfig, resolvePveVmid, type PveConfig } from './config.js';
import type { QmContext } from './qm.js';

/**
 * Name of the snapshot taken once a substrate has been provisioned and
 * verified. The only snapshot this repo takes: per-test state stays
 * `apply-state.sh`'s forward mutation (ADR-028).
 */
export const POST_PROVISION_SNAPSHOT = 'podkit-provisioned';

/** Debian's spelling of a target architecture. */
const DEBIAN_ARCH: Readonly<Record<TargetArch, DebianImageArch>> = {
  x64: 'amd64',
  arm64: 'arm64',
};

/** Guest sizing by the role the substrate plays. */
interface GuestSizing {
  readonly memoryMiB: number;
  readonly cores: number;
  readonly diskGiB: number;
}
const DEFAULT_SIZING: GuestSizing = { memoryMiB: 2048, cores: 2, diskGiB: 20 };
const SIZING: Readonly<Partial<Record<VmCategory, GuestSizing>>> = {
  device: DEFAULT_SIZING,
  builder: { memoryMiB: 4096, cores: 4, diskGiB: 40 },
};

/** Everything needed to drive one guest. */
export interface PveBinding {
  readonly substrate: SshVmDefinition;
  readonly vmid: number;
  readonly client: PveClient;
  readonly config: PveConfig;
  /** The create arguments for this guest, for `create` and for display. */
  readonly guestSpec: CreateGuestSpec;
}

/** Why lifecycle is unavailable on this machine. */
export type PveUnavailableReason =
  /** No PODKIT_PVE_* key is set at all — an ordinary, supported state. */
  | 'unconfigured'
  /** Some keys are set and others are not. */
  | 'partial'
  /** The API is configured but this machine names no guest for the role. */
  | 'no-vmid'
  /** The substrate is Lima-provisioned; this module is not its lifecycle. */
  | 'not-ssh';

/** Whether this machine can lifecycle a substrate over the PVE API. */
export type PveLifecycleResolution =
  | { readonly available: true; readonly binding: PveBinding }
  | {
      readonly available: false;
      readonly reason: PveUnavailableReason;
      readonly missing: readonly string[];
      readonly vmid: number | null;
    };

/** Options for {@link resolvePveLifecycle}. */
export interface ResolvePveLifecycleOpts {
  /** DI seams handed straight to the client. */
  readonly client?: Omit<CreatePveClientOpts, 'config'>;
}

/**
 * The create arguments for a registry entry, minus the VMID — that is the one
 * field the repo does not know and the caller must supply.
 */
export function guestSpecFor(
  substrate: SshVmDefinition,
  config: PveConfig
): Omit<CreateGuestSpec, 'vmid'> {
  const sizing = SIZING[substrate.category] ?? DEFAULT_SIZING;
  return {
    // The ssh alias is also the guest name and the snippet basename. One
    // string, so `bootstrap-pve.sh` and this module cannot name different
    // guests for the same role.
    name: substrate.sshAlias,
    snippetRef: `${config.snippetStorage}:snippets/${substrate.sshAlias}.yaml`,
    imagePath: pveDebianImagePath(DEBIAN_ARCH[substrate.targetArch]),
    ...sizing,
  };
}

/** Resolve the lifecycle binding for a substrate on this machine. */
export function resolvePveLifecycle(
  substrate: VmDefinition,
  env: Readonly<Record<string, string | undefined>> = envWithRepoDotfile(),
  opts: ResolvePveLifecycleOpts = {}
): PveLifecycleResolution {
  if (!isSshVm(substrate)) {
    return { available: false, reason: 'not-ssh', missing: [], vmid: null };
  }

  const resolved = resolvePveConfig(env);
  const vmid = resolvePveVmid(substrate, env);

  if (!resolved.available) {
    return {
      available: false,
      reason: resolved.partial ? 'partial' : 'unconfigured',
      missing: resolved.missing,
      vmid,
    };
  }
  if (vmid === null) {
    return { available: false, reason: 'no-vmid', missing: [], vmid: null };
  }

  const config = resolved.config;
  return {
    available: true,
    binding: {
      substrate,
      vmid,
      config,
      client: createPveClient({ config, ...opts.client }),
      guestSpec: { ...guestSpecFor(substrate, config), vmid },
    },
  };
}

/**
 * The context the `qm` fallback renderer needs.
 *
 * Tolerant of a malformed environment by design: this is what gets printed when
 * something is wrong, so it must not be the thing that throws.
 */
export function qmContextFor(
  substrate: VmDefinition,
  env: Readonly<Record<string, string | undefined>>
): QmContext {
  const pool = tryResolve(() => {
    const resolved = resolvePveConfig(env);
    return resolved.available ? resolved.config.pool : null;
  });
  const vmid = tryResolve(() => (isSshVm(substrate) ? resolvePveVmid(substrate, env) : null));
  return {
    vmid,
    guestName: isSshVm(substrate) ? substrate.sshAlias : substrate.instanceName,
    pool: pool ?? DEFAULT_PVE_POOL,
    snapshotName: POST_PROVISION_SNAPSHOT,
  };
}

function tryResolve<T>(read: () => T | null): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}

/** Current status of the bound guest. */
export function pveStatus(binding: PveBinding): Promise<PveGuestStatus> {
  return binding.client.guestStatus(binding.vmid);
}

/** Progress reporting seam — callers own the terminal. */
export type ReportFn = (message: string) => void;

const noReport: ReportFn = () => {};

/**
 * Bound on the wait for a started guest to report `running`.
 *
 * Generous: it covers a contended hypervisor, not a boot. The guest reports
 * `running` once QEMU is up, long before sshd is — ssh readiness is a separate
 * wait, owned by whoever holds a link.
 */
export const START_TIMEOUT_MS = 60_000;

/** Gap between status polls while waiting for a start to take effect. */
const START_POLL_MS = 1_000;

/** A guest that was started and never reached `running`. */
export class PveStartTimeoutError extends Error {
  readonly vmid: number;
  /** The status the guest was left reporting. */
  readonly status: PveGuestStatus;

  constructor(vmid: number, guestName: string, timeoutMs: number, last: PveGuestStatus) {
    super(
      last === 'missing'
        ? `VMID ${vmid} (${guestName}) was started and then reported 'missing'. Something ` +
            `removed the guest underneath this command.`
        : `VMID ${vmid} (${guestName}) was started but still reports '${last}' after ` +
            `${timeoutMs}ms. Check the guest's console on the PVE host — a start task can ` +
            `succeed while the guest fails to boot.`
    );
    this.name = 'PveStartTimeoutError';
    this.vmid = vmid;
    this.status = last;
  }
}

/** Seams for the status wait. Production callers leave them unset. */
export interface PveEnsureRunningOpts {
  readonly report?: ReportFn;
  /** Bound on the wait. Defaults to {@link START_TIMEOUT_MS}. */
  readonly timeoutMs?: number;
  /** Clock, injected so the timeout branch is reachable without waiting. */
  readonly now?: () => number;
  /** Sleep, injected for the same reason. */
  readonly sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll until the guest reports `running`.
 *
 * The start call returns a UPID and the client waits for that task, but the
 * task finishing means QEMU was launched — not that the guest has flipped to
 * `running`. Only this wait makes the status a caller reads afterwards
 * describe the box it asked for.
 *
 * `missing` ends the wait immediately: a guest that is not there cannot start,
 * so polling it out to the bound buys a minute of silence for an answer
 * already known.
 */
async function waitForRunning(
  binding: PveBinding,
  opts: PveEnsureRunningOpts
): Promise<PveGuestStatus> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? realSleep;
  const timeoutMs = opts.timeoutMs ?? START_TIMEOUT_MS;
  const deadline = now() + timeoutMs;

  let status = await pveStatus(binding);
  while (status === 'stopped' && now() < deadline) {
    await sleep(START_POLL_MS);
    status = await pveStatus(binding);
  }
  if (status !== 'running') {
    throw new PveStartTimeoutError(binding.vmid, binding.substrate.sshAlias, timeoutMs, status);
  }
  return status;
}

/**
 * Create the guest if it does not exist, start it if it is stopped, no-op if it
 * is already running. Returns only once the guest reports `running`.
 */
export async function pveEnsureRunning(
  binding: PveBinding,
  opts: PveEnsureRunningOpts = {}
): Promise<void> {
  const report = opts.report ?? noReport;
  const status = await pveStatus(binding);
  if (status === 'running') return;

  if (status === 'missing') {
    report(`creating ${binding.substrate.sshAlias} as VMID ${binding.vmid}`);
    await createGuest(binding);
  }
  report(`starting VMID ${binding.vmid}`);
  await binding.client.start(binding.vmid);
  await waitForRunning(binding, opts);
}

/** A create that failed, with the precondition no token can satisfy attached. */
export class PveCreateFailedError extends Error {
  readonly snippetRef: string;
  constructor(snippetRef: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      `${detail}\n\n` +
        `Create depends on the cloud-init snippet '${snippetRef}', and no API token can place ` +
        `one — PVE's upload endpoint has no 'snippets' content type. If it is missing or stale, ` +
        `re-run phase 1 on the host:\n` +
        `  bash test-packages/device-testing/substrate/proxmox/bootstrap-pve.sh --pve-host root@<host>`,
      { cause }
    );
    this.name = 'PveCreateFailedError';
    this.snippetRef = snippetRef;
  }
}

/**
 * Create the guest, attaching the precondition it cannot repair itself.
 *
 * Unconditional rather than matched on PVE's wording: create is the only verb
 * that depends on the snippet, so the note is always relevant, and inspecting
 * an error message to decide would break the typed-error rule in
 * `docs/architecture/conventions.md` §3.
 */
async function createGuest(binding: PveBinding): Promise<void> {
  try {
    await binding.client.createGuest(binding.guestSpec);
  } catch (err) {
    throw new PveCreateFailedError(binding.guestSpec.snippetRef, err);
  }
}

/** Stop the guest. No-op when it is already stopped or absent. */
export async function pveStop(
  binding: PveBinding,
  opts: { force?: boolean } = {}
): Promise<PveGuestStatus> {
  const status = await pveStatus(binding);
  if (status !== 'running') return status;
  await binding.client.stop(binding.vmid, opts);
  return 'stopped';
}

/** Destroy the guest, stopping it first if it is running. */
export async function pveDestroy(
  binding: PveBinding,
  opts: { report?: ReportFn } = {}
): Promise<void> {
  const report = opts.report ?? noReport;
  const status = await pveStatus(binding);
  if (status === 'missing') return;
  if (status === 'running') {
    report(`stopping VMID ${binding.vmid} before destroying it`);
    await binding.client.stop(binding.vmid, { force: true });
  }
  await binding.client.destroy(binding.vmid);
}

/** Take (or retake) the provisioning snapshot. */
export async function pveSealSnapshot(binding: PveBinding, description: string): Promise<void> {
  const existing = await binding.client.listSnapshots(binding.vmid);
  if (existing.some((s) => s.name === POST_PROVISION_SNAPSHOT)) {
    await binding.client.deleteSnapshot(binding.vmid, POST_PROVISION_SNAPSHOT);
  }
  await binding.client.snapshot(binding.vmid, POST_PROVISION_SNAPSHOT, description);
}

/** Whether the running guest still matches the committed provisioning inputs. */
export type TemplateHashVerdict =
  /** The sealed hash matches the host sources. */
  | 'match'
  /** They differ — the guest was provisioned from something the repo no longer says. */
  | 'drifted'
  /** Nothing is sealed, so there is no claim to check. */
  | 'unknown';

/** How to recover, and why. */
export type RecoveryStrategy =
  | { readonly action: 'rollback'; readonly snapshot: string; readonly reason: string }
  | { readonly action: 'recreate'; readonly reason: string };

/** Inputs to {@link chooseRecoveryStrategy}. */
export interface ChooseRecoveryInput {
  readonly snapshots: readonly PveSnapshot[];
  readonly templateHash: TemplateHashVerdict;
  readonly snapshotName?: string;
}

/**
 * Choose between rolling back and recreating.
 *
 * A rollback is much the faster repair, but it restores the guest as it was at
 * snapshot time — so when the committed template has moved since, rolling back
 * reinstates the stale box while reporting success. That trap is why the drift
 * verdict outranks the presence of a snapshot.
 */
export function chooseRecoveryStrategy(input: ChooseRecoveryInput): RecoveryStrategy {
  const name = input.snapshotName ?? POST_PROVISION_SNAPSHOT;
  const snapshot = input.snapshots.find((s) => s.name === name);

  if (input.templateHash === 'drifted') {
    return {
      action: 'recreate',
      reason:
        `the committed provisioning inputs have changed since this guest was sealed, so ` +
        `'${name}' would restore the stale box`,
    };
  }
  if (input.templateHash === 'unknown') {
    return {
      action: 'recreate',
      reason: `nothing is sealed in this guest, so there is no provisioning state to roll back to`,
    };
  }
  if (!snapshot) {
    return { action: 'recreate', reason: `this guest has no '${name}' snapshot` };
  }
  return {
    action: 'rollback',
    snapshot: name,
    reason: `'${name}' matches the committed provisioning inputs`,
  };
}

/** Hooks {@link pveRecover} needs from the package that owns provisioning. */
export interface PveRecoverOpts {
  /** Drift verdict for the running guest. */
  readonly templateHash: TemplateHashVerdict;
  /** Apply the substrate contract to a freshly created guest. */
  readonly provision?: (binding: PveBinding) => Promise<void>;
  /** Re-seal the baseline after provisioning. */
  readonly reseal?: (binding: PveBinding) => Promise<void>;
  readonly report?: ReportFn;
}

/** What a recovery did. */
export interface PveRecoverResult {
  readonly strategy: RecoveryStrategy;
  /** Addresses the guest agent reported afterwards, if it answered. */
  readonly addresses: readonly string[];
}

/**
 * Repair a wedged or drifted guest: roll back where that is sound, recreate
 * where it is not.
 *
 * The agent-reported addresses come back with the result because recreating a
 * guest regenerates its SSH host keys. The token cannot read the new key — that
 * is `VM.GuestAgent.Unrestricted`, deliberately not granted — but binding an
 * address to a VMID over an authenticated channel is what it *can* do, and the
 * caller needs it to say something honest about `known_hosts`.
 */
export async function pveRecover(
  binding: PveBinding,
  opts: PveRecoverOpts
): Promise<PveRecoverResult> {
  const report = opts.report ?? noReport;
  const status = await pveStatus(binding);
  const snapshots = status === 'missing' ? [] : await binding.client.listSnapshots(binding.vmid);
  const strategy =
    status === 'missing'
      ? ({ action: 'recreate', reason: 'the guest does not exist' } as const)
      : chooseRecoveryStrategy({ snapshots, templateHash: opts.templateHash });

  report(`${strategy.action}: ${strategy.reason}`);

  if (strategy.action === 'rollback') {
    // PVE will roll a running guest back, but pulling the disk out from under
    // a live kernel is not something to do on purpose. Stopping first makes the
    // operation deterministic, and the disk state is discarded either way.
    if (status === 'running') await binding.client.stop(binding.vmid, { force: true });
    await binding.client.rollback(binding.vmid, strategy.snapshot);
    await binding.client.start(binding.vmid);
  } else {
    await pveDestroy(binding, { report });
    await createGuest(binding);
    await binding.client.start(binding.vmid);
    if (opts.provision) await opts.provision(binding);
    if (opts.reseal) await opts.reseal(binding);
  }

  const addresses = await binding.client.guestAddresses(binding.vmid).catch(() => []);
  return { strategy, addresses };
}
