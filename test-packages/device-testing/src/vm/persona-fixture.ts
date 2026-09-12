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
 * # Enumeration waits
 *
 * `withPersona` does not wait for the gadget itself. `startDaemonForPersona`
 * does not return until the persona has enumerated (see
 * `runners/lima-enumeration.ts`), so by the time `body` runs the bus is
 * populated. This module used to own that wait; it moved into the primitive
 * so direct callers could not bypass it (TASK-504).
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
 * `body` runs against an enumerated bus: `startDaemonForPersona` waits for
 * the persona's gadget before returning, so this fixture does not poll for
 * it. That wait is the primitive's, not the fixture's — see
 * `runners/lima-enumeration.ts`.
 */
export async function withPersona<T>(opts: WithPersonaOpts, body: () => Promise<T>): Promise<T> {
  const vmName = opts.vmName ?? LIMA_DEVICE_HARNESS_VM_NAME;
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;

  await startDaemonForPersona({
    vmName,
    persona: opts.persona,
    subprocess,
  });

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
