/**
 * Per-persona VM fixture helpers.
 *
 * One concern: starting/stopping the dummy-hcd-daemon for a single persona.
 * Tests own persona lifecycle; the setup module owns group lifecycle.
 *
 * Mass-storage backing file staging is NOT done here — call
 * `stageBackingFile()` from the test explicitly when the persona has a
 * `massStorageBackingFile` and the test exercises it.
 *
 * Personas without a daemon payload (`sysInfoExtendedXml === null &&
 * massStorageBackingFile === null`) never reach this fixture: they are
 * filtered at grouping time inside `groupPersonasByState()`. See
 * `vm-runtime-setup.ts#hasDaemonPayload`.
 *
 * # USB + SCSI enumeration waits
 *
 * `systemctl start` returns as soon as the daemon `exec()`s (Type=simple),
 * BEFORE the kernel has enumerated the synthesized gadget. `withPersona`
 * therefore polls the VM after start:
 *
 *   - Every daemon-backed persona publishes a USB descriptor gadget, so we
 *     wait for the persona's `vid:pid` to appear in sysfs (the same source
 *     podkit's Linux USB walk reads; `lsusb` is not installed on the VM).
 *     Without this the body races the ~2-3s kernel enumeration lag and sees
 *     an empty `device scan` — a silent, confusing failure with no daemon log.
 *   - Mass-storage personas additionally wait for `/dev/sg*` (the kernel's
 *     SCSI enumeration lags the USB bind).
 *
 * Both waits dump the daemon journal on timeout so a synthesis failure is
 * self-diagnosing.
 *
 * @module
 */

import type { DevicePersona } from '../personas/types.js';
import type { TestRuntime } from '../runtime.js';
import {
  LIMA_DEVICE_HARNESS_VM_NAME,
  startDaemonForPersona,
  stopDaemon,
} from '../runners/lima-test-vm.js';
import { defaultSubprocessRunner, type SubprocessRunner } from '../subprocess.js';
import { runLimactl } from '../runners/lima-limactl.js';
import {
  formatUdcSlotSummary,
  formatUdcSlotFailure,
  probeUdcSlots,
} from '../runners/lima-test-vm-udc-slots.js';

// ---------------------------------------------------------------------------
// Wall-clock bounds
// ---------------------------------------------------------------------------

/**
 * Bound for a single `limactl shell` probe issued from inside a polling loop.
 *
 * A poll loop that checks its deadline *between* iterations is not bounded at
 * all if one iteration never returns — and `limactl shell` opens an SSH
 * session, which can hang indefinitely when the VM is starved. Each probe is
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

/** Time left on `deadline`, floored so a probe is never given a useless budget. */
function probeTimeout(deadline: number): number {
  return Math.max(PROBE_MIN_TIMEOUT_MS, deadline - Date.now());
}

// ---------------------------------------------------------------------------
// Persona lifecycle
// ---------------------------------------------------------------------------

/** Options for {@link withPersona}. */
export interface WithPersonaOpts {
  persona: DevicePersona;
  vmName?: string;
  subprocess?: SubprocessRunner;
}

/**
 * Start the daemon for `opts.persona`, run `body`, and stop the daemon.
 *
 * The runtime's `applyState()` must have completed for the group before this
 * is called. The teardown step is best-effort: a stop failure does not mask
 * a body-level test failure.
 *
 * For mass-storage personas (those with a `massStorageBackingFile`),
 * `withPersona` polls for `/dev/sg*` to appear in the VM before running
 * `body`. `systemctl start` returns when the unit is `active`, but the
 * kernel's SCSI bus enumeration happens asynchronously after the daemon
 * writes to `<gadget>/UDC`. Skipping this poll causes tests that probe
 * `/dev/sg*` (notably `podkit doctor` and `podkit device scan`) to race
 * the kernel and report "no /dev/sg* nodes" intermittently. The poll
 * deadline is conservative: ~1.6s observed empirically, 5s budget gives
 * plenty of headroom on a slow VM.
 *
 * Pure-FunctionFS personas (no backing file) do not produce `/dev/sg*`
 * and skip the poll.
 */
