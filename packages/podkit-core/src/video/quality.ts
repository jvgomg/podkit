/**
 * Source quality capping for video transcoding
 *
 * Implements logic to cap output quality based on source quality,
 * preventing "upscaling" of low-quality content.
 *
 * Formula: effective = min(preset_target, source_actual)
 */

import type {
  VideoSourceAnalysis,
  VideoQualityPreset,
  VideoDeviceProfile,
  VideoTranscodeSettings,
} from './types.js';
import { getPresetSettingsWithFallback } from './types.js';

// =============================================================================
// Target Dimensions
// =============================================================================

/**
 * Result of calculating target dimensions for transcoding
 */
export interface TargetDimensions {
  /** Target width in pixels */
  width: number;

  /** Target height in pixels */
  height: number;

  /** Whether letterboxing is needed (horizontal bars for wide content) */
  needsLetterboxing: boolean;

  /** Whether pillarboxing is needed (vertical bars for narrow content) */
  needsPillarboxing: boolean;
}

/**
 * Calculate target dimensions that fit within device constraints while maintaining aspect ratio
 *
 * The algorithm:
 * 1. Never upscale - if source is smaller than device max, use source dimensions
 * 2. Scale down proportionally to fit within device max dimensions
 * 3. Determine if letterboxing or pillarboxing is needed based on aspect ratio comparison
 *
 * @param sourceWidth - Source video width in pixels
 * @param sourceHeight - Source video height in pixels
 * @param deviceMaxWidth - Maximum width supported by the device
 * @param deviceMaxHeight - Maximum height supported by the device
 * @returns Target dimensions and boxing requirements
 */
export function calculateTargetDimensions(
  sourceWidth: number,
  sourceHeight: number,
  deviceMaxWidth: number,
  deviceMaxHeight: number
): TargetDimensions {
  // Never upscale - use source dimensions if smaller than device max
  if (sourceWidth <= deviceMaxWidth && sourceHeight <= deviceMaxHeight) {
    // Even dimensions required for video encoding
    const width = Math.floor(sourceWidth / 2) * 2;
    const height = Math.floor(sourceHeight / 2) * 2;

    return {
      width,
      height,
      needsLetterboxing: false,
      needsPillarboxing: false,
    };
  }

  // Calculate aspect ratios
  const sourceAspect = sourceWidth / sourceHeight;
  const deviceAspect = deviceMaxWidth / deviceMaxHeight;

  let targetWidth: number;
  let targetHeight: number;

  // Scale to fit within device constraints
  if (sourceAspect > deviceAspect) {
    // Source is wider than device (e.g., 2.35:1 movie on 4:3 device)
    // Fit to width, add letterboxing (horizontal bars)
    targetWidth = deviceMaxWidth;
    targetHeight = Math.round(deviceMaxWidth / sourceAspect);
  } else {
    // Source is narrower than or equal to device aspect
    // Fit to height, add pillarboxing if narrower (vertical bars)
    targetHeight = deviceMaxHeight;
    targetWidth = Math.round(deviceMaxHeight * sourceAspect);
  }

  // Ensure even dimensions (required for video encoding)
  targetWidth = Math.floor(targetWidth / 2) * 2;
  targetHeight = Math.floor(targetHeight / 2) * 2;

  // Determine boxing needs based on whether output fills the device dimensions
  const needsLetterboxing = targetHeight < deviceMaxHeight && sourceAspect > deviceAspect;
  const needsPillarboxing = targetWidth < deviceMaxWidth && sourceAspect < deviceAspect;

  return {
    width: targetWidth,
    height: targetHeight,
    needsLetterboxing,
    needsPillarboxing,
  };
}

// =============================================================================
// Quality Warnings
// =============================================================================

/**
 * Warning generated when source quality limits output
 */
export interface QualityWarning {
  /** Type of limitation */
  type: 'bitrate' | 'resolution' | 'framerate';

  /** Human-readable warning message */
  message: string;
}

/**
 * Generate warnings when source quality limits the output below preset targets
 *
 * @param source - Source video analysis
 * @param preset - Quality preset being used
 * @param device - Target device profile
 * @param effectiveSettings - The calculated effective settings
 * @returns Array of warnings about quality limitations
 */
