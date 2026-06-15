/**
 * Pure rendering for `podkit device scan` text output.
 *
 * `renderDeviceScan` produces the line-by-line text rendering of the scan
 * result. It is fully synchronous, has no I/O, no side effects, no
 * `OutputContext` dependency, and no dynamic imports — the action callback
 * does enumeration, classification, readiness checks, and disk pairing, then
 * hands the resolved state to this function. The caller iterates the
 * returned lines and writes each one (empty strings represent blank lines
 * for `out.newline()`).
 *
 * Extracted from the `device scan` action callback to:
 *
 * 1. Pin the rendering output in unit tests (concrete inputs → concrete
 *    line strings) — closing the coverage gap left by
 *    `device-scan.integration.test.ts`, which only validates classification.
 * 2. Make the regression "render every USB device as a phantom iPod"
 *    catchable at the rendering layer, not just at the classification
 *    boundary. Empty inputs render no `Unknown iPod` lines.
 */

import type {
  EnumeratedUsbDevice,
  IpodClassification,
  ReadinessResult,
  ReadinessStageResult,
  ClassifiedUsbDevice,
  UnsupportedDeviceClassification,
} from '@podkit/core';

import { bold, formatBytes, formatNumber } from '../output/index.js';
import { getDeviceTypeDisplayName } from './open-device.js';
import {
  collectReadinessIssues,
  formatIssueLines,
  formatReadinessLevel,
  formatReadinessSummaryLines,
  formatUnsupportedReasonLines,
} from './readiness-display.js';

// ── Types ────────────────────────────────────────────────────────────────────

type IpodRecognized = Extract<ClassifiedUsbDevice, { kind: 'ipod' }>;
type MassStorageRecognized = Extract<ClassifiedUsbDevice, { kind: 'mass-storage' }>;

/**
 * A mounted iPod row, pre-resolved with its readiness, configured-name,
 * and a fallback USB model display name (used when readiness is unavailable
 * — e.g. unsupported platforms).
 */
export interface DeviceScanIpodRow {
  device: {
    volumeName: string;
    volumeUuid: string;
    identifier: string;
    storage: { sizeBytes: number };
    isMounted: boolean;
    mountPoint?: string;
  };
  readiness?: ReadinessResult;
  configuredName?: string;
  fallbackUsbModelDisplayName?: string;
}

export interface ConfiguredDeviceSummary {
  name: string;
  type: string;
  path?: string;
}

/**
 * Inputs to {@link renderDeviceScan}.
 *
 * Each list is rendered as its own group. The renderer makes no effort to
 * derive group membership from raw enumeration: only entries that the
 * caller has placed in one of these lists appear in the output. In
 * particular, an empty input on every list yields the standard
 * "no devices" footer with no phantom entries, regardless of what was on
 * the USB bus.
 */
export interface DeviceScanInput {
  /** Mounted iPods, paired with readiness and config metadata. */
  ipods: DeviceScanIpodRow[];
  /** USB-only iPods (recognised by `classifyAsIpod`, no matching disk). */
  usbOnlyIpods: IpodClassification<EnumeratedUsbDevice>[];
  /** Mass-storage devices recognised by `classifyAsMassStorage`. */
  massStorageDevices: MassStorageRecognized[];
  /**
   * Vendor-recognised but no preset registered (Sony Walkman, …). Rendered
   * as USB-only entries with `level: 'unsupported'` + the canonical reason.
   * Optional for backwards compatibility with older callers; new callers
   * should pass through any `kind: 'unsupported'` classifications from
   * `classifyUsbDevices`.
   */
  unsupportedDevices?: UnsupportedDeviceClassification<EnumeratedUsbDevice>[];
  /** Devices in the user's config that were NOT seen during the scan. */
  configuredDevices: ConfiguredDeviceSummary[];
  /** Whether the platform's device manager supports enumeration. */
  isSupportedPlatform: boolean;
  /**
   * Build the stage list for a USB-only iPod. Injected so this module stays
   * synchronous and free of dynamic imports.
   */
  createUsbOnlyReadinessResult: (classification: IpodRecognized) => ReadinessResult;
}

// ── Renderer ─────────────────────────────────────────────────────────────────

