/**
 * Static check: mock-core.ts must export every symbol that @podkit/core exports.
 *
 * If this file fails to typecheck, mock-core.ts needs to be updated to match
 * new or renamed exports from @podkit/core.
 */

import type * as RealCore from '@podkit/core';
import type * as MockCore from './mock-core';

// Produces the set of export names present in @podkit/core but missing from mock-core.
// If any are missing, _Check will not extend `never` and the assertion line will error.
type _Missing = Exclude<keyof typeof RealCore, keyof typeof MockCore>;
type _Assert<T extends never> = T;
type _Check = _Assert<_Missing>;
