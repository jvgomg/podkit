/**
 * Subprocess runner re-exports. The `SubprocessRunner` interface lives in
 * `@podkit/device-types`; the default real-execFile implementation lives in
 * `@podkit/core`. This module re-exports both for tests that need a single
 * import path.
 *
 * @module
 */

import { defaultSubprocessRunner } from '@podkit/core';
import type {
  SubprocessRunner,
  SubprocessRunOpts,
  SubprocessRunResult,
} from '@podkit/device-types';

export type { SubprocessRunner, SubprocessRunOpts, SubprocessRunResult };
export { defaultSubprocessRunner };
