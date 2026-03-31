/**
 * Eject-with-retry wrapper
 *
 * Orchestrates filesystem sync, retry loop, and progress callbacks
 * around the platform-specific DeviceManager.eject() method.
 */

import { execSync } from 'node:child_process';
import type { DeviceManager, EjectResult, EjectWithRetryOptions } from './types.js';

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check whether an eject error is transient and worth retrying.
 *
 * Matches common macOS and Linux busy/dissent patterns:
 * - macOS: "dissented by PID", "failed to unmount"
 * - Linux: "target is busy", "device is busy"
 * - Both: "resource busy"
 */
export function isRetryableError(error?: string): boolean {
  if (!error) return false;
  const lower = error.toLowerCase();
  return (
    lower.includes('dissented') ||
    lower.includes('failed to unmount') ||
    lower.includes('resource busy') ||
    lower.includes('target is busy') ||
    lower.includes('device is busy') ||
    lower.includes('device is in use')
  );
}

/**
 * Flush filesystem buffers before eject.
 *
 * Belt-and-suspenders — libgpod already calls sync() during itdb_write(),
 * but this ensures any other pending writes are flushed before we attempt
 * to unmount the device.
 */
function fsSync(): void {
  try {
    execSync('sync', { timeout: 10_000 });
  } catch {
    // sync failing is not fatal — best-effort
  }
}

/**
 * Eject a device with filesystem sync and automatic retry on transient errors.
 *
 * Wraps the platform-specific DeviceManager.eject() with:
 * 1. Filesystem buffer flush (sync command)
 * 2. Retry loop for transient busy/dissent errors
 * 3. Progress event callbacks for CLI output
 *
 * Force mode bypasses retry and calls eject with force: true directly.
 */
export async function ejectWithRetry(
  manager: DeviceManager,
  mountPoint: string,
  options?: EjectWithRetryOptions
): Promise<EjectResult> {
  const force = options?.force ?? false;
  const maxAttempts = options?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const retryDelayMs = options?.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const deviceLabel = options?.deviceLabel ?? 'iPod';
  const onProgress = options?.onProgress;

  // Flush filesystem buffers
  onProgress?.({ phase: 'sync', message: 'Syncing filesystem...' });
  fsSync();

  // Force mode: skip retry, go straight to force unmount
  if (force) {
    onProgress?.({
      phase: 'eject',
      attempt: 1,
      maxAttempts: 1,
      message: `Force ejecting ${deviceLabel}...`,
    });
    const result = await manager.eject(mountPoint, { force: true });
    if (result.success) {
      onProgress?.({
        phase: 'success',
        message: `${deviceLabel} ejected. Safe to disconnect.`,
        forced: true,
      });
    } else {
      onProgress?.({ phase: 'failed', message: result.error ?? 'Force eject failed.' });
    }
    return { ...result, attempts: 1 };
  }

  // Normal mode: retry loop
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    onProgress?.({
      phase: 'eject',
      attempt,
      maxAttempts,
      message:
        attempt === 1
          ? `Ejecting ${deviceLabel}...`
          : `Retrying eject (attempt ${attempt}/${maxAttempts})...`,
    });

    const result = await manager.eject(mountPoint, { force: false });

    if (result.success) {
      onProgress?.({
        phase: 'success',
        message: `${deviceLabel} ejected. Safe to disconnect.`,
        forced: false,
      });
      return { ...result, attempts: attempt };
    }

    // Non-retryable error or last attempt — fail immediately
    if (!isRetryableError(result.error) || attempt === maxAttempts) {
      onProgress?.({ phase: 'failed', message: result.error ?? 'Eject failed.' });
      return { ...result, attempts: attempt };
    }

    // Transient error — wait and try again
    const delaySec = retryDelayMs / 1000;
    onProgress?.({
      phase: 'waiting',
      attempt,
      delayMs: retryDelayMs,
      message: `Device busy, waiting ${delaySec}s before retry...`,
    });
    await sleep(retryDelayMs);
  }

  // Should not reach here, but defensive
  return {
    success: false,
    device: mountPoint,
    error: 'Eject failed after retries',
    attempts: maxAttempts,
  };
}
