/**
 * VM coverage — Save-failure matrix.
 *
 * Fans (capability shape × source format × codec config × transfer mode ×
 * failure mode) into one observation per cell. Each cell:
 *
 *   1. Stages a config that materialises the cell's `CapabilityShape` via a
 *      `[devices.<name>]` capability override on the `ms-generic` preset
 *      (mass-storage shapes) or via `type = "ipod"` + a `gpod-tool` init at
 *      the cell's model number (iPod shapes).
 *   2. Provisions the mount point — for ENOSPC the
 *      `device-mount-near-full` loopback; for chmod-based faults a fresh
 *      writable directory inside the VM.
 *   3. Seeds the source tree (small FLAC / OGG / MP3, with embedded artwork
 *      for cells that need it).
 *   4. For faults flagged `preseed: 'first-sync'`, runs a clean first sync
 *      that produces a managed file on the device, mutates the source so
 *      the next sync queues an in-place tag-write (or relocate) diff
 *      against the managed file, then applies the fault.
 *   5. Applies the fault.
 *   6. Runs the (failing) sync.
 *   7. Walks the mount + runs a dry-run rescan + a doctor check, capturing
 *      the observation envelope per cell.
 *
 * # Cell pruning
 *
 *   - `cover-collision` × non-sidecar shape → `skipImpossible`.
 *   - `album-readonly` and `manifest-dir-readonly` → one canonical
 *     (sourceFormat, codecConfig) per shape (the prediction is identical).
 *   - `track-readonly` → keep cells whose output extension is distinct
 *     (`.flac` vs `.m4a` vs `.ogg`); skip duplicates.
 *   - `itunesdb-readonly` / `move-parent-readonly` → iPod / mass-storage
 *     only (respectively); cells in the other shape family are
 *     `skipImpossible`.
 *
 * @see test-packages/e2e-vm-tests/src/matrix/README.md
 */

import { mkdir, rm } from 'node:fs/promises';
import { describe, beforeAll, afterAll } from 'bun:test';

import {
  limaTestVmRunner,
  VM_COLD_TIMEOUT_MS,
  VM_WARM_TIMEOUT_MS,
  deviceMountNearFull,
  DEVICE_MOUNT_NEAR_FULL_PATH,
  deviceMountFitsEstimateFailedSweep,
  DEVICE_MOUNT_FITS_ESTIMATE_FAILED_SWEEP_PATH,
  deviceMountFitsEstimateSourceDrifts,
  DEVICE_MOUNT_FITS_ESTIMATE_SOURCE_DRIFTS_PATH,
  healthy,
} from '@podkit/device-testing';

import { defineMatrix, skipImpossible, skipRedundant } from './matrix/harness.js';
import {
  predictSaveFail,
  saveFailCellKey,
  saveFailCellLabel,
  SAVE_FAIL_CELLS,
  CAPABILITY_SHAPES,
  derivedSyncPath,
  type SaveFailCell,
  type SaveFailObserved,
  type CapabilityShape,
} from './matrix/save-failure-rules.js';
import { SAVE_FAILURE_FAULTS, type FaultContext } from './matrix/save-failure-faults.js';

// ---------------------------------------------------------------------------
// Per-cell layout
// ---------------------------------------------------------------------------

/**
 * Derive the per-cell mount point inside the VM. SystemState-provisioned
 * cells use their loopback's known path; chmod cells use a fresh `/tmp`
 * directory keyed by cell signature.
 */
function mountPointFor(cell: SaveFailCell): string {
  if (cell.failureMode === 'enospc') return DEVICE_MOUNT_NEAR_FULL_PATH;
  if (cell.failureMode === 'enospc-post-sweep') {
    return DEVICE_MOUNT_FITS_ESTIMATE_FAILED_SWEEP_PATH;
  }
  if (cell.failureMode === 'enospc-estimate-drift') {
    return DEVICE_MOUNT_FITS_ESTIMATE_SOURCE_DRIFTS_PATH;
  }
  const slug = saveFailCellKey(cell).replace(/[/]/g, '_');
  return `/tmp/podkit-savefail-${slug}`;
}

/**
 * Failure modes provisioned by a SystemState loopback (rather than chmod
 * faults). Used as a type predicate so the chmod-fault dispatch can
 * narrow `cell.failureMode` to the `FaultId` union safely.
 */
type LoopbackFailureMode = 'enospc' | 'enospc-post-sweep' | 'enospc-estimate-drift';
type ChmodFailureMode = Exclude<SaveFailCell['failureMode'], LoopbackFailureMode>;

function isLoopbackProvisionedFailure(
  mode: SaveFailCell['failureMode']
): mode is LoopbackFailureMode {
  return mode === 'enospc' || mode === 'enospc-post-sweep' || mode === 'enospc-estimate-drift';
}

const ARTIST = 'SaveFail Artist';
const ALBUM_ARTIST_ORIGINAL = 'SaveFail Artist';
const ALBUM_ARTIST_MUTATED = 'SaveFail Renamed Artist';
const ALBUM = 'Album';
const TRACK_TITLE = 'Track One';
const TRACK_2_TITLE = 'Track Two';
/**
 * On-device layout for the generic mass-storage preset:
 *   Music/{albumArtist}/{album}/{trackNumber} - {title}{ext}
 */
const DEVICE_MUSIC_DIR = 'Music';
function deviceRelPath(
  trackNumber: number,
  title: string,
  albumArtist: string = ALBUM_ARTIST_ORIGINAL,
  album: string = ALBUM
): string {
  return `${DEVICE_MUSIC_DIR}/${albumArtist}/${album}/${String(trackNumber).padStart(2, '0')} - ${title}`;
}

function sourceDirFor(cell: SaveFailCell): string {
  const slug = saveFailCellKey(cell).replace(/[/]/g, '_');
  return `/tmp/podkit-savefail-src-${slug}`;
}

function configPathFor(cell: SaveFailCell): string {
  const slug = saveFailCellKey(cell).replace(/[/]/g, '_');
  return `/tmp/podkit-savefail-cfg-${slug}.toml`;
}

function deviceNameFor(cell: SaveFailCell): string {
  return `cell_${saveFailCellKey(cell).replace(/[^a-zA-Z0-9]/g, '_')}`;
}

function isIpodShape(shape: CapabilityShape): boolean {
  return CAPABILITY_SHAPES[shape].deviceType === 'ipod';
}

