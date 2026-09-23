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
  type PveBinding,
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
  /** Open an interactive shell. Production callers leave unset. */
  readonly shellFn?: (alias: string) => number;
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

function defaultShell(alias: string): number {
  const result = spawnSync('ssh', [alias], { stdio: 'inherit' });
  if (result.error) throw result.error;
  return result.status ?? 0;
}

/** In-guest path the harness seals its provisioning hash at. */
const BASELINE_VM_HASH_PATH = '/var/lib/podkit-device-harness/baseline-hash';

async function readSealedHash(link: SubstrateLink): Promise<string> {
  const probe = await link.exec(['sh', '-c', `cat ${BASELINE_VM_HASH_PATH} 2>/dev/null || true`]);
  return probe.stdout.trim();
}

/** Compare what the guest was sealed with against what the host sources say. */
export function templateHashVerdict(
  sealed: string,
  expected: string | undefined
): TemplateHashVerdict {
  if (!sealed || !expected) return 'unknown';
  return sealed === expected ? 'match' : 'drifted';
}

/** Print the `qm` a verb would have run, and why it could not run it. */
function reportUnavailable(
  verb: string,
  def: SshVmDefinition,
  unavailable: { reason: string; missing: readonly string[] },
  opts: SshCliOpts
): number {
  const env = opts.env ?? process.env;
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
  const env = opts.env ?? process.env;
  const io = opts.io;
  const linkFor = opts.linkFor ?? ((d: SshVmDefinition) => createSshLink(d));

  if (verb === 'shell') {
    return (opts.shellFn ?? defaultShell)(def.sshAlias);
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
  const reachable = await linkFor(def)
    .exec(['true'])
    .then((r) => r.exitCode === 0)
    .catch(() => false);
  io.log(reachable ? 'running' : 'unreachable');
  return 0;
}

async function cmdInstall(
  def: SshVmDefinition,
  resolved: ReturnType<typeof resolvePveLifecycle>,
  linkFor: (d: SshVmDefinition) => SubstrateLink,
  io: SshCliIo
): Promise<number> {
  const link = linkFor(def);
  const reachable = await link
    .exec(['true'])
    .then((r) => r.exitCode === 0)
    .catch(() => false);
  if (reachable) {
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
  const sealed = await readSealedHash(link).catch(() => '');
  if (!sealed) {
    io.errorLog(
      `[podkit-vm] no sealed baseline hash at ${BASELINE_VM_HASH_PATH} in ${link.description}. ` +
        'Apply the contract and seal it with `bun run harness:setup`.'
    );
    return 1;
  }
  io.log(
    `[podkit-vm] \`${def.id}\` carries a sealed baseline hash (${sealed.slice(0, 12)}...).\n` +
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

async function cmdRecover(
  binding: PveBinding,
  args: readonly string[],
  link: SubstrateLink,
  io: SshCliIo,
  report: (message: string) => void
): Promise<number> {
  // The host-side hash spans packages this one must not depend on, so the
  // caller that can compute it passes it in. Without it the verdict is
  // `unknown`, and `unknown` recreates rather than rolling back.
  const expectIndex = args.indexOf('--expect-hash');
  const expected = expectIndex >= 0 ? args[expectIndex + 1] : undefined;
  const sealed = await readSealedHash(link).catch(() => '');
  const verdict = templateHashVerdict(sealed, expected);

  const result = await pveRecover(binding, { templateHash: verdict, report });
  io.log(
    `[podkit-vm] \`${binding.substrate.id}\` recovered by ${result.strategy.action} ` +
      `(${result.strategy.reason}).`
  );
  if (result.strategy.action === 'recreate') {
    io.log(
      '[podkit-vm] a recreated guest has NEW ssh host keys. The pool token cannot read them ' +
        '(that is VM.GuestAgent.Unrestricted, deliberately not granted), so verify them from ' +
        'the PVE host or its console — see docs/environments/device-substrate-proxmox.md.'
    );
    if (result.addresses.length > 0) {
      io.log(
        `[podkit-vm] the guest agent binds VMID ${binding.vmid} to ${result.addresses.join(', ')}, ` +
          'which rules out an impostor at that address but does not prove the key.'
      );
    }
    io.log('[podkit-vm] re-apply the contract with `bun run harness:setup`.');
  }
  return 0;
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
