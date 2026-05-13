import type { Migration } from './types.js';
import { migration0001 } from './0001-add-version.js';
import { migration0002 } from './0002-rename-ogg-codec.js';

/**
 * Ordered list of all config migrations.
 * Add new migrations here as they are created.
 */
export const registry: Migration[] = [migration0001, migration0002];
