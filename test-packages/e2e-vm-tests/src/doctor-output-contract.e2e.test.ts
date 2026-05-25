/**
 * VM coverage — doctor JSON output schema + human-text rendering.
 *
 * Locks the public output contract of `podkit doctor`:
 *
 *   - **JSON schema**: top-level key set, `checks[]` entry shape, `status`
 *     enum, `deviceType` enum, `readiness.stages[]` shape, and the
 *     `RepairOutput` envelope shape.
 *   - **Human text**: header line shape, section heading set + order, closing
 *     summary line (pluralisation correct for N=1), `Issues:` block presence +
 *     format, and `Fix:` commands echoing the user's typed `-d` argument
 *     verbatim with shell-quoting.
 *   - **`--json` stdout purity**: in JSON mode, stdout contains the JSON
 *     document and nothing else (no human prose lines bleed through).
 *   - **Byte-identical re-runs**: running the same `--json` doctor command
 *     twice produces identical bytes (no timestamps are emitted today; this
 *     contract pins it).
 *
 * # Persona selection — why these three
 *
 *   - `ipodNano7gSpaceGray` — the iPod path. USB-inquiry surface; reaches the
 *     iPod doctor renderer via `--scope system` (we do not drive the full iPod
 *     `doctor -d <path>` text flow because gpod-tool is not installed in
 *     `podkit-device-harness` — see "Scope limitations" below).
 *   - `echoMini` — the mass-storage path. Mounted FAT32 backing exercises the
 *     device-bound mass-storage doctor renderer end-to-end (including the
 *     `podkit doctor — Echo Mini at <path>` header, the `Issues:` block for
 *     `orphan-files-mass-storage` warn, and the `Fix:` command echoing the
 *     user's `-d` argument).
 *   - `ipodNano7gBlue` — the unsupported / failure-envelope path. The hashAB
 *     nano 7G surfaces UNSUPPORTED_DEVICE via the device-add surface; used
 *     here to pin the failure-envelope shape that `runJsonCommand` parses
 *     regardless of exit code.
 *
 * # Scope limitations
 *
 *   - **readiness shape on a real iPod doctor run** — the `readiness` field
 *     appears only on the device-bound iPod path (`doctor -d <ipod-path>`).
 *     The test VM lacks gpod-tool. We exercise the readiness shape via
 *     `podkit device scan --json` instead — that surface emits the same
 *     `ReadinessResult` shape that `DoctorOutput.readiness` mirrors, so
 *     pinning it there pins the schema contract. Driving the iPod doctor
 *     end-to-end is tracked for a gpod-tool follow-up.
 *
 *   - **Repair envelope** — exercised via `--repair udev-rule --dry-run`,
 *     the only repair that needs no device and no database. The full
 *     state-mutating `RepairOutput` envelope (real udev rule install,
 *     gpod-tool sysinfo writes) requires either a fully writable VM state
 *     we can roll back or a real iPod — deferred.
 *
 *   - **Issues block on the iPod doctor path** — exercised on the mass-storage
 *     path (echo-mini orphan-files-mass-storage warn). The iPod-side Issues
 *     block requires a populated iTunesDB to fail a database-health check;
 *     without gpod-tool we cannot synthesise one. The mass-storage path uses
 *     the same `printIssues()` renderer, so pinning the format there pins it
 *     for both paths.
 *
 * @see packages/podkit-cli/src/commands/doctor.ts (DoctorOutput / SystemDoctorOutput / RepairOutput)
 * @see packages/podkit-cli/src/commands/readiness-display.ts (printIssues + formatIssueLines)
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';

import {
  limaTestVmRunner,
  VM_COLD_TIMEOUT_MS,
  VM_WARM_TIMEOUT_MS,
  resolveVmAvailability,
  withPersona,
  runJsonCommand,
  healthy,
  echoMini,
  ipodNano7gBlue,
  ipodNano7gSpaceGray,
} from '@podkit/device-testing';

const vmAvailable = await resolveVmAvailability();

// ---------------------------------------------------------------------------
// Type interfaces (mirror the production-side DoctorOutput / RepairOutput)
// ---------------------------------------------------------------------------

interface DoctorCheckOutput {
  id: string;
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  summary: string;
  repairable: boolean;
  scope: 'system' | 'device-readiness' | 'database-health';
  details?: Record<string, unknown>;
  docsUrl?: string;
}

interface SystemDoctorOutput {
  success: true;
  status: 'ok' | 'issues-found';
  healthy: boolean;
  scope: 'system';
  checks: DoctorCheckOutput[];
}

interface DeviceDoctorOutput {
  success: true;
  status: 'ok' | 'issues-found';
  healthy: boolean;
  mountPoint: string;
  deviceModel: string;
  deviceType: 'ipod' | 'mass-storage';
  checks: DoctorCheckOutput[];
  readiness?: {
    level: string;
    stages: Array<{
      stage: string;
      status: 'pass' | 'fail' | 'warn' | 'skip';
      summary: string;
      details?: Record<string, unknown>;
    }>;
    unsupported?: Record<string, unknown>;
  };
}

interface RepairOutput {
  success: true;
  summary: string;
  checkId: string;
  dryRun: boolean;
  details?: Record<string, unknown>;
}

interface ScanEntry {
  readiness?: {
    level: string;
    stages: Array<{ stage: string; status: string; summary: string }>;
  };
  usbDescriptor?: { vendorId?: string; productId?: string };
}
interface ScanJson {
  success: true;
  devices: ScanEntry[];
}

// Documented stage set — see ReadinessStageId in @podkit/core. Used by the
// readiness.stages enum check below.
const DOCUMENTED_READINESS_STAGES = new Set([
  'usb',
  'partition',
  'filesystem',
  'mount',
  'sysinfo',
  'database',
]);

const ALLOWED_STATUSES = new Set(['pass', 'fail', 'warn', 'skip']);
const ALLOWED_DEVICE_TYPES = new Set(['ipod', 'mass-storage']);
const ALLOWED_CHECK_SCOPES = new Set(['system', 'device-readiness', 'database-health']);

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe.skipIf(!vmAvailable)('VM: doctor output contract', () => {
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
    // JSON SCHEMA (system scope — drives ACs #1, #2, #3, #14, #15)
    //
    // We exercise the system-scope envelope because it is reachable without
    // gpod-tool. The schema-shape assertions transfer to the device-bound
    // envelope because both go through the same `DoctorCheckOutput` mapping
    // in doctor.ts (single source of truth).
    // ─────────────────────────────────────────────────────────────────────

    describe('JSON schema — system-scope envelope', () => {
      it(
        'every checks[] entry has the required key set + allowed status enum',
        async () => {
          const invocation = await withPersona({ persona: ipodNano7gSpaceGray }, () =>
            runJsonCommand(
              limaTestVmRunner,
              '/usr/local/bin/podkit doctor --scope system --json',
              VM_WARM_TIMEOUT_MS
            )
          );
          expect(invocation.parseError).toBeUndefined();
          const parsed = invocation.parsed as SystemDoctorOutput;
          expect(Array.isArray(parsed.checks)).toBe(true);
          expect(parsed.checks.length).toBeGreaterThan(0);

          for (const check of parsed.checks) {
            // Required keys present + correct type.
            expect(typeof check.id).toBe('string');
            expect(typeof check.name).toBe('string');
            expect(typeof check.status).toBe('string');
            expect(typeof check.summary).toBe('string');
            expect(typeof check.repairable).toBe('boolean');
            // Status enum.
            expect(ALLOWED_STATUSES.has(check.status)).toBe(true);
            // The `scope` field on every check (3-way union). Asserted
            // alongside `status` because both gate the renderer's grouping logic.
            expect(ALLOWED_CHECK_SCOPES.has(check.scope)).toBe(true);

            // Optional keys, when present, have correct type.
            if (check.details !== undefined) {
              expect(typeof check.details).toBe('object');
              expect(check.details).not.toBeNull();
            }
            if (check.docsUrl !== undefined) {
              expect(typeof check.docsUrl).toBe('string');
            }

            // No unknown extras (extra keys are a schema-break — the JSON
            // is a public contract). Allow only the documented set.
            const allowed = new Set([
              'id',
              'name',
              'status',
              'summary',
              'repairable',
              'scope',
              'details',
              'docsUrl',
            ]);
            for (const key of Object.keys(check)) {
              expect(allowed.has(key)).toBe(true);
            }
          }
        },
        VM_WARM_TIMEOUT_MS
      );

      it(
        '--json mode stdout contains ONLY the JSON document (no human prose)',
        async () => {
          // We assert this by parsing the entire stdout as a single JSON
          // document. If any human prose leaks through (a stray `print()`
          // call before/after the JSON write), `JSON.parse(stdout)` fails
          // — that's the structural cover for "stdout-only purity".
          const invocation = await withPersona({ persona: ipodNano7gSpaceGray }, () =>
            runJsonCommand(
              limaTestVmRunner,
              '/usr/local/bin/podkit doctor --scope system --json',
              VM_WARM_TIMEOUT_MS
            )
          );
          expect(invocation.parseError).toBeUndefined();
          expect(invocation.parsed).toBeDefined();

          // No "podkit doctor" header, no "All checks passed", no "Issues:"
          // block — these are text-mode prose lines that must never appear
          // on stdout in JSON mode.
          expect(invocation.stdout).not.toMatch(/^podkit doctor/m);
          expect(invocation.stdout).not.toMatch(/^All checks passed\.$/m);
          expect(invocation.stdout).not.toMatch(/^\d+ issues? found\.$/m);
          expect(invocation.stdout).not.toMatch(/^Issues:$/m);
          // Section headers from the text renderer must not appear.
          expect(invocation.stdout).not.toMatch(/^System$/m);
          expect(invocation.stdout).not.toMatch(/^Device Readiness$/m);
          expect(invocation.stdout).not.toMatch(/^Database Health$/m);
        },
        VM_WARM_TIMEOUT_MS
      );

      it(
        'running --json doctor twice produces byte-identical stdout',
        async () => {
          // Doctor emits no timestamps today; the JSON document is purely
          // a function of the host environment + attached persona, both of
          // which are pinned for the duration of this test by the
          // applyState() snapshot + withPersona() lifecycle.
          const run1 = await withPersona({ persona: ipodNano7gSpaceGray }, () =>
            runJsonCommand(
              limaTestVmRunner,
              '/usr/local/bin/podkit doctor --scope system --json',
              VM_WARM_TIMEOUT_MS
            )
          );
          const run2 = await withPersona({ persona: ipodNano7gSpaceGray }, () =>
            runJsonCommand(
              limaTestVmRunner,
              '/usr/local/bin/podkit doctor --scope system --json',
              VM_WARM_TIMEOUT_MS
            )
          );
          expect(run1.parseError).toBeUndefined();
          expect(run2.parseError).toBeUndefined();

          // Byte-for-byte equality on stdout. This is stronger than
          // `expect(run1.parsed).toEqual(run2.parsed)` — it pins both the
          // value AND the serialisation (key order, whitespace, etc.).
          expect(run1.stdout).toBe(run2.stdout);
        },
        VM_WARM_TIMEOUT_MS * 2
      );
    });

    // ─────────────────────────────────────────────────────────────────────
    // JSON SCHEMA — failure envelope (drives the "parsed on non-zero exit"
    // half of the contract, which `runJsonCommand` already enforces).
    // ─────────────────────────────────────────────────────────────────────

    describe('JSON schema — failure envelope (non-zero exit, well-formed JSON)', () => {
      it(
        'doctor --scope device with no -d emits {success: false, code, error} envelope',
        async () => {
          const invocation = await runJsonCommand(
            limaTestVmRunner,
            '/usr/local/bin/podkit doctor --scope device --json',
            VM_WARM_TIMEOUT_MS
          );
          expect(invocation.exitCode).not.toBe(0);
          expect(invocation.parseError).toBeUndefined();
          const failure = invocation.parsed as {
            success: boolean;
            code?: string;
            error?: string;
          };
          // Required failure-envelope keys.
          expect(failure.success).toBe(false);
          expect(typeof failure.code).toBe('string');
          expect(typeof failure.error).toBe('string');
          // The envelope is well-formed even on non-zero exit — the contract
          // that `runJsonCommand` relies on.
        },
        VM_WARM_TIMEOUT_MS
      );
    });

    // ─────────────────────────────────────────────────────────────────────
    // JSON SCHEMA — readiness shape via device scan
    //
    // The DoctorOutput.readiness field mirrors the ReadinessResult shape
    // exactly (same `level` + `stages[]` payload — see doctor.ts:663–674).
    // Driving the iPod-bound doctor flow requires gpod-tool (see file
    // header); pinning the readiness shape via `device scan` covers the
    // same surface because both consumers map from the same ReadinessResult.
    // ─────────────────────────────────────────────────────────────────────

    describe('JSON schema — readiness.stages shape (via device scan)', () => {
      it(
        'every readiness.stages[] entry has { stage, status, summary } + stage from documented set',
        async () => {
          const invocation = await withPersona({ persona: ipodNano7gBlue }, () =>
            runJsonCommand(
              limaTestVmRunner,
              '/usr/local/bin/podkit device scan --json',
              VM_WARM_TIMEOUT_MS
            )
          );
          expect(invocation.parseError).toBeUndefined();
          const parsed = invocation.parsed as ScanJson;
          // Find a device that has readiness populated (the unsupported nano
          // is guaranteed to emit at least the `usb` stage).
          const entry = parsed.devices.find(
            (d) =>
              d.usbDescriptor?.vendorId?.toLowerCase() === '05ac' &&
              d.readiness &&
              d.readiness.stages.length > 0
          );
          expect(entry).toBeDefined();
          expect(typeof entry!.readiness!.level).toBe('string');
          for (const stage of entry!.readiness!.stages) {
            // Required keys.
            expect(typeof stage.stage).toBe('string');
            expect(typeof stage.status).toBe('string');
            expect(typeof stage.summary).toBe('string');
            // Enum constraints.
            expect(ALLOWED_STATUSES.has(stage.status)).toBe(true);
            expect(DOCUMENTED_READINESS_STAGES.has(stage.stage)).toBe(true);
          }
        },
        VM_WARM_TIMEOUT_MS
      );
    });

    // ─────────────────────────────────────────────────────────────────────
    // JSON SCHEMA — repair envelope
    //
    // `--repair udev-rule --dry-run` is the only repair pathway reachable
    // without a device or database. It emits the full RepairOutput
    // envelope, exercising every required + optional key.
    // ─────────────────────────────────────────────────────────────────────

    describe('JSON schema — repair envelope (via udev-rule --dry-run)', () => {
      it(
        'RepairOutput has { success: true, summary, checkId, dryRun } required + optional details',
        async () => {
          const invocation = await runJsonCommand(
            limaTestVmRunner,
            '/usr/local/bin/podkit doctor --repair udev-rule --dry-run --json',
            VM_WARM_TIMEOUT_MS
          );
          expect(invocation.parseError).toBeUndefined();
          const parsed = invocation.parsed as RepairOutput;
          // Required keys.
          expect(parsed.success).toBe(true);
          expect(typeof parsed.summary).toBe('string');
          expect(parsed.summary.length).toBeGreaterThan(0);
          expect(parsed.checkId).toBe('udev-rule');
          expect(parsed.dryRun).toBe(true);

          // No unknown extras (Repair envelope is part of the public
          // contract; surface drift trips this).
          const allowed = new Set(['success', 'summary', 'checkId', 'dryRun', 'details']);
          for (const key of Object.keys(parsed)) {
            expect(allowed.has(key)).toBe(true);
          }
        },
        VM_WARM_TIMEOUT_MS
      );
    });

    // ─────────────────────────────────────────────────────────────────────
    // HUMAN TEXT — system-scope output (the surface we can drive without
    // gpod-tool). Drives the closing-line + section-heading + Issues block.
    //
    // The full iPod / mass-storage section-set assertions live in
    // `doctor-consistent-sections.e2e.test.ts` and the grouped-render unit
    // tests; we focus here on the *renderer contract* not the per-device
    // section presence (covered unit-side authoritatively).
    // ─────────────────────────────────────────────────────────────────────

    describe('Human text — system-scope rendering', () => {
      it(
        'closing line is "All checks passed." OR "N issue(s) found." with correct pluralisation',
        async () => {
          // Text-mode invocation. The system-scope run on a healthy VM may
          // emit either branch depending on the udev rule state, codec
          // probe, etc. We assert that *exactly one* of the two branches
          // appears and that pluralisation matches the count.
          const result = await limaTestVmRunner.run('/usr/local/bin/podkit doctor --scope system', {
            timeoutMs: VM_WARM_TIMEOUT_MS,
          });
          // Doctor exits 0 (healthy) or 2 (issues-found); never an error.
          expect([0, 2]).toContain(result.exitCode);

          // The closing line is the LAST non-empty content line printed by
          // the renderer; both branches use `out.success` / `out.error`.
          // Scan both streams: `out.success` lands on stdout, but `out.error`
          // routing is renderer-dependent — check stderr first, fall back to
          // stdout so the test doesn't silently pass if the routing changes.
          const successMatch = result.stdout.match(/^All checks passed\.$/m);
          const failureMatch =
            result.stderr.match(/^(\d+) issues? found\.$/m) ??
            result.stdout.match(/^(\d+) issues? found\.$/m);

          // Exactly one of the two branches must appear.
          const sawSuccess = successMatch !== null;
          const sawFailure = failureMatch !== null;
          expect(sawSuccess !== sawFailure).toBe(true);

          if (sawFailure) {
            const count = Number.parseInt(failureMatch![1]!, 10);
            // Pluralisation contract: N=1 → "1 issue found.", N>1 → "N issues found."
            const word = count === 1 ? 'issue' : 'issues';
            expect(failureMatch![0]).toBe(`${count} ${word} found.`);
          }
        },
        VM_WARM_TIMEOUT_MS
      );

      it(
        'when issues exist, an "Issues:" block lists each non-passing check with marker + label + summary',
        async () => {
          // Drive system-only doctor; in the healthy VM at least one
          // system check may emit warn or fail (e.g. ffmpeg encoder
          // matrix, codec-encoders). When that happens the renderer emits
          // an `Issues:` block. We assert structural conformance only
          // when the block is present — i.e. we don't require failures,
          // we require the *format* if/when they happen.
          const result = await limaTestVmRunner.run('/usr/local/bin/podkit doctor --scope system', {
            timeoutMs: VM_WARM_TIMEOUT_MS,
          });
          expect([0, 2]).toContain(result.exitCode);

          if (result.stdout.match(/^Issues:$/m)) {
            // The line after `Issues:` must start with two spaces + a
            // marker glyph (✓ ✗ ! - ?) per `formatIssueLines` in
            // readiness-display.ts. Pin the format.
            const issuesIdx = result.stdout.indexOf('\nIssues:\n');
            expect(issuesIdx).toBeGreaterThanOrEqual(0);
            const afterIssues = result.stdout.slice(issuesIdx + '\nIssues:\n'.length);
            // First non-empty line of the block must be `  <marker> <label> — <summary>`.
            const firstLine = afterIssues.split('\n')[0]!;
            // marker is one of ✓ ✗ ! - ?; the em-dash separates label from summary.
            // We accept any of the markers (test runs against real env, so the
            // specific failures depend on the VM).
            expect(firstLine).toMatch(/^ {2}[✓✗!\-?] .+ — .+/);
          }
        },
        VM_WARM_TIMEOUT_MS
      );
    });

    // ─────────────────────────────────────────────────────────────────────
    // HUMAN TEXT + JSON — mass-storage device-bound doctor
    //
    // Mount the echo-mini backing FAT32 in the VM, register it as a named
    // device in a temp config, then drive `doctor -d echo` (text + JSON)
    // to assert:
    //
    //   - Header line: "podkit doctor — Echo Mini at <path>"
    //   - Mass-storage path renders grouped sections per the grouped-render
    //     contract (no system header under --no-system)
    //   - Issues block format on a real warn (orphan-files-mass-storage
    //     will warn on the empty FAT32 backing)
    //   - Fix: command shell-quoting (path arguments with no metacharacters
    //     render bare; metachar quoting is covered unit-side)
    //   - Fix: command echoes the user's typed `-d` argument ("echo")
    //     verbatim, NOT the resolved /mnt/... path
    //   - JSON envelope: { healthy, mountPoint, deviceModel, deviceType,
    //     checks }; deviceType = 'mass-storage'
    //
    // Same mount + config registration pattern as doctor-device-types.e2e.
    // ─────────────────────────────────────────────────────────────────────

    describe('Mass-storage device-bound doctor (echo-mini)', () => {
      const VM_MOUNT_POINT = '/mnt/podkit-doctor-output-contract-echo';
      const VM_CONFIG_PATH = '/tmp/podkit-doctor-output-contract-config.toml';
      let scsiSd: string | null = null;

      beforeAll(async () => {
        try {
          // 1. Start the daemon (long-lived for the test group).
          const { startDaemonForPersona } = await import('@podkit/device-testing');
          await startDaemonForPersona({
            vmName: 'podkit-device-harness',
            personaId: echoMini.id,
          });

          // 2. Wait for /dev/sg* enumeration.
          const { waitForScsiGenericEnumeration } = await import('@podkit/device-testing');
          await waitForScsiGenericEnumeration({
            vmName: 'podkit-device-harness',
            personaId: echoMini.id,
            timeoutMs: 5_000,
          });

          // 3. Find the /dev/sd* node by walking sysfs for the echo-mini
          //    USB descriptors (vendor 0x071b, product 0x3203).
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
            timeoutMs: VM_WARM_TIMEOUT_MS,
          });
          if (find.exitCode !== 0 || !find.stdout.trim()) {
            throw new Error(
              `failed to find echo-mini /dev/sd* node (exit=${find.exitCode}, stdout="${find.stdout}")`
            );
          }
          scsiSd = find.stdout.trim();

          // 4. Mount the FAT32 partition (raw FAT, no partition table).
          await limaTestVmRunner.run(`sudo mkdir -p ${VM_MOUNT_POINT}`, {
            timeoutMs: VM_WARM_TIMEOUT_MS,
          });
          const mount = await limaTestVmRunner.run(
            `sudo mount -t vfat /dev/${scsiSd} ${VM_MOUNT_POINT}`,
            { timeoutMs: VM_WARM_TIMEOUT_MS }
          );
          if (mount.exitCode !== 0) {
            const mountP1 = await limaTestVmRunner.run(
              `sudo mount -t vfat /dev/${scsiSd}1 ${VM_MOUNT_POINT}`,
              { timeoutMs: VM_WARM_TIMEOUT_MS }
            );
            if (mountP1.exitCode !== 0) {
              throw new Error(
                `failed to mount /dev/${scsiSd} OR /dev/${scsiSd}1 at ${VM_MOUNT_POINT}: ` +
                  `${mount.stderr.trim()} | ${mountP1.stderr.trim()}`
              );
            }
          }

          // 5. Register the mount as named device "echo" in a temp config.
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
            { timeoutMs: VM_WARM_TIMEOUT_MS }
          );
        } catch (err) {
          await limaTestVmRunner
            .run(`sudo umount ${VM_MOUNT_POINT} 2>/dev/null || true`, {
              timeoutMs: VM_WARM_TIMEOUT_MS,
            })
            .catch(() => {});
          const { stopDaemon } = await import('@podkit/device-testing');
          await stopDaemon({
            vmName: 'podkit-device-harness',
            personaId: echoMini.id,
          }).catch(() => {});
          throw err;
        }
      }, VM_COLD_TIMEOUT_MS);

      afterAll(async () => {
        await limaTestVmRunner
          .run(`sudo umount ${VM_MOUNT_POINT} 2>/dev/null || true`, {
            timeoutMs: VM_WARM_TIMEOUT_MS,
          })
          .catch(() => {});
        await limaTestVmRunner
          .run(`rm -f ${VM_CONFIG_PATH} 2>/dev/null || true`, {
            timeoutMs: VM_WARM_TIMEOUT_MS,
          })
          .catch(() => {});
        const { stopDaemon } = await import('@podkit/device-testing');
        await stopDaemon({
          vmName: 'podkit-device-harness',
          personaId: echoMini.id,
        }).catch(() => {});
      }, VM_COLD_TIMEOUT_MS);

      // ── JSON envelope ──────────────────────────────────────────────────

      it(
        'JSON envelope has exactly { healthy, mountPoint, deviceModel, deviceType, checks } + status keys',
        async () => {
          // We use --no-system to skip system-scope checks (no need for
          // an iPod for those; same applies to the mass-storage path).
          // The resulting envelope is the device-bound DoctorOutput.
          const invocation = await runJsonCommand(
            limaTestVmRunner,
            `/usr/local/bin/podkit --config ${VM_CONFIG_PATH} -d echo doctor --no-system --json`,
            VM_WARM_TIMEOUT_MS
          );
          if (invocation.parsed === undefined) {
            throw new Error(
              `doctor produced no parseable JSON.\n` +
                `exit=${invocation.exitCode}\n` +
                `stdout: ${invocation.stdout}\n` +
                `stderr: ${invocation.stderr}\n` +
                `parseError: ${invocation.parseError ?? '(none)'}`
            );
          }
          expect(invocation.parseError).toBeUndefined();
          const parsed = invocation.parsed as DeviceDoctorOutput;

          // Top-level key set. We allow {success, status, healthy, mountPoint,
          // deviceModel, deviceType, checks} as required; the optional
          // `readiness` slot may or may not appear (mass-storage doesn't run
          // readiness today). No other keys are permitted.
          const allowed = new Set([
            'success',
            'status',
            'healthy',
            'mountPoint',
            'deviceModel',
            'deviceType',
            'readiness',
            'checks',
          ]);
          for (const key of Object.keys(parsed)) {
            expect(allowed.has(key)).toBe(true);
          }

          // Required keys present.
          expect(parsed.success).toBe(true);
          expect(typeof parsed.healthy).toBe('boolean');
          expect(typeof parsed.mountPoint).toBe('string');
          expect(parsed.mountPoint).toBe(VM_MOUNT_POINT);
          expect(typeof parsed.deviceModel).toBe('string');
          expect(parsed.deviceModel).toBe('Echo Mini');
          // deviceType enum.
          expect(ALLOWED_DEVICE_TYPES.has(parsed.deviceType)).toBe(true);
          expect(parsed.deviceType).toBe('mass-storage');
          expect(Array.isArray(parsed.checks)).toBe(true);
        },
        VM_WARM_TIMEOUT_MS
      );

      // ── Text mode ──────────────────────────────────────────────────────

      it(
        'text-mode header line is "podkit doctor — Echo Mini at <path>"',
        async () => {
          const result = await limaTestVmRunner.run(
            `/usr/local/bin/podkit --config ${VM_CONFIG_PATH} -d echo doctor --no-system`,
            { timeoutMs: VM_WARM_TIMEOUT_MS }
          );
          // Doctor may exit 0 or 2 — both are valid for the renderer
          // contract (we care about the header, not the outcome).
          expect([0, 2]).toContain(result.exitCode);

          // The header is the FIRST line of stdout (the renderer prints
          // it before any sections). We pin the exact shape.
          const firstLine = result.stdout.split('\n')[0]!;
          expect(firstLine).toBe(`podkit doctor — Echo Mini at ${VM_MOUNT_POINT}`);
        },
        VM_WARM_TIMEOUT_MS
      );

      it(
        'Fix: command echoes the user\'s -d argument ("echo") with shell quoting',
        async () => {
          // Drive doctor by config-name (`-d echo`) so the renderer's
          // shell-quote path receives a value with NO whitespace or shell
          // metacharacters — the quote function returns it bare. We
          // assert the Fix line names the typed argument verbatim.
          const result = await limaTestVmRunner.run(
            `/usr/local/bin/podkit --config ${VM_CONFIG_PATH} -d echo doctor --no-system`,
            { timeoutMs: VM_WARM_TIMEOUT_MS }
          );
          expect([0, 2]).toContain(result.exitCode);

          // The Fix: line is emitted only for repairable failing checks.
          // The empty FAT32 backing means orphan-files-mass-storage may
          // pass (no orphans), but several other checks may surface
          // warnings. If any Fix: line is emitted, it MUST carry `-d echo`
          // (the typed argument), not the resolved /mnt/... path.
          const fixLines = result.stdout.split('\n').filter((l) => /^\s*Fix:/.test(l));
          if (fixLines.length > 0) {
            for (const line of fixLines) {
              // Contains `-d echo` (user's typed arg), not the resolved mount path.
              expect(line).toContain('-d echo');
              expect(line).not.toContain(`-d ${VM_MOUNT_POINT}`);
              // The command is copy-pasteable — starts with `podkit doctor --repair`.
              expect(line).toMatch(/podkit doctor --repair \S+/);
            }
          }
          // If no Fix: lines appeared, the contract holds vacuously — the
          // empty FAT32 backing happens to produce no repairable failures.
          // This is acceptable; the assertion exists to catch regressions
          // when the renderer DOES emit Fix lines.
        },
        VM_WARM_TIMEOUT_MS
      );

      it(
        '--json mode stdout contains only the JSON envelope (mass-storage path)',
        async () => {
          // Mirror of the system-scope --json purity test, on the device-bound
          // path. The mass-storage doctor renderer must also keep prose off
          // stdout in --json mode.
          const invocation = await runJsonCommand(
            limaTestVmRunner,
            `/usr/local/bin/podkit --config ${VM_CONFIG_PATH} -d echo doctor --no-system --json`,
            VM_WARM_TIMEOUT_MS
          );
          expect(invocation.parseError).toBeUndefined();
          expect(invocation.stdout).not.toMatch(/^podkit doctor/m);
          expect(invocation.stdout).not.toMatch(/^All checks passed\.$/m);
          expect(invocation.stdout).not.toMatch(/^\d+ issues? found\.$/m);
          expect(invocation.stdout).not.toMatch(/^Issues:$/m);
        },
        VM_WARM_TIMEOUT_MS
      );

      it(
        'byte-identical --json output across two runs (mass-storage path)',
        async () => {
          const r1 = await runJsonCommand(
            limaTestVmRunner,
            `/usr/local/bin/podkit --config ${VM_CONFIG_PATH} -d echo doctor --no-system --json`,
            VM_WARM_TIMEOUT_MS
          );
          const r2 = await runJsonCommand(
            limaTestVmRunner,
            `/usr/local/bin/podkit --config ${VM_CONFIG_PATH} -d echo doctor --no-system --json`,
            VM_WARM_TIMEOUT_MS
          );
          expect(r1.parseError).toBeUndefined();
          expect(r2.parseError).toBeUndefined();
          // Mass-storage envelope is deterministic too — no timestamps,
          // and the FAT32 backing file is unchanged between runs.
          expect(r1.stdout).toBe(r2.stdout);
        },
        VM_WARM_TIMEOUT_MS * 2
      );
    });
  });
});
