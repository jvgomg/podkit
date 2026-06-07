/**
 * Save-failure fault registry — chmod-based faults for Phase C.2.
 *
 * Each fault arranges a filesystem precondition that makes the named
 * syscall in podkit's save() pipeline hit the named errno. The harness
 * applies the fault between the source-tree seed and the sync invocation,
 * then runs cleanup (idempotent) so subsequent cells start from a known
 * state.
 *
 * ENOSPC is NOT modelled here — it's provisioned via the
 * `device-mount-near-full` SystemState (`apply-state.sh`) rather than as a
 * per-cell fault, because the loopback fill has to land before sync starts
 * for the planner pre-flight to fire.
 *
 * @module
 */

import type { TestRuntime } from '@podkit/device-testing';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Per-cell context that faults consume to derive concrete paths. The
 * harness produces this from (cell, seed layout, mount point); faults
 * dereference it inside `apply` / `cleanup`.
 */
export interface FaultContext {
  /** Mount point of the device under test (loopback or otherwise). */
  mountPoint: string;
  /**
   * Absolute path inside the VM to the audio file the sync will land on
   * the device. For chmod-on-file faults (`track-readonly`) this is the
   * file to be locked AFTER the copy stage completes — applied via the
   * pre-stage seed (not at-apply time). See harness for sequencing.
   */
  targetFile: string;
  /**
   * Absolute path inside the VM to the album directory where the audio
   * file lives. For `album-readonly` and `cover-collision`.
   */
  targetAlbumDir: string;
  /**
   * Absolute path to the iTunes directory inside the device (iPod
   * cells only). For `itunesdb-readonly`: chmod 0555 this dir AFTER the
   * first sync so the second sync's iTunesDB tmp+rename hits EACCES.
   */
  itunesDir?: string;
  /**
   * Absolute path to the destination album dir's PARENT (i.e. the artist
   * dir) for move-stage faults. For `move-parent-readonly`: chmod 0555
   * the parent dir of the destination album so the relocate's mkdir +
   * rename hit EACCES inside save()'s move stage.
   */
  movePivotDir?: string;
}

/** Stable identifiers for each fault injector. */
export type FaultId =
  | 'track-readonly'
  | 'album-readonly'
  | 'cover-collision'
  | 'manifest-dir-readonly'
  | 'itunesdb-readonly'
  | 'move-parent-readonly';

