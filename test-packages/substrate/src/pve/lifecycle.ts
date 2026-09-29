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

/**
 * What a status means for the power verbs.
 *
 * - `executing` — the guest is running.
 * - `halted` — QEMU is up and the vCPUs are not running; `resume` continues it.
 *   It cannot take an ACPI shutdown, and PVE rejects `start` on it.
 * - `wedged` — QEMU is up and the guest is dead. Only a hard stop gets out.
 * - `off` / `absent` — no process; no guest.
 * - `unknown` — nothing here can say, so no verb acts on it.
 */
export type GuestPower = 'executing' | 'halted' | 'wedged' | 'off' | 'absent' | 'unknown';

/** The one mapping every verb branches on, exhaustive so a new status cannot slip past. */
export function guestPower(status: PveGuestStatus): GuestPower {
  switch (status) {
    case 'running':
      return 'executing';
    case 'paused':
    case 'suspended':
    case 'prelaunch':
    case 'io-error':
      return 'halted';
    case 'internal-error':
    case 'guest-panicked':
      return 'wedged';
    case 'stopped':
      return 'off';
    case 'missing':
      return 'absent';
    case 'unknown':
      return 'unknown';
    default: {
      const unhandled: never = status;
      return unhandled;
    }
  }
}

/** A guest in a state a verb will not act on. */
export class PveGuestStateError extends Error {
  readonly vmid: number;
  readonly status: PveGuestStatus;

  constructor(vmid: number, verb: string, status: PveGuestStatus, advice: string) {
    super(`VMID ${vmid} reports '${status}', so ${verb} will not act on it. ${advice}`);
    this.name = 'PveGuestStateError';
    this.vmid = vmid;
    this.status = status;
  }
}

/** Every power state a verb can act on. */
type ActionablePower = Exclude<GuestPower, 'unknown'>;

/** Read the guest's power for `verb`, refusing `unknown` before anything is mutated. */
async function readPower(
  binding: PveBinding,
  verb: string
): Promise<{ status: PveGuestStatus; power: ActionablePower }> {
  const status = await pveStatus(binding);
  const power = guestPower(status);
  if (power === 'unknown') {
    throw new PveGuestStateError(
      binding.vmid,
      verb,
      status,
      `Read what PVE means by it on the host with \`qm status ${binding.vmid} --verbose\` ` +
        `before deciding anything.`
    );
  }
  return { status, power };
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
 * Polls through `off` and `halted` alike: the pool listing trails the power
 * state, so a resumed guest reads `paused` for a while just as a started one
 * reads `stopped`. Anything else ends the wait immediately — a guest that is
 * gone or dead will not come up by being watched.
 */
async function waitForRunning(
  binding: PveBinding,
  opts: PveEnsureRunningOpts
): Promise<PveGuestStatus> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? realSleep;
  const timeoutMs = opts.timeoutMs ?? START_TIMEOUT_MS;
  const deadline = now() + timeoutMs;
  const settling = (s: PveGuestStatus): boolean => {
    const power = guestPower(s);
    return power === 'off' || power === 'halted';
  };

  let status = await pveStatus(binding);
  while (settling(status) && now() < deadline) {
    await sleep(START_POLL_MS);
    status = await pveStatus(binding);
  }
  if (status !== 'running') {
    throw new PveStartTimeoutError(binding.vmid, binding.substrate.sshAlias, timeoutMs, status);
  }
  return status;
}

/**
 * Create the guest if it does not exist, start it if it is stopped, resume it
 * if it is halted, no-op if it is already running. Returns only once the guest
 * reports `running`.
 *
 * A wedged guest is refused rather than restarted: bouncing it would bury the
 * crash that wedged it, and `vm:recover` is the verb that decides what to
 * restore.
 */
