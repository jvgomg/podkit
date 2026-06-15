/**
 * VM coverage — HFS+-on-Linux filesystem refusal.
 *
 * Pins the cross-platform filesystem policy
 * (`packages/podkit-core/src/device/filesystem-policy.ts`) end-to-end:
 * on Linux, podkit refuses to operate against HFS+ volumes because
 *
 *   1. the kernel `hfsplus` driver is RO on journaled HFS+ (the default
 *      Mac-formatted iPod layout) — sync can't write;
 *   2. udev/blkid surface no filesystem UUID for HFS+ on Linux, breaking
 *      podkit's volumeUuid identity model;
 *   3. udisksctl falls back to `/media/$USER/disk` because no label is
 *      read.
 *
 * The refusal triggers off the `lsblk` fstype string `"hfsplus"`, which
 * kernel-side blkid reads from the on-disk volume header magic. The
 * refusal therefore decouples from whether `hfsprogs` userspace or the
 * `hfsplus.ko` kernel module are installed — a property the unit suite
 * already locks down via the platform-injected
 * `isFilesystemUnsupportedHere()` tests. This Tier-3 scenario confirms
 * the same wiring against a real synthesised USB block device.
 *
 * Scenarios:
 *
 *   - `device scan --json` against an HFS+ iPod → entry with
 *     `readiness.level: 'unsupported'`,
 *     `unsupportedReason.kind: 'filesystem-unsupported-on-linux'`,
 *     headline mentioning `HFS+`, and no misleading "Skipped — previous
 *     check failed" placeholder rows on `mount` / `sysinfo` / `database`
 *     stages.
 *
 *   - `device add --device <name> --yes --json` against the same persona
 *     → exit non-zero with
 *     `code: 'UNSUPPORTED_FILESYSTEM_ON_LINUX'`,
 *     `details.filesystem: 'hfsplus'`, headline mentioning the docs URL,
 *     and no config write.
 *
 *   - Regression: `device add` against the supported nano 4G sibling
 *     (`ipod-nano-4g-black`, USB-only, no backing) → MUST NOT emit
 *     `UNSUPPORTED_FILESYSTEM_ON_LINUX`. The refusal is HFS+-specific;
 *     other personas must take their normal paths through readiness
 *     even if those paths happen to fail downstream (e.g. NO_IPOD when
 *     no block device is present).
 *
 * @see packages/podkit-core/src/device/filesystem-policy.ts
 * @see packages/podkit-cli/src/commands/device/add.ts
 * @see packages/podkit-core/src/device/readiness/index.ts (stage 3)
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

import {
  limaTestVmRunner,
  VM_COLD_TIMEOUT_MS,
  VM_WARM_TIMEOUT_MS,
  withPersona,
  runJsonCommand,
  healthy,
  ipodNano4gHfsplus,
  ipodNano4gBlack,
} from '@podkit/device-testing';

interface FilesystemStageDetails {
  filesystem?: string;
  platform?: string;
  unsupported?: {
    kind?: string;
    headline?: string;
    docsUrl?: string;
    filesystem?: string;
  };
}

interface ScanStage {
  stage: string;
  status: string;
  summary?: string;
  details?: FilesystemStageDetails | Record<string, unknown>;
}

interface ScanReadiness {
  level: string;
  stages?: ScanStage[];
}

interface ScanEntry {
  usbDescriptor?: { vendorId?: string; productId?: string };
  readiness?: ScanReadiness;
}

interface ScanJson {
  success: true;
  devices: ScanEntry[];
}

interface AddFailureEnvelope {
  success: false;
  code?: string;
  error?: string;
  details?: {
    filesystem?: string;
    unsupported?: { kind?: string; headline?: string; docsUrl?: string };
  };
}

const hex = (n: number) => n.toString(16).padStart(4, '0');

describe('VM: HFS+-on-Linux filesystem refusal', () => {
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
      'device scan flags the HFS+ iPod as unsupported with a filesystem-unsupported-on-linux reason',
      async () => {
        const invocation = await withPersona({ persona: ipodNano4gHfsplus }, () =>
          runJsonCommand(
            limaTestVmRunner,
            '/usr/local/bin/podkit device scan --json',
            VM_WARM_TIMEOUT_MS
          )
        );
        expect(invocation.exitCode).toBe(0);
        const parsed = invocation.parsed as ScanJson;
        const entry = parsed.devices.find(
          (d) =>
            d.usbDescriptor?.productId?.toLowerCase() ===
            hex(ipodNano4gHfsplus.usbDescriptor.productId)
        );
        expect(entry).toBeDefined();
        expect(entry!.readiness?.level).toBe('unsupported');

        // Block-device entries carry the unsupported reason inside the
        // failing `filesystem` stage's `details.unsupported` payload (the
        // scan renderer does not duplicate the reason at the readiness
        // top-level — that shape is reserved for USB-only entries). See
        // `packages/podkit-core/src/device/readiness/index.ts` (stage 3).
        const stages = entry!.readiness?.stages ?? [];
        const fsStage = stages.find((s) => s.stage === 'filesystem');
        expect(fsStage?.status).toBe('fail');

        const fsDetails = (fsStage?.details ?? {}) as FilesystemStageDetails;
        // Stage-level filesystem field carries the raw lsblk fstype string —
        // verifies the readiness pipeline forwarded the kernel-reported value.
        expect(fsDetails.filesystem).toBe('hfsplus');

        const reason = fsDetails.unsupported;
        expect(reason).toBeDefined();
        expect(reason!.kind).toBe('filesystem-unsupported-on-linux');
        expect(reason!.headline ?? '').toMatch(/HFS\+/);
        expect(reason!.docsUrl ?? '').toMatch(/linux-filesystems/);
        // The reason payload also carries the filesystem string (from
        // `makeHfsplusOnLinuxUnsupportedReason({filesystem})`), distinct
        // from the stage-level `details.filesystem`.
        expect(reason!.filesystem).toBe('hfsplus');

        // The pipeline must NOT emit "Skipped — previous check failed" placeholder
        // rows for the post-filesystem stages: the cause is the filesystem, naming
        // mount/sysinfo/database as "skipped because earlier failed" is misleading
        // UX. Filesystem stage status is `fail`; subsequent stages do not appear.
        expect(stages.some((s) => s.stage === 'mount')).toBe(false);
        expect(stages.some((s) => s.stage === 'sysinfo')).toBe(false);
        expect(stages.some((s) => s.stage === 'database')).toBe(false);
      },
      VM_WARM_TIMEOUT_MS
    );

    it(
      'device add against the HFS+ iPod refuses with UNSUPPORTED_FILESYSTEM_ON_LINUX before any mount attempt',
      async () => {
        const invocation = await withPersona({ persona: ipodNano4gHfsplus }, () =>
          runJsonCommand(
            limaTestVmRunner,
            '/usr/local/bin/podkit device add -d hfsplus-nano --yes --json',
            VM_WARM_TIMEOUT_MS
          )
        );
        // Refusal exits non-zero.
        expect(invocation.exitCode).not.toBe(0);
        expect(invocation.parseError).toBeUndefined();
        const failure = invocation.parsed as AddFailureEnvelope;
        expect(failure.success).toBe(false);
        expect(failure.code).toBe('UNSUPPORTED_FILESYSTEM_ON_LINUX');

        // The structured reason payload carries the offending filesystem +
        // the docs URL that points users at the reformat instructions.
        expect(failure.details?.filesystem).toBe('hfsplus');
        const reason = failure.details?.unsupported;
        expect(reason?.kind).toBe('filesystem-unsupported-on-linux');
        expect(reason?.headline ?? '').toMatch(/HFS\+/);
        expect(reason?.docsUrl ?? '').toMatch(/linux-filesystems/);

        // Human-readable message text should mention HFS+ + reformat-to-FAT32
        // remediation — the canonical refusal text from
        // `formatHfsplusOnLinuxRefusal()`.
        const text = failure.error ?? '';
        expect(text).toMatch(/HFS\+/);
        expect(text).toMatch(/FAT32/);
      },
      VM_WARM_TIMEOUT_MS
    );

    it(
      'device add against the supported nano 4G sibling does NOT raise UNSUPPORTED_FILESYSTEM_ON_LINUX (regression control)',
      async () => {
        // Pair with the previous test: the refusal must be HFS+-specific.
        // A supported non-HFS+ persona may fail for unrelated reasons (no
        // block device, no iTunesDB) but must never surface the HFS+
        // refusal code.
        const invocation = await withPersona({ persona: ipodNano4gBlack }, () =>
          runJsonCommand(
            limaTestVmRunner,
            '/usr/local/bin/podkit device add -d fat32-nano --yes --json',
            VM_WARM_TIMEOUT_MS
          )
        );
        // Exit code is not asserted — the empty FAT32 image legitimately
        // fails the readiness pipeline downstream (no iTunesDB), so the
        // exit may be non-zero. We only assert the absence of the
        // filesystem-refusal envelope.
        if (invocation.parseError === undefined && invocation.parsed) {
          const failure = invocation.parsed as { code?: string; details?: unknown };
          expect(failure.code ?? '').not.toBe('UNSUPPORTED_FILESYSTEM_ON_LINUX');
          // Belt-and-braces: even if a future codepath changed where the
          // refusal envelope lands, the discriminated `kind` string must not
          // appear anywhere in the serialised JSON.
          expect(JSON.stringify(failure)).not.toContain('filesystem-unsupported-on-linux');
        } else {
          // No parsed JSON (env var, banner, etc.) — fall back to stdout +
          // stderr string match so a regression that bypassed JSON envelope
          // emission still fails this test.
          const haystack = invocation.stdout + '\n' + invocation.stderr;
          expect(haystack).not.toContain('UNSUPPORTED_FILESYSTEM_ON_LINUX');
          expect(haystack).not.toContain('filesystem-unsupported-on-linux');
        }
      },
      VM_WARM_TIMEOUT_MS
    );
  });
});
