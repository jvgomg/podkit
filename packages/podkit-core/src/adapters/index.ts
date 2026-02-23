/**
 * Collection adapters
 *
 * Adapters provide a uniform interface for reading track metadata
 * from different sources.
 */

// Interface types
export type {
  CollectionTrack,
  CollectionAdapter,
  AdapterConfig,
} from './interface.js';

// Directory adapter
export {
  DirectoryAdapter,
  createDirectoryAdapter,
} from './directory.js';

export type {
  DirectoryAdapterConfig,
  ScanProgress,
} from './directory.js';
