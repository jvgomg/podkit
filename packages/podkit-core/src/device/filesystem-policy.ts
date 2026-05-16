/**
 * Cross-platform filesystem policy for podkit's device flows.
 *
 * Centralizes the rule that podkit refuses to operate on HFS+ volumes when
 * running under Linux. The friction surfaces compound on Linux:
 *
 * 1. The kernel hfsplus driver refuses RW on journaled HFS+ (the iPod
 *    default), so sync can't write.
 * 2. udev/blkid don't surface a filesystem UUID for HFS+ on Linux, breaking
 *    podkit's volumeUuid identity model.
 * 3. udisksctl mount paths fall back to the generic `/media/$USER/disk`
 *    because no label is read.
 *
 * Refusing cleanly with a docs link is structurally cleaner than trying to
 * patch all three friction points. macOS HFS+ is unchanged — the policy is
 * Linux-only. See TASK-317.12 and `docs/devices/linux-filesystems.md`.
 */

/**
 * Canonical docs URL for the Linux filesystem policy. Referenced by every
 * user-facing message that mentions the refusal. Keep in sync with the
 * filename of `docs/devices/linux-filesystems.md`.
 */
export const LINUX_FILESYSTEMS_DOCS_URL = 'https://docs.podkit.app/devices/linux-filesystems';

/**
 * Returns true when the given filesystem cannot be supported by podkit on
 * the current platform.
 *
 * Today the only refusal case is `hfsplus` on Linux (`process.platform`
 * matches the Node convention — `'linux'`, `'darwin'`, `'win32'`, …).
 *
 * Both arguments are normalized internally — callers can pass `undefined`
 * for `filesystem` (treated as "unknown filesystem, no refusal") or any case
 * variant. The `platform` argument lets tests assert macOS pass-through
 * without mutating `process.platform`.
 */
export function isFilesystemUnsupportedHere(
  filesystem: string | undefined | null,
  platform: NodeJS.Platform | string = process.platform
): boolean {
  if (!filesystem) return false;
  return platform === 'linux' && filesystem.toLowerCase() === 'hfsplus';
}

/**
 * Build the canonical refusal text that the CLI prints for an HFS+ iPod
 * encountered on Linux. Matches the wording mandated by TASK-317.12.
 *
 * Returned as an array of lines so callers can route them through whichever
 * output sink they own (CliError message text). Callers that need a single
 * string (e.g. `CliError.message`) join with `\n`.
 *
 * For consumers that want the structured payload (the readiness pipeline,
 * `CliError.details`, JSON envelopes), use
 * `makeHfsplusOnLinuxUnsupportedReason()` instead.
 */
export function formatHfsplusOnLinuxRefusal(): string[] {
  return [
    'Cannot add iPod: this iPod is formatted as HFS+, which podkit does not support on Linux.',
    '',
    'To use this iPod with podkit on Linux, reformat it to FAT32. See:',
    `  ${LINUX_FILESYSTEMS_DOCS_URL}`,
    '',
    '(podkit fully supports HFS+ iPods on macOS — this is a Linux-only limitation.)',
  ];
}

/**
 * Build the typed `ReadinessUnsupportedReason` for an HFS+ iPod refusal on
 * Linux. Used by the readiness pipeline and by `device add` to populate
 * `CliError.details` with a machine-readable payload — the human-readable
 * message can still be produced by joining `formatHfsplusOnLinuxRefusal()`.
 *
 * The `filesystem` and `path` fields are optional so callers without that
 * context (e.g. tests synthesising a minimal `ReadinessResult`) can omit
 * them; production call sites always have at least the filesystem string.
 */
import type { ReadinessUnsupportedReason } from './readiness/types.js';

export function makeHfsplusOnLinuxUnsupportedReason(
  options: { filesystem?: string; path?: string } = {}
): ReadinessUnsupportedReason {
  return {
    kind: 'filesystem-unsupported-on-linux',
    headline:
      'Cannot add iPod: this iPod is formatted as HFS+, which podkit does not support on Linux.',
    details: [
      'To use this iPod with podkit on Linux, reformat it to FAT32.',
      '(podkit fully supports HFS+ iPods on macOS — this is a Linux-only limitation.)',
    ],
    docsUrl: LINUX_FILESYSTEMS_DOCS_URL,
    ...(options.filesystem ? { filesystem: options.filesystem } : {}),
    ...(options.path ? { path: options.path } : {}),
  };
}
