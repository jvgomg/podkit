/**
 * Collection adapters
 *
 * Adapters provide a uniform interface for reading track metadata
 * from different sources.
 */

// Interface types
export type {
  FileAccess,
  CollectionTrack,
  CollectionAdapter,
  AdapterConfig,
  DirectoryAdapterConfig as AdapterDirectoryConfig,
  SubsonicAdapterConfig as AdapterSubsonicConfig,
} from './interface.js';

// Directory adapter
export { DirectoryAdapter, createDirectoryAdapter } from './directory.js';

export type { DirectoryAdapterConfig, ScanProgress } from './directory.js';

// Subsonic adapter
export { SubsonicAdapter, createSubsonicAdapter } from './subsonic.js';

export type { SubsonicAdapterConfig } from './subsonic.js';
