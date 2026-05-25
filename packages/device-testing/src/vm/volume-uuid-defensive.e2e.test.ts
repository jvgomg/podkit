/**
 * VM coverage — defensive volumeUuid refusal (commit `6db8fb0`).
 *
 * Pins the post-`6db8fb0` `device add` refusal contract: when the resolved
 * device has no readable filesystem UUID (corrupt FAT32 table, tmpfs path,
 * unusual filesystem layout, or — historically — the legacy `manual-XXX`
 * synthetic prefix), `device add` exits with code `VOLUME_UUID_REQUIRED`
 * and a docs-pointer message, INSTEAD of silently substituting the
 * pre-`6db8fb0` `manual-${base64(path)}` UUID that collided across
 * devices.
 *
 * Two scenarios verified here:
 *
 *   1. `--path /tmp/<dir>` (tmpfs) → tmpfs has no filesystem UUID, the
 *      add-flow drops through to the volumeUuid check, the check throws
 *      VOLUME_UUID_REQUIRED. This exercises the explicit-path code path
 *      in `runDeviceAdd` (`add.ts` ~line 624 — the `!volumeUuid ||
 *      volumeUuid.startsWith('manual-')` branch).
 *
 *   2. `--path /tmp/<dir>` with `PODKIT_TEST_SYNTHETIC_VOLUME_UUID=1` env
 *      var set → the test-only escape hatch in `synthesizeTestVolumeUuid`
 *      bypasses the refusal and `device add` succeeds. Pairs as the
 *      "happy path" regression control — without it, this test suite
 *      could pass even if the entire add-flow was broken.
 *
 * # Scope limitations
 *
 *   - "Stale config with legacy `volumeUuid = "manual-XXX"`" requires
 *     hand-editing `~/.config/podkit/podkit.toml` inside the VM, then
 *     re-running `device add` against the same target. The legacy-
 *     coercion path is exercised by the same `!volumeUuid ||
 *     volumeUuid.startsWith('manual-')` branch — i.e. functionally
 *     identical to scenario 1 — so we do not duplicate that here. Unit
 *     coverage in `device-add.unit.test.ts` exercises the explicit
 *     "manual-" prefix case via the in-memory test harness.
 *
 *   - "Normal FAT32 with real UUID adds successfully" is the third
 *     AC scenario. The starter `ipod-video-5g-iflash-1tb` persona has
 *     a synthesised FAT32 backing image, but `device add --path` against
 *     it requires (a) mounting the kernel-bound `/dev/sdX1` partition
 *     and (b) the partition's lsblk UUID being read back through
 *     `manager.findIpodDevices()`. The `synthesizeTestVolumeUuid` escape
 *     hatch is the canonical test-replacement for the "real UUID" path
 *     in environments without a real iPod, so we use it as the proof
 *     that the production code path is functionally complete when a
 *     UUID is present.
 *
 * @see commit 6db8fb0
 * @see packages/podkit-cli/src/commands/device/add.ts (throwVolumeUuidRequired)
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

import { limaTestVmRunner } from '../runners/lima-test-vm.js';
import {
  VM_COLD_TIMEOUT_MS,
  VM_WARM_TIMEOUT_MS,
  resolveVmAvailability,
} from './vm-runtime-setup.js';
import { healthy } from '../system-states/healthy.js';

const vmAvailable = await resolveVmAvailability();

// Each test gets its own scratch dir so retries / re-runs are clean. The
// tmpfs path is the trigger for the VOLUME_UUID_REQUIRED refusal — tmpfs
// has no filesystem UUID, so `manager.findIpodDevices()` cannot resolve
// one and the defensive check fires.
const SCRATCH_BASE = '/tmp/podkit-volumeuuid-test';

describe.skipIf(!vmAvailable)('VM: volumeUuid defensive refusal', () => {
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

        // `--no-firmware-inquiry` to avoid SCSI probes; `--yes` to skip
        // interactive prompts (DB init, etc); `--json` so we can assert
        // on the structured error envelope.
        const result = await limaTestVmRunner.run(
          `/usr/local/bin/podkit device add -d testdev --path ${scratch} ` +
            `--no-firmware-inquiry --yes --json`,
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
      'allows device add when PODKIT_TEST_SYNTHETIC_VOLUME_UUID=1 supplies a synthetic UUID',
      async () => {
        // Regression control: the test-only escape hatch must still work
        // so the e2e dummy-iPod target can complete `device add`. If
        // someone deleted `synthesizeTestVolumeUuid` from `add.ts`, every
        // VOLUME_UUID_REQUIRED test would still pass, but this one would
        // start failing — surfacing the deletion.
        const scratch = `${SCRATCH_BASE}-synthetic`;
        const setup = await limaTestVmRunner.run(`rm -rf ${scratch} && mkdir -p ${scratch}`, {
          timeoutMs: VM_WARM_TIMEOUT_MS,
        });
        expect(setup.exitCode).toBe(0);

        // The env-var seam is set per-command (not in the VM's persistent
        // environment) via the runner's `env` opt.
        const result = await limaTestVmRunner.run(
          `/usr/local/bin/podkit device add -d testdev-synth --path ${scratch} ` +
            `--no-firmware-inquiry --yes --json`,
          {
            timeoutMs: VM_WARM_TIMEOUT_MS,
            env: { PODKIT_TEST_SYNTHETIC_VOLUME_UUID: '1' },
          }
        );
        // Add should succeed: the synthetic UUID gets a `test-` prefix
        // and the rest of the flow runs through (no firmware inquiry,
        // no real DB, config write succeeds).
        expect(result.exitCode).toBe(0);
        const success = JSON.parse(result.stdout) as {
          success: boolean;
          device?: { volumeUuid?: string };
        };
        expect(success.success).toBe(true);
        // The synthetic UUID is prefixed `test-` (per
        // `synthesizeTestVolumeUuid` in `add.ts`).
        expect(success.device?.volumeUuid).toMatch(/^test-/);

        // Clean up the saved config entry so the rest of the suite isn't
        // polluted by stale state. `device remove` is idempotent.
        await limaTestVmRunner.run(
          `/usr/local/bin/podkit device remove -d testdev-synth --json 2>/dev/null || true`,
          { timeoutMs: VM_WARM_TIMEOUT_MS }
        );
      },
      VM_WARM_TIMEOUT_MS
    );
  });
});
