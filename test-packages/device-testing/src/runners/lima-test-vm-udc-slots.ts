/**
 * UDC slot accounting for the device-harness VM.
 *
 * Personas are synthesised as USB gadgets bound to emulated device
 * controllers provided by the `dummy_hcd` kernel module, which is loaded with
 * a fixed `num=` (see `/etc/modprobe.d`). That number is a hard budget: a
 * gadget holds its controller for as long as its configfs directory names it
 * in `UDC`, and configfs has no owning process, so a daemon that dies without
 * tearing down leaves its binding in place indefinitely.
 *
 * When the budget runs out the symptom is spectacularly unhelpful. The next
 * daemon cannot bind, so nothing enumerates, so every wait in the harness
 * times out — in whichever test happened to be running, with no mention of
 * controllers anywhere in the message. This module exists to turn that into
 * one line stated up front.
 *
 * # Reading the state correctly
 *
 * `/sys/class/udc/<n>/state` is NOT the signal. On `dummy_hcd` it latches at
 * `configured` the first time any gadget binds and never returns to
 * `not attached`, so a controller that has been cleanly used and released
 * still reads `configured` with no gadget anywhere in configfs. Reading it as
 * occupancy makes every healthy VM look like it is leaking controllers, and
 * the count only ever grows.
 *
 * The authoritative signal is the configfs side: a controller is claimed if
 * and only if some `<gadget>/UDC` file names it. That file IS cleared on
 * unbind. Everything here is derived from that.
 *
 * # Orphans versus concurrent use
 *
 * A claim is an *orphan* when no `dummy-hcd-daemon@<persona>.service` unit is
 * active behind it — the daemon is gone but its binding is not. A claim with a
 * live unit behind it is simply another persona in flight (VM test packages
 * can run concurrently), which is not a fault and must not be reported as one.
 *
 * @see test-packages/device-testing-daemon/src/gadget.ts (the bind/reap side)
 * @module
 */

import { runLimactl, shellQuote } from './lima-limactl.js';
import { defaultSubprocessRunner, type SubprocessRunner } from '../subprocess.js';

/** configfs directory holding the synthesised USB gadgets inside the VM. */
export const CONFIGFS_GADGET_ROOT = '/sys/kernel/config/usb_gadget';

/**
 * Prefix the systemd unit template gives each gadget directory
 * (`--gadget-name podkit-%i`), so `podkit-<personaId>` maps back to
 * `dummy-hcd-daemon@<personaId>.service`.
 *
 * @see test-packages/device-testing-daemon/dummy-hcd-daemon@.service
 */
export const GADGET_NAME_PREFIX = 'podkit-';

/** Wall-clock bound for the in-VM probe. A handful of sysfs reads; never slow. */
export const UDC_SLOT_PROBE_TIMEOUT_MS = 30_000;

/** One gadget holding one device controller. */
export interface UdcClaim {
  /** configfs directory name, e.g. `podkit-ipod-nano-7g-blue`. */
  gadget: string;
  /** Controller it names in its `UDC` file, e.g. `dummy_udc.1`. */
  udc: string;
  /** Persona id derived from the gadget name, when it carries the prefix. */
  personaId: string | null;
  /** Whether a `dummy-hcd-daemon@<persona>.service` unit is active behind it. */
  daemonActive: boolean;
}

/** Snapshot of controller availability inside the VM. */
export interface UdcSlotReport {
  /** Every controller the kernel exposes, sorted. */
  udcs: readonly string[];
  /** `num=` from the `dummy_hcd` modprobe options, when it could be read. */
  configuredSlots: number | null;
  /** Every gadget currently holding a controller. */
  claims: readonly UdcClaim[];
  /** Claims with no live daemon behind them — leaked bindings. */
  orphans: readonly UdcClaim[];
  /** Controllers not named by any gadget. */
  free: readonly string[];
}

