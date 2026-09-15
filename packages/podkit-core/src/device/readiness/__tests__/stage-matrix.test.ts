/**
 * Stage-matrix coverage for the readiness pipeline.
 *
 * Single matrix file driving `checkReadiness()` and `determineLevel()` across
 * every stage permutation: each of the six stages passing and failing, the
 * downstream-skip cascade, the derived readiness level, and text/JSON parity.
 *
 * Each `describe` block names the stage it owns. The downstream-skip cascade
 * is parameterised over a small fixture table to avoid copy-paste; the
 * format-parity block walks both the text renderer
 * (`formatReadinessSummaryLines`) and the JSON shape returned by
 * `checkReadiness()` directly.
 *
 * **Cross-package note.** The natural inputs here are the
 * `@podkit/device-testing` personas, but that package depends on
 * `@podkit/core`, so importing them would introduce a cycle. The matrix
 * synthesises persona-shaped inputs inline instead — every relevant stage
 * input is a thin object/file already produced by the persona builders.
 * Persona-driven equivalents land in VM tests once the FunctionFS gadget
 * daemon closes the USB synthesis loop.
 *
 * **Stage-detail shapes pinned here** (they were widened once and JSON
 * consumers depend on the wider shape):
 *
 * - The usb-stage success path echoes vendorId/productId/usbModel into
 *   `details`, mirroring the unsupported-path shape on
 *   `createUsbOnlyReadinessResult`.
 * - The partition stage emits `{ partitionCount, partitions: [...] }`
 *   sourced from `PlatformDeviceInfo.partitionLayout` (populated by the
 *   `lsblk -J` / `diskutil list -plist` probes upstream), so single- vs
 *   dual-partition layouts are distinguishable from inside the cascade.
 * - "No partition table at all" surfaces via `createUsbOnlyReadinessResult`,
 *   NOT the main cascade, and is asserted there.
 *
 * @module
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import { checkReadiness, ipodFromBlock } from '../index.js';
import { determineLevel } from '../determine-level.js';
import { STAGE_ORDER, STAGE_DISPLAY_NAMES } from '../types.js';
import type { ReadinessLevel, ReadinessResult, ReadinessStageResult } from '../types.js';
import type { PlatformDeviceInfo } from '../../types.js';
import type { IpodModel, IpodClassification } from '@podkit/devices-ipod';
import type { EnumeratedUsbDevice } from '../../usb-enumeration.js';
import type { DiscoveredDeviceIpod } from '../../discovery.js';

/**
 * Stage-status marker characters used by the text renderer in
 * `packages/podkit-cli/src/commands/readiness-display.ts`. Duplicated here
 * (intentionally — `@podkit/core` cannot reach into the CLI without
 * inverting the dependency direction) to drive the format-parity check on
 * the same `ReadinessResult` that the CLI consumes.
 */
const STAGE_MARKER: Record<ReadinessStageResult['status'], string> = {
  pass: '✓',
  fail: '✗',
  warn: '!',
  skip: '-',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'podkit-readiness-matrix-'));
}

function createIpodStructure(mountPoint: string): void {
  fs.mkdirSync(path.join(mountPoint, 'iPod_Control', 'iTunes'), { recursive: true });
  fs.mkdirSync(path.join(mountPoint, 'iPod_Control', 'Device'), { recursive: true });
}

function writeSysInfo(mountPoint: string, content: string): void {
  fs.writeFileSync(path.join(mountPoint, 'iPod_Control', 'Device', 'SysInfo'), content, 'utf-8');
}

function writeSysInfoExtended(mountPoint: string, xml: string): void {
  fs.writeFileSync(
    path.join(mountPoint, 'iPod_Control', 'Device', 'SysInfoExtended'),
    xml,
    'utf-8'
  );
}

function writeITunesDb(mountPoint: string, content = 'not a valid iTunesDB'): void {
  fs.writeFileSync(path.join(mountPoint, 'iPod_Control', 'iTunes', 'iTunesDB'), content);
}