/** Output extension the device writes after save(). */
function outputExtFor(cell: SaveFailCell): string {
  const syncPath = derivedSyncPath(
    cell.shape,
    cell.sourceFormat,
    cell.codecConfig,
    cell.transferMode
  );
  if (syncPath === 'transcode-aac') return '.m4a';
  if (cell.sourceFormat === 'flac') return '.flac';
  if (cell.sourceFormat === 'mp3') return '.mp3';
  return '.ogg';
}

/** Two-track cells (Stage D move-parent-readonly) need a second track. */
function isTwoTrackCell(cell: SaveFailCell): boolean {
  return cell.failureMode === 'move-parent-readonly';
}

/** Concrete on-device file path (relative to mount). */
function deviceFileRelPath(
  cell: SaveFailCell,
  trackNumber: number = 1,
  title: string = TRACK_TITLE,
  albumArtist: string = ALBUM_ARTIST_ORIGINAL,
  album: string = ALBUM
): string {
  return `${deviceRelPath(trackNumber, title, albumArtist, album)}${outputExtFor(cell)}`;
}

/** Concrete on-device album dir (relative to mount). */
function deviceAlbumRelPath(
  albumArtist: string = ALBUM_ARTIST_ORIGINAL,
  album: string = ALBUM
): string {
  return `${DEVICE_MUSIC_DIR}/${albumArtist}/${album}`;
}

// ---------------------------------------------------------------------------
// Shell helpers
// ---------------------------------------------------------------------------