/** Options for {@link probeUdcSlots}. */
export interface ProbeUdcSlotsOpts {
  vmName: string;
  subprocess?: SubprocessRunner;
  timeoutMs?: number;
}

/**
 * Shell program run inside the VM. Emits one `key value…` record per line so
 * the host side does no positional parsing of `systemctl` table output:
 *
 *   udc <name>                     — one per controller the kernel exposes
 *   slots <n>                      — `num=` from the dummy_hcd modprobe options
 *   claim <gadget> <udc>           — a gadget whose UDC file is non-empty
 *   active <persona-id>            — a running dummy-hcd-daemon instance
 *
 * Every step is failure-tolerant: a VM with no gadgets, no modprobe config, or
 * no matching units simply emits fewer lines. The probe never exits non-zero
 * for an empty answer, so the caller can treat non-zero as "the probe itself
 * failed" rather than "nothing to report".
 */
const PROBE_SCRIPT = [
  'for u in /sys/class/udc/*; do [ -e "$u" ] && echo "udc $(basename "$u")"; done',
  `grep -ho 'num=[0-9][0-9]*' /etc/modprobe.d/*.conf 2>/dev/null | head -n1 | sed 's/num=/slots /'`,
  `for g in ${shellQuote(CONFIGFS_GADGET_ROOT)}/*; do ` +
    '[ -d "$g" ] || continue; ' +
    'bound=$(cat "$g/UDC" 2>/dev/null); ' +
    '[ -n "$bound" ] && echo "claim $(basename "$g") $bound"; ' +
    'done',
  `systemctl list-units 'dummy-hcd-daemon@*.service' --state=active --no-legend --plain 2>/dev/null | ` +
    `sed -n 's/^dummy-hcd-daemon@\\([^ ]*\\)\\.service .*/active \\1/p'`,
  'exit 0',
].join('\n');

/**
 * Read controller availability out of the VM. One `limactl shell` round trip.
 *
 * Throws only when the probe itself could not run — an empty VM (no gadgets,
 * no daemons) is a perfectly good report with everything free.
 */
export async function probeUdcSlots(opts: ProbeUdcSlotsOpts): Promise<UdcSlotReport> {
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;
  if (!opts.vmName) throw new Error('probeUdcSlots: vmName is required.');

  const result = await runLimactl(
    subprocess,
    ['shell', opts.vmName, '--', 'sh', '-c', PROBE_SCRIPT],
    { timeoutMs: opts.timeoutMs ?? UDC_SLOT_PROBE_TIMEOUT_MS }
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `probeUdcSlots: could not read UDC state in ${opts.vmName}: exit=${result.exitCode}: ` +
        (result.stderr.trim() || result.stdout.trim() || '(no output)')
    );
  }
  return parseUdcSlotProbe(result.stdout);
}

/**
 * Parse the probe's record stream into a report.
 *
 * @internal exported for tests
 */
export function parseUdcSlotProbe(stdout: string): UdcSlotReport {
  const udcs: string[] = [];
  const rawClaims: { gadget: string; udc: string }[] = [];
  const activePersonas = new Set<string>();
  let configuredSlots: number | null = null;

  for (const line of stdout.split('\n')) {
    const parts = line.trim().split(/\s+/);
    const [key, first, second] = parts;
    if (key === 'udc' && first) {
      udcs.push(first);
    } else if (key === 'slots' && first) {
      const parsed = Number.parseInt(first, 10);
      if (Number.isFinite(parsed)) configuredSlots = parsed;
    } else if (key === 'claim' && first && second) {
      rawClaims.push({ gadget: first, udc: second });
    } else if (key === 'active' && first) {
      activePersonas.add(first);
    }
  }

  const claims: UdcClaim[] = rawClaims.map(({ gadget, udc }) => {
    const personaId = gadget.startsWith(GADGET_NAME_PREFIX)
      ? gadget.slice(GADGET_NAME_PREFIX.length)
      : null;
    return {
      gadget,
      udc,
      personaId,
      daemonActive: personaId !== null && activePersonas.has(personaId),
    };
  });

  const claimedUdcs = new Set(claims.map((c) => c.udc));
  return {
    udcs: udcs.slice().sort(),
    configuredSlots,
    claims,
    orphans: claims.filter((c) => !c.daemonActive),
    free: udcs.filter((u) => !claimedUdcs.has(u)).sort(),
  };
}

