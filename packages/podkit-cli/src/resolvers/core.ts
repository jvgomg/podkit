/**
 * Core resolution utilities
 *
 * Generic functions for resolving named entities from configuration.
 * These form the foundation for device and collection resolvers.
 */

import type { ResolutionResult } from './types.js';

// =============================================================================
// Generic Named Entity Resolution
// =============================================================================

/**
 * Options for resolving a named entity
 */
export interface ResolveNamedEntityOptions<T> {
  /** Map of entity names to configurations */
  entities: Record<string, T> | undefined;
  /** Name of the default entity (from config.defaults) */
  defaultName: string | undefined;
  /** Explicitly requested entity name (from CLI arg) */
  requestedName: string | undefined;
  /** Entity type for error messages (e.g., "device", "music collection") */
  entityType: string;
  /** Command to run if no entities configured (e.g., "podkit device add <name>") */
  addCommand: string;
  /** Command to set default (e.g., "podkit device default <name>") */
  defaultCommand?: string;
}

/**
 * Resolve a named entity from configuration
 *
 * Resolution priority:
 * 1. If requestedName provided, look it up (error if not found)
 * 2. Otherwise, use defaultName from config
 * 3. If no default, return appropriate error
 *
 * @example
 * ```typescript
 * const result = resolveNamedEntity({
 *   entities: config.devices,
 *   defaultName: config.defaults?.device,
 *   requestedName: 'terapod',
 *   entityType: 'device',
 *   addCommand: 'podkit device add <name>',
 * });
 *
 * if (result.success) {
 *   console.log(result.entity.name, result.entity.config);
 * } else {
 *   console.error(result.error);
 * }
 * ```
 */
export function resolveNamedEntity<T>(options: ResolveNamedEntityOptions<T>): ResolutionResult<T> {
  const { entities, defaultName, requestedName, entityType, addCommand, defaultCommand } = options;

  // Case 1: Explicit name requested
  if (requestedName) {
    const config = entities?.[requestedName];
    if (config) {
      return {
        success: true,
        entity: { name: requestedName, config },
      };
    }
    // Not found - format helpful error
    return {
      success: false,
      error: formatNotFoundError(requestedName, entities, entityType),
    };
  }

  // Case 2: Use default
  if (defaultName) {
    const config = entities?.[defaultName];
    if (config) {
      return {
        success: true,
        entity: { name: defaultName, config },
      };
    }
    // Default configured but doesn't exist (config inconsistency)
    return {
      success: false,
      error: `Default ${entityType} "${defaultName}" not found in config.`,
    };
  }

  // Case 3: No default set
  const hasEntities = entities && Object.keys(entities).length > 0;
  if (hasEntities) {
    const setDefaultHint = defaultCommand ? ` or set a default with: ${defaultCommand}` : '';
    return {
      success: false,
      error: `No default ${entityType} set. Specify a name${setDefaultHint}`,
    };
  }

  // Case 4: No entities configured at all
  return {
    success: false,
    error: `No ${entityType}s configured. Run: ${addCommand}`,
  };
}

/**
 * Format error message when entity not found
 */
export function formatNotFoundError<T>(
  name: string,
  entities: Record<string, T> | undefined,
  entityType: string
): string {
  const available = entities ? Object.keys(entities) : [];
  if (available.length === 0) {
    return `${capitalize(entityType)} "${name}" not found. No ${entityType}s configured.`;
  }
  return `${capitalize(entityType)} "${name}" not found. Available: ${available.join(', ')}`;
}

/**
 * Get available entity names from config
 */
export function getAvailableNames<T>(entities: Record<string, T> | undefined): string[] {
  return entities ? Object.keys(entities) : [];
}

// =============================================================================
// CLI Argument Parsing
// =============================================================================

/**
 * Check if a string looks like a filesystem path
 *
 * A value is considered path-like if it:
 * - Contains a forward slash (/)
 * - Starts with a dot (. or ..)
 *
 * @example
 * isPathLike('/Volumes/IPOD')  // true
 * isPathLike('./ipod')         // true
 * isPathLike('../ipod')        // true
 * isPathLike('terapod')        // false
 * isPathLike('my-device')      // false
 */
export function isPathLike(value: string): boolean {
  return value.includes('/') || value.startsWith('.');
}

// =============================================================================
// Utilities
// =============================================================================

/**
 * Capitalize first letter of a string
 */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
