/**
 * Render helpers for `podkit device add`.
 *
 * Extracts the success-block printers used by all three add flows
 * (mass-storage, iPod-by-path, iPod-by-scan). Each flow wraps its
 * printer in `out.result(envelope, () => printX(...))` so JSON mode
 * still emits the structured envelope and text mode runs the printer.
 *
 * The two iPod tails (`add.ts:864-895` and `add.ts:1347-1378`) are
 * byte-identical apart from where `capabilities` comes from — single
 * helper covers both. The mass-storage tail (`add.ts:540-569`) has a
 * different shape (config-file path + label + "next steps" block) and
 * has its own helper.
 */

import type { DeviceCapabilities } from '@podkit/core';
import { OutputContext } from '../../output/index.js';
import { printCapabilitySummary } from './capability-summary.js';
import { getDeviceTypeDisplayName } from '../open-device.js';
import type { DeviceConfig } from '../../config/types.js';

/**
 * Prompt lines shown before the firmware-inquiry confirmation when
 * SysInfoExtended is missing. Shared between the explicit-path and
 * scan branches so the user-facing copy stays identical.
 */
export const SYSINFO_MISSING_PROMPT_LINES = [
  'SysInfo/SysInfoExtended is missing — required for syncing this iPod.',
  'podkit can read it from the device firmware over USB.',
  'Learn more: https://jvgomg.github.io/podkit/devices/supported-devices/',
] as const;

/**
 * Text-mode body for the iPod add-success block (both `--path` and
 * scan flows). Renders the checklist plus capability summary and the
 * `Done. Try: …` hint. Caller wraps this in `out.result(envelope, () => …)`.
 */
export function printIpodDeviceAddSuccess(
  out: OutputContext,
  opts: {
    name: string;
    modelDisplay: string;
    capabilities: DeviceCapabilities | null | undefined;
    firmwareWritten: boolean;
    isFirstDevice: boolean;
    initialized: boolean;
  }
): void {
  out.newline();
  if (opts.firmwareWritten) {
    out.print('  ✓ SysInfoExtended written');
  }
  out.print('  ✓ Added to config');
  if (opts.isFirstDevice) {
    out.print('  ✓ Set as default device');
  }
  if (opts.initialized) {
    out.print(`  ✓ Database initialized (${opts.modelDisplay})`);
  }
  if (opts.capabilities) {
    out.newline();
    printCapabilitySummary(out, opts.capabilities, {
      kind: 'ipod',
      modelDisplay: opts.modelDisplay,
    });
  }
  out.newline();
  out.print(`Done. Try: podkit sync -d ${opts.name} --dry-run`);
}

/**
 * Text-mode body for the mass-storage add-success block. Renders the
 * config-file path, the type label, "set as default" when first, and a
 * "Next steps" block pointing at collection setup + sync.
 */
export function printMassStorageDeviceAddSuccess(
  out: OutputContext,
  opts: {
    name: string;
    deviceType: NonNullable<DeviceConfig['type']>;
    configResult: { created: boolean; configPath: string };
    isFirstDevice: boolean;
  }
): void {
  out.newline();
  out.print(
    opts.configResult.created
      ? `Created config file: ${opts.configResult.configPath}`
      : `Updated config file: ${opts.configResult.configPath}`
  );
  out.newline();
  out.print(
    `Device "${opts.name}" added to config (${getDeviceTypeDisplayName({ type: opts.deviceType })}).`
  );
  if (opts.isFirstDevice) {
    out.print(`Set as default device.`);
  }
  out.newline();
  out.print('Next steps:');
  out.print('  podkit collection add -t music -c <name> --path <path>   # Add your music library');
  out.print(`  podkit sync                    # Sync to this device`);
}
