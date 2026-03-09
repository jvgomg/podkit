/**
 * Shared estimation utilities for sync planning
 *
 * Contains common constants and functions used by both audio and video planners
 * for estimating transfer times and sizes.
 *
 * @module
 */

// =============================================================================
// Constants
// =============================================================================

/**
 * Estimated USB transfer speed in bytes per second.
 *
 * With pipeline execution, transcoding happens in parallel with USB transfer,
 * so USB transfer is the bottleneck. Based on observed real-world throughput
 * of ~2.7 MB/s during E2E testing with USB 2.0 iPod.
 *
 * Using 2.5 MB/s as a conservative estimate.
 */
export const USB_TRANSFER_SPEED_BYTES_PER_SEC = 2.5 * 1024 * 1024; // 2.5 MB/s

// =============================================================================
// Functions
// =============================================================================

/**
 * Estimate time to transfer a file to iPod.
 *
 * With pipeline execution, transcoding happens in parallel with USB transfer,
 * so all time estimates are based on USB transfer speed (the bottleneck).
 *
 * @param sizeBytes - File size in bytes
 * @returns Estimated transfer time in seconds
 */
export function estimateTransferTime(sizeBytes: number): number {
  return sizeBytes / USB_TRANSFER_SPEED_BYTES_PER_SEC;
}
