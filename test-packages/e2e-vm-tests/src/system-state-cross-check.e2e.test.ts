/**
 * VM coverage — SystemState fixture cross-check against `podkit doctor`.
 *
 * Closes the wire ADR-017 §"SystemState schema" implied but never
 * connected: each `SystemState.expectedDoctorSystemOutput` is the golden
 * contract for what `podkit doctor --scope system --json` must emit
 * after the matching `apply-state.sh <id>` has run. Without this test
 * the fixtures are pure documentation — drift (phantom check ids, stale
 * statuses, exit-code shifts) is invisible until a human happens to look.
 *
 * For every entry in `systemStates`, this test:
 *   1. Applies the state via `limaTestVmRunner.applyState(state)`.
 *   2. Runs `podkit doctor --scope system --json` inside the VM.
 *   3. Parses the JSON envelope.
 *   4. Asserts the parsed `checks[]` ids + statuses match the fixture
 *      (order-independent — registry iteration order is a doctor
 *      implementation detail, not a fixture contract).
 *   5. Asserts the doctor exit code matches `state.expectedExitCode`.
 *   6. Restores `healthy` so the next state starts from a known baseline.
 *
 * # Tolerance: id + status strict, summary documentation-only
 *
 * `id` and `status` are the structural contract — a typo or status drift
 * means real behavioural change worth catching. Summaries are prose; they
 * change with every line edit to the check's message strings, and pinning
 * them turns the suite into a maintenance burden without adding signal.
 * We assert each emitted check carries SOME non-empty summary string, but
 * we do NOT compare against the fixture's `summary` field — that field is
 * kept as documentation so a reader of the fixture can see the typical
 * message without rerunning the VM.
 *
 * # `overallStatus` is computed, not parsed
 *
 * The doctor JSON envelope emits `healthy: boolean` + `status: 'ok' |
 * 'issues-found'`; it does NOT emit the 3-way `'healthy' | 'warn' |
 * 'fail'` field the fixture carries. We derive the expected overall from
 * `healthy` (true → 'healthy'; false + any check status === 'fail' →
 * 'fail'; otherwise → 'warn'), then assert against the fixture.
 *
 * # Order-independent diff
 *
 * Registry iteration order is a doctor implementation detail — moving a
 * check earlier in the CHECKS array is not a fixture-breaking change.
 * The assertion compares the SET of (id, status) tuples; if either side
 * has an extra or a mismatched entry, the diff message names the
 * offending id(s) so the failure points straight at the drift.
 *
 * @see adr/adr-017-device-persona-fixtures.md §"SystemState schema"
 * @see test-packages/device-testing/src/system-states/types.ts
 * @module
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

import {
  limaTestVmRunner,
  VM_COLD_TIMEOUT_MS,
  VM_WARM_TIMEOUT_MS,
  runJsonCommand,
  systemStates,
  healthy,
  type SystemState,
} from '@podkit/device-testing';

// ---------------------------------------------------------------------------
// Doctor JSON envelope (subset asserted by this suite)
// ---------------------------------------------------------------------------

interface DoctorCheckJson {
  id: string;
  status: 'pass' | 'warn' | 'fail' | 'skip';
  summary?: string;
  scope?: string;
}
interface SystemDoctorJson {
  success: true;
  status: 'ok' | 'issues-found';
  healthy: boolean;
  scope: 'system';
  checks: DoctorCheckJson[];
}

/**
 * Derive the 3-way `overallStatus` the fixture carries from the doctor
 * envelope's 2-way `healthy` + per-check `status[]`. Matches the
 * fixture's convention:
 *   - healthy true → 'healthy'
 *   - healthy false + any check === 'fail' → 'fail'
 *   - otherwise → 'warn'
 */
function deriveOverallStatus(envelope: SystemDoctorJson): 'healthy' | 'warn' | 'fail' {
  if (envelope.healthy) return 'healthy';
  return envelope.checks.some((c) => c.status === 'fail') ? 'fail' : 'warn';
}

/**
 * Format a check list as a sorted, stable string for diff messages.
 * Stable ordering means a `expect(actual).toEqual(expected)` failure
 * names the drifting id without being distracted by registry-order
 * permutations.
 */
function summariseChecks(checks: ReadonlyArray<{ id: string; status: string }>): string[] {
  return checks
    .map((c) => `${c.id}=${c.status}`)
    .slice()
    .sort();
}

