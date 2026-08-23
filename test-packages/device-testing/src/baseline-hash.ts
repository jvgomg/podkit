/**
 * Device-harness VM baseline: which host files a provisioned VM is pinned to,
 * and the hashing primitive that turns them into a sealed digest.
 *
 * The hashing primitive itself lives in the Lima substrate package
 * (`@podkit/lima`) and is re-exported here so the existing
 * `../src/baseline-hash.js` import sites (harness + drift check scripts) keep
 * resolving unchanged. What this module adds is the *composition*: the device
 * harness's baseline spans two packages — the Lima YAML (owned by
 * `@podkit/lima`) and `apply-state.sh` (owned here, because it is coupled to
 * the SystemState registry) — so only this package can name the full list.
 *
 * @module
 */

import * as path from 'node:path';

import { deviceVm, type TrackedBaselineFile } from '@podkit/lima';

import { devTestingPackageRoot } from './runners/paths.js';

export type { TrackedBaselineFile, BaselineFileEntry, BaselineHashResult } from '@podkit/lima';
export { computeBaselineHash, BASELINE_VM_HASH_PATH } from '@podkit/lima';

/**
 * The device-harness VM's tracked baseline files, in the order they are folded
 * into the combined hash. Order is significant (see `computeBaselineHash`):
 * the Lima YAML first, then `apply-state.sh`. Append new inputs at the END.
 *
 * Paths are resolved inside the function body, never at module load. Both
 * anchors walk `import.meta.url` back to a source-tree marker, and this
 * package's modules get bundled into the single-file FunctionFS daemon, whose
 * `/$bunfs/root/…` paths carry no such marker — eager resolution would turn a
 * host-only concern into a daemon startup crash.
 */
export function deviceBaselineFiles(): readonly TrackedBaselineFile[] {
  const tracked = [
    deviceVm().yamlPath,
    path.join(devTestingPackageRoot(), 'scripts', 'apply-state.sh'),
  ];
  // Labels are basenames rather than repeated literals, so a file rename can
  // never leave the hash naming something that no longer exists. This relies
  // on the tracked basenames being distinct — they are, and both live in
  // different packages. Adding a third input whose basename collides with an
  // existing one would make drift output ambiguous (two identical-looking
  // lines); switch to repo-relative labels if that ever happens.
  return tracked.map((absPath) => ({ label: path.basename(absPath), absPath }));
}
