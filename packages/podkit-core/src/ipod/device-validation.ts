/**
 * Device validation and capability analysis.
 *
 * Detects unsupported devices, unknown models, and provides
 * structured capability information for user-facing output.
 */

import type { IpodGeneration } from '@podkit/libgpod-node';
import type { IpodDeviceInfo } from './types.js';
import { formatGeneration, getUnsupportedReasonByLibgpodName } from '@podkit/devices-ipod';

// =============================================================================
// Types
// =============================================================================

/**
 * Why a device is unsupported.
 */
export type UnsupportedReason = 'ios_device' | 'buttonless_shuffle' | 'nano_6';

/**
 * Issue detected during device validation.
 */
export interface DeviceIssue {
  /** Issue type */
  type: 'unsupported_device' | 'unknown_model';
  /** Human-readable message */
  message: string;
  /** Actionable suggestion for the user */
  suggestion?: string;
  /** Why the device is unsupported (only for unsupported_device issues) */
  reason?: UnsupportedReason;
}

/**
 * Warning about device capabilities.
 */
export interface DeviceWarning {
  /** Warning type */
  type: 'no_artwork' | 'no_video' | 'no_podcast';
  /** Human-readable message */
  message: string;
}

/**
 * Named device capability for structured output.
 */
export interface DeviceCapabilitySummary {
  music: boolean;
  artwork: boolean;
  video: boolean;
  podcast: boolean;
}

/**
 * Result from validating a device.
 */
export interface DeviceValidationResult {
  /** Whether the device is supported by podkit */
  supported: boolean;
  /** Issues found (unsupported device, unknown model) */
  issues: DeviceIssue[];
  /** Warnings about limited capabilities */
  warnings: DeviceWarning[];
  /** Structured capability summary */
  capabilities: DeviceCapabilitySummary;
}

// =============================================================================
// Unsupported device detection
// =============================================================================

const DOCS_URL = 'https://jvgomg.github.io/podkit/devices/supported-devices';

/**
 * Check if a generation is unsupported.
 *
 * Delegates to `getUnsupportedReasonByLibgpodName` from `@podkit/devices-ipod`
 * which owns the authoritative list of unsupported libgpod generation names.
 */
export function isUnsupportedGeneration(generation: IpodGeneration): boolean {
  return getUnsupportedReasonByLibgpodName(generation) !== null;
}

/**
 * Get the reason a generation is unsupported.
 *
 * Maps the `UnsupportedGenerationKind` from devices-ipod to the legacy
 * `UnsupportedReason` type used by the DeviceIssue pipeline.
 */
function getUnsupportedReason(generation: IpodGeneration): UnsupportedReason | undefined {
  const kind = getUnsupportedReasonByLibgpodName(generation);
  return kind ?? undefined;
}

/**
 * Build an issue for an unsupported device.
 */
function buildUnsupportedIssue(generation: IpodGeneration): DeviceIssue {
  const displayName = formatGeneration(generation);
  const reason = getUnsupportedReason(generation);

  switch (reason) {
    case 'ios_device':
      return {
        type: 'unsupported_device',
        reason,
        message: `This appears to be an iPod ${displayName}. iOS devices (iPod Touch, iPhone, iPad) use Apple's proprietary sync protocol and cannot be used with podkit.`,
        suggestion: `Supported devices: iPod Classic, Video, Nano (1st-5th), Mini, Shuffle (1st-2nd). See: ${DOCS_URL}`,
      };

    case 'buttonless_shuffle':
      return {
        type: 'unsupported_device',
        reason,
        message: `This appears to be an iPod ${displayName}. These "buttonless" Shuffle models require an iTunes authentication hash that podkit cannot generate.`,
        suggestion: `Only 1st and 2nd generation Shuffles are supported. See: ${DOCS_URL}`,
      };

    case 'nano_6':
      return {
        type: 'unsupported_device',
        reason,
        message: `This appears to be an iPod ${displayName}. The 6th generation Nano uses a different database format that is not supported by libgpod.`,
        suggestion: `Supported Nano generations: 1st through 5th. See: ${DOCS_URL}`,
      };

    default:
      return {
        type: 'unsupported_device',
        message: `This device (${displayName}) is not supported by podkit.`,
        suggestion: `See: ${DOCS_URL}`,
      };
  }
}

/**
 * Build an issue for an unknown model.
 */
