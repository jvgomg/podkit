/**
 * VM coverage — doctor scope refactor + JSON envelope shape.
 *
 * Pins the post-`667d66b` / `679bec8` / `7d7a429` doctor envelope contract:
 *
 *   - `podkit doctor --scope device` expands internally to the two device-
 *     side scopes (`device-readiness` + `database-health`). With no `-d`,
 *     `--scope device` exits non-zero with the dedicated DEVICE_REQUIRED
 *     message (instead of silently running system checks).
 *   - `podkit doctor --scope system --json` emits the 3-way
 *     `scope: 'system' | 'device-readiness' | 'database-health'` on every
 *     `checks[]` entry — never the legacy `'system'|'device'` 2-way or the
 *     additive `category` field that `667d66b` removed.
 *   - `podkit device scan --json` entries that surface an unsupported device
 *     carry the discriminated-union `unsupportedReason` shape (object with
 *     `kind` + `headline`, never a bare string), matching the post-
 *     `01728b3` ReadinessUnsupportedReason contract.
 *
 * # Why this is one file
 *
 * All scenarios are JSON-shape contract tests — "run the same CLI surface,
 * parse stdout, assert keys". Splitting per assertion would triplicate the
 * `applyState(healthy)` cost (~1s per group) for what is effectively one suite.
 *
 * # Scope limitations
 *
 *   - The "richer config round-trip" + "legacy boolean coercion" half lives in
 *     the config loader / writer (`packages/podkit-cli/src/config/`), covered
 *     by the unit-test suite at `packages/podkit-cli/src/config/*.unit.test.ts`.
 *     There is no `podkit config` CLI surface that surfaces the round-tripped
 *     shape over JSON, so a VM cross-check is not meaningful.
 *
 * @see commits 667d66b, 679bec8, 7d7a429
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

import {
  limaTestVmRunner,
  VM_COLD_TIMEOUT_MS,
  VM_WARM_TIMEOUT_MS,
  withPersona,
  runJsonCommand,
  healthy,
  ipodNano7gBlue,
} from '@podkit/device-testing';

// ---------------------------------------------------------------------------
// Type guards — narrow the parsed JSON to the shapes asserted below.
// ---------------------------------------------------------------------------

interface DoctorCheck {
  id: string;
  scope: string;
  category?: string;
  status: string;
}
interface SystemDoctorJson {
  success: true;
  scope: 'system';
  checks: DoctorCheck[];
}

interface DeviceScanEntry {
  usbOnly?: boolean;
  usbDescriptor?: { vendorId?: string };
  unsupportedReason?: { kind?: string; headline?: string } | string;
  readiness?: {
    level: string;
    stages: Array<{ details?: { unsupported?: unknown } }>;
  };
}
interface DeviceScanJson {
  success: true;
  devices: DeviceScanEntry[];
}

describe('VM: doctor scope refactor + JSON shape', () => {
  beforeAll(async () => {
    await limaTestVmRunner.prepare();
  }, VM_COLD_TIMEOUT_MS);

  afterAll(async () => {
    await limaTestVmRunner.teardown();
  }, VM_COLD_TIMEOUT_MS);

  describe(`SystemState: ${healthy.id}`, () => {
    beforeAll(async () => {
      await limaTestVmRunner.applyState(healthy);
    }, VM_COLD_TIMEOUT_MS);

    it(
      'exits DEVICE_REQUIRED when --scope device is requested with no -d',
      async () => {
        const invocation = await runJsonCommand(
          limaTestVmRunner,
          '/usr/local/bin/podkit doctor --scope device --json',
          VM_WARM_TIMEOUT_MS
        );
        // The expansion `device → device-readiness + database-health` requires
        // a resolved device. Without -d, the CLI fails the request with
        // DEVICE_REQUIRED (NOT silently downgrading to system-only or
        // running anything device-bound).
        expect(invocation.exitCode).not.toBe(0);
        expect(invocation.parseError).toBeUndefined();
        const failure = invocation.parsed as {
          success: boolean;
          code?: string;
          error?: string;
        };
        expect(failure.success).toBe(false);
        expect(failure.code).toBe('DEVICE_REQUIRED');
        // The message must name `--scope device` explicitly so the user can
        // diagnose without re-reading the flag matrix docs.
        expect(failure.error).toMatch(/--scope device/);
      },
      VM_WARM_TIMEOUT_MS
    );

    it(
      'emits the new 3-way scope on every checks[] entry, with no legacy `category` field',
      async () => {
        // --scope system avoids device resolution entirely; the checks array
        // is the union of system-scope checks only, but the field shape is
        // what we want to pin (every doctor check, regardless of scope, must
        // declare its 3-way scope and must NOT carry the additive `category`
        // field 667d66b removed).
        const invocation = await runJsonCommand(
          limaTestVmRunner,
          '/usr/local/bin/podkit doctor --scope system --json',
          VM_WARM_TIMEOUT_MS
        );
        // doctor's exit code reflects overall health; we don't care here — we
        // care that the JSON envelope is well-formed even when checks warn.
        expect(invocation.parseError).toBeUndefined();
        const parsed = invocation.parsed as SystemDoctorJson;
        expect(parsed).toMatchObject({ success: true, scope: 'system' });
        expect(Array.isArray(parsed.checks)).toBe(true);
        expect(parsed.checks.length).toBeGreaterThan(0);

        // Every check carries the 3-way scope union.
        const validScopes = new Set(['system', 'device-readiness', 'database-health']);
        for (const check of parsed.checks) {
          expect(validScopes.has(check.scope)).toBe(true);
          // The additive `category` field was removed in 667d66b.
          // Any check that still carries it is a regression.
          expect(check.category).toBeUndefined();
        }

        // System-scope --scope filter must only yield system-scope checks.
        // This is the contract for the `--scope` expansion logic — if it
        // ever leaked database-health checks into a system-only run, this
        // assertion catches it.
        for (const check of parsed.checks) {
          expect(check.scope).toBe('system');
        }
      },
      VM_WARM_TIMEOUT_MS
    );

    it(
      'returns discriminated-union `unsupportedReason` (object, never bare string) in device scan',
      async () => {
        // Drive scan against a hashAB nano 7G — known unsupported. The
        // pre-`01728b3` shape was a bare string at top level; the new shape
        // is `{ kind, headline, docsUrl? }` per ReadinessUnsupportedReason.
        // Both the top-level `unsupportedReason` AND the readiness stage's
        // `details.unsupported` must carry the discriminated payload.
        const invocation = await withPersona({ persona: ipodNano7gBlue }, () =>
          runJsonCommand(
            limaTestVmRunner,
            '/usr/local/bin/podkit device scan --json',
            VM_WARM_TIMEOUT_MS
          )
        );
        expect(invocation.exitCode).toBe(0);
        expect(invocation.parseError).toBeUndefined();
        const parsed = invocation.parsed as DeviceScanJson;
        const nano = parsed.devices.find(
          (d) => d.usbDescriptor?.vendorId?.toLowerCase() === '05ac' && d.usbOnly === true
        );
        expect(nano).toBeDefined();
        // Top-level unsupportedReason is the discriminated object.
        expect(typeof nano!.unsupportedReason).toBe('object');
        expect(nano!.unsupportedReason).not.toBeNull();
        const reason = nano!.unsupportedReason as { kind?: string; headline?: string };
        expect(typeof reason.kind).toBe('string');
        expect(typeof reason.headline).toBe('string');
        expect(reason.headline!.length).toBeGreaterThan(0);
        // The readiness stage's details mirror the same payload
        // (`coerceUnsupportedReason` in `readiness/index.ts`).
        expect(nano!.readiness?.level).toBe('unsupported');
        const usbStage = nano!.readiness?.stages[0];
        expect(usbStage?.details?.unsupported).toBeDefined();
        const stageUnsupported = usbStage!.details!.unsupported as { kind?: string };
        expect(typeof stageUnsupported.kind).toBe('string');
      },
      VM_WARM_TIMEOUT_MS
    );
  });
});
