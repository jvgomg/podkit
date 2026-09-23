/**
 * Baseline hashing for substrate provisioning inputs.
 *
 * Inputs span packages, so this module owns only the primitive: an ordered list
 * in, one combined hash out. Composing the list for a substrate belongs to the
 * package that owns its provisioning.
 *
 * Shared between the drift check and the harness seal, so the two cannot
 * disagree. Changing the list or its order changes every sealed hash and every
 * sealed guest then reads as drifted — the intended cost of adding an input.
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

/**
 * A provisioning input that is a value rather than a file — a pin expressed in
 * TypeScript, say. Hashing the module that declares it would fold in every
 * unrelated edit to that module, so the value itself is what is tracked.
 */
export interface TrackedBaselineValue {
  /** Short, stable name. See {@link TrackedBaselineFile.label}. */
  label: string;
  /** The value whose change means the guest was provisioned differently. */
  value: string;
}

/** Anything a baseline may be sealed over. */
export type TrackedBaselineInput = TrackedBaselineFile | TrackedBaselineValue;

/** Per-input digest emitted by {@link computeBaselineHash}. */
export interface BaselineFileEntry {
  label: string;
  /** Absolute host path, or `null` for a tracked value. */
  absPath: string | null;
  /** sha256 hex of the content. */
  sha256: string;
}

/** Result of {@link computeBaselineHash}. */
export interface BaselineHashResult {
  /** Combined sha256 across all inputs (the value sealed in the VM). */
  combinedSha: string;
  /** Per-input digests, in the order the caller declared them. */
  files: readonly BaselineFileEntry[];
}

function isTrackedValue(input: TrackedBaselineInput): input is TrackedBaselineValue {
  return 'value' in input;
}

/**
 * Hash a substrate's tracked provisioning inputs into one combined digest.
 *
 * Declaration order is significant: the combined hash folds in
 * `` `${label}:${sha256}\n` `` per input, in the given order, so reordering or
 * relabelling produces a visibly different hash rather than masquerading as a
 * real source change. Build the list in a fixed order, and append rather than
 * insert when adding an input.
 *
 * Throws if any tracked file is missing — a baseline whose source is absent is
 * meaningless and should fail loudly rather than silently compute a
 * "different" hash that future runs would match.
 */
export function computeBaselineHash(
  trackedInputs: readonly TrackedBaselineInput[]
): BaselineHashResult {
  if (trackedInputs.length === 0) {
    throw new Error(
      'computeBaselineHash: no tracked baseline inputs were supplied. ' +
        'A baseline over zero inputs cannot detect drift.'
    );
  }

  const combined = createHash('sha256');
  const files: BaselineFileEntry[] = [];

  for (const input of trackedInputs) {
    let content: Buffer | string;
    let absPath: string | null = null;
    if (isTrackedValue(input)) {
      content = input.value;
    } else {
      absPath = input.absPath;
      try {
        content = fs.readFileSync(input.absPath);
      } catch (err) {
        const cause = err instanceof Error ? err.message : String(err);
        throw new Error(
          `computeBaselineHash: cannot read tracked baseline file ` +
            `'${input.label}' at ${input.absPath} (${cause}). The host source is incomplete.`
        );
      }
    }
    const sha256 = createHash('sha256').update(content).digest('hex');
    files.push({ label: input.label, absPath, sha256 });
    combined.update(`${input.label}:${sha256}\n`);
  }

  return { combinedSha: combined.digest('hex'), files };
}
