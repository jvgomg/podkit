/**
 * The `podkit-vm` verbs for an `ssh`-provisioned substrate.
 *
 * Same verbs as the Lima branch, dispatched on the registry's provisioner
 * discriminator — doc-060 rules out a parallel `substrate:*` family, which is
 * how you end up with two lifecycles that are each 80% correct.
 *
 * This file is glue and printing. The client, the config and the decisions all
 * live in `@podkit/substrate`; nothing Proxmox-shaped is implemented here.
 *
 * Two things work with no API token at all, because they ride the ssh link
 * rather than the hypervisor: `doctor`/`install`/`shell`, and `status`, which
 * can answer `running` on the evidence that the substrate just replied. The
 * rest print the `qm` they would have run and exit non-zero — the state was not
 * reached, and a wrapper that carried on would test a stopped guest.
 *
 * @module
 */

import { spawnSync } from 'node:child_process';

import {
  acquireRemoteLock,
  createSshLink,
  envWithRepoDotfile,
  describeRemoteLockHolder,
  forceReleaseRemoteLock,
  manualLifecycleNotice,
  POST_PROVISION_SNAPSHOT,
  pveDestroy,
  pveEnsureRunning,
  pveRecover,
  pveSealSnapshot,
  pveStatus,
  pveStop,
  qmContextFor,
  type CreatePveClientOpts,
  QM_VERB_FOR_CLI_VERB,
  readRemoteLockHolder,
  resolvePveLifecycle,
  isSubstrateLinkError,
  isSubstrateNotReadyError,
  waitForSubstrateReady,
  type PveBinding,
  type RecoveryStrategy,
  type SubstrateNotReadyError,
  type SshVmDefinition,
  type SubstrateLink,
  type TemplateHashVerdict,
} from '@podkit/substrate';

/** Terminal the verbs write to. Injected so tests capture output. */
export interface SshCliIo {
  log(message: string): void;
  errorLog(message: string): void;
  confirm(prompt: string): Promise<boolean>;
  /** Whether a confirmation prompt can be answered at all. */
  interactive: boolean;
}

/** DI seams for the ssh-substrate verbs. */
export interface SshCliOpts {
  readonly io: SshCliIo;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Build the link to the substrate. Production callers leave unset. */
  readonly linkFor?: (def: SshVmDefinition) => SubstrateLink;
  /** DI seams handed to the PVE client. */
  readonly client?: Omit<CreatePveClientOpts, 'config'>;
}

/** Verbs this branch serves. */
export const SSH_VERBS = [
  'ensure',
  'status',
  'stop',
  'destroy',
  'recover',
  'shell',
  'install',
  'doctor',
  'snapshot',
  'unlock',
] as const;

/** Verbs that need the hypervisor, and therefore a token. */
const LIFECYCLE_VERBS: ReadonlySet<string> = new Set([
  'ensure',
  'stop',
  'destroy',
  'recover',
  'snapshot',
]);

