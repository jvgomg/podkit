/**
 * Gadget-enumeration waits for a persona's dummy-hcd daemon.
 *
 * `systemctl start` on the `Type=simple` daemon unit returns as soon as the
 * daemon `exec()`s — 2-3 seconds before the kernel has finished enumerating
 * the synthesized gadget. Everything in this module exists to close that gap,
 * and {@link startDaemonForPersona} is its only production caller: a started
 * daemon whose gadget is not on the bus is not a useful thing to hand back to
 * anyone, so the wait belongs inside the primitive rather than at each call
 * site.
 *
 * Two enumerations are involved and they complete in order:
 *
 *   - **USB.** Every daemon-backed persona publishes a USB descriptor gadget,
 *     so we wait for the persona's `vid:pid` to appear in sysfs — the same
 *     source podkit's Linux USB walk reads (`lsusb` is not installed on the
 *     harness VM). Without this the caller races the kernel and sees an empty
 *     `device scan`, which reads as a legitimate "no devices" result rather
 *     than as an error.
 *   - **SCSI.** Mass-storage personas additionally surface `/dev/sg*`, which
 *     the kernel creates asynchronously after the USB bind.
 *
 * Both waits dump the daemon journal and the UDC slot budget on timeout, so a
 * gadget that binds a controller but never enumerates is a loud,
 * self-diagnosing failure.
 *
 * This module lives under `runners/` rather than `vm/` to keep the dependency
 * direction one-way: `vm/` composes `runners/`, never the reverse.
 *
 * @module
 */

import type { SubstrateLink } from '@podkit/substrate';

import type { DevicePersona } from '../personas/types.js';
import { deviceSubstrateLink } from './substrate.js';
import {
  formatUdcSlotSummary,
  formatUdcSlotFailure,
  probeUdcSlots,
} from './lima-test-vm-udc-slots.js';

// ---------------------------------------------------------------------------
// Wall-clock bounds
// ---------------------------------------------------------------------------

/**
 * Bound for a single link probe issued from inside a polling loop.
 *
 * A poll loop that checks its deadline *between* iterations is not bounded at
 * all if one iteration never returns — and every link opens an SSH session,
 * which can hang indefinitely when the substrate is starved. Each probe is
 * therefore given the time remaining on the caller's deadline, floored at this
 * value so a probe issued near the deadline still gets a fair chance to answer
 * on a loaded host rather than being cut off mid-handshake.
 */
const PROBE_MIN_TIMEOUT_MS = 2_000;

/**
 * Bound for the best-effort journal dump attached to a timeout message.
 *
 * This runs on a path that has already failed, so it must not be able to add
 * materially to the failure's duration: better a timeout error with no journal
 * than one that takes minutes to arrive.
 */
const DAEMON_LOG_TIMEOUT_MS = 15_000;

/**
 * Default budget for either enumeration wait.
 *
 * Generous relative to what it guards: kernel enumeration lag after UDC bind
 * is ~1.6s on the test VM. The cost of waiting an extra second when the daemon
 * is slow is negligible next to a test that races and falsely reports an empty
 * bus.
 */
export const ENUMERATION_TIMEOUT_MS = 5_000;

/** Time left on `deadline`, floored so a probe is never given a useless budget. */
function probeTimeout(deadline: number): number {
  return Math.max(PROBE_MIN_TIMEOUT_MS, deadline - Date.now());
}

// ---------------------------------------------------------------------------
// Waits
// ---------------------------------------------------------------------------

/**
 * Poll for at least one `/dev/sg*` node to appear in the VM. Called by
 * {@link startDaemonForPersona} for personas carrying a mass-storage backing
 * file; pure-FunctionFS personas produce no SCSI node and skip it.
 *
 * The poll re-tries every 150 ms up to `timeoutMs` (default
 * {@link ENUMERATION_TIMEOUT_MS}). Throws on timeout with a descriptive
 * message naming the persona.
 *
 * @internal exported for tests
 */