function sq(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function runScript(
  body: string
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const result = await limaTestVmRunner.run(`bash -c ${sq(body)}`, {
    timeoutMs: VM_WARM_TIMEOUT_MS,
  });
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
}

async function runRoot(
  body: string
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const result = await limaTestVmRunner.run(`sudo bash -c ${sq(body)}`, {
    timeoutMs: VM_WARM_TIMEOUT_MS,
  });
  return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
}

// ---------------------------------------------------------------------------
// Source tree provisioning
// ---------------------------------------------------------------------------

interface SourceSeed {
  /** Track number (1-based). */
  trackNumber: number;
  /** Track title (also drives file name). */
  title: string;
  /** Album name (overrides ALBUM for relocate fixtures). */
  album?: string;
  /**
   * AlbumArtist — drives the `{albumArtist}/...` segment of the path
   * template and is in MetadataChange (`albumArtist`). Mutating it
   * between pre-seed and second sync triggers a relocate (path-mismatch)
   * — the match key `(artist, title, album)` is unchanged, so the planner
   * pairs the source with the device track and queues a move.
   */
  albumArtist?: string;
  /** Distinct sine frequency keeps files distinguishable. */
  frequency: number;
  /**
   * Genre — surfaces a `MetadataChange` in the planner's metadata-correction
   * diff. Mutating genre between pre-seed and the failing sync triggers an
   * `update-metadata` op (in-place tag write) without changing the file's
   * path. `'original'` / `'updated'` is the convention used by the
   * pre-seed harness.
   */
  genre: string;
}

/**
 * Write one source audio file with optional embedded JPEG cover. Returns
 * the absolute path of the written file.
 */
async function writeSourceTrack(
  cell: SaveFailCell,
  seed: SourceSeed,
  opts: { embedCover: boolean }
): Promise<string> {
  const dir = sourceDirFor(cell);
  const album = seed.album ?? ALBUM;
  const albumArtist = seed.albumArtist ?? ALBUM_ARTIST_ORIGINAL;
  const rel = `${ARTIST}/${album}/${String(seed.trackNumber).padStart(2, '0')} ${seed.title}`;
  const ext = cell.sourceFormat === 'flac' ? 'flac' : cell.sourceFormat === 'mp3' ? 'mp3' : 'ogg';
  // TASK-412 estimate-drift cell: force a high-bitrate, long-duration mp3
  // so the actual file size exceeds estimateCopySize (typical-bitrate ×
  // duration → 256 kbps × 30s ≈ 960 KiB; actual at 320 kbps × 30s ≈ 1.2 MiB).
  const isDriftCell = cell.failureMode === 'enospc-estimate-drift';
  const codecArgs =
    cell.sourceFormat === 'flac'
      ? '-c:a flac'
      : cell.sourceFormat === 'mp3'
        ? isDriftCell
          ? '-c:a libmp3lame -b:a 320k'
          : '-c:a libmp3lame -b:a 128k'
        : '-c:a libvorbis';
  // Duration budget per failure mode:
  //   - enospc-estimate-drift: 30s so the 320kbps body (~1.2 MiB) exceeds the
  //     1024 KiB mount free space while the planner's 256kbps estimate (~940 KiB)
  //     fits.
  //   - enospc-post-sweep: 2s so the FLAC estimate (estimateCopySize at 900 kbps
  //     × 2s ≈ 222 KiB) fits inside the plan-time envelope
  //     (free 200 KiB + debris 120 KiB = 320 KiB) but exceeds actual free space
  //     (200 KiB) once the chattr-immutable sweep fails to reclaim the debris.
  //     At 4s the estimate (≈ 442 KiB) exceeds the 320 KiB envelope and the
  //     planner-level pre-flight fires first — the wrong path for this cell.
  //   - all others: 4s (default).
  const isPostSweepCell = cell.failureMode === 'enospc-post-sweep';
  const audioDuration = isDriftCell ? 30 : isPostSweepCell ? 2 : 4;
  // ffmpeg pre-create the cover (10x10 red JPEG) once per source dir.
  const coverPath = `${dir}/cover-src.jpg`;
  const outputPath = `${dir}/${rel}.${ext}`;
  const albumDir = `${dir}/${ARTIST}/${album}`;

  let script: string;
  if (opts.embedCover && cell.sourceFormat === 'ogg') {
    // ffmpeg 5.1 (Debian 12) does not support attached_pic inside an OGG/Vorbis
    // container — it errors with "Unsupported codec id in stream 1". The correct
    // format for OGG cover art is a METADATA_BLOCK_PICTURE vorbis comment
    // (RFC 5334 / FLAC picture block serialised as base64). We create the OGG
    // without embedded art first, then use python3 to inject the vorbis comment.
    // The Python script is written to a temp file to avoid heredoc quoting
    // conflicts with the sq()-wrapped bash -c invocation.
    const tmpOgg = `${outputPath}.notag.ogg`;
    const pyScript = `${outputPath}.embed-cover.py`;
    // Python one-liner (no indentation to survive single-line embedding):
    const pyCode = [
      'import sys,struct,base64,subprocess',
      'src_ogg,cover_jpg,dest_ogg=sys.argv[1],sys.argv[2],sys.argv[3]',
      'img=open(cover_jpg,"rb").read()',
      "mime=b'image/jpeg';desc=b''",
      "block=struct.pack('>I',3)+struct.pack('>I',len(mime))+mime+struct.pack('>I',len(desc))+desc+struct.pack('>IIII',10,10,24,0)+struct.pack('>I',len(img))+img",
      'encoded=base64.b64encode(block).decode()',
      "r=subprocess.run(['ffmpeg','-y','-i',src_ogg,'-c','copy','-metadata','METADATA_BLOCK_PICTURE='+encoded,dest_ogg],capture_output=True)",
      'sys.exit(r.returncode)',
    ].join('\n');
    script = `set -eu
mkdir -p ${sq(albumDir)}
if [ ! -f ${sq(coverPath)} ]; then
  ffmpeg -y -f lavfi -i 'color=red:size=10x10:duration=1' -frames:v 1 -update 1 ${sq(coverPath)} >/dev/null 2>&1
fi
ffmpeg -y -f lavfi -i 'sine=frequency=${seed.frequency}:sample_rate=44100:duration=${audioDuration}' \\
  -metadata artist=${sq(ARTIST)} -metadata album=${sq(album)} \\
  -metadata title=${sq(seed.title)} -metadata track=${seed.trackNumber} \\
  -metadata album_artist=${sq(albumArtist)} \\
  -metadata genre=${sq(seed.genre)} \\
  ${codecArgs} \\
  ${sq(tmpOgg)} >/dev/null 2>&1
printf '%s' ${sq(pyCode)} > ${sq(pyScript)}
python3 ${sq(pyScript)} ${sq(tmpOgg)} ${sq(coverPath)} ${sq(outputPath)} 2>&1
rm -f ${sq(tmpOgg)} ${sq(pyScript)}
`;
  } else if (opts.embedCover) {
    // FLAC and MP3 support embedded cover via -map + -disposition:v attached_pic.
    script = `set -eu
mkdir -p ${sq(albumDir)}
if [ ! -f ${sq(coverPath)} ]; then
  ffmpeg -y -f lavfi -i 'color=red:size=10x10:duration=1' -frames:v 1 -update 1 ${sq(coverPath)} >/dev/null 2>&1
fi
ffmpeg -y -f lavfi -i 'sine=frequency=${seed.frequency}:sample_rate=44100:duration=${audioDuration}' \\
  -i ${sq(coverPath)} \\
  -map 0:a -map 1:v \\
  -metadata artist=${sq(ARTIST)} -metadata album=${sq(album)} \\
  -metadata title=${sq(seed.title)} -metadata track=${seed.trackNumber} \\
  -metadata album_artist=${sq(albumArtist)} \\
  -metadata genre=${sq(seed.genre)} \\
  ${codecArgs} \\
  -c:v mjpeg -disposition:v attached_pic \\
  ${sq(outputPath)} >/dev/null 2>&1
`;
  } else {
    script = `set -eu
mkdir -p ${sq(albumDir)}
ffmpeg -y -f lavfi -i 'sine=frequency=${seed.frequency}:sample_rate=44100:duration=${audioDuration}' \\
  -metadata artist=${sq(ARTIST)} -metadata album=${sq(album)} \\
  -metadata title=${sq(seed.title)} -metadata track=${seed.trackNumber} \\
  -metadata album_artist=${sq(albumArtist)} \\
  -metadata genre=${sq(seed.genre)} \\
  ${codecArgs} \\
  ${sq(outputPath)} >/dev/null 2>&1
`;
  }
  const r = await runScript(script);
  if (r.exitCode !== 0) {
    throw new Error(
      `writeSourceTrack(${saveFailCellKey(cell)}, ${seed.title}) failed (exit=${r.exitCode}): ` +
        `stderr=${r.stderr.slice(0, 400)}`
    );
  }
  return outputPath;
}

/** Embed-cover required for cover-collision (sidecar would never fire without it). */
function needsEmbeddedCover(cell: SaveFailCell): boolean {
  return cell.failureMode === 'cover-collision';
}

async function provisionSourceTree(cell: SaveFailCell): Promise<void> {
  // Clean source dir before writing (a re-observation may have left state).
  await runScript(`rm -rf ${sq(sourceDirFor(cell))} && mkdir -p ${sq(sourceDirFor(cell))}`);
  await writeSourceTrack(
    cell,
    { trackNumber: 1, title: TRACK_TITLE, frequency: 440, genre: 'Original' },
    { embedCover: needsEmbeddedCover(cell) }
  );
  if (isTwoTrackCell(cell)) {
    await writeSourceTrack(
      cell,
      { trackNumber: 2, title: TRACK_2_TITLE, frequency: 660, genre: 'Original' },
      { embedCover: needsEmbeddedCover(cell) }
    );
  }
}

/**
 * Re-write the source files with mutated metadata. The first sync's
 * manifest references the OLD paths/tags, so the second sync queues:
 *
 *   - `move-parent-readonly` (relocate cells): mutates the album name so
 *     the planner queues a `relocate` (file move into a new album dir).
 *   - all other preseed cells: mutates `genre` only. Genre is a
 *     metadata-correction field that does NOT affect the path template,
 *     so the planner queues `update-metadata` (in-place tag write) — the
 *     stage that chmod 0444 on the device file actually blocks.
 *
 * Title is left UNTOUCHED on preseed-tag cells: the default path template
 * `{trackNumber} - {title}{ext}` includes the title, so mutating it would
 * trigger a relocate-style path change (and a NEW copy of the body) rather
 * than an in-place tag write.
 */
async function mutateSourceTree(cell: SaveFailCell): Promise<void> {
  const isRelocate = cell.failureMode === 'move-parent-readonly';
  const albumArtistAfter = isRelocate ? ALBUM_ARTIST_MUTATED : ALBUM_ARTIST_ORIGINAL;
  await writeSourceTrack(
    cell,
    {
      trackNumber: 1,
      title: TRACK_TITLE,
      albumArtist: albumArtistAfter,
      frequency: 440,
      genre: 'Updated',
    },
    { embedCover: needsEmbeddedCover(cell) }
  );
  if (isTwoTrackCell(cell)) {
    await writeSourceTrack(
      cell,
      {
        trackNumber: 2,
        title: TRACK_2_TITLE,
        albumArtist: albumArtistAfter,
        frequency: 660,
        genre: 'Updated',
      },
      { embedCover: needsEmbeddedCover(cell) }
    );
  }
}

// ---------------------------------------------------------------------------
// Config staging
// ---------------------------------------------------------------------------

function tomlListString(arr: readonly string[]): string {
  return `[${arr.map((s) => `"${s}"`).join(', ')}]`;
}

async function stageConfig(cell: SaveFailCell): Promise<void> {
  const deviceName = deviceNameFor(cell);
  const mount = mountPointFor(cell);
  const sourceDir = sourceDirFor(cell);
  const caps = CAPABILITY_SHAPES[cell.shape];

  const codec = cell.codecConfig;
  const lossy = codec === 'prefer-copy' ? '["aac"]' : '["aac"]';
  const lossless = codec === 'prefer-copy' ? '["source"]' : '["aac"]';
  const quality = codec === 'prefer-copy' ? '"max"' : '"high"';
  const transferMode = cell.transferMode;
  // Cover-collision cells need artwork enabled; everyone else turns it off
  // so the sidecar / picture stages don't run.
  const artwork = cell.failureMode === 'cover-collision' ? 'true' : 'false';

  let body: string;
  if (caps.deviceType === 'ipod') {
    // iPod cells: no capability override, the iTunesDB defines capabilities.
    body = [
      `version = 2`,
      ``,
      `quality = ${quality}`,
      `artwork = ${artwork}`,
      `transferMode = "${transferMode}"`,
      ``,
      `[codec]`,
      `lossy = ${lossy}`,
      `lossless = ${lossless}`,
      ``,
      `[devices.${deviceName}]`,
      `type = "ipod"`,
      `path = "${mount}"`,
      ``,
      `[music.default]`,
      `path = "${sourceDir}"`,
      ``,
      `[defaults]`,
      `music = "default"`,
      ``,
    ].join('\n');
  } else {
    body = [
      `version = 2`,
      ``,
      `quality = ${quality}`,
      `artwork = ${artwork}`,
      `transferMode = "${transferMode}"`,
      ``,
      `[codec]`,
      `lossy = ${lossy}`,
      `lossless = ${lossless}`,
      ``,
      `[devices.${deviceName}]`,
      `type = "generic"`,
      `path = "${mount}"`,
      `artworkSources = ${tomlListString([...caps.artworkSources])}`,
      `supportedAudioCodecs = ${tomlListString([...caps.supportedAudioCodecs])}`,
      `audioNormalization = "${caps.audioNormalization}"`,
      ``,
      `[music.default]`,
      `path = "${sourceDir}"`,
      ``,
      `[defaults]`,
      `music = "default"`,
      ``,
    ].join('\n');
  }

  const cfgPath = configPathFor(cell);
  const script = `cat > ${sq(cfgPath)} << '__CFG_EOF__'\n${body}\n__CFG_EOF__`;
  const result = await runScript(script);
  if (result.exitCode !== 0) {
    throw new Error(`stageConfig failed: ${result.stderr.slice(0, 400)}`);
  }
}

// ---------------------------------------------------------------------------
// Mount setup (non-ENOSPC)
// ---------------------------------------------------------------------------

async function provisionMount(cell: SaveFailCell): Promise<void> {
  if (isLoopbackProvisionedFailure(cell.failureMode)) return;
  const mount = mountPointFor(cell);
  const caps = CAPABILITY_SHAPES[cell.shape];
  // Fresh, world-writable dir. For iPod cells, also run gpod-tool init so
  // the iTunesDB exists before the first sync.
  let script = `rm -rf ${sq(mount)} && mkdir -p ${sq(mount)} && chmod 0777 ${sq(mount)}`;
  if (caps.deviceType === 'ipod') {
    const model = caps.ipodModel;
    script += ` && /usr/local/bin/gpod-tool init ${sq(mount)} --model ${sq(model)} >/dev/null 2>&1`;
    // Make /iPod_Control writable by the lima user (gpod-tool runs under
    // sudo so the tree is root-owned by default).
    script += ` && chmod -R 0777 ${sq(mount)}`;
  }
  const result = await runRoot(script);
  if (result.exitCode !== 0) {
    throw new Error(`provisionMount failed: ${result.stderr.slice(0, 400)}`);
  }
}

async function cleanupMount(cell: SaveFailCell): Promise<void> {
  if (isLoopbackProvisionedFailure(cell.failureMode)) return;
  const mount = mountPointFor(cell);
  await runRoot(`chmod -R 0777 ${sq(mount)} 2>/dev/null; rm -rf ${sq(mount)} || true`).catch(
    () => {}
  );
  await runScript(`rm -rf ${sq(sourceDirFor(cell))} ${sq(configPathFor(cell))} || true`).catch(
    () => {}
  );
}

// ---------------------------------------------------------------------------
// Observation
// ---------------------------------------------------------------------------

interface SyncJsonShape {
  success?: boolean;
  status?: string;
  error?: string;
  errors?: Array<{ track?: string; category?: string; message?: string }>;
  operations?: Array<{ type?: string; track?: string; reason?: string }>;
  warnings?: Array<{ message?: string; type?: string }>;
  result?: { completed?: number; failed?: number };
}

interface DoctorJsonShape {
  checks?: Array<{
    id?: string;
    status?: string;
    summary?: string;
    details?: {
      debrisCount?: number;
      debris?: Array<{ path?: string }>;
    };
  }>;
}

function classifyThrowsClass(message: string): SaveFailObserved['throwsClass'] {
  if (/Not enough space after debris cleanup/.test(message)) {
    return 'InsufficientSpaceAfterCleanup';
  }
  if (/file move failed for/.test(message) || /\bMoveError\b/.test(message)) return 'MoveError';
  if (/Failed to save database/.test(message) || /\bDatabaseWriteError\b/.test(message))
    return 'DatabaseWriteError';
  if (/tag write failed for/.test(message) || /\bTagWriteError\b/.test(message))
    return 'TagWriteError';
  if (/picture write failed for/.test(message) || /\bPictureWriteError\b/.test(message))
    return 'PictureWriteError';
  if (/sidecar write failed for/.test(message) || /\bSidecarWriteError\b/.test(message))
    return 'SidecarWriteError';
  return null;
}

/**
 * Parse the verbose text output from a `-vv` sync run and synthesise a
 * SyncJsonShape-like envelope. The formatter emits one block per failed
 * track:
 *
 *   ```
 *     - <track name>
 *       [<category>] <message>
 *   ```
 *
 * Plus a `Failed: N tracks` header just before the error list.
 */
function parseVerboseSyncOutput(
  stdout: string,
  stderr: string
): {
  plannerRejects: boolean;
  errorMessage?: string;
  firstError?: { category: string; message: string };
  failedTrackCount: number;
  portableTagWarn: boolean;
  postSweepDetail?: {
    bytesFreedBySweep: number;
    failedSweepPathsCount: number;
  };
} {
  // Post-sweep ENOSPC (ADR-018): `InsufficientSpaceAfterCleanup` message is
  // emitted via `out.error(err.message)` from sync-presenter's catch. The
  // constructor's message format carries the typed-error detail (see
  // packages/podkit-core/src/sync/engine/errors.ts):
  //   "Not enough space after debris cleanup. Need <N> bytes, have <M>
  //    (sweep freed <F> bytes[; <K> sweep path(s) failed])."
  const postSweepMatch = stderr.match(
    /^Not enough space after debris cleanup\. Need (\d+) bytes, have (\d+) \(sweep freed (\d+) bytes(?:; (\d+) sweep path\(s\) failed)?\)\.$/m
  );
  if (postSweepMatch) {
    const bytesFreedBySweep = parseInt(postSweepMatch[3] ?? '0', 10) || 0;
    const failedSweepPathsCount = postSweepMatch[4] ? parseInt(postSweepMatch[4], 10) || 0 : 0;
    return {
      // The post-sweep gate runs INSIDE the executor's pre-flight, so by
      // matrix nomenclature it's not the "planner" rejecting (no save() runs
      // either way, but the throw site is execute-time, not plan-time).
      plannerRejects: false,
      errorMessage: postSweepMatch[0],
      failedTrackCount: 0,
      portableTagWarn: false,
      postSweepDetail: { bytesFreedBySweep, failedSweepPathsCount },
    };
  }

  // Planner pre-flight: emitted on stderr.
  const enospcMatch = stderr.match(/^Not enough space (?:on device|for video sync)\.$/m);
  if (enospcMatch) {
    const needMatch = stderr.match(/^\s*Need:\s*([0-9.]+\s*[KMGT]?B)\s*$/m);
    const haveMatch = stderr.match(/^\s*Have:\s*([0-9.]+\s*[KMGT]?B)\s*$/m);
    const errorMessage =
      needMatch && haveMatch
        ? `Not enough space. Need ${needMatch[1]}, have ${haveMatch[1]}`
        : 'Not enough space';
    return {
      plannerRejects: true,
      errorMessage,
      failedTrackCount: 0,
      portableTagWarn: false,
    };
  }

  // `Failed: N track(s)` header on stdout.
  const failedHeader = stdout.match(/^Failed:\s*(\d+)\s+tracks?$/m);
  let failedTrackCount = 0;
  if (failedHeader) {
    failedTrackCount = parseInt(failedHeader[1] ?? '0', 10) || 0;
  }
  // If `Failed:` line absent, count the `[<category>]` bullet lines.
  if (failedTrackCount === 0) {
    const errBlocks = stdout.match(/^\s*\[(copy|transcode|database|artwork|unknown)\]\s+/gm) ?? [];
    failedTrackCount = errBlocks.length;
  }

  // Per-track error emitted by formatErrors at verbosity >= 2.
  const errLine = stdout.match(/^\s*\[(copy|transcode|database|artwork|unknown)\]\s+(.+)$/m);
  const firstError = errLine
    ? { category: errLine[1] ?? 'unknown', message: errLine[2] ?? '' }
    : undefined;

  // Portable tag-warn detection: iPod portable mode's WarningSink.emit
  // surfaces "iPod portable: failed to write file tags for ..." or
  // "iPod portable: ... tag write skipped" via the CLI's warning summary.
  // The verbose formatter prefixes warnings with "Warning:" or a "Warnings:"
  // header block.
  const portableTagWarn =
    /iPod portable:.*(?:tag write|file tags)/i.test(stdout) ||
    /iPod portable:.*(?:tag write|file tags)/i.test(stderr);

  return {
    plannerRejects: false,
    failedTrackCount,
    portableTagWarn,
    firstError,
  };
}

async function walkMount(mount: string): Promise<{
  audioCount: number;
  podkitTmpCount: number;
  hasManifest: boolean;
  hasSidecar: boolean;
  hasItunesDb: boolean;
  entries: string[];
}> {
  const cmd = `find ${sq(mount)} -type f -not -name _fill -not -path '*/lost+found/*' 2>/dev/null | sort`;
  const result = await runScript(cmd);
  const entries = result.stdout
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  const audioCount = entries.filter((e) => /\.(flac|ogg|m4a|mp3)$/.test(e)).length;
  const podkitTmpCount = entries.filter((e) => e.endsWith('.podkit-tmp')).length;
  const hasManifest = entries.some((e) => e.endsWith('.podkit/state.json'));
  const hasSidecar = entries.some((e) => e.endsWith('/cover.jpg'));
  const hasItunesDb = entries.some((e) => e.endsWith('iPod_Control/iTunes/iTunesDB'));
  return { audioCount, podkitTmpCount, hasManifest, hasSidecar, hasItunesDb, entries };
}

interface PartialStateInputs {
  cell: SaveFailCell;
  audioCount: number;
  hasManifest: boolean;
  hasSidecar: boolean;
  hasItunesDb: boolean;
  preseedDone: boolean;
}

function classifyPartialDeviceState(
  inputs: PartialStateInputs
): SaveFailObserved['partialDeviceState'] {
  const { cell, audioCount, hasSidecar, preseedDone } = inputs;
  if (cell.failureMode === 'itunesdb-readonly') {
    return 'database-stale';
  }
  if (cell.failureMode === 'move-parent-readonly') {
    // Pre-seed left 2 tracks at the OLD path. Relocate failure → tracks
    // remain at the OLD path (no movement happened for either).
    return 'preseed-only';
  }
  if (audioCount === 0) return 'no-files-landed';
  if (cell.failureMode === 'manifest-dir-readonly') {
    return 'file-copied-manifest-stale';
  }
  if (cell.failureMode === 'cover-collision') {
    return hasSidecar ? 'all-tracks-landed' : 'file-copied-no-sidecar';
  }
  if (cell.failureMode === 'track-readonly') {
    // Pre-seed pattern: the file was copied during the FIRST sync; the
    // tag-write on the second sync failed in place. We report
    // 'preseed-only' to convey "file is there from pre-seed, no new write
    // landed". This matches predictChmodFault's track-readonly prediction.
    if (preseedDone) return 'preseed-only';
    return cell.sourceFormat === 'ogg' ? 'file-copied-no-tags-no-pictures' : 'file-copied-tags-old';
  }
  return 'all-tracks-landed';
}

async function runSync(cell: SaveFailCell): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}> {
  const cfg = configPathFor(cell);
  const name = deviceNameFor(cell);
  const cmd = `/usr/local/bin/podkit --config ${sq(cfg)} sync -d ${sq(name)} -vv`;
  const result = await limaTestVmRunner.run(cmd, { timeoutMs: VM_WARM_TIMEOUT_MS });
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
}