function openShell(alias: string): number {
  const result = spawnSync('ssh', [alias], { stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 0;
}

/** Whether the substrate answers. A reply is the evidence that it is running. */
async function isReachable(link: SubstrateLink): Promise<boolean> {
  return link
    .exec(['true'])
    .then((result) => result.exitCode === 0)
    .catch(() => false);
}

/** In-guest path the harness seals its provisioning hash at. */
const BASELINE_VM_HASH_PATH = '/var/lib/podkit-device-harness/baseline-hash';

/**
 * What a probe for the guest's sealed hash came back with.
 *
 * A guest that answered with an empty file and a guest nobody could reach are
 * not the same fact, and only the first says anything about provisioning.
 */
export type SealedHashRead =
  /** The guest answered. `hash` is empty when nothing is sealed in it. */
  | { readonly read: true; readonly hash: string }
  /** Nobody could ask. `detail` is the link tool's own diagnostic. */
  | { readonly read: false; readonly detail: string };

async function readSealedHash(link: SubstrateLink): Promise<SealedHashRead> {
  try {
    const probe = await link.exec(['sh', '-c', `cat ${BASELINE_VM_HASH_PATH} 2>/dev/null || true`]);
    if (probe.exitCode !== 0) {
      return { read: false, detail: probe.stderr.trim() || `exit=${probe.exitCode}` };
    }
    return { read: true, hash: probe.stdout.trim() };
  } catch (err) {
    return {
      read: false,
      detail: isSubstrateLinkError(err)
        ? err.detail
        : err instanceof Error
          ? err.message
          : String(err),
    };
  }
}

/** Advice attached wherever the host side is the half that is missing. */
const EXPECT_HASH_HINT =
  "no expected hash was supplied (--expect-hash), so the guest's seal had nothing to be " +
  'compared against';

/**
 * Compare what the guest was sealed with against what the host sources say.
 *
 * Every answer other than `match`/`drifted` says which side came up empty,
 * because `recreate` is downstream of this and must not fire on an absence the
 * reader cannot see.
 */
export function templateHashVerdict(
  read: SealedHashRead,
  expected: string | undefined
): TemplateHashVerdict {
  if (!read.read) {
    return {
      verdict: 'unknown',
      because: `the sealed hash at ${BASELINE_VM_HASH_PATH} could not be read (${read.detail})`,
    };
  }
  if (!expected) return { verdict: 'unknown', because: EXPECT_HASH_HINT };
  if (!read.hash) return { verdict: 'absent' };
  return { verdict: read.hash === expected ? 'match' : 'drifted' };
}

/** Print the `qm` a verb would have run, and why it could not run it. */
function reportUnavailable(
  verb: string,
  def: SshVmDefinition,
  unavailable: { reason: string; missing: readonly string[] },
  opts: SshCliOpts
): number {
  const env = opts.env ?? envWithRepoDotfile();
  opts.io.errorLog(
    manualLifecycleNotice({
      verb: QM_VERB_FOR_CLI_VERB[verb] ?? 'status',
      context: qmContextFor(def, env),
      substrateId: def.id,
      missing: unavailable.missing,
      partial: unavailable.reason === 'partial',
    })
  );
  if (unavailable.reason === 'no-vmid') {
    opts.io.errorLog(
      `\nThe API is configured but no guest is named for '${def.id}' on this machine.`
    );
  }
  return 1;
}

/** Run one verb against an `ssh` substrate. */
export async function runSshSubstrateVerb(
  verb: string,
  def: SshVmDefinition,
  args: readonly string[],
  opts: SshCliOpts
): Promise<number> {
  const env = opts.env ?? envWithRepoDotfile();
  const io = opts.io;
  const linkFor = opts.linkFor ?? ((d: SshVmDefinition) => createSshLink(d));

  if (verb === 'shell') {
    return openShell(def.sshAlias);
  }

  if (verb === 'unlock') {
    return cmdUnlock(def, args, linkFor(def), io);
  }

  if (verb === 'doctor') {
    return cmdDoctor(def, linkFor(def), io);
  }

  // A malformed PODKIT_PVE_* value is an operator error, not a crash: report it
  // as one rather than as a stack trace out of a config reader.
  let resolved: ReturnType<typeof resolvePveLifecycle>;
  try {
    resolved = resolvePveLifecycle(def, env, opts.client ? { client: opts.client } : {});
  } catch (err) {
    io.errorLog(`[podkit-vm] ${err instanceof Error ? err.message : String(err)}`);
    return 1;
  }

  if (verb === 'status') {
    return cmdStatus(def, resolved, linkFor, io);
  }
  if (verb === 'install') {
    return cmdInstall(def, resolved, linkFor, io);
  }

  if (!LIFECYCLE_VERBS.has(verb)) {
    io.errorLog(`[podkit-vm] verb '${verb}' is not available for an ssh substrate.`);
    return 1;
  }
  if (!resolved.available) {
    return reportUnavailable(verb, def, resolved, opts);
  }
  const binding = resolved.binding;
  const report = (message: string): void => io.errorLog(`[podkit-vm] ${message}`);

  switch (verb) {
    case 'ensure':
      await pveEnsureRunning(binding, { report });
      io.log(`[podkit-vm] \`${def.id}\` (VMID ${binding.vmid}) is ${await pveStatus(binding)}.`);
      return 0;

    case 'stop': {
      const after = await pveStop(binding, { force: args.includes('--force') });
      io.log(`[podkit-vm] \`${def.id}\` (VMID ${binding.vmid}) is ${after}.`);
      return 0;
    }

    case 'destroy':
      return cmdDestroy(binding, args, io, report);

    case 'snapshot':
      await pveSealSnapshot(binding, 'podkit: substrate contract applied');
      io.log(`[podkit-vm] sealed snapshot '${POST_PROVISION_SNAPSHOT}' on VMID ${binding.vmid}.`);
      return 0;

    case 'recover':
      return cmdRecover(binding, args, linkFor(def), io, report);

    default:
      io.errorLog(`[podkit-vm] unhandled verb '${verb}'.`);
      return 1;
  }
}

async function cmdStatus(
  def: SshVmDefinition,
  resolved: ReturnType<typeof resolvePveLifecycle>,
  linkFor: (d: SshVmDefinition) => SubstrateLink,
  io: SshCliIo
): Promise<number> {
  if (resolved.available) {
    io.log(await pveStatus(resolved.binding));
    return 0;
  }
  // No token, but a substrate that answers is a substrate that is running.
  // That is an observation, not a guess, so it is a legitimate answer.
  io.log((await isReachable(linkFor(def))) ? 'running' : 'unreachable');
  return 0;
}

async function cmdInstall(
  def: SshVmDefinition,
  resolved: ReturnType<typeof resolvePveLifecycle>,
  linkFor: (d: SshVmDefinition) => SubstrateLink,
  io: SshCliIo
): Promise<number> {
  const link = linkFor(def);
  if (await isReachable(link)) {
    io.log(
      `[podkit-vm] ${link.description} is reachable. Device-specific binaries + systemd units ` +
        'are staged by the device-testing harness (`bun run harness:install`).'
    );
    return 0;
  }
  if (!resolved.available) {
    io.errorLog(
      `[podkit-vm] ${link.description} is unreachable and no Proxmox token is configured, ` +
        'so it cannot be started from here.'
    );
    return 1;
  }
  await pveEnsureRunning(resolved.binding, { report: (m) => io.errorLog(`[podkit-vm] ${m}`) });
  io.log(`[podkit-vm] \`${def.id}\` started. Re-run once sshd is answering.`);
  return 0;
}

async function cmdDoctor(def: SshVmDefinition, link: SubstrateLink, io: SshCliIo): Promise<number> {
  if (!def.trackedForBaseline) {
    io.log(`[podkit-vm] \`${def.id}\` is not baseline-tracked. Nothing to check.`);
    return 0;
  }
  const sealed = await readSealedHash(link);
  if (!sealed.read) {
    io.errorLog(
      `[podkit-vm] could not read ${BASELINE_VM_HASH_PATH} in ${link.description} ` +
        `(${sealed.detail}). That is a fact about the link, not about the guest — start it ` +
        `with \`bun run vm:up ${def.id}\` before concluding anything about its baseline.`
    );
    return 1;
  }
  if (!sealed.hash) {
    io.errorLog(
      `[podkit-vm] no sealed baseline hash at ${BASELINE_VM_HASH_PATH} in ${link.description}. ` +
        'Apply the contract and seal it with `bun run harness:setup`.'
    );
    return 1;
  }
  io.log(
    `[podkit-vm] \`${def.id}\` carries a sealed baseline hash (${sealed.hash.slice(0, 12)}...).\n` +
      '[podkit-vm] Run `bun run vm:doctor` to compare it against the host sources.'
  );
  return 0;
}

async function cmdDestroy(
  binding: PveBinding,
  args: readonly string[],
  io: SshCliIo,
  report: (message: string) => void
): Promise<number> {
  const status = await pveStatus(binding);
  if (status === 'missing') {
    io.log(
      `[podkit-vm] VMID ${binding.vmid} is not in pool '${binding.config.pool}'. Nothing to do.`
    );
    return 0;
  }
  if (!args.includes('--yes')) {
    if (!io.interactive) {
      io.errorLog(
        `[podkit-vm] refusing to destroy VMID ${binding.vmid} non-interactively. Pass --yes.`
      );
      return 1;
    }
    const confirmed = await io.confirm(
      `About to DESTROY Proxmox guest ${binding.vmid} ` +
        `(${binding.substrate.sshAlias}, status: ${status}). This deletes its disks. Continue? [y/N] `
    );
    if (!confirmed) {
      io.log('[podkit-vm] aborted.');
      return 0;
    }
  }
  await pveDestroy(binding, { report });
  io.log(`[podkit-vm] VMID ${binding.vmid} destroyed.`);
  return 0;
}

/**
 * Establish what the guest was sealed with, or say why that was not possible.
 *
 * The status read comes FIRST and over the API, which answers for a stopped
 * guest. Reaching for the link before knowing the guest is up measures the
 * power state and reports it as a fact about the disk — and `recreate` is
 * downstream.
 */
async function establishTemplateHash(
  binding: PveBinding,
  link: SubstrateLink,
  expected: string | undefined
): Promise<TemplateHashVerdict> {
  const status = await pveStatus(binding);
  if (status !== 'running') {
    return {
      verdict: 'unknown',
      because:
        `VMID ${binding.vmid} is ${status}, so its sealed hash could not be read over ` +
        link.description,
    };
  }
  return templateHashVerdict(await readSealedHash(link), expected);
}

async function cmdRecover(
  binding: PveBinding,
  args: readonly string[],
  link: SubstrateLink,
  io: SshCliIo,
  report: (message: string) => void
): Promise<number> {
  // The host-side hash spans packages this one must not depend on, so the
  // caller that can compute it passes it in — see `scripts/vm-recover.ts` in
  // `@podkit/device-testing`. Without it nothing can be compared, and a
  // comparison that did not happen is not evidence of drift.
  const expectIndex = args.indexOf('--expect-hash');
  const expected = expectIndex >= 0 ? args[expectIndex + 1] : undefined;
  // Nothing is asked of a guest that is about to be deleted, so the request
  // itself is what the strategy is chosen on.
  const verdict: TemplateHashVerdict = args.includes('--recreate')
    ? { verdict: 'not-sought', because: 'the operator asked for a rebuild with --recreate' }
    : await establishTemplateHash(binding, link, expected);

  // The hook THROWS, so nothing downstream of it runs against a guest that
  // never answered. The strategy is captured on the way past because the two
  // branches fail differently, and the failure path has to say which happened.
  const attempt: { strategy?: RecoveryStrategy } = {};
  try {
    const result = await pveRecover(binding, {
      templateHash: verdict,
      report,
      awaitReady: async (strategy) => {
        attempt.strategy = strategy;
        await waitForSubstrateReady(link, { report });
      },
    });
    io.log(
      `[podkit-vm] \`${binding.substrate.id}\` recovered by ${result.strategy.action} ` +
        `(${result.strategy.reason}).`
    );
    if (result.strategy.action === 'recreate') {
      reportNewHostKeys(binding, result.addresses, io);
    }
    return 0;
  } catch (err) {
    if (!isSubstrateNotReadyError(err)) throw err;
    return reportNotReady(binding, attempt.strategy, err, io);
  }
}

/**
 * What a recreate leaves the operator to do by hand.
 *
 * Printed on both the success and the failure path, because a recreate whose
 * readiness wait failed is the case this text was written for — suppressing it
 * there would withhold the explanation exactly when it is needed.
 */
function reportNewHostKeys(binding: PveBinding, addresses: readonly string[], io: SshCliIo): void {
  io.log(
    '[podkit-vm] a recreated guest has NEW ssh host keys. The pool token cannot read them ' +
      '(that is VM.GuestAgent.Unrestricted, deliberately not granted), so verify them from ' +
      'the PVE host or its console — see docs/environments/device-substrate-proxmox.md.'
  );
  if (addresses.length > 0) {
    io.log(
      `[podkit-vm] the guest agent binds VMID ${binding.vmid} to ${addresses.join(', ')}, ` +
        'which rules out an impostor at that address but does not prove the key.'
    );
  }
  io.log('[podkit-vm] re-apply the contract with `bun run harness:setup`.');
}

/**
 * Report a recovery whose guest never came back, and decide what that is worth
 * as an exit code.
 *
 * A **recreate** that ends in a refusal waiting cannot fix is the documented,
 * expected outcome: new host keys make `known_hosts` stale, and the guidance
 * above is the manual step that finishes the job. That exits zero, as it did
 * before there was a wait at all. Everything else — a rollback that did not
 * come back, either branch that ran out the bound — is a substrate nothing can
 * use, and says so with a non-zero exit.
 */
async function reportNotReady(
  binding: PveBinding,
  strategy: RecoveryStrategy | undefined,
  err: SubstrateNotReadyError,
  io: SshCliIo
): Promise<number> {
  const recreated = strategy?.action === 'recreate';
  io.log(
    `[podkit-vm] \`${binding.substrate.id}\` ${strategy?.action ?? 'recovery'} completed, but ` +
      'the substrate did not answer afterwards.'
  );
  if (recreated) {
    const addresses = await binding.client.guestAddresses(binding.vmid).catch(() => []);
    reportNewHostKeys(binding, addresses, io);
  }
  io.errorLog(`[podkit-vm] ${err.message}`);
  return recreated && err.reason === 'refused' ? 0 : 1;
}

async function cmdUnlock(
  def: SshVmDefinition,
  args: readonly string[],
  link: SubstrateLink,
  io: SshCliIo
): Promise<number> {
  const holder = await readRemoteLockHolder(link);
  if (!holder) {
    io.log(`[podkit-vm] ${link.description} is not locked.`);
    return 0;
  }
  if (!args.includes('--force')) {
    io.errorLog(
      `[podkit-vm] ${link.description} is locked by ${describeRemoteLockHolder(holder)}.\n` +
        '[podkit-vm] Breaking a lock a live run holds will interleave its state with yours. ' +
        'Pass --force once you know that run is gone.'
    );
    return 1;
  }
  const displaced = await forceReleaseRemoteLock(link);
  io.log(`[podkit-vm] broke the lock held by ${describeRemoteLockHolder(displaced)}.`);
  return 0;
}

/** Hold the substrate for the duration of `fn`. Re-exported for wrappers. */
export { acquireRemoteLock };
