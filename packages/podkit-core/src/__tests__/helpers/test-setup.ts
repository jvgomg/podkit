/**
 * Common test setup and utilities for podkit-core integration tests.
 *
 * Integration tests require external dependencies to be available.
 * If prerequisites are missing, tests will fail immediately with a clear
 * error message.
 */

import { execSync } from 'node:child_process';
import { isNativeAvailable } from '@podkit/libgpod-node';

// =============================================================================
// Dependency Checks
// =============================================================================

/**
 * Check if FFmpeg is available.
 */
function checkFFmpegAvailable(): boolean {
  try {
    execSync('which ffmpeg', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if gpod-tool is available.
 */
function checkGpodToolAvailable(): boolean {
  try {
    execSync('which gpod-tool', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if libgpod-node is available.
 * Uses the library's own isNativeAvailable() function.
 */
function checkLibgpodAvailable(): boolean {
  return isNativeAvailable();
}

// =============================================================================
// Early Fail Checks
// =============================================================================

/**
 * Assert that FFmpeg is available.
 *
 * This check runs at module load time. If FFmpeg is not installed,
 * the test suite will fail immediately with a clear error message.
 */
export function requireFFmpeg(): void {
  if (!checkFFmpegAvailable()) {
    throw new Error(
      '\n\n' +
        '═══════════════════════════════════════════════════════════════════\n' +
        ' FFmpeg not available!\n' +
        '═══════════════════════════════════════════════════════════════════\n\n' +
        ' Integration tests require FFmpeg to be installed.\n\n' +
        ' Install FFmpeg:\n\n' +
        '     macOS:   brew install ffmpeg\n' +
        '     Ubuntu:  sudo apt install ffmpeg\n\n' +
        '═══════════════════════════════════════════════════════════════════\n'
    );
  }
}

/**
 * Assert that gpod-tool is available.
 *
 * This check runs at module load time. If gpod-tool is not built,
 * the test suite will fail immediately with a clear error message.
 */
export function requireGpodTool(): void {
  if (!checkGpodToolAvailable()) {
    throw new Error(
      '\n\n' +
        '═══════════════════════════════════════════════════════════════════\n' +
        ' gpod-tool not available!\n' +
        '═══════════════════════════════════════════════════════════════════\n\n' +
        ' Integration tests require gpod-tool to be built and in PATH.\n\n' +
        ' Build gpod-tool:\n\n' +
        '     mise run tools:build\n\n' +
        '═══════════════════════════════════════════════════════════════════\n'
    );
  }
}

/**
 * Assert that libgpod-node native bindings are available.
 *
 * This check runs at module load time. If native bindings are not built,
 * the test suite will fail immediately with a clear error message.
 */
export function requireLibgpod(): void {
  if (!checkLibgpodAvailable()) {
    throw new Error(
      '\n\n' +
        '═══════════════════════════════════════════════════════════════════\n' +
        ' libgpod-node native bindings not available!\n' +
        '═══════════════════════════════════════════════════════════════════\n\n' +
        ' Integration tests require libgpod-node native bindings to be built.\n\n' +
        ' Build the native bindings:\n\n' +
        '     cd packages/libgpod-node && bun run build:native\n\n' +
        ' Or from the repository root:\n\n' +
        '     bun run build\n\n' +
        '═══════════════════════════════════════════════════════════════════\n'
    );
  }
}

/**
 * Assert that all sync executor dependencies are available.
 *
 * This includes FFmpeg, gpod-tool, and libgpod-node.
 */
export function requireAllDeps(): void {
  requireFFmpeg();
  requireGpodTool();
  requireLibgpod();
}
