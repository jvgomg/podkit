/**
 * VM coverage — `device add --no-verify` (trust-disk tier).
 *
 * The trust-disk tier (`--no-verify`) skips the live SCSI/USB cross-check and
 * the SysInfoExtended write, trusting whatever identity is on disk. doc-045
 * tightened it so it *requires* a ready on-disk identity: a checksum-based
 * generation with no on-disk SysInfoExtended must refuse with a "run
 * `podkit doctor`" remediation hint rather than persist an unsyncable row.
 *
 * Two persona-backed cases, both against a real mounted FAT32 (real filesystem
 * UUID, so the no-UUID gate — covered in `volume-uuid-defensive.e2e.test.ts` —
 * passes and we reach the identity-store policy):
 *
 *   1. SysInfo present, non-checksum generation → add SUCCEEDS with
 *      `verification: 'trusted-disk'`. A 5G Video (`checksumType: 'none'`)
 *      seeded on disk via `gpod-tool init --model MA147`: the model resolves
 *      from the on-disk classic SysInfo and no SysInfoExtended is required.
 *
 *   2. SysInfo resolves a checksum generation but SysInfoExtended is absent →
 *      add ERRORS with the "run `podkit doctor`" hint. `gpod-tool init --model
 *      MB147` writes a classic SysInfo whose ModelNumStr resolves to an
 *      iPod Classic 6G (`checksumType: 'hash58'`), so the identity store
 *      (SysInfoExtended) is *required* but missing — exactly M4's
 *      `error-missing-sysinfo` outcome.
 *
 * The M4 policy matrix itself is pinned exhaustively (no I/O) in
 * `packages/podkit-cli/src/commands/device/verification-policy.test.ts`; this
 * file is the end-to-end proof that the production binary + real FAT32 backing
 * reach those outcomes.
 *
 * @see packages/podkit-cli/src/commands/device/verification-policy.ts (error-missing-sysinfo)
 * @see test-packages/e2e-vm-tests/src/doctor-sysinfo-repair.e2e.test.ts (mountPersona + gpod-tool init pattern)
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
  ipodVideo5gIflash1tb,
} from '@podkit/device-testing';

interface AddSuccessJson {
  success: true;
  verification?: 'verified' | 'trusted-disk' | 'config-only';
  device?: { volumeUuid?: string; modelName?: string };
}

interface AddFailureJson {
  success: false;
  code?: string;
  error?: string;
}

describe('VM: device add --no-verify (trust-disk)', () => {
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
    // Case 1 — SysInfo present, non-checksum generation → trusted-disk.
    // ─────────────────────────────────────────────────────────────────────

    describe('on-disk SysInfo present (5G Video, no checksum)', () => {
      const VM_MOUNT_POINT = '/mnt/podkit-add-no-verify-present';
      const VM_CONFIG_PATH = '/tmp/podkit-add-no-verify-present.toml';
      const PERSONA = ipodVideo5gIflash1tb;

      beforeAll(async () => {
        try {
          await mountPersona({
            personaId: PERSONA.id,
            vendorId: PERSONA.usbDescriptor.vendorId,
            productId: PERSONA.usbDescriptor.productId,
            mountPoint: VM_MOUNT_POINT,
          });

          // MA147 → iPod 5G Video (checksumType: 'none'). init writes the
          // classic SysInfo (ModelNumStr) + a valid iTunesDB; it does NOT
          // write SysInfoExtended, but a non-checksum generation does not
          // require it, so the trust-disk add proceeds.
          const init = await limaTestVmRunner.run(
            `gpod-tool init ${VM_MOUNT_POINT} --model MA147`,
            { timeoutMs: VM_WARM_TIMEOUT_MS }
          );
          if (init.exitCode !== 0) {
            throw new Error(
              `gpod-tool init failed (exit=${init.exitCode}): ${init.stderr.trim() || init.stdout.trim()}`
            );
          }

          await limaTestVmRunner.run(`printf 'version = 2\\n' > ${VM_CONFIG_PATH}`, {
            timeoutMs: VM_WARM_TIMEOUT_MS,
          });
        } catch (err) {
          await unmountAndStop({ personaId: PERSONA.id, mountPoint: VM_MOUNT_POINT });
          throw err;
        }
      }, VM_COLD_TIMEOUT_MS);

      afterAll(async () => {
        await limaTestVmRunner
          .run(`rm -f ${VM_CONFIG_PATH} 2>/dev/null || true`, { timeoutMs: VM_WARM_TIMEOUT_MS })
          .catch(() => {});
        await unmountAndStop({ personaId: PERSONA.id, mountPoint: VM_MOUNT_POINT });
      }, VM_COLD_TIMEOUT_MS);

      it(
        'add --no-verify succeeds with verification: trusted-disk',
        async () => {
          const invocation = await runJsonCommand(
            limaTestVmRunner,
            `/usr/local/bin/podkit --config ${VM_CONFIG_PATH} device add -d trustdisk ` +
              `--path ${VM_MOUNT_POINT} --no-verify --yes --json`,
            VM_WARM_TIMEOUT_MS
          );
          expect(invocation.parseError).toBeUndefined();
          expect(invocation.exitCode).toBe(0);
          const parsed = invocation.parsed as AddSuccessJson;
          expect(parsed.success).toBe(true);
          expect(parsed.verification).toBe('trusted-disk');
        },
        VM_WARM_TIMEOUT_MS
      );
    });

    // ─────────────────────────────────────────────────────────────────────
    // Case 2 — checksum generation, SysInfoExtended absent → doctor hint.
    // ─────────────────────────────────────────────────────────────────────

    describe('checksum generation, SysInfoExtended absent (Classic 6G)', () => {
      const VM_MOUNT_POINT = '/mnt/podkit-add-no-verify-absent';
      const VM_CONFIG_PATH = '/tmp/podkit-add-no-verify-absent.toml';
      const PERSONA = ipodVideo5gIflash1tb;

      beforeAll(async () => {
        try {
          await mountPersona({
            personaId: PERSONA.id,
            vendorId: PERSONA.usbDescriptor.vendorId,
            productId: PERSONA.usbDescriptor.productId,
            mountPoint: VM_MOUNT_POINT,
          });

          // MB147 → iPod Classic 6G (checksumType: 'hash58'). The on-disk
          // SysInfo resolves a checksum generation, so the identity store
          // (SysInfoExtended) is REQUIRED — but gpod-tool init does not write
          // it, and we defensively remove any seeded copy below.
          const init = await limaTestVmRunner.run(
            `gpod-tool init ${VM_MOUNT_POINT} --model MB147`,
            { timeoutMs: VM_WARM_TIMEOUT_MS }
          );
          if (init.exitCode !== 0) {
            throw new Error(
              `gpod-tool init failed (exit=${init.exitCode}): ${init.stderr.trim() || init.stdout.trim()}`
            );
          }

          // Guarantee SysInfoExtended is absent so the identity store reads
          // as `missing` (trust-disk's required-but-missing branch).
          await limaTestVmRunner.run(
            `rm -f ${VM_MOUNT_POINT}/iPod_Control/Device/SysInfoExtended`,
            { timeoutMs: VM_WARM_TIMEOUT_MS }
          );

          await limaTestVmRunner.run(`printf 'version = 2\\n' > ${VM_CONFIG_PATH}`, {
            timeoutMs: VM_WARM_TIMEOUT_MS,
          });
        } catch (err) {
          await unmountAndStop({ personaId: PERSONA.id, mountPoint: VM_MOUNT_POINT });
          throw err;
        }
      }, VM_COLD_TIMEOUT_MS);

      afterAll(async () => {
        await limaTestVmRunner
          .run(`rm -f ${VM_CONFIG_PATH} 2>/dev/null || true`, { timeoutMs: VM_WARM_TIMEOUT_MS })
          .catch(() => {});
        await unmountAndStop({ personaId: PERSONA.id, mountPoint: VM_MOUNT_POINT });
      }, VM_COLD_TIMEOUT_MS);

      it(
        'add --no-verify errors with the run-doctor remediation hint',
        async () => {
          const invocation = await runJsonCommand(
            limaTestVmRunner,
            `/usr/local/bin/podkit --config ${VM_CONFIG_PATH} device add -d nosie ` +
              `--path ${VM_MOUNT_POINT} --no-verify --yes --json`,
            VM_WARM_TIMEOUT_MS
          );
          expect(invocation.parseError).toBeUndefined();
          expect(invocation.exitCode).not.toBe(0);
          const parsed = invocation.parsed as AddFailureJson;
          expect(parsed.success).toBe(false);
          // The remediation hint must point the user at `podkit doctor`.
          expect(parsed.error ?? '').toMatch(/podkit doctor/);
          // Config row must NOT have been written.
          const config = await limaTestVmRunner.run(`cat ${VM_CONFIG_PATH}`, {
            timeoutMs: VM_WARM_TIMEOUT_MS,
          });
          expect(config.stdout).not.toContain('[devices.nosie]');
        },
        VM_WARM_TIMEOUT_MS
      );
    });
  });
});