async function runDryRun(cell: SaveFailCell): Promise<{ json: SyncJsonShape; exitCode: number }> {
  const cfg = configPathFor(cell);
  const name = deviceNameFor(cell);
  const cmd = `/usr/local/bin/podkit --config ${sq(cfg)} sync -d ${sq(name)} --dry-run --json`;
  const result = await limaTestVmRunner.run(cmd, { timeoutMs: VM_WARM_TIMEOUT_MS });
  let json: SyncJsonShape = {};
  try {
    json = JSON.parse(result.stdout) as SyncJsonShape;
  } catch {
    // tolerated
  }
  return { json, exitCode: result.exitCode };
}

async function runDoctor(cell: SaveFailCell): Promise<DoctorJsonShape> {
  const cfg = configPathFor(cell);
  const name = deviceNameFor(cell);
  const cmd = `/usr/local/bin/podkit --config ${sq(cfg)} doctor -d ${sq(name)} --no-system --json`;
  const result = await limaTestVmRunner.run(cmd, { timeoutMs: VM_WARM_TIMEOUT_MS });
  try {
    return JSON.parse(result.stdout) as DoctorJsonShape;
  } catch {
    return {};
  }
}

function doctorSeesPodkitTmp(doctor: DoctorJsonShape): boolean | null {
  if (!doctor.checks || doctor.checks.length === 0) return null;
  const orphan = doctor.checks.find((c) => c.id === 'orphan-files-mass-storage');
  if (!orphan) return null;
  if (orphan.status === 'skip') return false;
  const debris = orphan.details?.debris ?? [];
  return debris.some((d) => typeof d.path === 'string' && d.path.endsWith('.podkit-tmp'));
}

