/**
 * VM coverage — defensive volumeUuid refusal + the config-inject escape.
 *
 * Pins the `device add` no-UUID refusal contract: when the resolved device
 * has no readable filesystem UUID (corrupt FAT32 table, tmpfs path, unusual
 * filesystem layout), a *verify / trust-disk* add exits with code
 * `VOLUME_UUID_REQUIRED` and a docs-pointer message, INSTEAD of silently
 * substituting a path-derived UUID that collided across devices.
 *
 * Two scenarios verified here:
 *
 *   1. Verify-tier-only refusal: `--path /tmp/<dir>` (tmpfs) → tmpfs has no
 *      filesystem UUID, so the add-flow's no-UUID gate (M4 `refuse-no-uuid`)
 *      fires and the command exits with VOLUME_UUID_REQUIRED. This is the
 *      gate that protects the verify and trust-disk tiers, which both read
 *      the device.
 *
 *   2. Config-inject escape: `--no-validate --type ipod --volume-uuid <uuid>`
 *      against the SAME tmpfs path → the config-inject tier writes the row
 *      straight from the supplied identity with ZERO device I/O, so the
 *      no-UUID gate never runs and the add succeeds. This is the product-level
 *      replacement for the removed test-only synthetic-UUID escape hatch and
 *      doubles as the "happy path" regression control — without it, the suite
 *      could pass even if the entire add-flow were broken.
 *
 * # Scope limitations
 *
 *   - "Normal FAT32 with real UUID adds successfully" is the verify-tier
 *     positive. It requires mounting the kernel-bound `/dev/sdX1` partition
 *     of a persona backing image and reading the lsblk UUID back through the
 *     device manager — exercised by the persona-backed `--no-verify` cases,
 *     not here. The config-inject scenario above proves the persist tail is
 *     functionally complete when an identity is supplied.
 *
 * @see packages/podkit-cli/src/commands/device/verification-policy.ts (refuse-no-uuid)
 * @see packages/podkit-cli/src/commands/device/resolve-add-request.ts (config-inject)
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

import {
  limaTestVmRunner,
  VM_COLD_TIMEOUT_MS,
  VM_WARM_TIMEOUT_MS,
  healthy,
} from '@podkit/device-testing';

// Each test gets its own scratch dir so retries / re-runs are clean. The
// tmpfs path is the trigger for the VOLUME_UUID_REQUIRED refusal — tmpfs
// has no filesystem UUID, so `manager.findIpodDevices()` cannot resolve
// one and the defensive check fires.
const SCRATCH_BASE = '/tmp/podkit-volumeuuid-test';

describe('VM: volumeUuid defensive refusal', () => {
  beforeAll(async () => {
    await limaTestVmRunner.prepare();
  }, VM_COLD_TIMEOUT_MS);

  afterAll(async () => {
    // Clean up scratch dirs on the way out so a re-run starts fresh.
    await limaTestVmRunner
      .run(`rm -rf ${SCRATCH_BASE}*`, { timeoutMs: VM_WARM_TIMEOUT_MS })
      .catch(() => undefined);
    await limaTestVmRunner.teardown();
  }, VM_COLD_TIMEOUT_MS);

  describe(`SystemState: ${healthy.id}`, () => {
    beforeAll(async () => {
      await limaTestVmRunner.applyState(healthy);
    }, VM_COLD_TIMEOUT_MS);

    it(
      'refuses device add with VOLUME_UUID_REQUIRED when the target path has no filesystem UUID',
      async () => {
        const scratch = `${SCRATCH_BASE}-missing`;
        // Fresh dir on tmpfs — no filesystem UUID resolvable via lsblk.
        const setup = await limaTestVmRunner.run(`rm -rf ${scratch} && mkdir -p ${scratch}`, {
          timeoutMs: VM_WARM_TIMEOUT_MS,
        });
        expect(setup.exitCode).toBe(0);

        // `--no-verify` keeps us in the trust-disk tier (no SCSI probes) which
        // still reads the device and so still trips the no-UUID gate; `--yes`
        // skips interactive prompts (DB init, etc); `--json` so we can assert
        // on the structured error envelope.
        const result = await limaTestVmRunner.run(
          `/usr/local/bin/podkit device add -d testdev --path ${scratch} ` +
            `--no-verify --yes --json`,
          { timeoutMs: VM_WARM_TIMEOUT_MS }
        );
        expect(result.exitCode).not.toBe(0);
        const failure = JSON.parse(result.stdout) as {
          success: boolean;
          code?: string;
          error?: string;
          details?: { path?: string; filesystem?: unknown };
        };
        expect(failure.success).toBe(false);
        expect(failure.code).toBe('VOLUME_UUID_REQUIRED');
        // Message must reference the docs URL for troubleshooting.
        expect(failure.error ?? '').toMatch(/troubleshooting/);
        // Details should reflect what we asked for.
        expect(failure.details?.path).toBe(scratch);
        // tmpfs has no detectable filesystem from lsblk's POV → null.
        expect(failure.details?.filesystem).toBeNull();
      },
      VM_WARM_TIMEOUT_MS
    );

    it(
      'allows device add against a UUID-less path via --no-validate (config-inject)',
      async () => {
        // Regression control + the replacement for the removed synthetic-UUID
        // hatch: `--no-validate` writes the config row straight from the
        // supplied identity with zero device I/O, so the no-UUID gate is never
        // reached. If the config-inject tier regressed, this would start
        // failing while the refusal test above kept passing — surfacing the
        // break.
        const scratch = `${SCRATCH_BASE}-novalidate`;
        const setup = await limaTestVmRunner.run(`rm -rf ${scratch} && mkdir -p ${scratch}`, {
          timeoutMs: VM_WARM_TIMEOUT_MS,
        });
        expect(setup.exitCode).toBe(0);

        const result = await limaTestVmRunner.run(
          `/usr/local/bin/podkit device add -d testdev-inject --path ${scratch} ` +
            `--type ipod --no-validate --volume-uuid vm-inject-uuid --yes --json`,
          { timeoutMs: VM_WARM_TIMEOUT_MS }
        );
        // Add should succeed: config-inject writes the supplied identity
        // straight to config (no device read, no DB init).
        expect(result.exitCode).toBe(0);
        const success = JSON.parse(result.stdout) as {
          success: boolean;
          verification?: string;
          device?: { volumeUuid?: string };
        };
        expect(success.success).toBe(true);
        expect(success.verification).toBe('config-only');
        expect(success.device?.volumeUuid).toBe('vm-inject-uuid');

        // Clean up the saved config entry so the rest of the suite isn't
        // polluted by stale state. `device remove` is idempotent.
        await limaTestVmRunner.run(
          `/usr/local/bin/podkit device remove -d testdev-inject --json 2>/dev/null || true`,
          { timeoutMs: VM_WARM_TIMEOUT_MS }
        );
      },
      VM_WARM_TIMEOUT_MS
    );
  });
});