/**
 * Render the report as a one-line summary suitable for a startup banner.
 */
export function formatUdcSlotSummary(report: UdcSlotReport): string {
  const total = report.udcs.length;
  const orphanNote = report.orphans.length > 0 ? `, ${report.orphans.length} leaked` : '';
  return (
    `dummy_hcd slots: ${report.free.length}/${total} free ` +
    `(${report.claims.length} in use${orphanNote})`
  );
}

/**
 * Describe why the VM cannot bind another gadget, or `null` when it can.
 *
 * Exhaustion is the only hard failure: while a slot remains free the next
 * persona binds normally, and a leaked binding whose persona is started again
 * is reaped by the daemon on its way in. Callers should still surface
 * {@link formatUdcSlotWarning} for leaks below that threshold.
 */
export function formatUdcSlotFailure(report: UdcSlotReport): string | null {
  if (report.udcs.length === 0) {
    return (
      'No USB device controllers exist in the VM — the `dummy_hcd` module is ' +
      'not loaded, so no persona can be synthesised.'
    );
  }
  if (report.free.length > 0) return null;

  const total = report.udcs.length;
  if (report.orphans.length > 0) {
    return (
      `All ${total} dummy_hcd slots are claimed and ${report.orphans.length} of ` +
      `them are leaked — held by a gadget whose daemon is gone:\n` +
      report.orphans.map((o) => `  ${o.udc}  ←  ${o.gadget} (no daemon running)`).join('\n') +
      `\nNo persona can bind until a slot is released. Every wait in the suite ` +
      `would time out with an unrelated-looking message.`
    );
  }
  return (
    `All ${total} dummy_hcd slots are in use by live daemons:\n` +
    report.claims.map((c) => `  ${c.udc}  ←  ${c.gadget}`).join('\n') +
    `\nAnother VM test run is probably in flight against the same VM.`
  );
}

/**
 * Describe leaked bindings that have not yet exhausted the budget, or `null`
 * when there are none. These self-heal the next time their own persona starts,
 * but they are worth naming: a leak is evidence a daemon was killed rather
 * than signalled, which usually means the host is under memory pressure.
 */
export function formatUdcSlotWarning(report: UdcSlotReport): string | null {
  if (report.orphans.length === 0 || report.free.length === 0) return null;
  return (
    `${report.orphans.length} of ${report.udcs.length} dummy_hcd slots are held ` +
    `by gadgets whose daemon is gone (${report.orphans
      .map((o) => `${o.udc}←${o.gadget}`)
      .join(', ')}). ` +
    `They will be released when those personas next start. A daemon that leaves ` +
    `a binding behind was killed rather than asked to stop — check host memory ` +
    `pressure if this keeps happening.`
  );
}

/**
 * Describe a controller count that does not match the module's `num=`, or
 * `null` when it does (or when `num=` could not be read).
 *
 * Reloading the gadget modules by hand can leave a controller failing to
 * re-register, so the VM comes back with fewer slots than it was configured
 * for. That is invisible until the budget runs out sooner than anyone expects.
 */
export function formatUdcSlotShortfall(report: UdcSlotReport): string | null {
  const { configuredSlots } = report;
  if (configuredSlots === null || report.udcs.length >= configuredSlots) return null;
  return (
    `Only ${report.udcs.length} of the ${configuredSlots} configured dummy_hcd ` +
    `slots registered. The VM has permanently fewer slots than it should — ` +
    `rebuild it rather than working around the shortfall.`
  );
}