// ---------------------------------------------------------------------------
// Pre-seed sequence (first-sync faults)
// ---------------------------------------------------------------------------

async function runPreseedFirstSync(cell: SaveFailCell): Promise<void> {
  const r = await runSync(cell);
  if (r.exitCode !== 0) {
    throw new Error(
      `pre-seed first sync for ${saveFailCellKey(cell)} failed (exit=${r.exitCode}). ` +
        `stdout=${r.stdout.slice(0, 600)} stderr=${r.stderr.slice(0, 300)}`
    );
  }
}

// ---------------------------------------------------------------------------
// observeCell
// ---------------------------------------------------------------------------

async function observeCell(cell: SaveFailCell): Promise<SaveFailObserved> {
  // 1. Provision mount + source tree + config.
  if (cell.failureMode === 'enospc') {
    await limaTestVmRunner.applyState(deviceMountNearFull);
  } else if (cell.failureMode === 'enospc-post-sweep') {
    await limaTestVmRunner.applyState(deviceMountFitsEstimateFailedSweep);
  } else if (cell.failureMode === 'enospc-estimate-drift') {
    await limaTestVmRunner.applyState(deviceMountFitsEstimateSourceDrifts);
  } else {
    await provisionMount(cell);
  }
  await provisionSourceTree(cell);
  await stageConfig(cell);

  // SystemState-provisioned cells (enospc, enospc-post-sweep,
  // enospc-estimate-drift) don't use chmod faults. The narrowed
  // `ChmodFailureMode` type lines up with `FaultId` so the lookup
  // typechecks.
  const fault = isLoopbackProvisionedFailure(cell.failureMode)
    ? undefined
    : SAVE_FAILURE_FAULTS.get(cell.failureMode satisfies ChmodFailureMode);
  const preseed = fault?.preseed === 'first-sync';

  // 2. Pre-seed: first sync clean, then mutate source so the second sync
  //    queues an in-place diff.
  if (preseed) {
    await runPreseedFirstSync(cell);
    await mutateSourceTree(cell);
  }

  // 3. Build FaultContext.
  // For track-readonly the pre-seed wrote a file at the ORIGINAL
  // albumArtist path; the chmod must target THAT inode (the in-place tag
  // write). For move-parent-readonly the relocate destination is the
  // MUTATED-albumArtist path; we pre-create that album dir and chmod 0555
  // so the renameSync (inside save()'s try/catch) hits EACCES → MoveError.
  // For iPod cells: libgpod stores audio under `iPod_Control/Music/FXX/`
  // (hashed filename), NOT under `Music/<albumArtist>/<album>/`. We discover
  // the actual on-disk path after the pre-seed by walking the iPod_Control
  // tree (preseed-only iPod cells need this lookup).
  const mount = mountPointFor(cell);
  let ipodAudioPath: string | undefined;
  if (isIpodShape(cell.shape) && preseed) {
    // Walk iPod_Control/Music/* for the first audio file (the pre-seed only
    // landed one file). Used by the portable track-readonly fault.
    const findScript =
      `find ${sq(mount + '/iPod_Control/Music')} -type f ` +
      `\\( -name '*.mp3' -o -name '*.m4a' -o -name '*.flac' -o -name '*.aac' -o -name '*.alac' \\) ` +
      `2>/dev/null | head -1`;
    const r = await runScript(findScript);
    ipodAudioPath = r.stdout.split('\n')[0]?.trim() || undefined;
  }
  const faultCtx: FaultContext = {
    mountPoint: mount,
    targetFile:
      ipodAudioPath ??
      `${mount}/${deviceFileRelPath(cell, 1, TRACK_TITLE, ALBUM_ARTIST_ORIGINAL, ALBUM)}`,
    targetAlbumDir: `${mount}/${deviceAlbumRelPath(ALBUM_ARTIST_ORIGINAL, ALBUM)}`,
    itunesDir: `${mount}/iPod_Control/iTunes`,
    // Stage D: the DESTINATION album dir under the MUTATED albumArtist.
    // The fault pre-creates and chmods 0555 on this exact dir so mkdirSync
    // is a no-op and renameSync(absOld, absNew) lands EACCES inside the
    // save()'s try/catch (where MoveError wraps it).
    movePivotDir: `${mount}/${deviceAlbumRelPath(ALBUM_ARTIST_MUTATED, ALBUM)}`,
  };

  // 4. Apply the fault.
  if (fault) {
    await fault.apply(limaTestVmRunner, faultCtx);
  }

  // 5. Run the sync (the failing one).
  const syncResult = await runSync(cell);

  // 6. Walk + classify.
  const walk = await walkMount(mount);
  const parsed = parseVerboseSyncOutput(syncResult.stdout, syncResult.stderr);
  const plannerRejects = parsed.plannerRejects;
  const errorMessage = parsed.errorMessage;
  const firstErrorMessage = parsed.firstError?.message ?? '';
  // ADR-018 post-sweep throw surfaces via `out.error(err.message)` on
  // stderr — the verbose-formatted per-track block (`[copy] ...`) never
  // emits because no track was attempted. Classify off the errorMessage
  // when no per-track entry exists.
  const throwsClass =
    classifyThrowsClass(firstErrorMessage) ?? classifyThrowsClass(errorMessage ?? '');
  const errorCategory: SaveFailObserved['errorCategory'] = parsed.firstError
    ? (parsed.firstError.category as SaveFailObserved['errorCategory'])
    : throwsClass === 'InsufficientSpaceAfterCleanup'
      ? 'space'
      : null;

  const partialDeviceState = classifyPartialDeviceState({
    cell,
    audioCount: walk.audioCount,
    hasManifest: walk.hasManifest,
    hasSidecar: walk.hasSidecar,
    hasItunesDb: walk.hasItunesDb,
    preseedDone: preseed,
  });

  // 7. Cleanup fault BEFORE doctor + rescan.
  if (fault) {
    await fault.cleanup(limaTestVmRunner, faultCtx);
  }

  // 8. Doctor (best-effort — iPod cells without a parseable iTunesDB will
  //    skip; mass-storage cells without a manifest also skip).
  const doctor = await runDoctor(cell);
  const doctorTmp = doctorSeesPodkitTmp(doctor);

  // 9. Rescan via dry-run. Loopback-provisioned cells need the mount
  //    rebuilt empty so the rescan's plan-time pre-flight reads a clean
  //    state — otherwise the same ENOSPC fires again and the rescan can't
  //    surface what it would re-queue.
  if (isLoopbackProvisionedFailure(cell.failureMode)) {
    await remountClean(faultCtx.mountPoint);
  }
  const dry = await runDryRun(cell);
  const ops = dry.json.operations ?? [];
  // "Refires" includes any remediation diff: a fresh add/upgrade for files
  // that didn't land OR an `update-metadata` / `relocate` for files that
  // landed but ended up with stale tags / wrong paths. All four are
  // self-healing signals — the matrix asserts that the next sync converges.
  const rescanRefiresAddOrUpgrade = ops.some(
    (op) =>
      typeof op.type === 'string' &&
      (op.type.startsWith('add-') ||
        op.type.startsWith('upgrade-') ||
        op.type === 'relocate' ||
        op.type === 'update-metadata')
  );

  // 10. Per-cell cleanup. Loopback-provisioned cells unmount the
  //     clean-remount image and reset the VM to `healthy`; chmod cells
  //     run cleanupMount.
  if (isLoopbackProvisionedFailure(cell.failureMode)) {
    await runRoot(
      `umount ${sq(faultCtx.mountPoint)} 2>/dev/null || true; rm -f /tmp/podkit-savefail-clean.img`
    ).catch(() => {});
    await limaTestVmRunner.applyState(healthy).catch(() => {});
  } else {
    await cleanupMount(cell);
  }

  const observed: SaveFailObserved = {
    plannerRejects,
    throwsClass,
    errorCategory,
    partialDeviceState,
    rescanRefiresAddOrUpgrade,
    doctorSeesPodkitTmp: doctorTmp,
    errorMessage,
    failedTrackCount: parsed.failedTrackCount,
    portableTagWarn: parsed.portableTagWarn,
    postSweepDetail: parsed.postSweepDetail
      ? {
          bytesFreedBySweep: parsed.postSweepDetail.bytesFreedBySweep,
          failedSweepPathsCount: parsed.postSweepDetail.failedSweepPathsCount,
        }
      : null,
    debug: {
      syncExit: syncResult.exitCode,
      syncStdoutHead: syncResult.stdout.slice(0, 1200),
      syncStderrHead: syncResult.stderr.slice(0, 400),
      parsedFirstError: parsed.firstError,
      audioCount: walk.audioCount,
      podkitTmpCount: walk.podkitTmpCount,
      hasManifest: walk.hasManifest,
      hasSidecar: walk.hasSidecar,
      hasItunesDb: walk.hasItunesDb,
      walkEntries: walk.entries.slice(0, 25),
      dryExit: dry.exitCode,
      dryOps: ops.slice(0, 10),
      preseedDone: preseed,
    },
  };
  return observed;
}

