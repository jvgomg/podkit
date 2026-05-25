/**
 * VM coverage — `podkit doctor` consistent sections.
 *
 * Pins the post-`78b0c71` (+ `667d66b` cleanup) renderer contract:
 *
 *   - `--scope system` runs ONLY system-scope checks; no device resolution
 *     is attempted; only the System section renders. iPod-only system
 *     checks (notably `inquiry-methods`, filtered via `applicableTo:
 *     ['ipod']`) still apply because the system scope is host-environment.
 *   - `--scope device` without `-d` exits non-zero with DEVICE_REQUIRED
 *     (the JSON envelope side lives in `doctor-scope-refactor.e2e.test.ts`).
 *   - `--no-system` without `-d` exits non-zero with DEVICE_NOT_RESOLVED
 *     (the renderer never reaches "render device sections only" without a
 *     resolved device).
 *   - System-scope text output uses the "System" heading (the System section
 *     is one of three the renderer can emit; the other two — "Device
 *     Readiness" + "Database Health" — only appear when device context is
 *     resolved). This pins the consistent-section ordering.
 *
 * # Scope limitations
 *
 * The "iPod doctor → 3 sections" and "Echo Mini doctor → 2 sections (no
 * empty Device Readiness)" scenarios from the AC require a fully-resolved
 * device with a mounted filesystem holding an iTunesDB. The persona-side
 * starter images are bare FAT32 — `podkit doctor -d <name>` against them
 * currently fails before reaching the grouped-section renderer. Wiring
 * `gpod-tool init` (now always present in the harness VM — installed by
 * `bun run harness:install` via `@podkit/gpod-testing#build:linux-binary`)
 * into the persona seeding step is the follow-up work that unblocks the
 * full per-device-type assertion here.
 *
 * The full per-device-type 3-section vs 2-section assertion is covered
 * unit-side by `packages/podkit-cli/src/commands/doctor-grouped-render.
 * test.ts`, which drives `printGroupedChecks` with synthetic
 * `DiagnosticCheck[]` arrays — that test is the authoritative cover for
 * the renderer matrix. VM's value-add is the surface-level
 * `--scope system` / `--scope device` / `--no-system` flag-routing
 * verified end-to-end against the real CLI binary in a real Linux
 * environment.
 *
 * @see commit 78b0c71 (introduction), 667d66b (scope union cleanup)
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

import {
  limaTestVmRunner,
  VM_COLD_TIMEOUT_MS,
  VM_WARM_TIMEOUT_MS,
  runJsonCommand,
  healthy,
} from '@podkit/device-testing';

describe('VM: doctor consistent sections', () => {
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
      '--scope system renders ONLY the System section (text mode)',
      async () => {
        // Text-mode invocation — the text renderer is what the AC's
        // section-ordering contract speaks about. JSON envelope is asserted
        // in `doctor-scope-refactor.e2e.test.ts`.
        const result = await limaTestVmRunner.run('/usr/local/bin/podkit doctor --scope system', {
          timeoutMs: VM_WARM_TIMEOUT_MS,
        });

        // Exit code reflects system health (0 = healthy, 2 = issues-found);
        // we don't care which here — we care about the section structure.
        expect([0, 2]).toContain(result.exitCode);

        // The System heading must appear.
        expect(result.stdout).toMatch(/^System$/m);

        // Device-section headings must NOT appear under --scope system.
        // The renderer emits "Device Readiness" + "Database Health" only
        // when a device is resolved; --scope system bypasses device
        // resolution entirely.
        expect(result.stdout).not.toMatch(/^Device Readiness$/m);
        expect(result.stdout).not.toMatch(/^Database Health$/m);
      },
      VM_WARM_TIMEOUT_MS
    );

    it(
      '--scope system --json carries scope: "system" envelope (no device fields)',
      async () => {
        // Cross-check the system-scope envelope shape: it must be the
        // SystemDoctorOutput variant (`scope: 'system'`), not the device-
        // bound DoctorOutput variant (which carries mountPoint /
        // deviceModel / readiness). The distinct envelope allows the renderer
        // to branch cleanly between system-only and device-bound output.
        const invocation = await runJsonCommand(
          limaTestVmRunner,
          '/usr/local/bin/podkit doctor --scope system --json',
          VM_WARM_TIMEOUT_MS
        );
        expect(invocation.parseError).toBeUndefined();
        const parsed = invocation.parsed as {
          success: true;
          scope: 'system';
          checks: Array<{ scope: string }>;
          // Fields that MUST NOT appear on the system-scope envelope:
          mountPoint?: unknown;
          deviceModel?: unknown;
          deviceType?: unknown;
          readiness?: unknown;
        };
        expect(parsed).toMatchObject({ success: true, scope: 'system' });
        expect(parsed.mountPoint).toBeUndefined();
        expect(parsed.deviceModel).toBeUndefined();
        expect(parsed.deviceType).toBeUndefined();
        expect(parsed.readiness).toBeUndefined();
      },
      VM_WARM_TIMEOUT_MS
    );

    it(
      '--scope device with no -d exits DEVICE_REQUIRED (no fallback to system-only)',
      async () => {
        const invocation = await runJsonCommand(
          limaTestVmRunner,
          '/usr/local/bin/podkit doctor --scope device --json',
          VM_WARM_TIMEOUT_MS
        );
        // Must fail — never silently downgrade to a partial run.
        expect(invocation.exitCode).not.toBe(0);
        expect(invocation.parseError).toBeUndefined();
        const failure = invocation.parsed as {
          success: boolean;
          code?: string;
          error?: string;
        };
        expect(failure.success).toBe(false);
        expect(failure.code).toBe('DEVICE_REQUIRED');
        // The error message must name the flag so the user can diagnose.
        expect(failure.error).toMatch(/--scope device/);
      },
      VM_WARM_TIMEOUT_MS
    );

    it(
      '--no-system with no -d exits DEVICE_NOT_RESOLVED (--no-system requires a device)',
      async () => {
        // --no-system asks the renderer to skip the System section, leaving
        // only device-bound sections. With no -d configured, the resolver
        // surfaces DEVICE_NOT_RESOLVED — the renderer never reaches the
        // device sections without a device. Pins "--no-system doesn't silently
        // produce an empty report".
        const invocation = await runJsonCommand(
          limaTestVmRunner,
          '/usr/local/bin/podkit doctor --no-system --json',
          VM_WARM_TIMEOUT_MS
        );
        expect(invocation.exitCode).not.toBe(0);
        expect(invocation.parseError).toBeUndefined();
        const failure = invocation.parsed as {
          success: boolean;
          code?: string;
        };
        expect(failure.success).toBe(false);
        // DEVICE_NOT_RESOLVED or DEVICE_REQUIRED depending on whether any
        // device is configured — both are valid "no device available" exits.
        expect(failure.code).toBeDefined();
        expect(['DEVICE_NOT_RESOLVED', 'DEVICE_REQUIRED']).toContain(failure.code!);
      },
      VM_WARM_TIMEOUT_MS
    );

    it(
      'inquiry-methods system check declares applicableTo: ipod (filters out on non-iPod hosts)',
      async () => {
        // `inquiry-methods` is declared `applicableTo: ['ipod']` so an Echo
        // Mini doctor run does NOT surface "iPod Firmware Inquiry Methods" —
        // the check is iPod-specific (it probes SCSI VPD + USB control
        // transfers Apple-only). In a system-scope run the check is always
        // evaluated (host environment, not device-bound), so we assert it
        // appears here. The negative-side coverage (Echo Mini doctor omitting
        // it) is in the unit suite `doctor-grouped-render.test.ts` because
        // VM can't drive a mounted mass-storage `doctor -d` flow today.
        const invocation = await runJsonCommand(
          limaTestVmRunner,
          '/usr/local/bin/podkit doctor --scope system --json',
          VM_WARM_TIMEOUT_MS
        );
        const parsed = invocation.parsed as {
          checks: Array<{ id: string; scope: string }>;
        };
        const inquiry = parsed.checks.find((c) => c.id === 'inquiry-methods');
        expect(inquiry).toBeDefined();
        expect(inquiry?.scope).toBe('system');
      },
      VM_WARM_TIMEOUT_MS
    );
  });
});
