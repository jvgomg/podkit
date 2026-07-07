/**
 * `podkit __container-probe` — container device-access probe (internal).
 *
 * The Docker entrypoint invokes this at startup so the container tells the
 * user what device access it has and what to do about it, before they hit a
 * confusing failure. Pure decision logic (`formatDeviceAccessReport`) is
 * separated from the filesystem/proc collection so the guidance is
 * unit-testable without a container.
 *
 * The report is informational — the command always exits 0; missing access
 * must never block startup (a path-only setup legitimately has no USB).
 */

import * as fs from 'node:fs';
import { Command } from 'commander';

/** What the container can currently reach, as facts (no policy). */
export interface ContainerDeviceAccessView {
  /** The conventional iPod bind-mount path (default `/ipod`). */
  ipodPath: string;
  /** Whether `ipodPath` is an active mount point (from /proc/mounts). */
  ipodMounted: boolean;
  /** Whether `/dev/bus/usb` exists (USB passthrough). */
  usbBusPresent: boolean;
  /** Number of `/dev/sg*` generic-SCSI nodes. */
  sgDeviceCount: number;
}

/**
 * Whether `path` is an active mount point according to /proc/mounts content.
 *
 * Mount points with spaces are octal-escaped (`\040`) in /proc/mounts; decode
 * before comparing. Exact match only — `/ipod` must not match `/ipod2`.
 */
export function isMountPoint(procMounts: string, path: string): boolean {
  for (const line of procMounts.split('\n')) {
    const target = line.split(' ')[1];
    if (!target) continue;
    const decoded = target.replace(/\\(\d{3})/g, (_, oct: string) =>
      String.fromCharCode(parseInt(oct, 8))
    );
    if (decoded === path) return true;
  }
  return false;
}

/**
 * Turn an access view into the startup report.
 *
 * Guidance distinguishes the two onboarding lanes: the **path baseline**
 * (steady-state sync needs only the mounted volume) and the **one-time USB
 * setup** (`device add` for iPods without authoritative on-disk identity).
 * Missing USB is therefore advisory, not an error, when the path lane works.
 */
export function formatDeviceAccessReport(view: ContainerDeviceAccessView): string[] {
  const lines: string[] = ['Device access:'];

  if (view.ipodMounted) {
    lines.push(`  ✓ ${view.ipodPath} — iPod volume mounted; path-based sync ready`);
  } else {
    lines.push(
      `  ✗ ${view.ipodPath} — not mounted. For path-based sync, mount the iPod on the host ` +
        `and bind it into the container (-v /media/ipod:${view.ipodPath})`
    );
  }

  if (view.usbBusPresent) {
    lines.push('  ✓ /dev/bus/usb — USB passthrough present; one-time setup (device add) available');
  } else {
    lines.push(
      '  ✗ /dev/bus/usb — no USB passthrough; one-time setup (device add) unavailable. ' +
        'Not needed for path-based sync of an already-set-up iPod'
    );
  }

  if (view.sgDeviceCount > 0) {
    lines.push(`  ✓ /dev/sg* — ${view.sgDeviceCount} generic-SCSI device(s) present`);
  } else {
    lines.push(
      '  · /dev/sg* — none; SCSI inquiry unavailable (only relevant to older iPods, ' +
        'not supported in containers yet)'
    );
  }

  return lines;
}

/** Collect the live view from the container's filesystem/proc. */
export function collectContainerDeviceAccessView(ipodPath: string): ContainerDeviceAccessView {
  let procMounts = '';
  try {
    procMounts = fs.readFileSync('/proc/mounts', 'utf-8');
  } catch {
    // No /proc (non-Linux) — report as not mounted rather than crash.
  }

  let sgDeviceCount = 0;
  try {
    sgDeviceCount = fs.readdirSync('/dev').filter((name) => /^sg\d+$/.test(name)).length;
  } catch {
    // /dev unreadable — count stays 0.
  }

  return {
    ipodPath,
    ipodMounted: isMountPoint(procMounts, ipodPath),
    usbBusPresent: fs.existsSync('/dev/bus/usb'),
    sgDeviceCount,
  };
}

export const containerProbeCommand = new Command('__container-probe')
  .description('container device-access report (internal)')
  .helpOption(false)
  .option('--ipod-path <path>', 'iPod bind-mount path to probe', '/ipod')
  .action((options: { ipodPath: string }) => {
    const view = collectContainerDeviceAccessView(options.ipodPath);
    for (const line of formatDeviceAccessReport(view)) {
      console.log(line);
    }
  });
