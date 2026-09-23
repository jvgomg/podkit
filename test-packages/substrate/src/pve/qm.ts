/**
 * The `qm` command a lifecycle verb would have run, for a machine with no API
 * token configured.
 *
 * doc-060 requires the unconfigured path to stay first-class: a contributor
 * with a hand-built box keeps the same verbs and is handed the equivalent to
 * run themselves rather than an error. Printing it also makes the API path
 * auditable — what the client does is what these lines say.
 *
 * @module
 */

/**
 * Lifecycle verb being explained. Named for what it does to the guest, not for
 * the CLI spelling — `ensure` is `qm start`.
 */
export type QmVerb =
  | 'status'
  | 'start'
  | 'stop'
  | 'destroy'
  | 'recover'
  | 'snapshot'
  | 'rollback'
  | 'unlock';

/** CLI verb to the guest action it performs. */
export const QM_VERB_FOR_CLI_VERB: Readonly<Record<string, QmVerb>> = {
  ensure: 'start',
  start: 'start',
  install: 'start',
  status: 'status',
  stop: 'stop',
  destroy: 'destroy',
  recover: 'recover',
  snapshot: 'snapshot',
  rollback: 'rollback',
  unlock: 'unlock',
};

/** What the rendered commands need to know about the guest. */
export interface QmContext {
  /** VMID, or `null` when this machine has not named one. */
  readonly vmid: number | null;
  /** Guest name — the ssh alias, which is also the snippet basename. */
  readonly guestName: string;
  /** Pool the guest belongs to. */
  readonly pool: string;
  /** Provisioning snapshot name. */
  readonly snapshotName: string;
}

function vmidToken(ctx: QmContext): string {
  return ctx.vmid === null ? '<vmid>' : String(ctx.vmid);
}

/** The `qm` lines equivalent to a verb, to be run as root on the PVE host. */
export function manualQmEquivalent(verb: QmVerb, ctx: QmContext): readonly string[] {
  const vmid = vmidToken(ctx);
  switch (verb) {
    case 'status':
      return [`qm status ${vmid}`];
    case 'start':
      return [`qm start ${vmid}`];
    case 'stop':
      return [`qm shutdown ${vmid}`];
    case 'destroy':
      return [`qm stop ${vmid}`, `qm destroy ${vmid}`];
    case 'snapshot':
      return [`qm snapshot ${vmid} ${ctx.snapshotName}`];
    case 'rollback':
      return [`qm rollback ${vmid} ${ctx.snapshotName}`, `qm start ${vmid}`];
    case 'recover':
      return [
        `qm rollback ${vmid} ${ctx.snapshotName}   # if that snapshot exists`,
        `qm start ${vmid}`,
        '# otherwise recreate from scratch — see docs/environments/device-substrate-proxmox.md §4',
      ];
    case 'unlock':
      // Not a `qm` verb: the run lock lives in the guest, not on the
      // hypervisor, so it is reachable over plain ssh with no token at all.
      return [`ssh ${ctx.guestName} rm -rf /run/lock/podkit-substrate.lock`];
  }
}

/** Options for {@link manualLifecycleNotice}. */
export interface ManualNoticeInput {
  readonly verb: QmVerb;
  readonly context: QmContext;
  /** Registry id of the substrate, for the message. */
  readonly substrateId: string;
  /** Required env keys that are unset. */
  readonly missing: readonly string[];
  /** Whether some PVE keys are set and others are not. */
  readonly partial: boolean;
}

/**
 * The whole message a degraded verb prints: why it is degraded, what to run
 * instead, and how to stop being degraded.
 */
export function manualLifecycleNotice(input: ManualNoticeInput): string {
  const { verb, context, substrateId, missing, partial } = input;
  const lines: string[] = [];

  lines.push(
    partial
      ? `Proxmox lifecycle for '${substrateId}' is half-configured: ${missing.join(', ')} ` +
          `${missing.length === 1 ? 'is' : 'are'} unset while other PODKIT_PVE_* keys are set.`
      : `No Proxmox API token is configured, so '${substrateId}' cannot be lifecycled from here.`
  );
  if (context.vmid === null) {
    lines.push(`This machine also has no VMID for '${substrateId}'. Substitute your own below.`);
  }
  lines.push('', `Run this on the PVE host instead:`);
  for (const command of manualQmEquivalent(verb, context)) lines.push(`  ${command}`);
  lines.push(
    '',
    `To drive it from here, copy .env.example into .env.local and fill in the PODKIT_PVE_* keys;`,
    `test-packages/device-testing/substrate/proxmox/bootstrap-pve.sh produces them.`
  );
  return lines.join('\n');
}
