/**
 * SysInfoExtended consistency check
 *
 * Verifies that the on-disk `iPod_Control/Device/SysInfoExtended` agrees
 * with the live device on two independent axes:
 *
 *   1. **FireWireGUID** — the GUID stored in the file matches the
 *      FireWireGUID reported live (USB descriptor's serial number, or
 *      a SCSI/USB inquiry result). A mismatch means the file is stale —
 *      typically because the volume was cloned/synced from a different
 *      iPod, or the device was replaced.
 *
 *   2. **Model** — the model implied by the file (via `ModelNumStr` or
 *      `SerialNumber` suffix) matches the model identified live (USB
 *      product ID lookup). A mismatch means the file came from a
 *      different generation entirely.
 *
 * **Missing files are not a failure.** `SysInfoExtended` is optional
 * persisted state — if it's absent the check returns `skip`, since
 * there's nothing on disk to verify against. The user can still
 * populate it via `podkit doctor --repair sysinfo-extended` if they
 * want the file present, but absence on its own is not actionable.
 *
 * **Live data axes are independently optional.** If the host can't
 * resolve a live FireWireGUID, the GUID axis is skipped. If no live
 * model is provided, the model axis is skipped. The check only fails
 * when at least one axis can be evaluated *and* it disagrees.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parsePlist, extractFromPlist, normaliseFireWireGuid } from '@podkit/ipod-firmware';
import { identify, type IpodModel } from '@podkit/devices-ipod';
import { sysInfoExtendedCheck, runSysInfoExtendedRepair } from './sysinfo-extended.js';
import type { DiagnosticCheck, CheckResult, DiagnosticContext } from '../types.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const SYSINFO_EXTENDED_PATH = join('iPod_Control', 'Device', 'SysInfoExtended');

// ── Injectable filesystem reader (for unit testing without real FS) ───────────

export interface SysinfFsReader {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: 'utf-8'): string;
}

// ── Axis result types ─────────────────────────────────────────────────────────

type AxisStatus = 'pass' | 'fail' | 'skip';

interface AxisResult {
  /** Which dimension this axis covered. */
  name: 'firewireGuid' | 'model';
  status: AxisStatus;
  /** On-disk value (string for GUID, displayName for model). */
  onDisk?: string;
  /** Live value (string for GUID, displayName for model). */
  live?: string;
  /** Why the axis was skipped, when status === 'skip'. */
  skipReason?: string;
}

// ── Pure check logic ──────────────────────────────────────────────────────────

/**
 * Core consistency check logic.
 *
 * Accepts an injectable filesystem reader so unit tests can run without
 * touching the real filesystem. Live identity is read from
 * `ctx.liveIdentity` — populated by the doctor command from
 * `resolveUsbDeviceFromPath` and the readiness pipeline's `usbModel`.
 */
export async function checkSysinfoConsistency(
  ctx: DiagnosticContext,
  fsReader: SysinfFsReader = { existsSync, readFileSync: (p, enc) => readFileSync(p, enc) }
): Promise<CheckResult> {
  const filePath = join(ctx.mountPoint, SYSINFO_EXTENDED_PATH);

  // 1. File absent → skip. Missing optional state is not a failure.
  if (!fsReader.existsSync(filePath)) {
    return {
      status: 'skip',
      summary: 'SysInfoExtended not present on device (run --repair sysinfo-extended to create it)',
      repairable: false,
    };
  }

  // 2. Read the file. I/O errors on a present file are real corruption.
  let xml: string;
  try {
    xml = fsReader.readFileSync(filePath, 'utf-8');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      status: 'fail',
      summary: `SysInfoExtended could not be read: ${msg}`,
      repairable: true,
      details: { filePath },
    };
  }

  // 3. Parse + extract. A present-but-unparseable file is corruption,
  //    repairable by re-fetching from USB.
  let parsed;
  try {
    const plist = parsePlist(xml);
    parsed = extractFromPlist(plist, xml);
  } catch {
    return {
      status: 'fail',
      summary: 'SysInfoExtended present but XML failed to parse',
      repairable: true,
      details: { filePath },
    };
  }
  if (!parsed) {
    return {
      status: 'fail',
      summary: 'SysInfoExtended present but missing required identity fields',
      repairable: true,
      details: { filePath },
    };
  }

  const onDiskGuid = parsed.firewireGuid; // already normalised by extractFromPlist
  const onDiskModel = identifyOnDiskModel(parsed.modelNumber, parsed.serialNumber);
  const live = ctx.liveIdentity;

  // 4. Evaluate each axis independently.
  const axes: AxisResult[] = [
    evaluateGuidAxis(onDiskGuid, live?.firewireGuid),
    evaluateModelAxis(onDiskModel, live?.model),
  ];

  return summariseAxes(axes, { onDiskGuid, onDiskModel, filePath });
}