function buildUnknownModelIssue(mountPoint?: string): DeviceIssue {
  const sysInfoPath = mountPoint
    ? `${mountPoint}/iPod_Control/Device/SysInfo`
    : 'iPod_Control/Device/SysInfo';

  return {
    type: 'unknown_model',
    message:
      'Could not identify iPod model. The device will be treated as a generic iPod, which may cause issues with artwork format or database compatibility.',
    suggestion: `Ensure ${sysInfoPath} exists with your model number (e.g., "ModelNumStr: MA147"). See: ${DOCS_URL}`,
  };
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate a device and return structured results.
 *
 * Checks for:
 * - Unsupported device generations (iOS, buttonless Shuffles, Nano 6th)
 * - Unknown model detection
 * - Capability limitations (no artwork, no video, no podcast)
 *
 * @param device - Device info from the iPod database
 * @param mountPoint - Optional mount point for SysInfo path in messages
 * @returns Validation result with issues, warnings, and capabilities
 */
export function validateDevice(
  device: IpodDeviceInfo,
  mountPoint?: string
): DeviceValidationResult {
  const issues: DeviceIssue[] = [];
  const warnings: DeviceWarning[] = [];
  const generation = device.generation as IpodGeneration;

  // Check for unsupported device
  if (isUnsupportedGeneration(generation)) {
    issues.push(buildUnsupportedIssue(generation));
  }

  // Check for unknown model
  if (generation === 'unknown') {
    issues.push(buildUnknownModelIssue(mountPoint));
  }

  // Build capability summary
  const capabilities: DeviceCapabilitySummary = {
    music: true, // All iPods support music
    artwork: device.supportsArtwork,
    video: device.supportsVideo,
    podcast: device.supportsPodcast,
  };

  // Add capability warnings
  if (!device.supportsArtwork) {
    warnings.push({
      type: 'no_artwork',
      message: 'This device does not support album artwork. Artwork will not be synced.',
    });
  }

  if (!device.supportsVideo) {
    warnings.push({
      type: 'no_video',
      message: 'This device does not support video playback. Video files will be skipped.',
    });
  }

  if (!device.supportsPodcast) {
    warnings.push({
      type: 'no_podcast',
      message: 'This device does not support podcasts.',
    });
  }

  return {
    supported: issues.every((i) => i.type !== 'unsupported_device'),
    issues,
    warnings,
    capabilities,
  };
}

/**
 * Format validation issues and warnings for human-readable CLI output.
 *
 * @param result - Validation result from validateDevice()
 * @returns Array of formatted strings to display
 */
export function formatValidationMessages(result: DeviceValidationResult): string[] {
  const lines: string[] = [];

  for (const issue of result.issues) {
    if (issue.type === 'unsupported_device') {
      lines.push(`Error: ${issue.message}`);
    } else {
      lines.push(`Warning: ${issue.message}`);
    }
    if (issue.suggestion) {
      lines.push(`  ${issue.suggestion}`);
    }
  }

  return lines;
}

/**
 * Format a capability summary for human-readable CLI output.
 *
 * Uses check/cross markers to indicate support status.
 *
 * @param capabilities - Capability summary from validation
 * @param device - Device info for generation display name
 * @returns Array of formatted strings
 */
export function formatCapabilities(
  capabilities: DeviceCapabilitySummary,
  device: IpodDeviceInfo
): string[] {
  const gen = formatGeneration(device.generation);
  const lines: string[] = [];

  const entries: Array<{ name: string; supported: boolean; label: string }> = [
    { name: 'Music', supported: capabilities.music, label: 'Music' },
    { name: 'Artwork', supported: capabilities.artwork, label: 'Album artwork' },
    { name: 'Video', supported: capabilities.video, label: 'Video playback' },
    { name: 'Podcasts', supported: capabilities.podcast, label: 'Podcasts' },
  ];

  for (const entry of entries) {
    if (entry.supported) {
      lines.push(`    + ${entry.name}`);
    } else {
      lines.push(`    - ${entry.name} (not supported on ${gen})`);
    }
  }

  return lines;
}

/**
 * Build sync-specific warnings about unsupported content types.
 *
 * @param capabilities - Device capabilities
 * @param hasVideo - Whether the sync includes video content
 * @param hasArtwork - Whether the sync includes artwork
 * @returns Array of warning messages, empty if no issues
 */
export function buildSyncWarnings(
  capabilities: DeviceCapabilitySummary,
  options: { hasVideo?: boolean; hasArtwork?: boolean }
): string[] {
  const warnings: string[] = [];

  if (options.hasVideo && !capabilities.video) {
    warnings.push('Video playback is not supported on this device. Video files will be skipped.');
  }

  if (options.hasArtwork && !capabilities.artwork) {
    warnings.push('Album artwork is not supported on this device. Artwork will not be synced.');
  }

  return warnings;
}
