/**
 * Add-intent shape returned by `@podkit/core`'s `describeAddIntent`
 * dispatcher.
 *
 * Lives in `@podkit/device-types` so consumers (CLI render, core, future
 * device packages) can refer to the shape without depending on
 * `@podkit/core`'s runtime surface.
 *
 * Pre-TASK-427 this file also hosted the `DeviceProvider` interface +
 * `DiscoveredContext` for the now-deleted provider-driven enumeration
 * framework. Both removed: the per-kind dispatcher in
 * `@podkit/core/discovery` (`describeAddIntent(d: DiscoveredDevice)`)
 * supersedes the runtime-registered provider list.
 *
 * @module
 */

import type { UsbFingerprint } from './identity.js';

export type { UsbFingerprint };

/**
 * Per-kind hint describing how a detected device would be added to the
 * user's config via the CLI.
 *
 * The CLI assembles the user-visible command from this shape:
 *   `podkit device add -d <name> <addArgs.join(' ')>`
 *
 * The dispatcher does not know the device name the user will choose, so
 * the CLI is responsible for prepending `-d <name>`. The dispatcher
 * contributes only the `--type` / `--path` / preset-id pieces (`addArgs`),
 * an identifier (`kind`) suitable for human display, and any clarifying
 * `notes`.
 */
export interface DeviceAddIntent {
  /**
   * String tag identifying which arm of the `DiscoveredDevice` union
   * produced this intent — `'ipod'` / `'mass-storage'` / `'unsupported'`.
   * Carries the same vocabulary `DeviceProvider.id` used pre-TASK-427 so
   * existing CLI consumers can keep branching on it unchanged.
   */
  providerId: string;
  /**
   * Device-kind identifier the dispatcher recognises — e.g. preset id
   * `'echo-mini'` for mass-storage, `'ipod'` for the iPod arm. The CLI may
   * render this through a display-name lookup.
   */
  kind: string;
  /**
   * Argv tokens to append after `podkit device add -d <name>`.
   * E.g. `['--type', 'echo-mini', '--path', '<mount-point>']`.
   * Placeholders like `<mount-point>` are intentional — the CLI prints
   * them verbatim so the user knows what to substitute.
   */
  addArgs: readonly string[];
  /**
   * Extra context lines printed after the suggested command. Used for
   * device-specific notes such as "mount it first" or "disk: disk5".
   */
  notes?: readonly string[];
}
