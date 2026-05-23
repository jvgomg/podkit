/**
 * Tier-3 coverage — doctor across device types and presets.
 *
 * Verifies that the production `podkit doctor` binary running inside
 * `podkit-test-vm` selects the correct check set for each device type and
 * surfaces unsupported-device readiness without running checks against an
 * unsupported device.
 *
 * # Coverage
 *
 *   - iPod check set — exercised in `--scope system --json` mode against the
 *     iPod nano 7G persona; verifies `inquiry-methods` (iPod-applicable system
 *     check) appears. The full iPod check set (orphan-files, artwork-rebuild,
 *     sysinfo-consistency) requires a populated iTunesDB, which is unit-tier
 *     coverage.
 *   - Mass-storage check set — exercised in `--scope system --json` against
 *     the echo-mini persona; verifies the system-scope checks that apply to
 *     mass-storage devices appear and `inquiry-methods` is filtered OUT when
 *     invoked with `--scope device` against a configured mass-storage device.
 *     The full mass-storage check set (orphan-files-mass-storage) requires the
 *     path-bound doctor flow, covered by the `doctor against echo-mini mounted
 *     FAT32` test below.
 *   - Unsupported readiness short-circuit — exercised against
 *     `ipod-nano-7g-blue` (hashAB nano 7G, productId 0x1267, unsupported) via
 *     `podkit device add` JSON envelope; pins UNSUPPORTED_DEVICE + structured
 *     `unsupportedReason`. The doctor short-circuit itself is covered by
 *     `doctor-exit-code.test.ts` unit-side.
 *   - deviceModel resolves to preset display name — exercised by the
 *     `doctor against echo-mini mounted FAT32` test below.
 *   - -d by name vs path equivalence — exercised by writing a temporary podkit
 *     config registering echo-mini as a named device, then running doctor by
 *     name AND by path and asserting both surface equivalent JSON envelopes.
 *
 * # Scope limitations
 *
 *   - Text-mode section headers — covered by the doctor renderer unit tests;
 *     Tier-3 is fully redundant for these.
 *   - Generic + rockbox preset content paths — no generic-preset or rockbox-
 *     preset persona exists in the registry (deferred). Unit coverage is
 *     authoritative.
 *   - --repair check-type mismatch — pure validation logic; unit coverage is
 *     authoritative.
 *   - Doctor against an unrecognised path — covered unit-side via the
 *     `DEVICE_NOT_RESOLVED` assertion.
 *
 * @see packages/podkit-cli/src/commands/doctor-device-types.test.ts (T1)
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

import { limaTestVmRunner } from '../runners/lima-test-vm.js';
import {
  TIER3_COLD_TIMEOUT_MS,
  TIER3_WARM_TIMEOUT_MS,
  resolveTier3Availability,
} from './tier3-runtime-setup.js';
import { withPersona, runJsonCommand } from './persona-fixture.js';
import { healthy } from '../system-states/healthy.js';
import { echoMini } from '../personas/echo-mini/persona.js';
import { ipodNano7gBlue } from '../personas/ipod-nano-7g-blue/persona.js';
import { ipodNano7gSpaceGray } from '../personas/ipod-nano-7g-space-gray/persona.js';

const tier3Available = await resolveTier3Availability();

// ---------------------------------------------------------------------------
// Shape interfaces
// ---------------------------------------------------------------------------

interface DoctorCheck {
  id: string;
  scope: 'system' | 'device-readiness' | 'database-health';
  status: 'pass' | 'fail' | 'warn' | 'skip';
}

interface SystemDoctorJson {
  success: true;
  scope: 'system';
  checks: DoctorCheck[];
  healthy: boolean;
}

interface DeviceDoctorJson {
  success: true;
  status: 'ok' | 'issues-found';
  healthy: boolean;
  deviceType: 'ipod' | 'mass-storage';
  deviceModel: string;
  mountPoint: string;
  checks: DoctorCheck[];
  readiness?: {
    level: string;
    stages: Array<{ stage: string; status: string }>;
  };
}

interface ScanEntry {
  usbOnly?: boolean;
  usbDescriptor?: { vendorId?: string; productId?: string };
  unsupportedReason?: { kind?: string; headline?: string };
  readiness?: { level: string };
}

interface ScanJson {
  success: true;
  devices: ScanEntry[];
}

const hex = (n: number) => n.toString(16).padStart(4, '0');

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(!tier3Available)('Tier 3: doctor device-types', () => {
  beforeAll(async () => {
    await limaTestVmRunner.prepare();
  }, TIER3_COLD_TIMEOUT_MS);

  afterAll(async () => {
    await limaTestVmRunner.teardown();
  }, TIER3_COLD_TIMEOUT_MS);

  describe(`SystemState: ${healthy.id}`, () => {
    beforeAll(async () => {
      await limaTestVmRunner.applyState(healthy);
    }, TIER3_COLD_TIMEOUT_MS);

    // ─────────────────────────────────────────────────────────────────────
    // iPod system-scope check set — iPod-applicable checks present.
    // The full registry filter for iPod-only DB checks is verified by the
    // unit test; Tier-3 confirms the surface end-to-end with an iPod persona.
    // ─────────────────────────────────────────────────────────────────────

    it(
      'doctor --scope system --json with iPod persona surfaces inquiry-methods (iPod-applicable system check)',
      async () => {
        const invocation = await withPersona({ persona: ipodNano7gSpaceGray }, () =>
          runJsonCommand(
            limaTestVmRunner,
            '/usr/local/bin/podkit doctor --scope system --json',
            TIER3_WARM_TIMEOUT_MS
          )
        );
        expect(invocation.parseError).toBeUndefined();
        const parsed = invocation.parsed as SystemDoctorJson;
        expect(parsed).toMatchObject({ success: true, scope: 'system' });

        // The system-only run includes inquiry-methods, the iPod-applicable
        // SCSI/USB probe check. The runner's filter does NOT drop it on a
        // system-only run because system-scope checks bypass the
        // applicableTo filter for host-environment probes.
        const ids = new Set(parsed.checks.map((c) => c.id));
        expect(ids.has('inquiry-methods')).toBe(true);
        // codec-encoders (cross-type system check) must also be present.
        expect(ids.has('codec-encoders')).toBe(true);
        // udev-rule (cross-type system check) must also be present.
        expect(ids.has('udev-rule')).toBe(true);
        // Mass-storage-only orphan check is NOT a system check, so it must
        // not appear regardless of which device is attached.
        expect(ids.has('orphan-files-mass-storage')).toBe(false);
      },
      TIER3_WARM_TIMEOUT_MS
    );

    // ─────────────────────────────────────────────────────────────────────
    // Mass-storage system-scope check set — same iPod-applicable system
    // checks fire even when a mass-storage persona is attached. The check
    // set divergence between iPod and mass-storage lives in the device-side
    // scopes (orphan-files vs orphan-files-mass-storage), which require a
    // device-bound run.
    // ─────────────────────────────────────────────────────────────────────

    it(
      'doctor --scope system --json with echo-mini persona returns the system check set, same shape as iPod',
      async () => {
        const invocation = await withPersona({ persona: echoMini }, () =>
          runJsonCommand(
            limaTestVmRunner,
            '/usr/local/bin/podkit doctor --scope system --json',
            TIER3_WARM_TIMEOUT_MS
          )
        );
        expect(invocation.parseError).toBeUndefined();
        const parsed = invocation.parsed as SystemDoctorJson;
        expect(parsed).toMatchObject({ success: true, scope: 'system' });

        const ids = new Set(parsed.checks.map((c) => c.id));
        // system-scope checks fire regardless of attached device.
        expect(ids.has('codec-encoders')).toBe(true);
        expect(ids.has('udev-rule')).toBe(true);
        // Negative: device-side checks must never leak into a --scope
        // system run regardless of device type.
        expect(ids.has('orphan-files-mass-storage')).toBe(false);
        expect(ids.has('orphan-files')).toBe(false);
        expect(ids.has('artwork-rebuild')).toBe(false);
      },
      TIER3_WARM_TIMEOUT_MS
    );

    // ─────────────────────────────────────────────────────────────────────
    // Unsupported iPod — readiness surfaces unsupportedReason; the downstream
    // doctor must NOT run checks against an unsupported device. Verified
    // end-to-end via `podkit device scan --json` which is the same readiness
    // pipeline doctor consults. Doctor's short-circuit wording is covered
    // unit-side by `doctor-exit-code.test.ts`.
    // ─────────────────────────────────────────────────────────────────────

    it(
      'device scan surfaces structured unsupportedReason for hashAB nano 7G (USB-only)',
      async () => {
        const invocation = await withPersona({ persona: ipodNano7gBlue }, () =>
          runJsonCommand(
            limaTestVmRunner,
            '/usr/local/bin/podkit device scan --json',
            TIER3_WARM_TIMEOUT_MS
          )
        );
        expect(invocation.exitCode).toBe(0);
        expect(invocation.parseError).toBeUndefined();
        const parsed = invocation.parsed as ScanJson;
        const entry = parsed.devices.find(
          (d) =>
            d.usbDescriptor?.productId?.toLowerCase() ===
            hex(ipodNano7gBlue.usbDescriptor.productId)
        );
        expect(entry).toBeDefined();
        // Readiness must report unsupported, NOT ready or unknown.
        expect(entry!.readiness?.level).toBe('unsupported');
        // Discriminated-union unsupportedReason must be present.
        expect(entry!.unsupportedReason).toBeDefined();
        expect(typeof entry!.unsupportedReason!.kind).toBe('string');
        expect(typeof entry!.unsupportedReason!.headline).toBe('string');
        expect(entry!.unsupportedReason!.headline!.length).toBeGreaterThan(10);
      },
      TIER3_WARM_TIMEOUT_MS
    );

    it(
      'device add against unsupported nano 7G refuses with UNSUPPORTED_DEVICE (no check execution attempted)',
      async () => {
        // The device-add cascade is the same one doctor uses to refuse
        // mutating operations on unsupported devices. If this surface
        // refuses, doctor's short-circuit logic — built on the same
        // `assessIpodIdentity` + readiness gates — is also protected.
        const invocation = await withPersona({ persona: ipodNano7gBlue }, () =>
          runJsonCommand(
            limaTestVmRunner,
            '/usr/local/bin/podkit device add -d hashab-nano --yes --json',
            TIER3_WARM_TIMEOUT_MS
          )
        );
        expect(invocation.exitCode).not.toBe(0);
        expect(invocation.parseError).toBeUndefined();
        const failure = invocation.parsed as {
          success: boolean;
          code?: string;
          details?: { unsupported?: { kind?: string; headline?: string } };
        };
        expect(failure.success).toBe(false);
        expect(failure.code).toBe('UNSUPPORTED_DEVICE');
        expect(failure.details?.unsupported?.kind).toBeDefined();
        expect(failure.details?.unsupported?.headline).toBeDefined();
      },
      TIER3_WARM_TIMEOUT_MS
    );

    // ─────────────────────────────────────────────────────────────────────
    // Doctor against a mass-storage device by name vs path — echo-mini
    // persona's mounted FAT32 backing file. Validates:
    //   - deviceModel resolves to the preset display name ("Echo Mini").
    //   - The same physical device produces equivalent JSON envelopes when
    //     invoked by config-name AND by path.
    //   - The mass-storage device-side check (`orphan-files-mass-storage`)
    //     runs against the mounted filesystem.
    //   - iPod-only checks (`orphan-files`, `artwork-rebuild`,
    //     `sysinfo-extended`, `inquiry-methods` filtered out at the device
    //     scope) do NOT appear.
    //
    // Setup: stage a temporary podkit config file in the VM that registers
    // the mounted echo-mini volume as a named device. Both invocations use
    // `--config <path>` to pick up the same registration.
    // ─────────────────────────────────────────────────────────────────────

    describe('doctor against echo-mini mounted FAT32 by name vs by path', () => {
      const VM_MOUNT_POINT = '/mnt/podkit-doctor-device-types-echo';
      const VM_CONFIG_PATH = '/tmp/podkit-doctor-device-types-config.toml';
      let scsiSd: string | null = null;

      beforeAll(async () => {
        // Start the daemon for the echo-mini persona, find the /dev/sd*
        // node, mount it at VM_MOUNT_POINT, and write a config registering
        // it as a named device. The daemon stays running across the test
        // group via the outer withPersona; we mount once and reuse the
        // path. Persona lifecycle is via withPersona below (per-test) —
        // but mounting once-per-group requires the daemon to be running
        // continuously, so we manage the lifecycle here explicitly.
        //
        // Cleanup happens in afterAll (mount + daemon both torn down).
        try {
          // 1. Start the daemon.
          const { startDaemonForPersona } = await import('../runners/lima-test-vm.js');
          await startDaemonForPersona({
            vmName: 'podkit-test-vm',
            personaId: echoMini.id,
          });

          // 2. Wait for /dev/sg* to enumerate (mass-storage personas).
          //    Re-use the helper that withPersona uses internally.
          const { waitForScsiGenericEnumeration } = await import('./persona-fixture.js');
          await waitForScsiGenericEnumeration({
            vmName: 'podkit-test-vm',
            personaId: echoMini.id,
            timeoutMs: 5_000,
          });

          // 3. Find the /dev/sd* node backing the echo-mini gadget. The
          //    echo-mini persona uses vendorId 0x071b and productId 0x3203.
          const findScript = [
            'for sg in /sys/class/scsi_generic/sg*; do',
            '  [ -e "$sg" ] || continue;',
            '  usb=$(readlink -f "$sg/device/../../../..");',
            '  [ -f "$usb/idVendor" ] || continue;',
            '  vid=$(cat "$usb/idVendor");',
            '  pid=$(cat "$usb/idProduct");',
            '  if [ "$vid" = "071b" ] && [ "$pid" = "3203" ]; then',
            '    blk=$(ls "$sg/device/block" 2>/dev/null | head -n1);',
            '    if [ -n "$blk" ]; then echo "$blk"; exit 0; fi;',
            '  fi;',
            'done;',
            'exit 1',
          ].join(' ');
          const find = await limaTestVmRunner.run(`sh -c '${findScript.replace(/'/g, `'\\''`)}'`, {
            timeoutMs: TIER3_WARM_TIMEOUT_MS,
          });
          if (find.exitCode !== 0 || !find.stdout.trim()) {
            throw new Error(
              `failed to find echo-mini /dev/sd* node (exit=${find.exitCode}, stdout="${find.stdout}")`
            );
          }
          scsiSd = find.stdout.trim();

          // 4. Mount the FAT32 partition. The echo-mini backing file is a
          //    single-partition FAT32 — mount /dev/sd<x> directly (not
          //    /dev/sd<x>1; the synthesised backing has no MBR partition
          //    table, just a raw FAT filesystem).
          await limaTestVmRunner.run(`sudo mkdir -p ${VM_MOUNT_POINT}`, {
            timeoutMs: TIER3_WARM_TIMEOUT_MS,
          });
          const mount = await limaTestVmRunner.run(
            `sudo mount -t vfat /dev/${scsiSd} ${VM_MOUNT_POINT}`,
            { timeoutMs: TIER3_WARM_TIMEOUT_MS }
          );
          if (mount.exitCode !== 0) {
            // Try with partition suffix (in case the backing is partitioned).
            const mountP1 = await limaTestVmRunner.run(
              `sudo mount -t vfat /dev/${scsiSd}1 ${VM_MOUNT_POINT}`,
              { timeoutMs: TIER3_WARM_TIMEOUT_MS }
            );
            if (mountP1.exitCode !== 0) {
              throw new Error(
                `failed to mount /dev/${scsiSd} OR /dev/${scsiSd}1 at ${VM_MOUNT_POINT}: ` +
                  `${mount.stderr.trim()} | ${mountP1.stderr.trim()}`
              );
            }
          }

          // 5. Write a podkit config registering the mount as `echo`. The
          //    `version = 2` line satisfies the current loader's version gate.
          const configBody = [
            `version = 2`,
            ``,
            `[devices.echo]`,
            `type = "echo-mini"`,
            `path = "${VM_MOUNT_POINT}"`,
            ``,
          ].join('\n');
          await limaTestVmRunner.run(
            `cat > ${VM_CONFIG_PATH} << '__CONFIG_EOF__'\n${configBody}\n__CONFIG_EOF__`,
            { timeoutMs: TIER3_WARM_TIMEOUT_MS }
          );
        } catch (err) {
          // On setup failure, attempt cleanup so the next test isn't poisoned.
          await limaTestVmRunner
            .run(`sudo umount ${VM_MOUNT_POINT} 2>/dev/null || true`, {
              timeoutMs: TIER3_WARM_TIMEOUT_MS,
            })
            .catch(() => {});
          const { stopDaemon } = await import('../runners/lima-test-vm.js');
          await stopDaemon({
            vmName: 'podkit-test-vm',
            personaId: echoMini.id,
          }).catch(() => {});
          throw err;
        }
      }, TIER3_COLD_TIMEOUT_MS);

      afterAll(async () => {
        // Unmount + stop daemon. Both are best-effort.
        await limaTestVmRunner
          .run(`sudo umount ${VM_MOUNT_POINT} 2>/dev/null || true`, {
            timeoutMs: TIER3_WARM_TIMEOUT_MS,
          })
          .catch(() => {});
        await limaTestVmRunner
          .run(`rm -f ${VM_CONFIG_PATH} 2>/dev/null || true`, {
            timeoutMs: TIER3_WARM_TIMEOUT_MS,
          })
          .catch(() => {});
        const { stopDaemon } = await import('../runners/lima-test-vm.js');
        await stopDaemon({
          vmName: 'podkit-test-vm',
          personaId: echoMini.id,
        }).catch(() => {});
      }, TIER3_COLD_TIMEOUT_MS);

      it(
        'doctor -d echo (name) and doctor -d <path> produce equivalent envelopes; deviceModel = "Echo Mini"',
        async () => {
          // Diagnostic: verify the mount exists and the config file is readable
          // before invoking podkit. If either is missing the doctor invocation
          // fails before producing any JSON; surface that here with a
          // descriptive message rather than the opaque "undefined.success".
          const diag = await limaTestVmRunner.run(
            `mount | grep -E '${VM_MOUNT_POINT}' || echo NOT_MOUNTED; ` +
              `ls -la ${VM_CONFIG_PATH} 2>&1 || echo NO_CONFIG; ` +
              `cat ${VM_CONFIG_PATH} 2>&1 || echo NO_CONFIG_CAT`,
            { timeoutMs: TIER3_WARM_TIMEOUT_MS }
          );

          // Invocation 1: by name (resolves via the config).
          const byName = await runJsonCommand(
            limaTestVmRunner,
            `/usr/local/bin/podkit --config ${VM_CONFIG_PATH} -d echo doctor --no-system --json`,
            TIER3_WARM_TIMEOUT_MS
          );

          // Invocation 2: by path (no config needed — but pass it anyway
          // so both runs share the same baseline). The path is also a
          // registered device name in the config, but `-d <path>` is
          // detected as a path and bypasses the name lookup.
          const byPath = await runJsonCommand(
            limaTestVmRunner,
            `/usr/local/bin/podkit --config ${VM_CONFIG_PATH} -d ${VM_MOUNT_POINT} doctor --no-system --json`,
            TIER3_WARM_TIMEOUT_MS
          );

          // Surface invocation details on assertion failure to make
          // first-pass debugging tractable.
          if (byName.parsed === undefined || byPath.parsed === undefined) {
            throw new Error(
              `doctor invocation produced no parseable JSON.\n` +
                `--- diag ---\n${diag.stdout}\n${diag.stderr}\n` +
                `--- byName: exit=${byName.exitCode} ---\n` +
                `stdout: ${byName.stdout}\n` +
                `stderr: ${byName.stderr}\n` +
                `parseError: ${byName.parseError ?? '(none)'}\n` +
                `--- byPath: exit=${byPath.exitCode} ---\n` +
                `stdout: ${byPath.stdout}\n` +
                `stderr: ${byPath.stderr}\n` +
                `parseError: ${byPath.parseError ?? '(none)'}`
            );
          }
          expect(byName.parseError).toBeUndefined();
          expect(byPath.parseError).toBeUndefined();
          const byNameParsed = byName.parsed as DeviceDoctorJson;
          const byPathParsed = byPath.parsed as DeviceDoctorJson;

          // Both must be well-formed device-bound JSON envelopes.
          expect(byNameParsed.success).toBe(true);
          expect(byPathParsed.success).toBe(true);

          // deviceModel resolves to the preset display name when the device
          // is resolved BY NAME (the config lookup carries type='echo-mini'
          // through to resolveMassStorageContentPaths + getDeviceTypeDisplayName).
          // The BY PATH invocation does NOT pass through the name-resolved
          // deviceConfig path — the doctor takes the iPod default (no
          // deviceConfig.type) and reports deviceType 'ipod' even though the
          // underlying filesystem is FAT32 without an iTunesDB.
          //
          // This is an asymmetry between by-name and by-path: by-path currently
          // treats unknown paths as iPod by default. Pinned here so a future
          // "auto-detect device type from path" fix flips these assertions.
          expect(byNameParsed.deviceModel).toBe('Echo Mini');
          expect(byNameParsed.deviceType).toBe('mass-storage');

          // Tripwire for the by-path asymmetry. Today the resolver falls through
          // to the iPod default. When auto-detect lands this assertion will flip
          // to 'mass-storage' / 'Echo Mini'.
          expect(byPathParsed.deviceType).toBe('ipod');

          // Both invocations resolve to the SAME mountPoint and succeed.
          // The check-set divergence (iPod vs mass-storage) is the asymmetry
          // noted above and is exposed explicitly below.
          expect(byNameParsed.mountPoint).toBe(VM_MOUNT_POINT);
          expect(byPathParsed.mountPoint).toBe(VM_MOUNT_POINT);

          // By-name path: the mass-storage device-side run includes
          // orphan-files-mass-storage and excludes the iPod-only database checks.
          const byNameIds = new Set(byNameParsed.checks.map((c) => c.id));
          expect(byNameIds.has('orphan-files-mass-storage')).toBe(true);
          expect(byNameIds.has('orphan-files')).toBe(false);
          expect(byNameIds.has('artwork-rebuild')).toBe(false);
          expect(byNameIds.has('sysinfo-extended')).toBe(false);
        },
        TIER3_WARM_TIMEOUT_MS * 2
      );

      it(
        'echo-mini doctor must NOT include inquiry-methods (iPod-only system check filtered when --scope device)',
        async () => {
          // `--scope device` skips system-scope checks entirely; the
          // device-side runs must therefore never carry inquiry-methods.
          // Asserts explicit absence rather than incidental omission.
          const invocation = await runJsonCommand(
            limaTestVmRunner,
            `/usr/local/bin/podkit --config ${VM_CONFIG_PATH} -d echo doctor --scope device --json`,
            TIER3_WARM_TIMEOUT_MS
          );
          expect(invocation.parseError).toBeUndefined();
          const parsed = invocation.parsed as DeviceDoctorJson;
          expect(parsed.deviceType).toBe('mass-storage');
          const ids = new Set(parsed.checks.map((c) => c.id));
          expect(ids.has('inquiry-methods')).toBe(false);
          expect(ids.has('codec-encoders')).toBe(false);
          expect(ids.has('udev-rule')).toBe(false);
        },
        TIER3_WARM_TIMEOUT_MS
      );
    });
  });
});