export async function withPersona<T>(opts: WithPersonaOpts, body: () => Promise<T>): Promise<T> {
  const vmName = opts.vmName ?? LIMA_DEVICE_HARNESS_VM_NAME;
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;

  await startDaemonForPersona({
    vmName,
    personaId: opts.persona.id,
    subprocess,
  });

  // Every daemon-backed persona synthesizes a USB descriptor gadget; wait
  // for it to enumerate on the bus before running the body. `systemctl
  // start` returns at daemon exec() — before the gadget binds — so skipping
  // this races the kernel, and if the gadget never enumerates the body sees
  // a silent empty `device scan` instead of a loud, log-bearing timeout.
  await waitForUsbEnumeration({
    vmName,
    persona: opts.persona,
    subprocess,
  });

  if (opts.persona.massStorageBackingFile !== null) {
    await waitForScsiGenericEnumeration({
      vmName,
      personaId: opts.persona.id,
      subprocess,
    });
  }

  try {
    return await body();
  } finally {
    try {
      await stopDaemon({
        vmName,
        personaId: opts.persona.id,
        subprocess,
      });
    } catch (err) {
      // Stop failure is non-fatal; surface to stderr but do not throw.
      // eslint-disable-next-line no-console
      console.warn(
        `[vm] best-effort stopDaemon(${opts.persona.id}) failed: ` +
          (err instanceof Error ? err.message : String(err))
      );
    }
  }
}

/**
 * Poll for at least one `/dev/sg*` node to appear in the VM. Used by
 * {@link withPersona} after daemon start for mass-storage personas.
 *
 * The poll re-tries every 150 ms up to `timeoutMs` (default 5s). The deadline
 * is generous because the failure mode we're guarding against — kernel SCSI
 * enumeration lag after UDC bind — is bounded by ~1.6s on the test VM, and
 * the cost of waiting an extra second when the daemon is slow is negligible
 * compared to the test that races and falsely reports "no /dev/sg*".
 *
 * Throws on timeout with a descriptive message naming the persona.
 *
 * @internal exported for tests
 */
