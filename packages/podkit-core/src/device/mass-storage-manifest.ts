/**
 * On-disk rewrite utilities for the mass-storage manifest (state.json).
 *
 * This module is adapter-agnostic — it knows nothing about in-memory state,
 * open adapter handles, or diagnostic context. It operates purely on the
 * filesystem path to the state directory and returns a typed result so each
 * consumer can apply its own bookkeeping after the rewrite succeeds.
 *
 * @module
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { atomicWriteFile } from '../utils/atomic-fs.js';
import { PODKIT_DIR, MANIFEST_FILE, type MassStorageManifest } from './mass-storage-utils.js';

// =============================================================================
// Public API
// =============================================================================

/**
 * Compute the absolute path to the manifest file from a mount-point path.
 * Useful when callers need to construct `stateDir` from a mount point.
 */
export function manifestPath(mountPoint: string): string {
  return path.join(mountPoint, PODKIT_DIR, MANIFEST_FILE);
}

/**
 * Remove specific rows from the on-disk mass-storage manifest (state.json)
 * via an atomic rewrite.
 *
 * Behaviour:
 * - Empty `pathsToRemove` → immediate no-op, returns `{ pruned: 0, errors: [] }`.
 * - Missing manifest file → treated the same way: nothing to prune.
 * - Unrecognised manifest shape → returns `{ pruned: 0, errors }` where every
 *   requested path gets the same "Unrecognised manifest shape" error. The file
 *   is never overwritten.
 * - Atomic write failure → re-reads the original file and returns all requested
 *   paths as errors. The original manifest survives (atomicWriteFile leaves the
 *   temp file, not the destination, on error).
 * - Individual rows that don't appear in the manifest are silently skipped —
 *   asking to remove a row that isn't there is not an error.
 *
 * This function does NOT update any in-memory state. Each consumer (the adapter
 * wrapper and the doctor) is responsible for its own bookkeeping after a
 * successful call.
 *
 * @param stateDir   - Absolute path to the `.podkit` directory (the parent of
 *                     `state.json`). Use `path.join(mountPoint, PODKIT_DIR)`.
 * @param pathsToRemove - Device-relative paths to drop from `managedFiles`.
 *                        Comparison is NFC-normalised so macOS NFD paths match.
 * @returns `{ pruned, errors }` where `pruned` is the count of rows actually
 *           removed and `errors` lists per-path failures. Catastrophic failures
 *           (read error, write error) surface as an error against every path
 *           rather than a thrown exception — this keeps the caller's error
 *           handling uniform.
 */
export async function pruneManifestRows(
  stateDir: string,
  pathsToRemove: string[]
): Promise<{ pruned: number; errors: Array<{ path: string; error: Error }> }> {
  if (pathsToRemove.length === 0) {
    return { pruned: 0, errors: [] };
  }

  const filePath = path.join(stateDir, MANIFEST_FILE);
  const phantomSet = new Set(pathsToRemove.map((p) => p.normalize('NFC')));

  let raw: string;
  try {
    raw = await fs.promises.readFile(filePath, 'utf-8');
  } catch (err: unknown) {
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr?.code === 'ENOENT') {
      // No manifest on disk — nothing to prune. This is not an error.
      return { pruned: 0, errors: [] };
    }
    // Read failure (EACCES, etc.) — catastrophic, surface against all paths.
    const error = err instanceof Error ? err : new Error(String(err));
    return {
      pruned: 0,
      errors: pathsToRemove.map((p) => ({ path: p, error })),
    };
  }

  let parsed: MassStorageManifest;
  try {
    parsed = JSON.parse(raw) as MassStorageManifest;
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    return {
      pruned: 0,
      errors: pathsToRemove.map((p) => ({ path: p, error })),
    };
  }

  if (parsed.version !== 1 || !Array.isArray(parsed.managedFiles)) {
    // Unrecognised shape — refuse to overwrite a manifest we can't round-trip.
    const failure = new Error('Unrecognised manifest shape; refusing to rewrite');
    return {
      pruned: 0,
      errors: pathsToRemove.map((p) => ({ path: p, error: failure })),
    };
  }

  const before = parsed.managedFiles.length;
  parsed.managedFiles = parsed.managedFiles.filter((p) => !phantomSet.has(p.normalize('NFC')));
  const pruned = before - parsed.managedFiles.length;

  try {
    atomicWriteFile(filePath, JSON.stringify(parsed) + '\n', 'utf-8');
  } catch (err: unknown) {
    const error = err instanceof Error ? err : new Error(String(err));
    return {
      pruned: 0,
      errors: pathsToRemove.map((p) => ({ path: p, error })),
    };
  }

  return { pruned, errors: [] };
}
