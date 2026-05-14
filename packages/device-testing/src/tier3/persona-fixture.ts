/**
 * Per-persona Tier-3 fixture helpers.
 *
 * One concern: starting/stopping the dummy-hcd-daemon for a single persona.
 * Tests own persona lifecycle; the setup module owns group lifecycle.
 *
 * Mass-storage backing file staging is NOT done here — call
 * `stageBackingFile()` from the test explicitly when the persona has a
 * `massStorageBackingFile` and the test exercises it.
 *
 * # Known scaffold gap (descriptor handshake)
 *
 * The FunctionFS daemon's descriptor handshake is deferred to TASK-322.05.01.
 * Until it lands:
 *
 *   - `startDaemonForPersona()` succeeds against the systemd unit and the
 *     daemon binary serves VPD page 0xC0 over the gadget's control endpoint…
 *   - …but the *USB host enumeration path* sees nothing, because no
 *     descriptors have been published. `podkit device scan` therefore returns
 *     an empty array.
 *
 * The Tier-3 tests use this fixture to wrap each `it()` body in a daemon
 * lifecycle and assert what works today (well-formed JSON shape, daemon
 * start/stop). The stronger assertions land in TASK-322.05.01 itself —
 * they are NOT scaffolded here as skipped tests.
 *
 * @module
 */

import type { DevicePersona } from '../personas/types.js';
import type { TestRuntime } from '../runtime.js';
import { LIMA_TEST_VM_NAME, startDaemonForPersona, stopDaemon } from '../runners/lima-test-vm.js';
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
 */
export async function withPersona<T>(opts: WithPersonaOpts, body: () => Promise<T>): Promise<T> {
  const vmName = opts.vmName ?? LIMA_TEST_VM_NAME;
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;

  await startDaemonForPersona({
    vmName,
    personaId: opts.persona.id,
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
        `[tier-3] best-effort stopDaemon(${opts.persona.id}) failed: ` +
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
 * Run `command` inside the VM via `runtime.run`. Parses stdout as JSON when
 * the exit code is 0; on parse failure attaches `parseError` so the test
 * failure message includes the underlying reason rather than just
 * "undefined". Never throws on a non-zero exit — the test asserts shape.
 */
export async function runJsonCommand(
  runtime: TestRuntime,
  command: string,
  timeoutMs: number
): Promise<CliInvocation> {
  const result = await runtime.run(command, { timeoutMs });
  let parsed: unknown;
  let parseError: string | undefined;
  if (result.exitCode === 0 && result.stdout.length > 0) {
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