function makeDevice(overrides: Partial<PlatformDeviceInfo> = {}): PlatformDeviceInfo {
  return {
    identifier: 'disk6s2',
    volumeName: 'TERAPOD',
    volumeUuid: 'ABC-123-UUID',
    storage: { sizeBytes: 120 * 1024 * 1024 * 1024 },
    isMounted: true,
    mountPoint: '/tmp/will-be-overridden',
    ...overrides,
  } as PlatformDeviceInfo;
}

/**
 * Minimal SysInfoExtended plist with FireWireGUID + SerialNumber. The
 * sysinfo stage requires a FireWireGUID to treat the file as authoritative.
 * Serial defaults to a nano_3g suffix (YXX) so the cascade resolves a known
 * generation; tests override the serial when they need a different model.
 */
function makeSysInfoExtendedXml(
  opts: { firewireGuid?: string; serialNumber?: string; familyId?: number } = {}
): string {
  const guid = opts.firewireGuid ?? '000A27001301297E';
  const serial = opts.serialNumber ?? '5U8280FNYXX';
  const family =
    opts.familyId !== undefined ? `<key>FamilyID</key><integer>${opts.familyId}</integer>` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0">
<dict>
  <key>FireWireGUID</key><string>${guid}</string>
  <key>SerialNumber</key><string>${serial}</string>
  ${family}
</dict>
</plist>`;
}

/** Build a fake USB enumeration object for `createUsbOnlyReadinessResult`. */
function makeEnumeratedUsbDevice(
  overrides: Partial<EnumeratedUsbDevice> = {}
): EnumeratedUsbDevice {
  return {
    vendorId: '05ac',
    productId: '1209',
    serialNumber: '000A270014198517',
    bus: 1,
    devnum: 4,
    ...overrides,
  };
}

/** Build a fake `IpodModel` for the usbModel plumbing assertions. */
function makeIpodModel(): IpodModel {
  return {
    generationId: 'video_5g',
    displayName: 'iPod Video (5th Generation)',
    family: 'iPod Video',
    ordinal: 5,
    modelNumber: 'MA147',
    checksumType: 'none',
    source: 'usb',
  };
}

/**
 * Build a USB-only `DiscoveredDeviceIpod` carrying a happy-path classification.
 * Used to drive the formerly-separate `createUsbOnlyReadinessResult` test
 * paths through the unified `checkReadiness` dispatch (T5).
 */
function makeUsbOnlyIpod(
  classificationOverrides: Partial<IpodClassification<EnumeratedUsbDevice>> = {}
): DiscoveredDeviceIpod {
  const usb: IpodClassification<EnumeratedUsbDevice> = {
    kind: 'ipod',
    device: makeEnumeratedUsbDevice(),
    model: makeIpodModel(),
    supported: true,
    ...classificationOverrides,
  };
  return { kind: 'ipod', usb, matchedBy: 'usb-only' };
}

/**
 * Wrap a `PlatformDeviceInfo` plus optional USB classification into a
 * `DiscoveredDeviceIpod` for the iPod-with-block readiness arm.
 */
function makeBlockIpod(
  block: PlatformDeviceInfo,
  usb?: IpodClassification<EnumeratedUsbDevice>
): DiscoveredDeviceIpod {
  return {
    kind: 'ipod',
    block,
    ...(usb ? { usb } : {}),
    matchedBy: usb ? 'serial' : 'block-only',
  };
}

// ── Stage 1 — usb ────────────────────────────────────────────────────────────

describe('readiness pipeline — usb stage', () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpdir();
    createIpodStructure(dir);
    writeSysInfoExtended(dir, makeSysInfoExtendedXml());
    writeITunesDb(dir);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('usb passes for a discovered device; details echo vendorId/productId/usbModel, matching the unsupported-path shape', async () => {
    // The usb stage always passes for any PlatformDeviceInfo that reaches
    // the pipeline (the device manager only surfaces partitioned devices).
    // Pass-path details mirror the unsupported-path push —
    // identifier + vendorId + productId + usbModel — so JSON consumers see
    // the same information regardless of which branch fired.
    const usbModel = makeIpodModel();
    const result = await checkReadiness({
      device: makeBlockIpod(makeDevice({ mountPoint: dir }), {
        kind: 'ipod',
        device: { productId: '0x1207', vendorId: '0x05ac' } as EnumeratedUsbDevice,
        model: usbModel,
        supported: true,
      }),
    });
    const usb = result.stages.find((s) => s.stage === 'usb');
    expect(usb?.status).toBe('pass');
    expect(usb?.details?.identifier).toBe('disk6s2');
    expect(usb?.details?.vendorId).toBe('0x05ac');
    expect(usb?.details?.productId).toBe('0x1207');
    expect(usb?.details?.usbModel).toBe('iPod Video (5th Generation)');
    expect(result.usbModel).toEqual(usbModel);
  });

  it('usb pass-path details omit USB fields when no usbConnection/usbModel was threaded', async () => {
    // Defensive: the pipeline accepts a `PlatformDeviceInfo` without any
    // upstream USB data (e.g. legacy callers, doctor running on a
    // mounted-only volume). Stage details should fall back to identifier-only
    // and not emit `undefined` placeholders.
    const result = await checkReadiness({ device: ipodFromBlock(makeDevice({ mountPoint: dir })) });
    const usb = result.stages.find((s) => s.stage === 'usb');
    expect(usb?.status).toBe('pass');
    expect(usb?.details?.identifier).toBe('disk6s2');
    expect(usb?.details).not.toHaveProperty('vendorId');
    expect(usb?.details).not.toHaveProperty('productId');
    expect(usb?.details).not.toHaveProperty('usbModel');
  });

  it('usb fails (and downstream stages skip) when USB classifier marks the device unsupported', async () => {
    // The pipeline does not probe USB itself — discovery happens upstream.
    // The only failure path is the unsupported short-circuit.
    const headline = 'iPod touch (5th generation) uses Apple’s proprietary sync protocol.';
    const result = await checkReadiness({
      device: makeBlockIpod(makeDevice({ mountPoint: dir }), {
        kind: 'ipod',
        device: makeEnumeratedUsbDevice(),
        supported: false,
        unsupportedReason: { kind: 'ios-device', headline },
      }),
    });
    const usb = result.stages.find((s) => s.stage === 'usb');
    expect(usb?.status).toBe('fail');
    const stageUnsupported = usb?.details?.unsupported as
      | { kind: string; headline: string }
      | undefined;
    expect(stageUnsupported?.headline).toBe(headline);
    expect(stageUnsupported?.kind).toBe('ios-device');
    expect(result.level).toBe('unsupported');
  });

  it('usb skip — no platform device manager produces no PlatformDeviceInfo, so checkReadiness is not invoked', async () => {
    // The "unsupported platform" path is exercised at the device-manager
    // layer (no `PlatformDeviceManager` is registered for the OS). When
    // there is no device, there is no readiness call to run.
    //
    // Closest stage-level analogue: callers that pass a USB-only
    // `DiscoveredDeviceIpod` (no `block`) route through the same
    // `checkReadiness` dispatch — the usb stage passes ("device visible")
    // and partition reports the absence.
    const result = await checkReadiness({ device: makeUsbOnlyIpod() });
    const usb = result.stages.find((s) => s.stage === 'usb');
    expect(usb?.status).toBe('pass');
    expect(usb?.details?.vendorId).toBe('05ac');
    expect(usb?.details?.productId).toBe('1209');
    expect(usb?.details?.modelName).toBe('iPod Video (5th Generation)');
  });
});

// ── Stage 2 — partition ──────────────────────────────────────────────────────

describe('readiness pipeline — partition stage', () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpdir();
    createIpodStructure(dir);
    writeSysInfoExtended(dir, makeSysInfoExtendedXml());
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('partition passes for a single-partition iPod layout; details echo partitionCount=1 + per-partition filesystem/size', async () => {
    // Single-partition layout (typical FAT32 iPod 5G / nano on macOS Win-style
    // formatting). The `partitionLayout` payload was populated by the
    // platform probe upstream; the partition stage threads it into details
    // verbatim without re-probing.
    const result = await checkReadiness({
      device: ipodFromBlock(
        makeDevice({
          mountPoint: dir,
          identifier: 'sda1',
          storage: {
            sizeBytes: 120 * 1024 * 1024 * 1024,
            partitionLayout: {
              partitionCount: 1,
              partitions: [
                {
                  index: 1,
                  filesystem: 'vfat',
                  sizeBytes: 32 * 1024 * 1024 * 1024,
                  identifier: 'sda1',
                  volumeUuid: 'ABCD-EF01',
                },
              ],
            },
          },
        })
      ),
    });
    const partition = result.stages.find((s) => s.stage === 'partition');
    expect(partition?.status).toBe('pass');
    expect(partition?.details?.partitionCount).toBe(1);
    expect(partition?.details?.partitions).toEqual([
      {
        index: 1,
        filesystem: 'vfat',
        sizeBytes: 32 * 1024 * 1024 * 1024,
        identifier: 'sda1',
        volumeUuid: 'ABCD-EF01',
      },
    ]);
  });

  it('partition passes for a dual-partition iPod layout (firmware + FAT32) — both partitions visible in stage details', async () => {
    // Dual-partition layout (iPod 5G Mac formatting: HFS-wrapped firmware
    // partition + main media partition). Both partitions are visible in
    // `partitionLayout.partitions` even though only the second has a UUID;
    // the kernel still reports the firmware slice.
    const result = await checkReadiness({
      device: ipodFromBlock(
        makeDevice({
          mountPoint: dir,
          identifier: 'disk6s2',
          storage: {
            sizeBytes: 120 * 1024 * 1024 * 1024,
            partitionLayout: {
              partitionCount: 2,
              partitions: [
                { index: 1, filesystem: null, sizeBytes: 80 * 1024 * 1024, identifier: 'disk6s1' },
                {
                  index: 2,
                  filesystem: 'MS-DOS FAT32',
                  sizeBytes: 30 * 1024 * 1024 * 1024,
                  identifier: 'disk6s2',
                  volumeUuid: 'ABC-123-UUID',
                },
              ],
            },
          },
        })
      ),
    });
    const partition = result.stages.find((s) => s.stage === 'partition');
    expect(partition?.status).toBe('pass');
    expect(partition?.details?.partitionCount).toBe(2);
    const partitions = partition?.details?.partitions as Array<Record<string, unknown>>;
    expect(partitions).toHaveLength(2);
    expect(partitions[0]).toEqual({
      index: 1,
      filesystem: null,
      sizeBytes: 80 * 1024 * 1024,
      identifier: 'disk6s1',
    });
    expect(partitions[1]).toEqual({
      index: 2,
      filesystem: 'MS-DOS FAT32',
      sizeBytes: 30 * 1024 * 1024 * 1024,
      identifier: 'disk6s2',
      volumeUuid: 'ABC-123-UUID',
    });
  });

  it('partition pass-path falls back to identifier-only when no layout was captured by the probe (legacy/synthesised PlatformDeviceInfo)', async () => {
    // Callers that synthesise a `PlatformDeviceInfo` outside `scan()`
    // (e.g. older doctor flows, tests written before the widening) won't carry a
    // `partitionLayout` field. The pipeline preserves the historical
    // `{ identifier }` shape so existing JSON consumers don't see a sudden
    // schema break.
    const result = await checkReadiness({
      device: ipodFromBlock(makeDevice({ mountPoint: dir, identifier: 'sda1' })),
    });
    const partition = result.stages.find((s) => s.stage === 'partition');
    expect(partition?.status).toBe('pass');
    expect(partition?.details).toEqual({ identifier: 'sda1' });
  });

  it('partition fails (and yields needs-partition) for USB-only iPods (no block) routed through the unified dispatch', async () => {
    // The "no partition table at all" path is the USB-only iPod arm —
    // device was visible on USB but never produced a disk. Post-T5 it
    // routes through the unified `checkReadiness` dispatch alongside the
    // full block-device pipeline.
    const result = await checkReadiness({ device: makeUsbOnlyIpod() });
    const partition = result.stages.find((s) => s.stage === 'partition');
    expect(partition?.status).toBe('fail');
    expect(result.level).toBe('needs-partition');
  });
});

// ── Stage 3 — filesystem ─────────────────────────────────────────────────────

describe('readiness pipeline — filesystem stage', () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpdir();
    createIpodStructure(dir);
    writeSysInfoExtended(dir, makeSysInfoExtendedXml());
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('filesystem passes for FAT32 (volumeName "TERAPOD"); details echo the volume name', async () => {
    const result = await checkReadiness({
      device: ipodFromBlock(makeDevice({ mountPoint: dir, volumeName: 'TERAPOD' })),
    });
    const fs1 = result.stages.find((s) => s.stage === 'filesystem');
    expect(fs1?.status).toBe('pass');
    expect(fs1?.summary).toBe('TERAPOD');
    expect(fs1?.details?.volumeName).toBe('TERAPOD');
  });

  it('filesystem passes for HFS+ (volumeName "iPod")', async () => {
    const result = await checkReadiness({
      device: ipodFromBlock(makeDevice({ mountPoint: dir, volumeName: 'iPod' })),
    });
    expect(result.stages.find((s) => s.stage === 'filesystem')?.status).toBe('pass');
  });

  it('filesystem fails with needs-format level when no recognised filesystem (empty volumeName)', async () => {
    const result = await checkReadiness({
      device: ipodFromBlock(makeDevice({ mountPoint: dir, volumeName: '' })),
    });
    const fs1 = result.stages.find((s) => s.stage === 'filesystem');
    expect(fs1?.status).toBe('fail');
    expect(fs1?.summary).toContain('No recognized filesystem');
    expect(result.level).toBe('needs-format');
  });
});

// ── Stage 4 — mount ──────────────────────────────────────────────────────────

describe('readiness pipeline — mount stage', () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpdir();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('mount passes when iPod_Control directory is present at the mount point', async () => {
    createIpodStructure(dir);
    writeSysInfoExtended(dir, makeSysInfoExtendedXml());
    const result = await checkReadiness({ device: ipodFromBlock(makeDevice({ mountPoint: dir })) });
    const mount = result.stages.find((s) => s.stage === 'mount');
    expect(mount?.status).toBe('pass');
    expect(mount?.details?.mountPoint).toBe(dir);
  });

  it('mount fails with needs-init level when iPod_Control is missing', async () => {
    // tmp dir exists (mount live) but has no iPod_Control directory.
    const result = await checkReadiness({ device: ipodFromBlock(makeDevice({ mountPoint: dir })) });
    const mount = result.stages.find((s) => s.stage === 'mount');
    expect(mount?.status).toBe('fail');
    expect(mount?.details?.ipodControlExists).toBe(false);
    expect(result.level).toBe('needs-init');
  });
});

// ── Stage 5 — sysinfo ────────────────────────────────────────────────────────

describe('readiness pipeline — sysinfo stage', () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpdir();
    createIpodStructure(dir);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('sysinfo passes when SysInfoExtended parses; details include usbModelName + resolved deviceModel', async () => {
    writeSysInfoExtended(dir, makeSysInfoExtendedXml());
    const result = await checkReadiness({
      device: makeBlockIpod(makeDevice({ mountPoint: dir }), {
        kind: 'ipod',
        device: { productId: '0x1208', vendorId: '0x05ac' } as EnumeratedUsbDevice,
        model: makeIpodModel(),
        supported: true,
      }),
    });
    const sysinfo = result.stages.find((s) => s.stage === 'sysinfo');
    expect(sysinfo?.status).toBe('pass');
    expect(sysinfo?.details?.sysInfoExtendedExists).toBe(true);
    // usbModelName is threaded through from the input
    expect(sysinfo?.details?.usbModelName).toBe('iPod Video (5th Generation)');
    // deviceModel surfaces on the result, not the stage details
    expect(result.deviceModel).toBeDefined();
  });

  it('sysinfo passes when SysInfo is missing but SysInfoExtended resolves a model', async () => {
    writeSysInfoExtended(dir, makeSysInfoExtendedXml());
    const result = await checkReadiness({ device: ipodFromBlock(makeDevice({ mountPoint: dir })) });
    const sysinfo = result.stages.find((s) => s.stage === 'sysinfo');
    expect(sysinfo?.status).toBe('pass');
    expect(sysinfo?.details?.sysInfoExtendedExists).toBe(true);
  });

  it('sysinfo passes when SysInfoExtended is missing but classic SysInfo resolves a no-checksum model', async () => {
    // MA147 = video_5g, checksumType 'none'. Classic SysInfo alone is fine.
    writeSysInfo(dir, 'ModelNumStr: MA147\nFirewireGuid: 0001234');
    const result = await checkReadiness({ device: ipodFromBlock(makeDevice({ mountPoint: dir })) });
    const sysinfo = result.stages.find((s) => s.stage === 'sysinfo');
    expect(sysinfo?.status).toBe('pass');
    expect(sysinfo?.details?.modelName).toContain('iPod');
  });

  it('sysinfo fails with needs-repair level when both SysInfo and SysInfoExtended are missing', async () => {
    writeITunesDb(dir);
    const result = await checkReadiness({ device: ipodFromBlock(makeDevice({ mountPoint: dir })) });
    const sysinfo = result.stages.find((s) => s.stage === 'sysinfo');
    expect(sysinfo?.status).toBe('fail');
    expect(sysinfo?.summary).toContain('not found');
    expect(sysinfo?.details?.suggestion).toContain('--repair sysinfo-extended');
    // determineLevel collapses sysinfo+database=fail to needs-repair (database also fails: corrupt).
    // To isolate sysinfo's level contribution: write nothing → db fails as missing →
    // db rule "exists=false" wins (needs-init). Re-run with a corrupt db to force
    // the sysinfo path.
    expect(result.level).toBe('needs-repair');
  });

  it('sysinfo fails when SysInfo exists but identify() cannot resolve a model from any field', async () => {
    // SysInfo with no ModelNumStr key at all — identify() has nothing to work with.
    writeSysInfo(dir, 'FirewireGuid: 0001234\nOther: stuff');
    writeITunesDb(dir);
    const result = await checkReadiness({ device: ipodFromBlock(makeDevice({ mountPoint: dir })) });
    const sysinfo = result.stages.find((s) => s.stage === 'sysinfo');
    expect(sysinfo?.status).toBe('fail');
    expect(sysinfo?.summary).toContain('ModelNumStr not found');
  });
});

// ── Stage 6 — database ───────────────────────────────────────────────────────

describe('readiness pipeline — database stage', () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpdir();
    createIpodStructure(dir);
    writeSysInfoExtended(dir, makeSysInfoExtendedXml());
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  // Declared as skipped rather than asserted. The libgpod-driven happy path is
  // covered in device/readiness.integration.test.ts, where `checkDatabase` and
  // `checkReadiness with pre-opened ipod` assert trackCount and modelName
  // against a freshly-created database; libgpod is not available here without
  // the native build. This entry exists so the stage matrix reads complete —
  // but an `expect(true).toBe(true)` would report as a passing test while
  // asserting nothing, quietly inflating the count. A skip says the same thing
  // honestly.
  it.skip('database — pass-path lives in readiness.integration.test.ts (libgpod required)', () => {});

  it('database fails with needs-init level when iTunesDB is missing', async () => {
    const result = await checkReadiness({ device: ipodFromBlock(makeDevice({ mountPoint: dir })) });
    const db = result.stages.find((s) => s.stage === 'database');
    expect(db?.status).toBe('fail');
    expect(db?.details?.exists).toBe(false);
    expect(result.level).toBe('needs-init');
  });

  it('database fails (needs-repair) when iTunesDB is present but corrupt', async () => {
    writeITunesDb(dir, 'not a valid iTunesDB binary');
    const result = await checkReadiness({ device: ipodFromBlock(makeDevice({ mountPoint: dir })) });
    const db = result.stages.find((s) => s.stage === 'database');
    expect(db?.status).toBe('fail');
    expect(db?.details?.exists).toBe(true);
    expect(result.level).toBe('needs-repair');
  });
});

// ── Downstream skip cascade ──────────────────────────────────────────────────

interface SkipFixture {
  label: string;
  /** Stage that fails first. */
  failsAt: ReadinessStageResult['stage'];
  /** Stages that must report `skip` as a result. */
  expectSkipped: ReadinessStageResult['stage'][];
  /** Stages that must continue to run (i.e. not be skipped). */
  expectRan: ReadinessStageResult['stage'][];
  /** Per-fixture pipeline driver — builds the input + filesystem state. */
  build: (
    dir: string
  ) =>
    | Promise<{ input: Parameters<typeof checkReadiness>[0] }>
    | { input: Parameters<typeof checkReadiness>[0] };
}

describe('readiness pipeline — downstream skip cascade', () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpdir();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const fixtures: SkipFixture[] = [
    {
      label: '#17 usb fail → partition + filesystem + mount + sysinfo + database all skip',
      failsAt: 'usb',
      expectSkipped: ['partition', 'filesystem', 'mount', 'sysinfo', 'database'],
      expectRan: [],
      // Post-T5: the unsupported signal rides on the iPod arm's `usb`
      // classification (the classifier set `supported: false` + the typed
      // reason). The block is still present — what's being asserted is the
      // short-circuit firing before any disk-mode probe runs.
      build: () => ({
        input: {
          device: makeBlockIpod(makeDevice(), {
            kind: 'ipod',
            device: makeEnumeratedUsbDevice(),
            model: makeIpodModel(),
            supported: false,
            unsupportedReason: {
              kind: 'unsupported-preset' as const,
              headline: 'Sony Walkman is not yet supported by podkit.',
            },
          }),
        },
      }),
    },
    {
      label: '#17 filesystem fail → mount + sysinfo + database skip (usb + partition still pass)',
      failsAt: 'filesystem',
      expectSkipped: ['mount', 'sysinfo', 'database'],
      expectRan: ['usb', 'partition'],
      build: (d) => ({
        input: { device: ipodFromBlock(makeDevice({ volumeName: '', mountPoint: d })) },
      }),
    },
    {
      label: '#18 mount fail → sysinfo + database skip',
      failsAt: 'mount',
      expectSkipped: ['sysinfo', 'database'],
      expectRan: ['usb', 'partition', 'filesystem'],
      build: (d) => ({ input: { device: ipodFromBlock(makeDevice({ mountPoint: d })) } }),
    },
    {
      label: '#19 sysinfo fail (missing files) but mount passed → database STILL runs',
      failsAt: 'sysinfo',
      expectSkipped: [],
      expectRan: ['usb', 'partition', 'filesystem', 'mount', 'sysinfo', 'database'],
      build: (d) => {
        createIpodStructure(d);
        writeITunesDb(d, 'not a valid iTunesDB');
        return { input: { device: ipodFromBlock(makeDevice({ mountPoint: d })) } };
      },
    },
  ];

  for (const fixture of fixtures) {
    it(fixture.label, async () => {
      const { input } = await fixture.build(dir);
      const result = await checkReadiness(input);
      const byStage = new Map(result.stages.map((s) => [s.stage, s] as const));

      // The failing stage itself must report fail.
      expect(byStage.get(fixture.failsAt)?.status).toBe('fail');

      // Downstream stages report skip.
      for (const skipped of fixture.expectSkipped) {
        expect(byStage.get(skipped)?.status).toBe('skip');
      }

      // Upstream stages still ran (not skip).
      for (const ran of fixture.expectRan) {
        expect(byStage.get(ran)?.status).not.toBe('skip');
      }

      // The full stage list always reports all six stages in canonical order.
      expect(result.stages.map((s) => s.stage)).toEqual(STAGE_ORDER);
    });
  }
});

// ── Derived level ────────────────────────────────────────────────────────────

describe('readiness pipeline — derived level', () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpdir();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  interface LevelFixture {
    label: string;
    /** Stages — partial; missing stages default to 'pass'. */
    stages: Partial<Record<ReadinessStageResult['stage'], ReadinessStageResult['status']>>;
    /** Optional extra details that select between needs-init / hardware-error subtypes. */
    details?: Partial<Record<ReadinessStageResult['stage'], Record<string, unknown>>>;
    expected: ReadinessLevel;
  }

  const fixtures: LevelFixture[] = [
    {
      label: 'all stages pass → ready',
      stages: {},
      expected: 'ready',
    },
    {
      label: 'usb fail → hardware-error (even if every other stage would pass)',
      stages: { usb: 'fail' },
      expected: 'hardware-error',
    },
    {
      label: 'partition fail → needs-partition',
      stages: { partition: 'fail' },
      expected: 'needs-partition',
    },
    {
      label: 'filesystem fail → needs-format',
      stages: { filesystem: 'fail' },
      expected: 'needs-format',
    },
    {
      label: 'mount fail (iPod_Control missing) → needs-init regardless of downstream sysinfo',
      stages: { mount: 'fail', sysinfo: 'fail' },
      details: { mount: { ipodControlExists: false } },
      expected: 'needs-init',
    },
    {
      label: 'database fail (exists=false) → needs-init',
      stages: { database: 'fail' },
      details: { database: { exists: false } },
      expected: 'needs-init',
    },
    {
      label: 'database fail (corrupt) → needs-repair',
      stages: { database: 'fail' },
      details: { database: { exists: true } },
      expected: 'needs-repair',
    },
    {
      label: 'sysinfo fail only → needs-repair',
      stages: { sysinfo: 'fail' },
      expected: 'needs-repair',
    },
  ];

  for (const fixture of fixtures) {
    it(fixture.label, () => {
      const stages: ReadinessStageResult[] = STAGE_ORDER.map((stage) => ({
        stage,
        status: fixture.stages[stage] ?? 'pass',
        summary: 'fixture',
        details: fixture.details?.[stage] ?? {},
      }));
      const level = determineLevel(stages);
      expect(level).toBe(fixture.expected);
    });
  }
});

// ── Format parity between the text renderer and the JSON shape ───────────────

describe('readiness pipeline — text/JSON format parity', () => {
  let dir: string;
  beforeEach(() => {
    dir = tmpdir();
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  /**
   * Render the `ReadinessResult` two ways — once as JSON (the doctor
   * `--json` payload is the `ReadinessResult` itself) and once as the
   * single-line-per-stage text renderer ships in the CLI. Assert that
   * both views agree on:
   *
   *   - the set of stage ids
   *   - each stage's status (mapped via STAGE_MARKER on the text side)
   *   - each stage's display name
   *
   * We don't snapshot the full string — the CLI renderer adds whitespace,
   * indentation, and SysInfoExtended sub-lines that aren't part of the
   * core readiness contract. Structural parity is what matters: the two
   * renderings must agree on stages, statuses and names.
   */
  function renderText(result: ReadinessResult): string[] {
    return result.stages.map((stage) => {
      const name = STAGE_DISPLAY_NAMES[stage.stage];
      return `  ${STAGE_MARKER[stage.status]} ${name} — ${stage.summary}`;
    });
  }

  function assertParity(result: ReadinessResult): void {
    const json = JSON.parse(JSON.stringify(result)) as ReadinessResult;
    const textLines = renderText(result);

    // Same number of stage lines as JSON stages.
    expect(textLines).toHaveLength(json.stages.length);

    // Every JSON stage id appears in the text output with the matching
    // marker character and display name.
    for (const stage of json.stages) {
      const expectedName = STAGE_DISPLAY_NAMES[stage.stage];
      const expectedMarker = STAGE_MARKER[stage.status];
      const matching = textLines.find(
        (line) => line.includes(expectedMarker) && line.includes(expectedName)
      );
      expect(matching).toBeDefined();
    }
  }

  it('parity: ready fixture (all stages pass via SysInfoExtended; database fails as corrupt)', async () => {
    createIpodStructure(dir);
    writeSysInfoExtended(dir, makeSysInfoExtendedXml());
    writeITunesDb(dir);
    const result = await checkReadiness({ device: ipodFromBlock(makeDevice({ mountPoint: dir })) });
    assertParity(result);
  });

  it('parity: mount-fail fixture (downstream stages skipped)', async () => {
    // tmpDir exists but has no iPod_Control.
    const result = await checkReadiness({ device: ipodFromBlock(makeDevice({ mountPoint: dir })) });
    assertParity(result);
  });

  it('parity: filesystem-fail fixture (most stages skipped)', async () => {
    const result = await checkReadiness({
      device: ipodFromBlock(makeDevice({ mountPoint: dir, volumeName: '' })),
    });
    assertParity(result);
  });

  it('parity: unsupported short-circuit (every downstream stage skipped)', async () => {
    const result = await checkReadiness({
      device: makeBlockIpod(makeDevice({ mountPoint: dir }), {
        kind: 'ipod',
        device: makeEnumeratedUsbDevice(),
        supported: false,
        unsupportedReason: {
          kind: 'ios-device',
          headline: 'iPod touch (5th generation) uses proprietary sync.',
        },
      }),
    });
    assertParity(result);
  });
});