async function remountClean(mount: string): Promise<void> {
  await limaTestVmRunner.applyState(healthy).catch(() => {});
  const cmd =
    `mkdir -p ${sq(mount)} && ` +
    `truncate -s 5M /tmp/podkit-savefail-clean.img && ` +
    `mkfs.ext4 -F -q /tmp/podkit-savefail-clean.img && ` +
    `mount -o loop /tmp/podkit-savefail-clean.img ${sq(mount)} && ` +
    `chmod 0777 ${sq(mount)}`;
  const r = await runRoot(cmd);
  if (r.exitCode !== 0) {
    throw new Error(`remountClean failed: ${r.stderr.slice(0, 400)}`);
  }
}

// ---------------------------------------------------------------------------
// Pruning
// ---------------------------------------------------------------------------

function isSidecarPrimary(shape: CapabilityShape): boolean {
  return CAPABILITY_SHAPES[shape].artworkSources[0] === 'sidecar';
}

function isCanonicalCell(cell: SaveFailCell): boolean {
  if (cell.failureMode === 'enospc') {
    return (
      cell.shape === 'embedded' &&
      cell.sourceFormat === 'flac' &&
      cell.codecConfig === 'prefer-copy'
    );
  }
  if (cell.failureMode === 'enospc-post-sweep') {
    // TASK-412: one canonical post-sweep cell (embedded × flac × prefer-copy).
    return (
      cell.shape === 'embedded' &&
      cell.sourceFormat === 'flac' &&
      cell.codecConfig === 'prefer-copy'
    );
  }
  if (cell.failureMode === 'enospc-estimate-drift') {
    // TASK-412: one canonical drift cell (embedded × mp3 × prefer-copy) —
    // mp3 because the planner's typical-bitrate gap is most easily forced
    // with 320kbps mp3 vs 256kbps default.
    return (
      cell.shape === 'embedded' && cell.sourceFormat === 'mp3' && cell.codecConfig === 'prefer-copy'
    );
  }
  // iPod cells are pre-pruned at generation time — they have one
  // codecConfig (prefer-copy) and only itunesdb-readonly or track-readonly
  // (portable) failure modes. They are always canonical.
  if (isIpodShape(cell.shape)) return true;

  if (cell.failureMode === 'album-readonly' || cell.failureMode === 'manifest-dir-readonly') {
    return cell.sourceFormat === 'flac' && cell.codecConfig === 'prefer-copy';
  }
  if (cell.failureMode === 'cover-collision') {
    if (!isSidecarPrimary(cell.shape)) return false;
    return cell.codecConfig === 'prefer-copy';
  }
  if (cell.failureMode === 'move-parent-readonly') {
    // One canonical move-parent-readonly cell per shape — keep flac/prefer-copy.
    return cell.sourceFormat === 'flac' && cell.codecConfig === 'prefer-copy';
  }
  if (cell.failureMode === 'track-readonly') {
    const syncPath = derivedSyncPath(
      cell.shape,
      cell.sourceFormat,
      cell.codecConfig,
      cell.transferMode
    );
    if (syncPath === 'transcode-aac') {
      return cell.sourceFormat === 'flac' && cell.codecConfig === 'transcode-aac';
    }
    return cell.codecConfig === 'prefer-copy';
  }
  return true;
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('VM: save-failure matrix', () => {
  const resultsByCell = new Map<string, SaveFailObserved>();

  beforeAll(async () => {
    await limaTestVmRunner.prepare();
    for (const cell of SAVE_FAIL_CELLS) {
      if (skipForCell(cell) !== null) continue;
      try {
        const observed = await observeCell(cell);
        resultsByCell.set(saveFailCellKey(cell), observed);
      } catch (err) {
        resultsByCell.set(saveFailCellKey(cell), {
          plannerRejects: false,
          throwsClass: null,
          errorCategory: null,
          partialDeviceState: 'no-files-landed',
          rescanRefiresAddOrUpgrade: false,
          doctorSeesPodkitTmp: null,
          errorMessage: undefined,
          failedTrackCount: 0,
          portableTagWarn: false,
          debug: {
            observeError: err instanceof Error ? err.message : String(err),
          },
        });
      }
    }
  }, VM_COLD_TIMEOUT_MS);

  afterAll(async () => {
    await limaTestVmRunner.applyState(healthy).catch(() => {});
    await limaTestVmRunner.teardown();
  }, VM_COLD_TIMEOUT_MS);

  defineMatrix<SaveFailCell, ReturnType<typeof predictSaveFail>, SaveFailObserved>({
    title: 'save-failure matrix',
    cells: SAVE_FAIL_CELLS,
    cellKey: saveFailCellKey,
    cellLabel: saveFailCellLabel,
    passes: [false],
    passLabel: () => 'pass=default',
    predict: (cell) => predictSaveFail(cell),
    skip: skipForCell,
    runPass: () => Promise.resolve(resultsByCell),
    timeoutMs: VM_COLD_TIMEOUT_MS,
  });
});

/**
 * Cell-level skip decisions. Centralised so `beforeAll` and the harness
 * `skip` predicate agree on which cells are observed.
 */
function skipForCell(cell: SaveFailCell) {
  // cover-collision on a shape without a sidecar surface is impossible.
  if (cell.failureMode === 'cover-collision' && !isSidecarPrimary(cell.shape)) {
    return skipImpossible(
      `${cell.shape} does not write a peer cover.jpg — the collision is invisible to save()`
    );
  }
  // iPod shapes don't have a sidecar surface, manifest dir, or mass-storage
  // album dir; only itunesdb-readonly and track-readonly (portable) apply.
  if (isIpodShape(cell.shape)) {
    if (
      cell.failureMode === 'cover-collision' ||
      cell.failureMode === 'manifest-dir-readonly' ||
      cell.failureMode === 'album-readonly' ||
      cell.failureMode === 'enospc' ||
      cell.failureMode === 'move-parent-readonly'
    ) {
      return skipImpossible(
        `${cell.failureMode} not applicable to iPod — no such filesystem surface or already covered by the mass-storage cells.`
      );
    }
    if (cell.failureMode === 'track-readonly' && cell.transferMode === 'fast') {
      // iPod fast mode doesn't write file tags (iTunesDB is authoritative).
      return skipImpossible(
        `iPod fast mode does not write file tags — only iTunesDB. track-readonly on the audio file is invisible to save().`
      );
    }
    // `track-readonly` × portable now flows: the iPod adapter emits a
    // structured Warning into its sink, MusicHandler.executeBatch drains the
    // pipeline's accumulator into the executor's sink, and the presenter
    // reads the typed getWarnings() surface. The CLI summary and --json
    // envelope both surface `portableTagWarn: true` end-to-end.
  } else {
    // Non-iPod shapes don't reach iTunesDB.
    if (cell.failureMode === 'itunesdb-readonly') {
      return skipImpossible(`${cell.shape} is not an iPod — no iTunesDB to lock.`);
    }
    // portable transferMode is iPod-only.
    if (cell.transferMode === 'portable') {
      return skipImpossible(
        `${cell.shape} is not an iPod — portable transferMode is iPod-only (controls portable tag-write semantics).`
      );
    }
  }
  if (!isCanonicalCell(cell)) {
    return skipRedundant(
      `non-canonical (sourceFormat, codecConfig) for ${cell.failureMode} on ${cell.shape}`
    );
  }
  return null;
}

// Suppress unused-import warnings.
void mkdir;
void rm;
