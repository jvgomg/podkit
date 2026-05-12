/**
 * Thin barrel — implementation lives in ./device/.
 *
 * Preserves the historical `./commands/device.js` import path so external
 * consumers (tests, sibling commands) do not need per-call-site changes.
 */
export * from './device/index.js';

// Re-export formatting utilities for backward compatibility.
export { formatBytes, formatNumber } from '../output/index.js';
export { formatGeneration } from '@podkit/core';