export function generateQualityWarnings(
  source: VideoSourceAnalysis,
  preset: VideoQualityPreset,
  device: VideoDeviceProfile,
  effectiveSettings: VideoTranscodeSettings
): QualityWarning[] {
  const warnings: QualityWarning[] = [];
  const presetSettings = getPresetSettingsWithFallback(device.name, preset);

  // Check if source video bitrate limits output
  if (source.videoBitrate < presetSettings.videoBitrate) {
    warnings.push({
      type: 'bitrate',
      message: `Source video bitrate (${source.videoBitrate}kbps) limits output below preset target (${presetSettings.videoBitrate}kbps)`,
    });
  }

  // Check if source resolution limits output
  // Source is limiting if it's smaller than what the device could display
  if (
    source.width < device.maxWidth ||
    source.height < device.maxHeight
  ) {
    // Only warn if the source dimensions are actually limiting the output
    if (
      effectiveSettings.targetWidth < device.maxWidth ||
      effectiveSettings.targetHeight < device.maxHeight
    ) {
      // Check if limitation is due to source being smaller, not aspect ratio
      const sourceArea = source.width * source.height;
      const deviceArea = device.maxWidth * device.maxHeight;
      if (sourceArea < deviceArea) {
        warnings.push({
          type: 'resolution',
          message: `Source resolution (${source.width}x${source.height}) limits output below device maximum (${device.maxWidth}x${device.maxHeight})`,
        });
      }
    }
  }

  // Check if source frame rate limits output
  if (source.frameRate < device.maxFrameRate && source.frameRate < effectiveSettings.frameRate) {
    warnings.push({
      type: 'framerate',
      message: `Source frame rate (${source.frameRate}fps) limits output below device maximum (${device.maxFrameRate}fps)`,
    });
  }

  return warnings;
}

// =============================================================================
// Effective Settings Calculation
// =============================================================================

/**
 * Calculate effective transcode settings by capping preset targets to source quality
 *
 * Key rules:
 * - Video bitrate: min(preset target, source actual, device max)
 * - Resolution: min(source, device max), maintaining aspect ratio
 * - Frame rate: min(source, device max)
 * - CRF and audio bitrate: use preset values
 * - Profile/level: always use device settings for compatibility
 *
 * @param source - Source video analysis from probing
 * @param preset - Quality preset to use as baseline
 * @param device - Target device profile
 * @returns Effective transcode settings capped to source quality
 */
export function calculateEffectiveSettings(
  source: VideoSourceAnalysis,
  preset: VideoQualityPreset,
  device: VideoDeviceProfile
): VideoTranscodeSettings {
  const presetSettings = getPresetSettingsWithFallback(device.name, preset);

  // Calculate target dimensions (respects source and device limits)
  const dimensions = calculateTargetDimensions(
    source.width,
    source.height,
    device.maxWidth,
    device.maxHeight
  );

  // Cap video bitrate: min(preset, source, device max)
  // If source bitrate is 0 (unknown), use preset/device limits
  const targetVideoBitrate = source.videoBitrate > 0
    ? Math.min(presetSettings.videoBitrate, source.videoBitrate, device.maxVideoBitrate)
    : Math.min(presetSettings.videoBitrate, device.maxVideoBitrate);

  // Cap audio bitrate: min(preset, source, device max)
  // Note: we don't downgrade audio if source is lower since re-encoding
  // at a slightly higher bitrate won't hurt quality
  const targetAudioBitrate = Math.min(
    presetSettings.audioBitrate,
    device.maxAudioBitrate
  );

  // Cap frame rate: min(source, device max)
  // If source frame rate is 0 (unknown), use device max
  const frameRate = source.frameRate > 0
    ? Math.min(source.frameRate, device.maxFrameRate)
    : device.maxFrameRate;

  return {
    targetWidth: dimensions.width,
    targetHeight: dimensions.height,
    targetVideoBitrate,
    targetAudioBitrate,
    videoProfile: device.videoProfile,
    videoLevel: device.videoLevel,
    crf: presetSettings.crf,
    frameRate,
    useHardwareAcceleration: true, // Default to hardware acceleration
  };
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Check if source quality is significantly below preset targets
 *
 * Useful for deciding whether to warn users about low-quality sources.
 *
 * @param source - Source video analysis
 * @param preset - Quality preset being used
 * @param device - Target device profile
 * @returns True if source quality significantly limits output
 */
export function isSourceQualityLimiting(
  source: VideoSourceAnalysis,
  preset: VideoQualityPreset,
  device: VideoDeviceProfile
): boolean {
  const effectiveSettings = calculateEffectiveSettings(source, preset, device);
  const warnings = generateQualityWarnings(source, preset, device, effectiveSettings);
  return warnings.length > 0;
}

/**
 * Get a summary of quality limitations for display
 *
 * @param source - Source video analysis
 * @param preset - Quality preset being used
 * @param device - Target device profile
 * @returns Array of warning messages, empty if no limitations
 */
export function getQualityLimitationSummary(
  source: VideoSourceAnalysis,
  preset: VideoQualityPreset,
  device: VideoDeviceProfile
): string[] {
  const effectiveSettings = calculateEffectiveSettings(source, preset, device);
  const warnings = generateQualityWarnings(source, preset, device, effectiveSettings);
  return warnings.map(w => w.message);
}
