/**
 * Source-of-truth hash for the device-harness VM baseline.
 *
 * The "baseline" is the union of host files that, when changed, mean the
 * running VM was provisioned from an out-of-date version of the source.
 * Currently:
 *
 *   - `lima/podkit-device-harness.yaml` — apt packages, kernel modules,
 *     fstab entries; the cloud-init script that runs at first boot.
 *   - `scripts/apply-state.sh` — runtime realisation of SystemStates.
 *     Drift here means a SystemState in the TypeScript registry may have
 *     no in-VM applier.
 *
 * Shared between the drift check (read-side: hashes host, compares to VM) and
 * the harness setup (write-side: hashes host, seals into VM). Lifting the file
 * glob + hashing primitive into a module keeps the two paths in lockstep —
 * neither can drift from the other without a unit test catching it.
 *
 * @module
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * In-VM path where the sealed baseline hash lives. Written after successful
 * provisioning and binary install; read by the drift check.
 *
 * The directory is also where `apply-state.sh` already places long-lived
 * harness state (`stashed-udev`, `podkit-device-fs.img`), so we don't
 * introduce a new top-level path under `/var/lib`.
 */
export const BASELINE_VM_HASH_PATH = '/var/lib/podkit-device-harness/baseline-hash';

/**
 * Files (relative to the device-testing package root) whose content
 * contributes to the baseline hash. Order is significant — the combined
 * hash is `sha256(name + ':' + sha256(content) + '\n')` for each entry in
 * the order below, so an accidental sort would invalidate every VM
 * without a real change. Add new entries at the END to preserve cache
 * stability for existing VMs (or accept a one-time drift hit).
 */
const BASELINE_FILES: readonly string[] = [
  'lima/podkit-device-harness.yaml',
  'scripts/apply-state.sh',
];

/** Per-file digest emitted by {@link computeBaselineHash}. */
export interface BaselineFileEntry {
  /** Path relative to the package root, for log/error messages. */
  relPath: string;
  /** Absolute host path that was hashed. */
  absPath: string;
  /** sha256 hex of the file content. */
  sha256: string;
}

/** Result of {@link computeBaselineHash}. */
export interface BaselineHashResult {
  /** Combined sha256 across all baseline files (the value sealed in the VM). */
  combinedSha: string;
  /** Per-file digests, in declaration order. */
  files: readonly BaselineFileEntry[];
}

/**
 * Compute the combined baseline hash for the device-harness VM.
 *
 * Throws if any tracked file is missing — a baseline whose source is
 * absent is meaningless and should fail loudly rather than silently
 * compute a "different" hash that future runs would match.
 */
export function computeBaselineHash(packageRoot: string): BaselineHashResult {
  const combined = createHash('sha256');
  const files: BaselineFileEntry[] = [];

  for (const relPath of BASELINE_FILES) {
    const absPath = path.join(packageRoot, relPath);
    let content: Buffer;
    try {
      content = fs.readFileSync(absPath);
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(
        `computeBaselineHash: cannot read tracked baseline file ` +
          `at ${absPath} (${cause}). The host source is incomplete.`
      );
    }
    const sha256 = createHash('sha256').update(content).digest('hex');
    files.push({ relPath, absPath, sha256 });
    // Format: `<relPath>:<sha256>\n` — names are part of the combined
    // hash so reordering BASELINE_FILES (a programmer error) produces a
    // visibly different combined hash rather than masquerading as a
    // real source change.
    combined.update(`${relPath}:${sha256}\n`);
  }

  return { combinedSha: combined.digest('hex'), files };
}
