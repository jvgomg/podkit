/**
 * VM coverage — doctor SysInfoExtended-related output + readiness.
 *
 * Pins the end-to-end CLI contract for two behaviour rules whose byte-level
 * semantics live in unit tests:
 *
 *   - **failure-copy correctness**: when on-disk SIE fails to parse,
 *     doctor's user-facing output mentions "SysInfoExtended" + a repair
 *     pointer; output does NOT contain the string "artwork database is
 *     out of sync". Unit coverage:
 *     `packages/podkit-core/src/diagnostics/checks/sysinfo-consistency.ts`
 *     + readiness renderer pins.
 *   - **truncated readiness flag**: truncated on-disk SIE → readiness
 *     details report `sysInfoExtendedUnparseable: true`, preserving the
 *     "present but unparseable" signal distinct from "not present". Unit
 *     coverage: `packages/podkit-core/src/diagnostics/checks/malformed-sysinfo.test.ts:60-78`
 *     pins the parser → readiness data shape; this test pins the same
 *     shape surfaced through the production CLI against a real FAT mount.
 *
 * # Deferred coverage (skipped tests below)
 *
 * Two related behaviour rules require successful SCSI VPD page 0xC0
 * inquiry against the FunctionFS-served gadget:
 *
 *   - `--repair sysinfo-consistency` reads the live SIE from USB VPD to
 *     overwrite a stale on-disk copy.
 *   - `--repair sysinfo-extended` against a DB-less iPod queries USB VPD
 *     0xC0 for the SIE payload to write to disk.
 *
 * The harness daemon currently returns SCSI CHECK CONDITION
 * (key=0x5 asc=0x24 INVALID FIELD IN CDB) for VPD page 0xC0 — the
 * "Known scaffold gap" comment in
 * `test-packages/device-testing/src/vm/persona-fixture.ts` and
 * `test-packages/device-testing-daemon/src/protocol.ts`. Both behaviours
 * have authoritative unit coverage:
 *   - `packages/podkit-core/src/diagnostics/checks/sysinfo-consistency-repair.test.ts`
 *   - `packages/podkit-core/src/diagnostics/checks/sysinfo-extended.test.ts:57-66`
 *
 * The `it.skip` blocks below name the scaffold gap and sketch the test
 * body so the work re-lights as soon as the daemon supports VPD 0xC0.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

import {
  limaTestVmRunner,
  VM_COLD_TIMEOUT_MS,
  VM_WARM_TIMEOUT_MS,
  mountPersona,
  unmountAndStop,
  runJsonCommand,
  healthy,
  ipod5gStaleGuid,
} from '@podkit/device-testing';

// ---------------------------------------------------------------------------
// Shape interfaces
// ---------------------------------------------------------------------------

interface ReadinessStage {
  stage: string;
  status: string;
  summary?: string;
  details?: Record<string, unknown>;
}

interface DeviceDoctorJson {
  success: true;
  status: 'ok' | 'issues-found';
  healthy: boolean;
  deviceType: 'ipod' | 'mass-storage';
  deviceModel: string;
  mountPoint: string;
  checks: Array<{
    id: string;
    scope: 'system' | 'device-readiness' | 'database-health';
    status: 'pass' | 'fail' | 'warn' | 'skip';
    summary: string;
    details?: Record<string, unknown>;
  }>;
  readiness?: {
    level: string;
    stages: ReadinessStage[];
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('VM: doctor SysInfoExtended output + readiness', () => {
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

    // ─────────────────────────────────────────────────────────────────────
    // On-disk SIE truncated — pins doctor output + readiness shape.
    //
    // Persona: `ipod-5g-stale-guid` already has a stale GUID overlay; the
    // shape is the same — start from a TERAPOD-clone, mount, gpod-tool
    // init for valid DB structure, then truncate the on-disk SIE to 500
    // bytes (mid-element). The unit suite at `malformed-sysinfo.test.ts`
    // pins the parser behaviour for this exact byte layout.
    // ─────────────────────────────────────────────────────────────────────

    describe('on-disk SIE truncated', () => {
      const VM_MOUNT_POINT = '/mnt/podkit-trunc-sie';
      const PERSONA = ipod5gStaleGuid;

      beforeAll(async () => {
        try {
          await mountPersona({
            personaId: PERSONA.id,
            vendorId: PERSONA.usbDescriptor.vendorId,
            productId: PERSONA.usbDescriptor.productId,
            mountPoint: VM_MOUNT_POINT,
          });

          // Bootstrap canonical SysInfo + iTunesDB so the classic SysInfo
          // stage of readiness passes (firmware identity resolves from
          // SysInfo alone; SIE parse failure is therefore an isolated
          // signal, not an "unknown device" cascade).
          const init = await limaTestVmRunner.run(
            `gpod-tool init ${VM_MOUNT_POINT} --model MA446`,
            { timeoutMs: VM_WARM_TIMEOUT_MS }
          );
          if (init.exitCode !== 0) {
            throw new Error(
              `gpod-tool init failed (exit=${init.exitCode}): ${init.stderr.trim() || init.stdout.trim()}`
            );
          }

          // Truncate the on-disk SIE to 500 bytes. The persona's
          // `initialContent` seeded a full TERAPOD SIE XML (with the
          // `BAADBAADBAADBAAD` GUID overlay); truncation must happen
          // AFTER gpod-tool init, since init does not touch SIE but a
          // future change might. 500 bytes lands mid-element on the SIE
          // XML — the exact failure shape the unit suite pins.
          const truncate = await limaTestVmRunner.run(
            `truncate -s 500 ${VM_MOUNT_POINT}/iPod_Control/Device/SysInfoExtended`,
            { timeoutMs: VM_WARM_TIMEOUT_MS }
          );
          if (truncate.exitCode !== 0) {
            throw new Error(
              `truncate SIE failed (exit=${truncate.exitCode}): ${truncate.stderr.trim()}`
            );
          }
        } catch (err) {
          await unmountAndStop({ personaId: PERSONA.id, mountPoint: VM_MOUNT_POINT });
          throw err;
        }
      }, VM_COLD_TIMEOUT_MS);

      afterAll(async () => {
        await unmountAndStop({ personaId: PERSONA.id, mountPoint: VM_MOUNT_POINT });
      }, VM_COLD_TIMEOUT_MS);

      it(
        'truncated on-disk SIE: readiness stage reports sysInfoExtendedUnparseable: true (preserves the present-but-unparseable signal)',
        async () => {
          const invocation = await runJsonCommand(
            limaTestVmRunner,
            `/usr/local/bin/podkit -d ${VM_MOUNT_POINT} doctor --scope device --json`,
            VM_WARM_TIMEOUT_MS
          );
          if (invocation.parsed === undefined) {
            throw new Error(
              `doctor produced no parseable JSON.\nexit=${invocation.exitCode}\nstdout: ${invocation.stdout}\nstderr: ${invocation.stderr}\nparseError: ${invocation.parseError ?? '(none)'}`
            );
          }
          const parsed = invocation.parsed as DeviceDoctorJson;
          const sysinfoStage = parsed.readiness?.stages.find((s) => s.stage === 'sysinfo');
          if (!sysinfoStage) {
            throw new Error(
              `readiness sysinfo stage missing. envelope:\n${JSON.stringify(parsed, null, 2)}`
            );
          }
          const details = (sysinfoStage.details ?? {}) as Record<string, unknown>;
          // Dump for diagnosis if the discriminant flag is absent — the
          // production rendering depends on this exact field to pick the
          // right human-facing remediation copy.
          if (details.sysInfoExtendedUnparseable !== true) {
            throw new Error(
              `expected details.sysInfoExtendedUnparseable === true but got ${JSON.stringify(details, null, 2)}\n--- full readiness ---\n${JSON.stringify(parsed.readiness, null, 2)}`
            );
          }
          expect(details.sysInfoExtendedUnparseable).toBe(true);
        },
        VM_WARM_TIMEOUT_MS
      );

      it(
        'truncated on-disk SIE: human output names SysInfoExtended; does NOT bleed artwork-database failure copy',
        async () => {
          const result = await limaTestVmRunner.run(
            `/usr/local/bin/podkit -d ${VM_MOUNT_POINT} doctor --scope device`,
            { timeoutMs: VM_WARM_TIMEOUT_MS }
          );

          const haystack = (result.stdout + '\n' + result.stderr).toLowerCase();

          // Output must name SIE so the user can act. Either the
          // long-form name or the short alias counts.
          expect(haystack).toMatch(/sysinfoextended|\bsie\b/i);

          // Output must NOT contain artwork-database failure copy.
          // The bug guarded against was a code path bleeding artwork
          // messaging into the SIE-failure rendering — visible to the
          // user as a misleading remediation pointer.
          expect(haystack).not.toContain('artwork database is out of sync');
        },
        VM_WARM_TIMEOUT_MS
      );
    });

    // ─────────────────────────────────────────────────────────────────────
    // Deferred — daemon SCSI VPD scaffold gap.
    //
    // Both repair surfaces below need `--repair sysinfo-consistency` or
    // `--repair sysinfo-extended` to read live SIE bytes via SCSI VPD
    // page 0xC0. The harness daemon returns CHECK CONDITION
    // (key=0x5 asc=0x24 INVALID FIELD IN CDB) for VPD 0xC0, so the
    // repair path can't fetch USB truth and the test would assert
    // against an "unavailable" repair envelope rather than a real
    // mutation.
    //
    // Authoritative unit coverage pins repair semantics; the gap below
    // is end-to-end CLI surface, blocked on the daemon.
    // ─────────────────────────────────────────────────────────────────────

    it.skip('stale on-disk FireWireGUID: --repair sysinfo-consistency rewrites on-disk SIE from USB truth — BLOCKED on daemon SCSI VPD 0xC0 scaffold', async () => {
      // When the harness daemon serves VPD 0xC0, this test should:
      //   1. mountPersona(ipod5gStaleGuid)
      //   2. gpod-tool init MA446 (readiness ready)
      //   3. detect: `sysinfo-consistency` fail with FireWireGUID detail
      //   4. repair: `--repair sysinfo-consistency` success envelope
      //   5. re-read SIE file, assert FireWireGUID line now matches USB
    });

    it.skip('fresh iPod with no iTunesDB: --repair sysinfo-extended succeeds (no DB-open gate) — BLOCKED on daemon SCSI VPD 0xC0 scaffold', async () => {
      // When the harness daemon serves VPD 0xC0, this test should:
      //   1. mountPersona(ipodVideo5gIflash1tb) (DB-less by design)
      //   2. NO gpod-tool init (proving repair doesn't gate on DB)
      //   3. repair: `--repair sysinfo-extended --json`
      //   4. assert `details.source === 'usb'` (not 'existing' — would
      //      false-pass if persona acquired an SIE overlay later)
      //   5. assert SysInfoExtended file now present at expected path
    });
  });
});