describe('VM: SystemState cross-check', () => {
  beforeAll(async () => {
    await limaTestVmRunner.prepare();
    // Sweep any abandoned `podkit-transcode-<uuid>/` scratch dirs left in
    // `/tmp` by prior suites (pre-sync-sweep.e2e.test.ts SIGKILLs syncs to
    // synthesise debris). The `debris-transcode-tmp` doctor check walks
    // `os.tmpdir()` for abandoned dirs and warns on hits — leftover debris
    // from another suite would flip our fixture's `pass` assertion to
    // `warn` with no real signal. Best-effort: failures here are non-fatal
    // (the cross-check assertion will catch any residual debris loudly).
    await limaTestVmRunner
      .run('rm -rf /tmp/podkit-transcode-* 2>/dev/null || true', {
        timeoutMs: VM_WARM_TIMEOUT_MS,
      })
      .catch(() => {});
  }, VM_COLD_TIMEOUT_MS);

  afterAll(async () => {
    // Leave the VM in `healthy` so subsequent suites have a known
    // baseline rather than inheriting whichever state ran last.
    await limaTestVmRunner.applyState(healthy).catch(() => {});
    await limaTestVmRunner.teardown();
  }, VM_COLD_TIMEOUT_MS);

  // One `describe` per state so per-state failures localise in the
  // bun test output. Iteration order is registry order; the suite does
  // not depend on it.
  for (const state of systemStates.values()) {
    runStateAssertions(state);
  }
});

function runStateAssertions(state: SystemState): void {
  describe(`SystemState: ${state.id}`, () => {
    let envelope: SystemDoctorJson | undefined;
    let observedExitCode: number | undefined;

    beforeAll(async () => {
      // 1. Apply the state. apply-state.sh is idempotent — re-application
      //    of the same state is a no-op, so back-to-back state transitions
      //    are safe to chain.
      await limaTestVmRunner.applyState(state);

      // 2. Run doctor inside the VM and parse the envelope.
      const invocation = await runJsonCommand(
        limaTestVmRunner,
        '/usr/local/bin/podkit doctor --scope system --json',
        VM_WARM_TIMEOUT_MS
      );
      observedExitCode = invocation.exitCode;

      // Parse errors surface in the assertions below so the test
      // failure message includes the raw command output rather than
      // an undefined envelope.
      if (!invocation.parseError && invocation.parsed) {
        envelope = invocation.parsed as SystemDoctorJson;
      }
    }, VM_COLD_TIMEOUT_MS);

    afterAll(async () => {
      // Restore healthy so the next state's beforeAll starts from a
      // clean baseline. apply-state.sh's `healthy` action is
      // idempotent + tears down any loopback-mount provisioning the
      // failing state may have left behind.
      await limaTestVmRunner.applyState(healthy).catch(() => {});
    }, VM_COLD_TIMEOUT_MS);

    it(
      'doctor JSON envelope parsed',
      () => {
        expect(
          envelope,
          'doctor --scope system --json did not produce parseable JSON'
        ).toBeDefined();
      },
      VM_WARM_TIMEOUT_MS
    );

    it(
      `emits the expected (id, status) set: ${summariseChecks(state.expectedDoctorSystemOutput.checks).join(', ')}`,
      () => {
        expect(envelope).toBeDefined();
        if (!envelope) return;
        const observed = summariseChecks(envelope.checks);
        const expected = summariseChecks(state.expectedDoctorSystemOutput.checks);
        expect(observed).toEqual(expected);
      },
      VM_WARM_TIMEOUT_MS
    );

    it(
      'every emitted check carries a non-empty summary string',
      () => {
        expect(envelope).toBeDefined();
        if (!envelope) return;
        // Tolerance: we assert summaries EXIST, not that they match the
        // fixture's prose. Prose drift is too noisy to gate the suite on.
        const missing = envelope.checks.filter(
          (c) => typeof c.summary !== 'string' || c.summary.length === 0
        );
        expect(missing.map((c) => c.id)).toEqual([]);
      },
      VM_WARM_TIMEOUT_MS
    );

    it(
      `overallStatus is ${state.expectedDoctorSystemOutput.overallStatus} (derived from healthy + check statuses)`,
      () => {
        expect(envelope).toBeDefined();
        if (!envelope) return;
        expect(deriveOverallStatus(envelope)).toBe(state.expectedDoctorSystemOutput.overallStatus);
      },
      VM_WARM_TIMEOUT_MS
    );

    it(
      `exit code is ${state.expectedExitCode}`,
      () => {
        expect(observedExitCode).toBe(state.expectedExitCode);
      },
      VM_WARM_TIMEOUT_MS
    );
  });
}
