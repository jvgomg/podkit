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
 * # Known scaffold gap (descriptor handshake)
 *
 * The FunctionFS daemon's descriptor handshake is deferred (the production
 * systemd unit and binary serve VPD page 0xC0 over the gadget's control
 * endpoint, but the *USB host enumeration path* requires descriptors to be
 * published). The VM tests use this fixture to wrap each `it()` body in
 * a daemon lifecycle and assert what works today (well-formed JSON shape,
 * daemon start/stop).
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
    const probe = await runLimactl(subprocess, [
      'shell',
      opts.vmName,
      '--',
      'sh',
      '-c',
      // `ls /dev/sg* 2>/dev/null | head -n1` outputs the first match or
      // nothing. We branch on whether stdout is non-empty.
      'ls /dev/sg* 2>/dev/null | head -n1',
    ]);
    if (probe.exitCode === 0 && probe.stdout.trim().length > 0) return;
    if (Date.now() >= deadline) {
      // Best-effort daemon log dump so the timeout is self-diagnosing.
      // The journalctl call is already at the deadline — paying one more
      // round-trip is cheap compared to making the developer SSH in.
      let daemonLog = '';
      try {
        const log = await runLimactl(subprocess, [
          'shell',
          opts.vmName,
          '--',
          'sudo',
          'journalctl',
          '-u',
          `dummy-hcd-daemon@${opts.personaId}.service`,
          '-n',
          '20',
          '--no-pager',
        ]);
        daemonLog = log.stdout.trim() || log.stderr.trim();
      } catch {
        // Swallow — the timeout message stands on its own.
      }
      const logSuffix = daemonLog
        ? `\n--- dummy-hcd-daemon@${opts.personaId} log (last 20 lines) ---\n${daemonLog}`
        : '';
      throw new Error(
        `withPersona: timed out after ${timeoutMs}ms waiting for /dev/sg* to ` +
          `appear in ${opts.vmName} for persona '${opts.personaId}'. ` +
          `Is the dummy-hcd-daemon binding mass-storage correctly?${logSuffix}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
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
