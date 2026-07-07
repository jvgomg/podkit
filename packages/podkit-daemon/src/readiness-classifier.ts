/**
 * Daemon readiness classifier.
 *
 * Pure decision logic that maps the outcome of a `podkit sync` invocation to a
 * readiness status, driving the daemon's notify-and-skip behaviour. The daemon
 * never mutates a detected device (it never writes SysInfoExtended, never
 * auto-inits a blank database) — it shells out to the CLI and classifies the
 * result so the user gets an actionable notification instead of a generic
 * "sync failed".
 *
 * Because the CLI hard-errors on an unidentified iPod (TASK-440) and on an
 * unsupported generation, the daemon inherits correct refusal behaviour for
 * free; this module turns those typed exit codes into clear guidance.
 *
 * @module
 */

import type { DetectedDevice } from './device-poller.js';

export type DaemonReadiness = 'ready' | 'needs-setup' | 'needs-init' | 'unsupported' | 'error';

export interface DaemonSyncOutcome {
  /** Exit code of the `podkit sync` invocation. */
  exitCode: number;
  /** Typed error code from the CLI's `--json` envelope, when present. */
  code?: string;
}

/**
 * Classify a sync outcome into a readiness status.
 *
 * - exit 0 (clean) or 2 (synced with per-item failures) → `ready`: the device
 *   is set up and was synced.
 * - `UNKNOWN_IPOD_MODEL` → `needs-setup`: the iPod's identity could not be
 *   resolved; it needs the one-time USB setup.
 * - `DEVICE_UNSUPPORTED` → `unsupported`.
 * - `IPOD_NEEDS_INIT` → `needs-init`: a blank device with no database.
 * - anything else → `error`: a generic failure handled by the normal error path.
 */
export function classifyReadiness(outcome: DaemonSyncOutcome): DaemonReadiness {
  if (outcome.exitCode === 0 || outcome.exitCode === 2) return 'ready';
  switch (outcome.code) {
    case 'UNKNOWN_IPOD_MODEL':
      return 'needs-setup';
    case 'DEVICE_UNSUPPORTED':
      return 'unsupported';
    case 'IPOD_NEEDS_INIT':
      return 'needs-init';
    default:
      return 'error';
  }
}

function deviceLabel(device: DetectedDevice): string {
  return device.label ?? device.name;
}

/**
 * Build an actionable notification for a non-ready device, or `null` when the
 * status has no dedicated guidance (`ready` succeeded; `error` is reported via
 * the generic error-notification path).
 *
 * Wording stays neutral — no implementation (libgpod) leakage.
 */
export function formatReadinessNotification(
  device: DetectedDevice,
  status: DaemonReadiness
): string | null {
  const label = deviceLabel(device);
  switch (status) {
    case 'needs-setup':
      return (
        `${label} needs a one-time setup before it can sync. ` +
        `Connect it over USB and run \`podkit device add\` once (in Docker, pass the USB ` +
        `device through for that command), or run \`podkit doctor --repair sysinfo-extended\`. ` +
        `Later syncs need only the mounted volume.`
      );
    case 'unsupported':
      return `${label} is not supported by podkit and was skipped. See the supported-devices documentation.`;
    case 'needs-init':
      return (
        `${label} has no music database yet. Run \`podkit device init\` to set it up before ` +
        `syncing. The daemon will not initialise a device automatically.`
      );
    case 'ready':
    case 'error':
      return null;
  }
}