export interface FaultSpec {
  id: FaultId;
  description: string;
  /**
   * Arrange the precondition. May mutate the device fs, create
   * directories, or chmod paths.
   */
  apply(runtime: TestRuntime, ctx: FaultContext): Promise<void>;
  /**
   * Reverse the precondition. Idempotent — must succeed (best-effort) even
   * if `apply` partially failed or the test harness called cleanup twice.
   */
  cleanup(runtime: TestRuntime, ctx: FaultContext): Promise<void>;
  /**
   * Pre-seed semantics. When `'first-sync'`, the harness runs a clean
   * first sync (the device gets a manifest + the track file), then mutates
   * the source so the next sync queues an in-place tag-write (or relocate)
   * diff against the managed file, then applies the fault, then runs the
   * second (failing) sync. Required for any fault that must hit an
   * in-place mutation stage rather than a fresh-inode copy stage —
   * podkit's `atomicCopyFile` writes to a new inode so chmod on the
   * destination file never lands on the inode the copy actually writes.
   *
   * When `'none'` (default), the fault fires against a fresh device with
   * one sync invocation; the fault precondition exists at first-sync time.
   */
  preseed?: 'none' | 'first-sync';
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Quote-safe shell single-quoting. */
function sq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Run a shell command via `sudo bash -c "..."`. Errors out on non-zero exit. */
async function shAsRoot(runtime: TestRuntime, body: string): Promise<void> {
  const result = await runtime.run(`sudo bash -c ${sq(body)}`);
  if (result.exitCode !== 0) {
    throw new Error(
      `fault command failed (exit=${result.exitCode}): ${body}\n` +
        `  stdout: ${result.stdout.slice(0, 400)}\n  stderr: ${result.stderr.slice(0, 400)}`
    );
  }
}

/** Best-effort root sh — swallows non-zero exits (used in cleanup paths). */
async function shAsRootBestEffort(runtime: TestRuntime, body: string): Promise<void> {
  try {
    await runtime.run(`sudo bash -c ${sq(body)} || true`);
  } catch {
    // tolerated
  }
}

// ---------------------------------------------------------------------------
// Faults
// ---------------------------------------------------------------------------

const TRACK_READONLY: FaultSpec = {
  id: 'track-readonly',
  description:
    "chattr +i on the target audio file after first sync — second sync's in-place tag write hits EPERM. The ext4 immutable bit blocks unlink AND rename of the target inode (and rename-onto-target), so the tag-writer's tmp+rename atomic flow trips EPERM instead of the chmod 0444 EACCES it relied on before TASK-376's atomicWriteFileWithSync routing.",
  preseed: 'first-sync',
  async apply(runtime, ctx) {
    // The target file must exist before chattr — `preseed: 'first-sync'`
    // makes the harness run a clean first sync to create the managed file,
    // mutate the source so the second sync queues a tag-update on it, then
    // call this apply() to flip the immutable bit before the second sync.
    //
    // chmod 0444 USED to block tag writes (the writer opened the target
    // file for write directly). After TASK-376, `TagLibTagWriter` reads the
    // file, mutates a buffer, writes a sibling `.podkit-tmp`, fsyncs it,
    // then `renameat()` over the target. `renameat()` honours parent-dir
    // permissions, not the source/target file perms — so chmod 0444 on the
    // target no longer trips anything. The ext4 immutable bit DOES block
    // both `unlink(target)` and `renameat(tmp, target)` regardless of dir
    // perms, with EPERM ("Operation not permitted").
    await shAsRoot(runtime, `chattr +i ${sq(ctx.targetFile)}`);
  },
  async cleanup(runtime, ctx) {
    await shAsRootBestEffort(runtime, `chattr -i ${sq(ctx.targetFile)} || true`);
  },
};

const ALBUM_READONLY: FaultSpec = {
  id: 'album-readonly',
  description: 'chmod 0500 on the album directory — copy/sidecar/etc cannot create new files.',
  async apply(runtime, ctx) {
    // The album dir must exist before chmod. We create it world-writable
    // first (so the parent chain is traversable) then chmod the leaf to
    // 0500 — block writes inside the album dir specifically.
    await shAsRoot(
      runtime,
      `mkdir -p ${sq(ctx.targetAlbumDir)} && chmod -R 0777 ${sq(ctx.mountPoint)} && chmod 0500 ${sq(ctx.targetAlbumDir)}`
    );
  },
  async cleanup(runtime, ctx) {
    await shAsRootBestEffort(runtime, `chmod 0777 ${sq(ctx.targetAlbumDir)} || true`);
  },
};

const COVER_COLLISION: FaultSpec = {
  id: 'cover-collision',
  description: 'A DIRECTORY exists at <album>/cover.jpg — sidecar atomic rename fails with EISDIR.',
  async apply(runtime, ctx) {
    // Create the parent chain as world-writable, then drop the cover.jpg
    // directory at the album-level path. The audio copy stage must still
    // be able to write inside the album dir.
    await shAsRoot(
      runtime,
      `mkdir -p ${sq(ctx.targetAlbumDir + '/cover.jpg')} && chmod -R 0777 ${sq(ctx.mountPoint)} && chmod 0555 ${sq(ctx.targetAlbumDir + '/cover.jpg')}`
    );
  },
  async cleanup(runtime, ctx) {
    await shAsRootBestEffort(
      runtime,
      `chmod 0777 ${sq(ctx.targetAlbumDir + '/cover.jpg')} 2>/dev/null; rm -rf ${sq(ctx.targetAlbumDir + '/cover.jpg')} || true`
    );
  },
};

const MANIFEST_DIR_READONLY: FaultSpec = {
  id: 'manifest-dir-readonly',
  description: 'chmod 0500 on <mount>/.podkit/ — the manifest tmp+rename write fails with EACCES.',
  async apply(runtime, ctx) {
    // Create the .podkit dir with read-only mode. Mount root stays
    // 0777 so the rest of the sync (copy + tag + sidecar) can land.
    await shAsRoot(
      runtime,
      `mkdir -p ${sq(ctx.mountPoint + '/.podkit')} && chmod -R 0777 ${sq(ctx.mountPoint)} && chmod 0555 ${sq(ctx.mountPoint + '/.podkit')}`
    );
  },
  async cleanup(runtime, ctx) {
    await shAsRootBestEffort(runtime, `chmod 0777 ${sq(ctx.mountPoint + '/.podkit')} || true`);
  },
};

const ITUNESDB_READONLY: FaultSpec = {
  id: 'itunesdb-readonly',
  description:
    "chmod 0555 on <iPod>/iPod_Control/iTunes/ after first sync — second sync's iTunesDB tmp+rename hits EACCES inside save() stage 1.",
  preseed: 'first-sync',
  async apply(runtime, ctx) {
    if (!ctx.itunesDir) {
      throw new Error('itunesdb-readonly: ctx.itunesDir is required (iPod cells only)');
    }
    // The iTunes/ directory exists after `podkit device init` + first sync.
    // chmod 0555 blocks libgpod's tmp+rename: it tries to create
    // `iTunesDB.XXXXXX` inside the dir and hits EACCES on open().
    await shAsRoot(runtime, `chmod 0555 ${sq(ctx.itunesDir)}`);
  },
  async cleanup(runtime, ctx) {
    if (!ctx.itunesDir) return;
    await shAsRootBestEffort(runtime, `chmod 0755 ${sq(ctx.itunesDir)} || true`);
  },
};

const MOVE_PARENT_READONLY: FaultSpec = {
  id: 'move-parent-readonly',
  description:
    'Pre-create the destination album dir, then chmod 0555 on it — save() stage 1 fs.mkdirSync no-ops (dir exists) then fs.renameSync EACCES → MoveError. Combined with a 2-track relocate pre-seed this surfaces MoveError throw-on-first asymmetry.',
  preseed: 'first-sync',
  async apply(runtime, ctx) {
    if (!ctx.movePivotDir) {
      throw new Error('move-parent-readonly: ctx.movePivotDir is required');
    }
    // Pre-create the destination album dir THEN chmod 0555. This way the
    // save()'s `mkdirSync(..., { recursive: true })` is a no-op (idempotent
    // mkdir on an existing dir succeeds), and the renameSync inside the
    // try/catch hits EACCES → wrapped as MoveError. Without the
    // pre-existence, mkdirSync fails BEFORE the try and the raw EACCES
    // escapes uncategorised — that would not pin the MoveError type.
    await shAsRoot(
      runtime,
      `mkdir -p ${sq(ctx.movePivotDir)} && chmod 0555 ${sq(ctx.movePivotDir)}`
    );
  },
  async cleanup(runtime, ctx) {
    if (!ctx.movePivotDir) return;
    await shAsRootBestEffort(runtime, `chmod 0777 ${sq(ctx.movePivotDir)} || true`);
  },
};

/**
 * Registry of chmod-based faults. Index by `FaultId`.
 */
export const SAVE_FAILURE_FAULTS: ReadonlyMap<FaultId, FaultSpec> = new Map<FaultId, FaultSpec>([
  ['track-readonly', TRACK_READONLY],
  ['album-readonly', ALBUM_READONLY],
  ['cover-collision', COVER_COLLISION],
  ['manifest-dir-readonly', MANIFEST_DIR_READONLY],
  ['itunesdb-readonly', ITUNESDB_READONLY],
  ['move-parent-readonly', MOVE_PARENT_READONLY],
]);