export async function waitForScsiGenericEnumeration(opts: {
  vmName: string;
  personaId: string;
  subprocess?: SubprocessRunner;
  timeoutMs?: number;
}): Promise<void> {
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const probe = await runLimactl(
      subprocess,
      [
        'shell',
        opts.vmName,
        '--',
        'sh',
        '-c',
        // `ls /dev/sg* 2>/dev/null | head -n1` outputs the first match or
        // nothing. We branch on whether stdout is non-empty.
        'ls /dev/sg* 2>/dev/null | head -n1',
      ],
      { timeoutMs: probeTimeout(deadline) }
    ).catch(() => ({ exitCode: 1, stdout: '', stderr: '' }));
    if (probe.exitCode === 0 && probe.stdout.trim().length > 0) return;
    if (Date.now() >= deadline) {
      const slotSuffix = await udcSlotSuffix(subprocess, opts.vmName);
      const logSuffix = await daemonLogSuffix(subprocess, opts.vmName, opts.personaId);
      throw new Error(
        `withPersona: timed out after ${timeoutMs}ms waiting for /dev/sg* to ` +
          `appear in ${opts.vmName} for persona '${opts.personaId}'. ` +
          `Is the dummy-hcd-daemon binding mass-storage correctly?` +
          `${slotSuffix}${logSuffix}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

/**
 * Poll for the persona's USB descriptor gadget to enumerate — its
 * `vid:pid` appearing in sysfs (`/sys/bus/usb/devices/`), the source
 * podkit's Linux USB walk reads. Called by {@link withPersona} for every
 * persona, since the daemon publishes a USB descriptor gadget regardless
 * of whether the persona also carries a mass-storage backing file.
 *
 * Throws on timeout with the daemon journal appended, so a gadget that
 * binds a UDC but never enumerates is a loud, self-diagnosing failure
 * rather than a silent empty `device scan`.
 *
 * @internal exported for tests
 */
export async function waitForUsbEnumeration(opts: {
  vmName: string;
  persona: DevicePersona;
  subprocess?: SubprocessRunner;
  timeoutMs?: number;
}): Promise<void> {
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;
  const timeoutMs = opts.timeoutMs ?? 5_000;
  const vid = opts.persona.usbDescriptor.vendorId.toString(16).padStart(4, '0');
  const pid = opts.persona.usbDescriptor.productId.toString(16).padStart(4, '0');
  const idPair = `${vid}:${pid}`;
  const deadline = Date.now() + timeoutMs;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const probe = await runLimactl(
      subprocess,
      [
        'shell',
        opts.vmName,
        '--',
        'sh',
        '-c',
        // Match on sysfs — the same source podkit's Linux USB walk reads — not
        // `lsusb`, which is NOT installed on the harness VM. sysfs
        // idVendor/idProduct are lower-case 4-hex with no `0x` prefix, exactly
        // our `vid`/`pid`. Prints `MATCH` when the enumerated device appears.
        `for dir in /sys/bus/usb/devices/*; do ` +
          `[ "$(cat "$dir/idVendor" 2>/dev/null)" = '${vid}' ] || continue; ` +
          `[ "$(cat "$dir/idProduct" 2>/dev/null)" = '${pid}' ] || continue; ` +
          `echo MATCH; break; ` +
          `done`,
      ],
      { timeoutMs: probeTimeout(deadline) }
    ).catch(() => ({ exitCode: 1, stdout: '', stderr: '' }));
    if (probe.exitCode === 0 && probe.stdout.includes('MATCH')) return;
    if (Date.now() >= deadline) {
      const slotSuffix = await udcSlotSuffix(subprocess, opts.vmName);
      const logSuffix = await daemonLogSuffix(subprocess, opts.vmName, opts.persona.id);
      throw new Error(
        `withPersona: timed out after ${timeoutMs}ms waiting for USB device ` +
          `${idPair} to enumerate in ${opts.vmName} for persona ` +
          `'${opts.persona.id}'. The daemon may bind a UDC but never publish ` +
          `FunctionFS descriptors — is the gadget enumerating?` +
          `${slotSuffix}${logSuffix}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

/**
 * Best-effort USB device-controller accounting, formatted as a suffix for an
 * enumeration-timeout error.
 *
 * A gadget that never enumerates is most often a gadget that never got a
 * controller to bind to, and the controller budget is finite. Stating the
 * budget at the point of failure is the difference between "some test timed
 * out" and "there was nowhere left to bind". Returns '' on any error.
 */
async function udcSlotSuffix(subprocess: SubprocessRunner, vmName: string): Promise<string> {
  try {
    const report = await probeUdcSlots({
      vmName,
      subprocess,
      timeoutMs: DAEMON_LOG_TIMEOUT_MS,
    });
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
async function daemonLogSuffix(
  subprocess: SubprocessRunner,
  vmName: string,
  personaId: string
): Promise<string> {
  let daemonLog = '';
  try {
    const log = await runLimactl(
      subprocess,
      [
        'shell',
        vmName,
        '--',
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

// ---------------------------------------------------------------------------
// CLI invocations inside the VM
// ---------------------------------------------------------------------------

/** Result of one VM-side CLI invocation. */
export interface CliInvocation {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  parsed?: unknown;
  /** JSON.parse error message when stdout was non-empty but not valid JSON. */
  parseError?: string;
}

/**
 * Run `command` inside the VM via `runtime.run`. Parses stdout as JSON
 * whenever stdout is non-empty (regardless of exit code) — every podkit
 * CLI surface routes its `--json` envelope through `out.result()` to
 * stdout, including the failure-envelope variant emitted on non-zero
 * exits (e.g. doctor exits 2 when issues are found but still writes a
 * complete `DoctorOutput` JSON; device add exits 1 on error but still
 * writes `{success: false, code, error}`). Gating parse on `exitCode ===
 * 0` would hide that envelope from every test that exercises the failure
 * paths. On parse failure, attaches `parseError` so the test failure
 * message includes the underlying reason rather than just "undefined".
 * Never throws on a non-zero exit — the test asserts shape.
 */
export async function runJsonCommand(
  runtime: TestRuntime,
  command: string,
  timeoutMs: number
): Promise<CliInvocation> {
  const result = await runtime.run(command, { timeoutMs });
  let parsed: unknown;
  let parseError: string | undefined;
  if (result.stdout.length > 0) {
    try {
      parsed = JSON.parse(result.stdout) as unknown;
    } catch (err) {
      parseError = err instanceof Error ? err.message : String(err);
    }
  }
  return {
    command,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
    parsed,
    parseError,
  };
}
