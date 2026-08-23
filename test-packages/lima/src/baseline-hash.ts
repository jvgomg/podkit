/**
 * Baseline hashing for VM provisioning inputs.
 *
 * A VM's "baseline" is the set of host files that, when changed, mean the
 * running VM was provisioned from an out-of-date version of the source. For
 * the device-synthesis harness those inputs are:
 *
 *   - its Lima YAML — apt packages, kernel modules, fstab entries; the
 *     cloud-init script that runs at first boot.
 *   - `apply-state.sh` — runtime realisation of SystemStates. Drift here means
 *     a SystemState in the TypeScript registry may have no in-VM applier.
 *
 * Those inputs span packages: the YAML lives in this package's `vms/`, while
 * `apply-state.sh` belongs to `@podkit/device-testing` (it is domain-coupled to
 * the SystemState registry). This module therefore owns only the *primitive* —
 * an explicit list of absolute file paths in, one combined hash out. Composing
 * the list for a given VM is the job of the package that owns its non-YAML
 * inputs.
 *
 * The primitive is shared between the drift check (read-side: hashes host,
 * compares to VM) and the harness setup (write-side: hashes host, seals into
 * VM), so neither path can drift from the other without a unit test catching
 * it.
 *
 * Note: consolidating the VM YAMLs under `vms/` changed the labels fed into
 * the combined hash, so it shifted once at that point and every previously
 * sealed VM reads as drifted. That is a deliberate one-time cost, paid
 * alongside the Lima instance renames that already require a destroy and
 * re-provision — not an accident.
 *
 * @module
 */

import { createHash } from 'node:crypto';
import * as fs from 'node:fs';

/**
 * In-VM path where the sealed baseline hash lives. Written after successful
 * provisioning and binary install; read by the drift check.
 *
 * The directory is also where `apply-state.sh` already places long-lived
 * harness state (`stashed-udev`, `podkit-device-fs.img`), so we don't
 * introduce a new top-level path under `/var/lib`. It is an in-VM filesystem
 * path, deliberately independent of the Lima instance name.
 */
export const BASELINE_VM_HASH_PATH = '/var/lib/podkit-device-harness/baseline-hash';

/** One host file whose content contributes to a VM's baseline hash. */
export interface TrackedBaselineFile {
  /**
   * Short, stable name for this input. It is mixed into the combined hash (so
   * relabelling or reordering the inputs is visible) and used in error
   * messages, so it should read well in a terminal — a bare basename or a
   * short repo-relative path, not an absolute path.
   */
  label: string;
  /** Absolute host path to hash. */
  absPath: string;
}

/** Per-file digest emitted by {@link computeBaselineHash}. */
export interface BaselineFileEntry extends TrackedBaselineFile {
  /** sha256 hex of the file content. */
  sha256: string;
}

/** Result of {@link computeBaselineHash}. */
export interface BaselineHashResult {
  /** Combined sha256 across all baseline files (the value sealed in the VM). */
  combinedSha: string;
  /** Per-file digests, in the order the caller declared them. */
  files: readonly BaselineFileEntry[];
}

/**
 * Hash a VM's tracked baseline files into one combined digest.
 *
 * Declaration order is significant: the combined hash folds in
 * `` `${label}:${sha256}\n` `` per file, in the given order, so reordering or
 * relabelling the list produces a visibly different combined hash rather than
 * masquerading as a real source change. Callers must therefore build the list
 * in a fixed order, and append rather than insert when adding an input.
 *
 * Throws if any tracked file is missing — a baseline whose source is absent is
 * meaningless and should fail loudly rather than silently compute a
 * "different" hash that future runs would match.
 */
export function computeBaselineHash(
  trackedFiles: readonly TrackedBaselineFile[]
): BaselineHashResult {
  if (trackedFiles.length === 0) {
    throw new Error(
      'computeBaselineHash: no tracked baseline files were supplied. ' +
        'A baseline over zero files cannot detect drift.'
    );
  }

  const combined = createHash('sha256');
  const files: BaselineFileEntry[] = [];

  for (const { label, absPath } of trackedFiles) {
    let content: Buffer;
    try {
      content = fs.readFileSync(absPath);
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(
        `computeBaselineHash: cannot read tracked baseline file ` +
          `'${label}' at ${absPath} (${cause}). The host source is incomplete.`
      );
    }
    const sha256 = createHash('sha256').update(content).digest('hex');
    files.push({ label, absPath, sha256 });
    combined.update(`${label}:${sha256}\n`);
  }

  return { combinedSha: combined.digest('hex'), files };
}
