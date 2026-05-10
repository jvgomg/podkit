/**
 * Output infrastructure for CLI commands
 *
 * This module provides a unified output system that eliminates scattered
 * `if (globalOpts.json)` conditionals throughout command implementations.
 *
 * @example
 * ```typescript
 * import { OutputContext } from '../output/index.js';
 *
 * const out = OutputContext.fromGlobalOpts(globalOpts);
 *
 * // Text mode only
 * out.print('Scanning...');
 * const spinner = out.spinner('Loading...');
 * spinner.stop('Done!');
 *
 * // JSON mode only
 * out.json({ success: true, count: 42 });
 *
 * // Both modes
 * out.result(data, (d) => console.log(`Found ${d.count} items`));
 * ```
 */

// Types
export type {
  ExitCodeSink,
  OutputMode,
  OutputOptions,
  OutputContextConfig,
  OutputSink,
  SpinnerControl,
  TableOptions,
} from './types.js';
export { BufferExitCodeSink, nullSpinner, processExitCodeSink } from './types.js';

// Main context class
export { OutputContext } from './context.js';

// Formatters
export {
  // Re-exported from display-utils
  formatBytes,
  formatNumber,
  // Text styling
  bold,
  // Duration formatting
  formatDurationSeconds,
  // Header formatting
  formatDeviceHeader,
  formatCollectionLabel,
  // Progress
  renderProgressBar,
  // Error formatting
  formatErrors,
  formatUpdateReason,
  // Transform preview
  buildTransformPreview,
} from './formatters.js';

export type { DeviceHeaderInfo, CollectedError, TransformPreviewEntry } from './formatters.js';

// Tips
export { collectTips, formatTips, printTips } from './tips.js';
export type { Tip, TipContext, TipDefinition } from './tips.js';