/**
 * Render the `device scan` text output as a list of lines.
 *
 * Empty strings in the result correspond to blank lines (`out.newline()`).
 * Non-empty strings are written verbatim (`out.print(line)`).
 *
 * Pure — same input always produces the same output, no I/O, no side effects.
 */
export function renderDeviceScan(input: DeviceScanInput): string[] {
  const {
    ipods,
    usbOnlyIpods,
    massStorageDevices,
    unsupportedDevices,
    configuredDevices,
    isSupportedPlatform,
    createUsbOnlyReadinessResult,
  } = input;

  const unsupportedList = unsupportedDevices ?? [];

  const hasAnyDevices =
    ipods.length > 0 ||
    usbOnlyIpods.length > 0 ||
    massStorageDevices.length > 0 ||
    unsupportedList.length > 0 ||
    configuredDevices.length > 0;

  if (!hasAnyDevices) {
    return [
      'No devices found.',
      '',
      'Make sure your device is connected and mounted, or add one with: podkit device add',
    ];
  }

  const lines: string[] = [];

  // Mounted iPods with readiness
  for (const row of ipods) {
    pushIpodRow(lines, row);
  }

  // USB-only iPods (no disk representation)
  for (const recognised of usbOnlyIpods) {
    pushUsbOnlyIpodRow(lines, recognised, createUsbOnlyReadinessResult);
  }

  // Mass-storage DAPs (Echo Mini, etc.)
  for (const recognised of massStorageDevices) {
    pushMassStorageRow(lines, recognised);
  }

  // Recognised-but-unsupported (Sony Walkman, …).
  for (const recognised of unsupportedList) {
    pushUnsupportedRow(lines, recognised);
  }

  // No-detected-devices footer (only when configured devices exist alongside
  // an otherwise-empty bus, on a supported platform).
  if (
    ipods.length === 0 &&
    usbOnlyIpods.length === 0 &&
    massStorageDevices.length === 0 &&
    unsupportedList.length === 0 &&
    isSupportedPlatform
  ) {
    lines.push('No iPod devices found.');
    lines.push('');
  }

  // Configured-but-not-detected devices
  if (configuredDevices.length > 0) {
    lines.push('Not detected:');
    for (const cd of configuredDevices) {
      const pathInfo = cd.path ? ` — ${cd.path}` : '';
      lines.push(`  ${bold(cd.name)} (${getDeviceTypeDisplayName(cd)})${pathInfo}`);
    }
    lines.push('');
  }

  return lines;
}

// ── Group renderers ──────────────────────────────────────────────────────────

function pushIpodRow(lines: string[], row: DeviceScanIpodRow): void {
  const { device, readiness, configuredName, fallbackUsbModelDisplayName } = row;
  const label = device.volumeName || '(unnamed)';
  const identifier = device.identifier ? ` (${device.identifier})` : '';

  const displayModel = readiness?.deviceModel ?? readiness?.usbModel;
  const modelLabel = displayModel?.displayName ?? fallbackUsbModelDisplayName;
  const modelSource = displayModel?.source === 'usb' ? ' (USB)' : '';
  if (modelLabel) {
    lines.push(`  ${bold(label)}${identifier}  ${modelLabel}${modelSource}`);
  } else {
    lines.push(`  ${bold(label)}${identifier}`);
  }

  if (configuredName) {
    lines.push(`  Configured as: ${configuredName}`);
  } else {
    const suggestedName = label.toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'myipod';
    lines.push(`  Not configured — run: podkit device add -d ${suggestedName}`);
  }

  lines.push('');

  if (readiness) {
    const cmdId = configuredName ?? device.mountPoint ?? label;
    pushReadinessBlock(lines, readiness.stages, readiness, cmdId);
  } else {
    lines.push(`    Volume UUID:  ${device.volumeUuid || '(unknown)'}`);
    lines.push(`    Size:         ${formatBytes(device.storage.sizeBytes)}`);
    if (device.isMounted && device.mountPoint) {
      lines.push(`    Mounted:      ${device.mountPoint}`);
    } else {
      lines.push(`    Mounted:      no`);
    }
  }
  lines.push('');
}

