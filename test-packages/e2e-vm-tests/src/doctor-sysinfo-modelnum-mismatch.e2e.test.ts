/**
 * VM coverage — sysinfo-modelnum-mismatch detect + repair.
 *
 * Pins the end-to-end CLI contract for the TERAPOD-shape mismatch case:
 * the on-disk classic SysInfo file carries a `ModelNumStr` that disagrees
 * with the firmware-derived generation (SIE serial suffix). The check
 * surfaces a `warn` with structured details; `--repair sysinfo-modelnum-mismatch`
 * rewrites the line + writes a `.podkit-backup`; a re-run passes.
 *
 * # Coverage split
 *
 *   - Byte-level repair semantics (backup file presence + content,
 *     ModelNumStr rewrite, skip paths for healthy/unknown/missing files)
 *     are pinned by
 *     `packages/podkit-core/src/diagnostics/checks/sysinfo-modelnum-mismatch.test.ts`.
 *     VM coverage is fully redundant for those.
 *   - This file pins the end-to-end behaviour: the production binary
 *     running inside the device-harness VM, given a FAT32 backing seeded
 *     with the synthesised mismatch state, surfaces the same warn → repair
 *     → pass cycle visible to a user. Verification is "re-run doctor sees
 *     pass" — the unit tests already prove the bytes are correct.
 *
 * # Persona
 *
 * `ipod-video-5g-modelnum-mismatch` mirrors TERAPOD (`0x05ac:0x1209`,
 * V9M-suffix SIE → generation `video_5_5g`) but seeds
 * `iPod_Control/Device/SysInfo` with `ModelNumStr: MA147` (resolves to
 * `video_5g`). The check should flag the disagreement; the repair should
 * rewrite to the canonical ModelNum for `video_5_5g`.
 *
 * @see packages/podkit-core/src/diagnostics/checks/sysinfo-modelnum-mismatch.ts
 * @see test-packages/device-testing/src/personas/ipod-5g-modelnum-mismatch/persona.ts
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
  ipod5gModelnumMismatch,
} from '@podkit/device-testing';

// ---------------------------------------------------------------------------
// Shape interfaces
// ---------------------------------------------------------------------------

interface DoctorCheck {
  id: string;
  scope: 'system' | 'device-readiness' | 'database-health';
  status: 'pass' | 'fail' | 'warn' | 'skip';
  summary: string;
  details?: Record<string, unknown>;
}

interface DeviceDoctorJson {
  success: true;
  status: 'ok' | 'issues-found';
  healthy: boolean;
  deviceType: 'ipod' | 'mass-storage';
  deviceModel: string;
  mountPoint: string;
  checks: DoctorCheck[];
}

interface RepairOutput {
  success: boolean;
  summary: string;
  checkId: string;
  dryRun?: boolean;
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('VM: doctor sysinfo-modelnum-mismatch', () => {
  beforeAll(async () => {
    await limaTestVmRunner.prepare();
  }, VM_COLD_TIMEOUT_MS);

  afterAll(async () => {
    await limaTestVmRunner.teardown();
  }, VM_COLD_TIMEOUT_MS);

  describe(`SystemState: ${healthy.id}`, () => {
    const VM_MOUNT_POINT = '/mnt/podkit-modelnum-mismatch';
    const PERSONA = ipod5gModelnumMismatch;

    beforeAll(async () => {
      await limaTestVmRunner.applyState(healthy);
    }, VM_COLD_TIMEOUT_MS);

    // Daemon + mount + DB bootstrap are shared across the cycle: detect,
    // repair, and re-detect must observe the same backing file. The
    // canonical detect → repair → re-detect cycle therefore runs inside
    // a single `it` block (running the repair without a re-mount is
    // cheaper than per-test isolation, and the unit suite already pins
    // the byte-level mutation).

    beforeAll(async () => {
      try {
        await mountPersona({
          personaId: PERSONA.id,
          vendorId: PERSONA.usbDescriptor.vendorId,
          productId: PERSONA.usbDescriptor.productId,
          mountPoint: VM_MOUNT_POINT,
        });

        // Bootstrap a valid iPod DB on the FAT (writes SysInfo + iTunesDB
        // + dir structure for model MA446 / video_5_5g). gpod-tool is the
        // independent setup tool — libgpod-node reads what gpod-tool
        // writes, so a libgpod-node read/write asymmetry can't false-pass
        // the test.
        const init = await limaTestVmRunner.run(`gpod-tool init ${VM_MOUNT_POINT} --model MA446`, {
          timeoutMs: VM_WARM_TIMEOUT_MS,
        });
        if (init.exitCode !== 0) {
          throw new Error(
            `gpod-tool init failed (exit=${init.exitCode}): ${init.stderr.trim() || init.stdout.trim()}`
          );
        }

        // Overlay the stale ModelNumStr line on the SysInfo file
        // gpod-tool just wrote. This is the canonical TERAPOD-shape edit
        // case: classic SysInfo was rewritten (manually or copied from
        // another iPod) and now points at the wrong model number for the
        // device's firmware identity.
        const seed = await limaTestVmRunner.run(
          `sh -c 'printf "ModelNumStr: MA147\\n" > ${VM_MOUNT_POINT}/iPod_Control/Device/SysInfo'`,
          { timeoutMs: VM_WARM_TIMEOUT_MS }
        );
        if (seed.exitCode !== 0) {
          throw new Error(
            `failed to seed stale SysInfo (exit=${seed.exitCode}): ${seed.stderr.trim()}`
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
      'detect → repair → re-detect: MA147 SysInfo warns, repair rewrites, re-run passes',
      async () => {
        // Diagnostic: surface mount state if doctor produces no parseable JSON.
        const diag = await limaTestVmRunner.run(
          `mount | grep -E '${VM_MOUNT_POINT}' || echo NOT_MOUNTED; ` +
            `ls -la ${VM_MOUNT_POINT}/iPod_Control/Device 2>&1 || echo NO_DEVICE_DIR; ` +
            `cat ${VM_MOUNT_POINT}/iPod_Control/Device/SysInfo 2>&1 || echo NO_SYSINFO`,
          { timeoutMs: VM_WARM_TIMEOUT_MS }
        );

        // 1. Detect — sysinfo-modelnum-mismatch present with warn + structured
        //    details exposing the disagreement.
        const detect = await runJsonCommand(
          limaTestVmRunner,
          `/usr/local/bin/podkit -d ${VM_MOUNT_POINT} doctor --scope device --json`,
          VM_WARM_TIMEOUT_MS
        );
        if (detect.parsed === undefined) {
          throw new Error(
            `detect doctor produced no parseable JSON.\n` +
              `--- diag ---\n${diag.stdout}\n${diag.stderr}\n` +
              `--- detect: exit=${detect.exitCode} ---\n` +
              `stdout: ${detect.stdout}\n` +
              `stderr: ${detect.stderr}\n` +
              `parseError: ${detect.parseError ?? '(none)'}`
          );
        }
        expect(detect.parseError).toBeUndefined();
        const detectParsed = detect.parsed as DeviceDoctorJson;
        expect(detectParsed.success).toBe(true);

        const detectCheck = detectParsed.checks.find((c) => c.id === 'sysinfo-modelnum-mismatch');
        if (!detectCheck) {
          throw new Error(
            `sysinfo-modelnum-mismatch not in checks. full envelope:\n${JSON.stringify(detectParsed, null, 2)}\n--- stderr ---\n${detect.stderr}`
          );
        }
        expect(detectCheck.status).toBe('warn');

        // Structured details pin the contract the CLI consumer / JSON
        // consumer relies on. The check emits both the on-disk value and
        // the firmware-derived truth so downstream tooling can render a
        // useful diff without re-parsing the iPod filesystem.
        const details = detectCheck.details ?? {};
        expect(details).toMatchObject({
          onDiskModelNumStr: 'MA147',
          onDiskGenerationId: 'video_5g',
          firmwareGenerationId: 'video_5_5g',
        });

        // 2. Repair — emits the canonical repair envelope. Byte-level
        //    semantics (backup written, ModelNumStr rewritten) are unit-
        //    pinned; here we pin only the envelope contract.
        const repair = await runJsonCommand(
          limaTestVmRunner,
          `/usr/local/bin/podkit -d ${VM_MOUNT_POINT} doctor --repair sysinfo-modelnum-mismatch --json`,
          VM_WARM_TIMEOUT_MS
        );
        expect(repair.parseError).toBeUndefined();
        const repairParsed = repair.parsed as RepairOutput;
        expect(repairParsed.success).toBe(true);
        expect(repairParsed.checkId).toBe('sysinfo-modelnum-mismatch');
        expect(typeof repairParsed.summary).toBe('string');
        expect(repairParsed.summary.length).toBeGreaterThan(0);

        // 3. Re-detect — the same check now passes (or skips) because the
        //    on-disk ModelNumStr matches the firmware-derived generation.
        //    This is the end-to-end proof that repair mutated the
        //    filesystem and the next read sees the change.
        const recheck = await runJsonCommand(
          limaTestVmRunner,
          `/usr/local/bin/podkit -d ${VM_MOUNT_POINT} doctor --scope device --json`,
          VM_WARM_TIMEOUT_MS
        );
        expect(recheck.parseError).toBeUndefined();
        const recheckParsed = recheck.parsed as DeviceDoctorJson;
        const recheckCheck = recheckParsed.checks.find((c) => c.id === 'sysinfo-modelnum-mismatch');
        expect(recheckCheck?.status).toMatch(/^(pass|skip)$/);
      },
      VM_WARM_TIMEOUT_MS * 3
    );
  });
});