/**
 * Identify the model implied by the on-disk file. Prefers `ModelNumStr`
 * (more specific — yields capacity + color) and falls back to the
 * serial number's variant suffix.
 */
function identifyOnDiskModel(
  modelNumber: string | undefined,
  serialNumber: string
): IpodModel | undefined {
  if (modelNumber) {
    const fromModelNum = identify({ from: 'sysinfo', modelNumStr: modelNumber });
    if (fromModelNum) return fromModelNum;
  }
  return identify({ from: 'serial', serialNumber });
}

function evaluateGuidAxis(onDiskGuid: string, liveGuid: string | undefined): AxisResult {
  if (!liveGuid) {
    return {
      name: 'firewireGuid',
      status: 'skip',
      onDisk: onDiskGuid,
      skipReason: 'live FireWireGUID unavailable',
    };
  }
  const normLive = normaliseFireWireGuid(liveGuid);
  return {
    name: 'firewireGuid',
    status: onDiskGuid === normLive ? 'pass' : 'fail',
    onDisk: onDiskGuid,
    live: normLive,
  };
}

function evaluateModelAxis(
  onDiskModel: IpodModel | undefined,
  liveModel: IpodModel | undefined
): AxisResult {
  if (!liveModel) {
    return {
      name: 'model',
      status: 'skip',
      onDisk: onDiskModel?.displayName,
      skipReason: 'live model unavailable',
    };
  }
  if (!onDiskModel) {
    return {
      name: 'model',
      status: 'skip',
      live: liveModel.displayName,
      skipReason: 'on-disk identity could not be resolved to a known model',
    };
  }
  // Compare at generation granularity — the USB-derived live model only
  // resolves to a generation (no capacity/color), so anything finer than
  // that would produce false negatives.
  return {
    name: 'model',
    status: onDiskModel.generationId === liveModel.generationId ? 'pass' : 'fail',
    onDisk: onDiskModel.displayName,
    live: liveModel.displayName,
  };
}

function summariseAxes(
  axes: AxisResult[],
  context: { onDiskGuid: string; onDiskModel?: IpodModel; filePath: string }
): CheckResult {
  const failed = axes.filter((a) => a.status === 'fail');
  const passed = axes.filter((a) => a.status === 'pass');

  const baseDetails: Record<string, unknown> = {
    onDiskGuid: context.onDiskGuid,
    onDiskModel: context.onDiskModel?.displayName,
    onDiskGenerationId: context.onDiskModel?.generationId,
    axes: axes.map((a) => ({
      name: a.name,
      status: a.status,
      onDisk: a.onDisk,
      live: a.live,
      ...(a.skipReason ? { skipReason: a.skipReason } : {}),
    })),
    filePath: context.filePath,
  };

  if (failed.length > 0) {
    const summary = failed
      .map((a) =>
        a.name === 'firewireGuid'
          ? `FireWireGUID mismatch (on-disk ${a.onDisk}, live ${a.live})`
          : `model mismatch (on-disk ${a.onDisk}, live ${a.live})`
      )
      .join('; ');
    return {
      status: 'fail',
      summary: `SysInfoExtended disagrees with live device: ${summary}`,
      repairable: true,
      details: baseDetails,
    };
  }

  if (passed.length === 0) {
    // Everything skipped — file is present but nothing live to verify.
    return {
      status: 'skip',
      summary: `SysInfoExtended present (GUID ${context.onDiskGuid}); no live data available to verify`,
      repairable: false,
      details: baseDetails,
    };
  }

  const verified = passed.map((a) => a.name).join(' + ');
  return {
    status: 'pass',
    summary: `SysInfoExtended matches live device (${verified})`,
    repairable: false,
    details: baseDetails,
  };
}

// ── Exported check object ─────────────────────────────────────────────────────

export const sysinfoConsistencyCheck: DiagnosticCheck = {
  id: 'sysinfo-consistency',
  name: 'SysInfoExtended consistency with device',
  scope: 'device',
  applicableTo: ['ipod'],

  async check(ctx: DiagnosticContext): Promise<CheckResult> {
    return checkSysinfoConsistency(ctx);
  },

  // Re-use the sysinfo-extended repair runner with `force: true` so a stale
  // on-disk file is re-read from USB and overwritten. Without `force`, the
  // existing-file short-circuit in `ensureSysInfoExtended` would return
  // success without touching disk — the original false-success bug.
  repair: {
    description: sysInfoExtendedCheck.repair!.description,
    requirements: sysInfoExtendedCheck.repair!.requirements,
    async run(ctx, options) {
      return runSysInfoExtendedRepair(ctx, options, /* force */ true);
    },
  },
};