export async function waitForScsiGenericEnumeration(opts: {
  link?: SubstrateLink;
  personaId: string;
  timeoutMs?: number;
}): Promise<void> {
  const link = opts.link ?? deviceSubstrateLink();
  const timeoutMs = opts.timeoutMs ?? ENUMERATION_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const probe = await link
      .exec(
        [
          'sh',
          '-c',
          // `ls /dev/sg* 2>/dev/null | head -n1` outputs the first match or
          // nothing. We branch on whether stdout is non-empty.
          'ls /dev/sg* 2>/dev/null | head -n1',
        ],
        { timeoutMs: probeTimeout(deadline) }
      )
      // A link failure mid-poll is absorbed rather than propagated: the
      // substrate may simply be busy binding a gadget, and the deadline below
      // is what decides whether the wait has actually failed.
      .catch(() => ({ exitCode: 1, stdout: '', stderr: '' }));
    if (probe.exitCode === 0 && probe.stdout.trim().length > 0) return;
    if (Date.now() >= deadline) {
      const slotSuffix = await udcSlotSuffix(link);
      const logSuffix = await daemonLogSuffix(link, opts.personaId);
      throw new Error(
        `startDaemonForPersona: timed out after ${timeoutMs}ms waiting for /dev/sg* to ` +
          `appear in ${link.description} for persona '${opts.personaId}'. ` +
          `Is the dummy-hcd-daemon binding mass-storage correctly?` +
          `${slotSuffix}${logSuffix}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

/**
 * Poll for the persona's USB descriptor gadget to enumerate — its `vid:pid`
 * appearing in sysfs (`/sys/bus/usb/devices/`), the source podkit's Linux USB
 * walk reads. Called by {@link startDaemonForPersona} for every persona, since
 * the daemon publishes a USB descriptor gadget regardless of whether the
 * persona also carries a mass-storage backing file.
 *
 * Throws on timeout with the daemon journal appended, so a gadget that binds a
 * UDC but never enumerates is a loud, self-diagnosing failure rather than a
 * silent empty `device scan`.
 *
 * @internal exported for tests
 */
export async function waitForUsbEnumeration(opts: {
  link?: SubstrateLink;
  persona: DevicePersona;
  timeoutMs?: number;
}): Promise<void> {
  const link = opts.link ?? deviceSubstrateLink();
  const timeoutMs = opts.timeoutMs ?? ENUMERATION_TIMEOUT_MS;
  const vid = opts.persona.usbDescriptor.vendorId.toString(16).padStart(4, '0');
  const pid = opts.persona.usbDescriptor.productId.toString(16).padStart(4, '0');
  const idPair = `${vid}:${pid}`;
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const probe = await link
      .exec(
        [
          'sh',
          '-c',
          // Match on sysfs — the same source podkit's Linux USB walk reads — not
          // `lsusb`, which is NOT installed on the substrate. sysfs
          // idVendor/idProduct are lower-case 4-hex with no `0x` prefix,
          // exactly our `vid`/`pid`. Prints `MATCH` when the device appears.
          `for dir in /sys/bus/usb/devices/*; do ` +
            `[ "$(cat "$dir/idVendor" 2>/dev/null)" = '${vid}' ] || continue; ` +
            `[ "$(cat "$dir/idProduct" 2>/dev/null)" = '${pid}' ] || continue; ` +
            `echo MATCH; break; ` +
            `done`,
        ],
        { timeoutMs: probeTimeout(deadline) }
      )
      // See the sibling wait: a link failure mid-poll is the deadline's
      // business, not this iteration's.
      .catch(() => ({ exitCode: 1, stdout: '', stderr: '' }));
    if (probe.exitCode === 0 && probe.stdout.includes('MATCH')) return;
    if (Date.now() >= deadline) {
      const slotSuffix = await udcSlotSuffix(link);
      const logSuffix = await daemonLogSuffix(link, opts.persona.id);
      throw new Error(
        `startDaemonForPersona: timed out after ${timeoutMs}ms waiting for USB device ` +
          `${idPair} to enumerate in ${link.description} for persona ` +
          `'${opts.persona.id}'. The daemon may bind a UDC but never publish ` +
          `FunctionFS descriptors — is the gadget enumerating?` +
          `${slotSuffix}${logSuffix}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

// ---------------------------------------------------------------------------
// Failure context
// ---------------------------------------------------------------------------

/**
 * Best-effort USB device-controller accounting, formatted as a suffix for an
 * enumeration-timeout error.
 *
 * A gadget that never enumerates is most often a gadget that never got a
 * controller to bind to, and the controller budget is finite. Stating the
 * budget at the point of failure is the difference between "some test timed
 * out" and "there was nowhere left to bind". Returns '' on any error.
 */
async function udcSlotSuffix(link: SubstrateLink): Promise<string> {
  try {
    const report = await probeUdcSlots({ link, timeoutMs: DAEMON_LOG_TIMEOUT_MS });
    const failure = formatUdcSlotFailure(report);
    return `\n--- ${formatUdcSlotSummary(report)}${failure ? `\n${failure}` : ''}`;
  } catch {
    // Swallow — the timeout message stands on its own.
    return '';
  }
}

/**
 * Best-effort dump of a persona's dummy-hcd-daemon journal (last 20 lines),
 * formatted as a suffix for an enumeration-timeout error so the failure is
 * self-diagnosing. Returns '' on any error — the timeout message stands on
 * its own.
 */
async function daemonLogSuffix(link: SubstrateLink, personaId: string): Promise<string> {
  let daemonLog = '';
  try {
    const log = await link.exec(
      [
        'sudo',
        'journalctl',
        '-u',
        `dummy-hcd-daemon@${personaId}.service`,
        '-n',
        '20',
        '--no-pager',
      ],
      { timeoutMs: DAEMON_LOG_TIMEOUT_MS }
    );
    daemonLog = log.stdout.trim() || log.stderr.trim();
  } catch {
    // Swallow — the timeout message stands on its own.
  }
  return daemonLog
    ? `\n--- dummy-hcd-daemon@${personaId} log (last 20 lines) ---\n${daemonLog}`
    : '';
}