export async function pveEnsureRunning(
  binding: PveBinding,
  opts: PveEnsureRunningOpts = {}
): Promise<void> {
  const report = opts.report ?? noReport;
  const { status, power } = await readPower(binding, 'ensure');

  switch (power) {
    case 'executing':
      return;
    case 'absent':
      report(`creating ${binding.substrate.sshAlias} as VMID ${binding.vmid}`);
      await createGuest(binding);
      report(`starting VMID ${binding.vmid}`);
      await binding.client.start(binding.vmid);
      break;
    case 'off':
      report(`starting VMID ${binding.vmid}`);
      await binding.client.start(binding.vmid);
      break;
    case 'halted':
      report(`resuming VMID ${binding.vmid}, which is ${status}`);
      await binding.client.resume(binding.vmid);
      break;
    case 'wedged':
      throw new PveGuestStateError(
        binding.vmid,
        'ensure',
        status,
        `QEMU is up but the guest is not. Repair it with ` +
          `\`bun run vm:recover ${binding.substrate.id}\`.`
      );
    default: {
      const unhandled: never = power;
      throw new Error(`unhandled power state ${String(unhandled)}`);
    }
  }
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

/** Whether QEMU is up, and so has to be stopped before its disk is replaced. */
function hasProcess(power: ActionablePower): boolean {
  return power === 'executing' || power === 'halted' || power === 'wedged';
}

/**
 * Stop the guest. No-op when it is already stopped or absent.
 *
 * Only an executing guest is offered a graceful shutdown: a halted or wedged
 * one is not running the code that would answer it, so the shutdown task would
 * wait out its timeout and fail.
 */
export async function pveStop(
  binding: PveBinding,
  opts: { force?: boolean; report?: ReportFn } = {}
): Promise<PveGuestStatus> {
  const report = opts.report ?? noReport;
  const { status, power } = await readPower(binding, 'stop');
  if (!hasProcess(power)) return status;
  if (power !== 'executing' && !opts.force) {
    report(`VMID ${binding.vmid} is ${status} and cannot take an ACPI shutdown; stopping it hard`);
  }
  await binding.client.stop(binding.vmid, { force: opts.force || power !== 'executing' });
  return 'stopped';
}

/** Destroy the guest, stopping it first if its process is up. */
export async function pveDestroy(
  binding: PveBinding,
  opts: { report?: ReportFn } = {}
): Promise<void> {
  const report = opts.report ?? noReport;
  const { status, power } = await readPower(binding, 'destroy');
  if (power === 'absent') return;
  if (hasProcess(power)) {
    report(`stopping VMID ${binding.vmid} (${status}) before destroying it`);
    await binding.client.stop(binding.vmid, { force: true });
  }
  await binding.client.destroy(binding.vmid);
}

/** What the provisioning snapshot vouches for. */
export interface ProvisionSeal {
  /** The baseline hash sealed in the guest at snapshot time, or `null` for none. */
  readonly baselineHash: string | null;
}

/**
 * The field the provisioning snapshot carries its baseline claim in.
 *
 * The snapshot description rather than the guest's own: it binds the claim to
 * the restore point a rollback would restore, and dies with it.
 */
const BASELINE_FIELD = 'podkit-baseline-hash';
const BASELINE_FIELD_PATTERN = new RegExp(`(?:^|[\\s;])${BASELINE_FIELD}=(\\S+)`);
const FULL_SHA256 = /^[0-9a-f]{64}$/;

/** Whether `value` is a baseline hash as sealed — a full lowercase sha256. */
export function isBaselineHash(value: string): boolean {
  return FULL_SHA256.test(value);
}

function provisionSnapshotDescription(seal: ProvisionSeal): string {
  return `podkit provisioning snapshot; ${BASELINE_FIELD}=${seal.baselineHash ?? 'none'}`;
}

/** A baseline hash that is not one, refused before it reaches the snapshot. */
export class PveBaselineHashFormatError extends Error {
  readonly value: string;
  constructor(value: string) {
    super(
      `refusing to seal '${value}' into '${POST_PROVISION_SNAPSHOT}': a baseline hash is 64 ` +
        `lowercase hex characters, and anything shorter cannot be compared.`
    );
    this.name = 'PveBaselineHashFormatError';
    this.value = value;
  }
}

/**
 * Take (or retake) the provisioning snapshot.
 *
 * Takes the claim, not a description, so every caller writes the one format
 * {@link snapshotHashVerdict} reads.
 */
export async function pveSealSnapshot(binding: PveBinding, seal: ProvisionSeal): Promise<void> {
  if (seal.baselineHash !== null && !isBaselineHash(seal.baselineHash)) {
    throw new PveBaselineHashFormatError(seal.baselineHash);
  }
  const existing = await binding.client.listSnapshots(binding.vmid);
  if (existing.some((s) => s.name === POST_PROVISION_SNAPSHOT)) {
    await binding.client.deleteSnapshot(binding.vmid, POST_PROVISION_SNAPSHOT);
  }
  await binding.client.snapshot(
    binding.vmid,
    POST_PROVISION_SNAPSHOT,
    provisionSnapshotDescription(seal)
  );
}

/** What a snapshot's description says about the baseline. */
type BaselineClaim =
  | { readonly claim: 'hash'; readonly hash: string }
  /** Sealed by a command that knowingly had no hash to record. */
  | { readonly claim: 'none' }
  /** Written by an older podkit, or by hand. */
  | { readonly claim: 'unrecognised' };

function parseBaselineClaim(description: string): BaselineClaim {
  const value = BASELINE_FIELD_PATTERN.exec(description)?.[1];
  if (value === 'none') return { claim: 'none' };
  if (value !== undefined && isBaselineHash(value)) return { claim: 'hash', hash: value };
  return { claim: 'unrecognised' };
}

/** The provisioning snapshot and what its description claims, or `null` if there is none. */
function provisionClaim(
  snapshots: readonly PveSnapshot[]
): { readonly description: string; readonly claim: BaselineClaim } | null {
  const snapshot = snapshots.find((s) => s.name === POST_PROVISION_SNAPSHOT);
  return snapshot
    ? { description: snapshot.description, claim: parseBaselineClaim(snapshot.description) }
    : null;
}

/**
 * Compare the provisioning snapshot's claim against the committed inputs,
 * using nothing but what the API returns — so it answers for a stopped guest.
 *
 * A claim is what the sealing command wrote, not a measurement of the disk: a
 * hand-run `qm snapshot` can make it lie. It is evidence about the restore
 * point, which is what recover chooses between; the running disk stays
 * `vm:doctor`'s to verify. Each way of having no claim is `unknown` with its
 * own reason, and none of them is drift.
 */
export function snapshotHashVerdict(
  snapshots: readonly PveSnapshot[],
  expected: string | undefined
): TemplateHashVerdict {
  const name = POST_PROVISION_SNAPSHOT;
  const found = provisionClaim(snapshots);
  if (!found) {
    return { verdict: 'unknown', because: `there is no '${name}' snapshot to read a claim from` };
  }
  const { claim, description } = found;
  if (claim.claim === 'none') {
    return { verdict: 'unknown', because: `'${name}' was sealed without a baseline hash` };
  }
  if (claim.claim === 'unrecognised') {
    return {
      verdict: 'unknown',
      because:
        `'${name}' carries no ${BASELINE_FIELD} field (its description is '${description}'); ` +
        `re-seal it with \`bun run harness:seal\` to record one`,
    };
  }
  if (!expected) {
    return {
      verdict: 'unknown',
      because: `no expected hash was supplied, so '${name}''s claim had nothing to be compared against`,
    };
  }
  return { verdict: claim.hash === expected ? 'match' : 'drifted' };
}

/**
 * How the provisioning snapshot's claim and the guest's own seal differ, or
 * `null` when they agree or the snapshot claims nothing to hold the seal to.
 *
 * Neither side is preferred here: which one a caller acts on is its own
 * business, and the point of saying so is that neither gets overruled quietly.
 */
export function baselineDisagreement(
  snapshots: readonly PveSnapshot[],
  guestHash: string
): string | null {
  const found = provisionClaim(snapshots);
  if (found?.claim.claim !== 'hash' || found.claim.hash === guestHash) return null;
  return (
    `the provisioning snapshot and the guest disagree: '${POST_PROVISION_SNAPSHOT}' claims ` +
    `${found.claim.hash.slice(0, 12)}..., the guest's seal holds ` +
    `${guestHash ? `${guestHash.slice(0, 12)}...` : 'nothing'}`
  );
}

/**
 * What the comparison against the committed provisioning inputs came to.
 *
 * `absent` is a fact about the guest's disk: it was asked, and carries no
 * claim. `unknown` is the admission that no comparison was possible, and
 * `not-sought` that none was attempted — both carry the reason, so a caller
 * never has to reconstruct one and `'unknown'` can never mean two things at
 * once. Which of these reach the destructive branch, and why that matters, is
 * `docs/architecture/testing/vm-testing.md`.
 */
export type TemplateHashVerdict =
  /** The sealed hash matches the host sources. */
  | { readonly verdict: 'match' }
  /** They differ — the guest was provisioned from something the repo no longer says. */
  | { readonly verdict: 'drifted' }
  /** The guest answered and nothing is sealed in it, so no claim exists. */
  | { readonly verdict: 'absent' }
  /** No comparison could be made. {@link because} says which side was missing. */
  | { readonly verdict: 'unknown'; readonly because: string }
  /** The caller pre-empted the question — an operator asking for a rebuild. */
  | { readonly verdict: 'not-sought'; readonly because: string };

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
 *
 * Every route to `recreate` below names a fact, and a verdict that establishes
 * nothing rolls back instead. The two mistakes are not symmetric; see
 * `docs/architecture/testing/vm-testing.md` for why that orders the branches.
 */
export function chooseRecoveryStrategy(input: ChooseRecoveryInput): RecoveryStrategy {
  const name = input.snapshotName ?? POST_PROVISION_SNAPSHOT;
  const snapshot = input.snapshots.find((s) => s.name === name);
  const hash = input.templateHash;

  if (hash.verdict === 'not-sought') {
    return { action: 'recreate', reason: hash.because };
  }
  if (hash.verdict === 'drifted') {
    return {
      action: 'recreate',
      reason:
        `the committed provisioning inputs have changed since this guest was sealed, so ` +
        `'${name}' would restore the stale box`,
    };
  }
  if (hash.verdict === 'absent') {
    return {
      action: 'recreate',
      reason: `nothing is sealed in this guest, so there is no provisioning state to roll back to`,
    };
  }
  if (!snapshot) {
    const missing = `this guest has no '${name}' snapshot`;
    return {
      action: 'recreate',
      reason: hash.verdict === 'unknown' ? `${hash.because}; ${missing}` : missing,
    };
  }
  if (hash.verdict === 'unknown') {
    return {
      action: 'rollback',
      snapshot: name,
      reason:
        `${hash.because}, so '${name}' is the only evidence available — rolling back rather ` +
        `than rebuilding a guest nothing has shown to be stale. Re-check with \`bun run vm:doctor\``,
    };
  }
  return {
    action: 'rollback',
    snapshot: name,
    reason: `'${name}' matches the committed provisioning inputs`,
  };
}

/** Hooks {@link pveRecover} needs from the package that owns provisioning. */
export interface PveRecoverOpts {
  /** Drift verdict for the guest. */
  readonly templateHash: TemplateHashVerdict;
  /**
   * Wait until the restarted guest answers over ssh, throwing if it never
   * does. Injected rather than built here because this module holds a
   * `PveClient` and no `SubstrateLink`, and that boundary is deliberate
   * (ADR-029 §2).
   *
   * It receives the strategy because the two branches fail differently: a
   * rollback preserves the guest's host keys and a recreate regenerates them,
   * so only the caller, and only when it knows which happened, can say
   * something true about why the box is not answering.
   */
  readonly awaitReady?: (strategy: RecoveryStrategy) => Promise<void>;
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
 * Both branches restart the guest and then hand it to hooks that reach it over
 * ssh, so both go through {@link PveRecoverOpts.awaitReady} first — a started
 * guest is not a reachable one. See `link-ready.ts` for why those are
 * different facts.
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
  const { status, power } = await readPower(binding, 'recover');
  const snapshots = status === 'missing' ? [] : await binding.client.listSnapshots(binding.vmid);
  const strategy =
    status === 'missing'
      ? ({ action: 'recreate', reason: 'the guest does not exist' } as const)
      : chooseRecoveryStrategy({ snapshots, templateHash: opts.templateHash });

  report(`${strategy.action}: ${strategy.reason}`);

  // Pairing these two is the point: every branch that starts the guest owes
  // the caller a guest that answers, and splitting them is how the hooks below
  // ended up racing a boot.
  const startAndWait = async (): Promise<void> => {
    await binding.client.start(binding.vmid);
    if (opts.awaitReady) await opts.awaitReady(strategy);
  };

  if (strategy.action === 'rollback') {
    // PVE stops a live guest itself before rolling it back — paused included,
    // measured — but that is its behaviour, not this verb's contract. Stopping
    // first makes the operation deterministic, and the disk state is discarded
    // either way.
    if (hasProcess(power)) await binding.client.stop(binding.vmid, { force: true });
    await binding.client.rollback(binding.vmid, strategy.snapshot);
    await startAndWait();
  } else {
    await pveDestroy(binding, { report });
    await createGuest(binding);
    await startAndWait();
    if (opts.provision) await opts.provision(binding);
    if (opts.reseal) await opts.reseal(binding);
  }

  const addresses = await binding.client.guestAddresses(binding.vmid).catch(() => []);
  return { strategy, addresses };
}
