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
  DiscoveredDevice,
  DiscoveredDeviceIpod,
  ReadinessResult,
  ReadinessStageResult,
} from '@podkit/core';
import { displayFor } from '@podkit/core';

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

/**
 * One row in the scan output — a discovered device with the per-row context
 * the renderer needs but which doesn't belong on the pure `DiscoveredDevice`
 * data type itself.
 */
export interface DiscoveredDeviceRow {
  device: DiscoveredDevice;
  /** Readiness result. Only populated for iPod-arm devices (mass-storage + unsupported don't run readiness). */
  readiness?: ReadinessResult;
  /** Name from the user's config when this device matches a configured entry by volumeUuid. */
  configuredName?: string;
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
  /** All discovered devices, pre-computed with per-row readiness and config metadata. */
  discovered: DiscoveredDeviceRow[];
  /** Devices in the user's config that were NOT seen during the scan. */
  configuredDevices: ConfiguredDeviceSummary[];
  /** Whether the platform's device manager supports enumeration. */
  isSupportedPlatform: boolean;
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
  const { discovered, configuredDevices, isSupportedPlatform } = input;

  const hasAnyDevices = discovered.length > 0 || configuredDevices.length > 0;

  if (!hasAnyDevices) {
    return [
      'No devices found.',
      '',
      'Make sure your device is connected and mounted, or add one with: podkit device add',
    ];
  }

  const lines: string[] = [];

  for (const row of discovered) {
    pushDeviceRow(lines, row);
  }

  // No-detected-devices footer (only when configured devices exist alongside
  // an otherwise-empty bus, on a supported platform).
  if (discovered.length === 0 && isSupportedPlatform) {
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

// ── Single dispatcher ────────────────────────────────────────────────────────

function pushDeviceRow(lines: string[], row: DiscoveredDeviceRow): void {
  switch (row.device.kind) {
    case 'ipod':
      pushIpodRow(lines, row, row.device);
      break;
    case 'mass-storage':
      pushMassStorageRow(lines, row.device);
      break;
    case 'unsupported':
      pushUnsupportedRow(lines, row.device);
      break;
  }
}

// ── Per-kind renderers ───────────────────────────────────────────────────────

function pushIpodRow(
  lines: string[],
  row: DiscoveredDeviceRow,
  device: DiscoveredDeviceIpod
): void {
  const { readiness, configuredName } = row;

  if (device.matchedBy === 'usb-only') {
    // USB-only iPod (no block-device representation).
    //
    // Header label preference (TASK-317.03 sub-behaviour #4):
    //   1. resolved cascade model name (`iPod touch 5th generation`, …)
    //   2. friendly fallback for iOS-range PIDs not in IPOD_USB_IDS
    //      (modern iPhone/iPad PIDs that classify as "iOS device")
    //   3. defensive `Unknown iPod`
    // No PID-only "Unknown iPod" rows when the classifier already knows
    // enough to call it an iOS device.
    const label = device.usb?.model?.displayName ?? deriveUsbOnlyLabel(device);
    lines.push(`  ${bold(label)} (USB only)`);
    lines.push('');

    if (device.usb && !device.usb.supported) {
      lines.push('  This device is not supported by podkit.');
      if (device.usb.unsupportedReason) {
        lines.push(`  ${device.usb.unsupportedReason.headline}`);
      }
    } else if (readiness) {
      pushReadinessBlock(lines, readiness.stages, readiness, label);
    }
    lines.push('');
    return;
  }

  // Block-side iPod (mounted or block-only). `block` is guaranteed present
  // for every `matchedBy` value except `'usb-only'`, which returned above.
  const block = device.block!;
  const label = block.volumeName || '(unnamed)';
  const identifier = block.identifier ? ` (${block.identifier})` : '';

  // Model label: prefer readiness-resolved model (sysinfo cascade), then
  // displayFor(device).rich as fallback (USB model name from classification).
  // The `source === 'ipod-generation'` guard suppresses the volume-name
  // fallback (`source: 'usb-fingerprint'`) — for block-only iPods, the volume
  // name is already the header `label`, so re-emitting it here would duplicate.
  const displayModel = readiness?.deviceModel ?? readiness?.usbModel;
  const modelLabel =
    displayModel?.displayName ??
    (() => {
      const d = displayFor(device);
      return d.source === 'ipod-generation' ? d.rich : undefined;
    })();
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
    const cmdId = configuredName ?? (block.isMounted ? block.mountPoint : undefined) ?? label;
    pushReadinessBlock(lines, readiness.stages, readiness, cmdId);
  } else {
    lines.push(`    Volume UUID:  ${block.volumeUuid || '(unknown)'}`);
    lines.push(`    Size:         ${formatBytes(block.storage.sizeBytes)}`);
    if (block.isMounted && block.mountPoint) {
      lines.push(`    Mounted:      ${block.mountPoint}`);
    } else {
      lines.push(`    Mounted:      no`);
    }
  }
  lines.push('');
}

/**
 * Fallback header label for a USB-only iPod when the cascade model is
 * absent. `classifyAsIpod` returns no model for unsupported PIDs in the iOS
 * range (0x1290–0x12af) catch-all — render them as `iOS device` rather than
 * `Unknown iPod`.
 */
function deriveUsbOnlyLabel(device: DiscoveredDeviceIpod): string {
  const productId = device.usb?.device.productId;
  if (productId) {
    const pid = parseInt(productId.replace(/^0x/i, ''), 16);
    if (Number.isFinite(pid) && pid >= 0x1290 && pid <= 0x12af) {
      return 'iOS device';
    }
  }
  return 'Unknown iPod';
}

function pushUnsupportedRow(
  lines: string[],
  device: import('@podkit/core').DiscoveredDeviceUnsupported
): void {
  const label = device.usb.family ?? 'Unsupported device';
  const vid = device.usb.device.vendorId;
  const pid = device.usb.device.productId;
  lines.push(`  ${bold(label)} (USB ${vid}:${pid})`);
  lines.push('');
  lines.push('  This device is not supported by podkit.');
  lines.push(`  ${device.usb.reason}`);
  lines.push('');
}

function pushMassStorageRow(
  lines: string[],
  device: import('@podkit/core').DiscoveredDeviceMassStorage
): void {
  if (!device.usb) {
    // Block-only mass-storage: no preset metadata. Use displayFor fallback.
    const display = displayFor(device);
    lines.push(`  ${bold(display.rich)} — no USB descriptor`);
    lines.push('');
    return;
  }
  // Pre-add scan — no user-supplied display overrides yet, only the
  // preset's defaults shown to confirm what `device add` will store.
  const presetDisplayName = getDeviceTypeDisplayName({ type: device.usb.presetId });
  if (device.usb.device.diskIdentifier) {
    lines.push(
      `  ${bold(presetDisplayName)} (${device.usb.presetId}) — disk: ${device.usb.device.diskIdentifier}`
    );
  } else {
    lines.push(`  ${bold(presetDisplayName)} (${device.usb.presetId}) — no volume mounted`);
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