function pushUsbOnlyIpodRow(
  lines: string[],
  recognised: IpodRecognized,
  createUsbOnlyReadinessResult: (classification: IpodRecognized) => ReadinessResult
): void {
  // Header label preference (TASK-317.03 sub-behaviour #4):
  //   1. resolved cascade model name (`iPod touch 5th generation`, …)
  //   2. friendly fallback for iOS-range PIDs not in IPOD_USB_IDS
  //      (modern iPhone/iPad PIDs that classify as "iOS device")
  //   3. defensive `Unknown iPod`
  // No PID-only "Unknown iPod" rows when the classifier already knows
  // enough to call it an iOS device.
  const label = recognised.model?.displayName ?? deriveUsbOnlyLabel(recognised);
  lines.push(`  ${bold(label)} (USB only)`);
  lines.push('');

  if (!recognised.supported) {
    lines.push('  This device is not supported by podkit.');
    if (recognised.unsupportedReason) {
      lines.push(`  ${recognised.unsupportedReason.headline}`);
    }
  } else {
    const readiness = createUsbOnlyReadinessResult(recognised);
    pushReadinessBlock(lines, readiness.stages, readiness, label);
  }
  lines.push('');
}

/**
 * Fallback header label for a USB-only iPod when the cascade model is
 * absent. `classifyAsIpod` returns no model for unsupported PIDs in the iOS
 * range (0x1290–0x12af) catch-all — render them as `iOS device` rather than
 * `Unknown iPod`.
 */
function deriveUsbOnlyLabel(recognised: IpodRecognized): string {
  const pid = parseInt(recognised.device.productId.replace(/^0x/i, ''), 16);
  if (Number.isFinite(pid) && pid >= 0x1290 && pid <= 0x12af) {
    return 'iOS device';
  }
  return 'Unknown iPod';
}

function pushUnsupportedRow(
  lines: string[],
  recognised: UnsupportedDeviceClassification<EnumeratedUsbDevice>
): void {
  const label = recognised.family ?? 'Unsupported device';
  const vid = recognised.device.vendorId;
  const pid = recognised.device.productId;
  lines.push(`  ${bold(label)} (USB ${vid}:${pid})`);
  lines.push('');
  lines.push('  This device is not supported by podkit.');
  lines.push(`  ${recognised.reason}`);
  lines.push('');
}

function pushMassStorageRow(lines: string[], recognised: MassStorageRecognized): void {
  // Pre-add scan — no user-supplied display overrides yet, only the
  // preset's defaults shown to confirm what `device add` will store.
  const presetDisplayName = getDeviceTypeDisplayName({ type: recognised.presetId });
  if (recognised.device.diskIdentifier) {
    lines.push(
      `  ${bold(presetDisplayName)} (${recognised.presetId}) — disk: ${recognised.device.diskIdentifier}`
    );
  } else {
    lines.push(`  ${bold(presetDisplayName)} (${recognised.presetId}) — no volume mounted`);
  }
  lines.push('');
}

// ── Readiness rendering ──────────────────────────────────────────────────────

function pushReadinessBlock(
  lines: string[],
  stages: ReadinessStageResult[],
  readiness: ReadinessResult,
  deviceName: string
): void {
  for (const line of formatReadinessSummaryLines(stages)) {
    lines.push(line);
  }
  lines.push('');

  if (readiness.level === 'ready' && readiness.summary) {
    const trackStr = formatNumber(readiness.summary.trackCount);
    const parts = [`${trackStr} track${readiness.summary.trackCount === 1 ? '' : 's'}`];
    if (readiness.summary.freeBytes !== undefined) {
      parts.push(`${formatBytes(readiness.summary.freeBytes)} free`);
    }
    lines.push(`  Ready — ${parts.join(', ')}`);
  } else if (readiness.level === 'unsupported') {
    lines.push(`  ${formatReadinessLevel(readiness.level, deviceName)}`);
    for (const line of formatUnsupportedReasonLines(readiness.unsupported)) {
      lines.push(`  ${line}`);
    }
  } else {
    lines.push(`  ${formatReadinessLevel(readiness.level, deviceName)}`);
  }

  const issues = collectReadinessIssues(stages, deviceName);
  if (issues.length > 0) {
    lines.push('');
    for (const line of formatIssueLines(issues)) {
      lines.push(line);
    }
  }
}
