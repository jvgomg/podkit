/**
 * Backing-file synthesis for mass-storage personas inside `podkit-device`.
 *
 * Three starter personas (`ipod-video-5g-iflash-1tb`, `ipod-nano-7g-space-gray`,
 * `echo-mini`) declare a `massStorageBackingFile.synthesis` recipe. The runner
 * realises that recipe directly inside the VM via `truncate` + `mkfs.vfat
 * --invariant -F 32 -n <label>`, producing a byte-identical FAT32 image every
 * time. No host file is materialised — there is nothing to commit, nothing to
 * gitignore, and no host disk cost.
 *
 * Personas with `filesystem: 'HFS+'` take a different path: the image is
 * built on the HOST via the MBR-wrapped HFS+ writer in
 * `hfsplus-image-writer.ts` and `limactl copy`'d into the VM. `hfsprogs`
 * is unpackaged on arm64 in Debian bookworm, so an in-VM `mkfs.hfsplus`
 * is impossible on Apple-Silicon hosts. The image is a sparse file with
 * an MBR partition table + HFS+ Volume Header (signature + finderInfo
 * UUID seed) — enough for the kernel + blkid to surface the partition
 * as `fstype=hfsplus` with a UUID, which is what the Linux platform's
 * `findIpodDevices` needs to include it. See
 * `synthesiseHfsplusBackingFile` below + the architecture doc
 * `documents/architecture/testing/vm-testing.md` §5.6.
 *
 * Why in-VM (vs host then `limactl copy`):
 *
 *   - `mkfs.vfat` exists on the test VM already (provisioned by
 *     `test-packages/lima/vms/podkit-device.yaml`'s `dosfstools` package) and is
 *     not always available on macOS hosts.
 *   - Skipping the copy eliminates a 256 MiB+ host→VM transfer per session
 *     for the biggest persona.
 *   - Determinism is a property of the recipe + tool, not of the bytes that
 *     happen to land on disk. The host has no role to play in deciding what
 *     bytes are produced.
 *
 * Determinism is achieved through `mkfs.vfat --invariant`: a single flag that
 * fixes the volume ID, creation timestamps, OEM string, and any other
 * normally-random fields to constants.
 *
 * **Synthesis always rebuilds, and that is the point.** The gadget binds the
 * canonical `<vmPath>` straight into `mass_storage.0/lun.0/file`, so the guest
 * writes tests perform (`gpod-tool init`, a `podkit sync`) land in the image
 * itself. Rebuilding from the recipe on every `prepare()` is therefore not
 * redundant work — it is what returns each persona to its declared initial
 * state. A content-addressed skip keyed on the recipe would hand the next run
 * the *previous* run's mutations.
 *
 * The rebuild is also nearly free. Measured inside `podkit-device` on a 256 MiB
 * persona: `truncate` + `mkfs.vfat --invariant` is **12 ms**, while a single
 * `sha256sum` of the result is **750 ms** — sixty times the cost of the work it
 * was verifying. Hashing is therefore opt-in ({@link EnsureBackingFileOpts.computeSha256}),
 * used by the determinism test and the out-of-band build script, and skipped on
 * the `prepare()` hot path. What the build always emits instead is the finished
 * image's size, which costs nothing, proves the script ran to its last line, and
 * asserts the file that survived the atomic `mv` is the declared size.
 *
 * Output paths inside the VM live under {@link BACKING_FILES_VM_DIR} keyed by
 * persona id. The runner emits these paths into the persona sidecar's
 * `massStorageBackingFile.vmPath` so the dummy-hcd daemon picks them up
 * automatically at `systemctl start dummy-hcd-daemon@<id>.service`.
 *
 * @see test-packages/device-testing/src/personas/types.ts ("MassStorageBackingFile")
 * @see test-packages/device-testing-daemon/src/gadget.ts (mass_storage.0/lun.0/file)
 * @module
 */

import { createHash, randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { FILE_COPY_TIMEOUT_MS } from '@podkit/lima';

import type { DevicePersona } from '../personas/types.js';
import { defaultSubprocessRunner, type SubprocessRunner } from '../subprocess.js';
import { writeMbrWrappedHfsplusImage } from './hfsplus-image-writer.js';
import { limactlError, runLimactl, shellQuote } from './lima-limactl.js';
import { devTestingPackageRoot } from './paths.js';

/** In-VM directory where the runner stages synthesised backing files. */
export const BACKING_FILES_VM_DIR = '/var/device-testing/backing-files';

// ---------------------------------------------------------------------------
// Wall-clock bounds
//
// Every `limactl` call in this module now carries one, and they come in two
// shapes because the calls do two different kinds of thing.
//
//   - Calls that touch NO image bytes (`mkdir -p`, `rm -f`, staging-dir
//     cleanup) are the "should finish in milliseconds" bucket. Their whole
//     budget is the SSH round trip on a loaded host, so they take the flat
//     {@link VM_ROUND_TRIP_TIMEOUT_MS}.
//   - Calls whose cost scales with the image (the sha256 probe, the build
//     script, the HFS+ `install`) take a bound derived from `sizeMiB` via
//     {@link imageWorkTimeoutMs}.
//
// `limactl copy` is the substrate's own primitive and keeps the substrate's own
// bound, `FILE_COPY_TIMEOUT_MS`, rather than a second derivation of the same
// thing here.
//
// Both shapes go through `runLimactl`, which owns the descriptive
// `timed out after Nms` message. A bound that fires anonymously as execFile's
// generic "killed" is most of the way back to having no bound at all — which is
// what an unbounded `sha256sum` in this module produced when it ran for 20
// minutes on a file that hashes in 750 ms and died reporting only
// `Command failed: …`. That is a wedged SSH session, not slow work, and no
// bound derived from the work will ever be tight enough to be wrong about it.
// ---------------------------------------------------------------------------

/**
 * Bound for an in-VM command that does no work proportional to the image, and
 * the additive headroom underneath every size-derived bound below.
 *
 * Nothing here can legitimately take anywhere near this long: `mkdir -p` and
 * `rm -f` are syscalls. The budget is the SSH round trip on a host deep in swap
 * with a contended channel — the same figure, for the same reason, as the
 * daemon lifecycle bound in `./lima-test-vm.js`.
 */
export const VM_ROUND_TRIP_TIMEOUT_MS = 45_000;

/**
 * Throughput floor, in MiB/s, used to size the bounds on operations that read
 * or write a whole image.
 *
 * Measured inside `podkit-device` (2 vCPU, arm64): `sha256sum` of a 256 MiB
 * backing image runs at ~340 MiB/s, and `truncate` + `mkfs.vfat --invariant`
 * over the same size costs 12 ms. The floor is set ~85x below the slower of
 * those, which is what a VM starved of host CPU by a concurrent build looks
 * like. Anything past the resulting bound is a wedged session, not slow work.
 */
const IMAGE_THROUGHPUT_FLOOR_MIB_PER_S = 4;

/**
 * Wall-clock bound for an in-VM operation whose cost scales with the image:
 * one SSH round trip's headroom plus the image size at the throughput floor.
 *
 * For the largest persona (256 MiB) that is 109s against 0.75s of measured
 * work; for the smallest (32 MiB) it is 53s.
 */
export function imageWorkTimeoutMs(sizeMiB: number): number {
  return VM_ROUND_TRIP_TIMEOUT_MS + Math.ceil(sizeMiB / IMAGE_THROUGHPUT_FLOOR_MIB_PER_S) * 1_000;
}

/**
 * Fixed epoch used as `SOURCE_DATE_EPOCH` for mtools invocations.
 *
 * mtools (`mmd`, `mcopy`) writes a current-time directory entry timestamp by
 * default. mtools honours `SOURCE_DATE_EPOCH` (the reproducible-builds.org
 * standard) and burns that timestamp into every directory entry instead, which
 * gives byte-identical FAT32 output across runs regardless of host clock or
 * source-file mtime. The value itself is arbitrary; `1700000000` is "early
 * 2023-11-14" — comfortably in the FAT-supported range (1980-01-01 to
 * 2107-12-31) and not coincident with any meaningful real timestamp.
 */
const SEED_FIXED_EPOCH = '1700000000';

/** Result of {@link ensureBackingFile} for a single persona. */
export interface EnsureBackingFileResult {
  personaId: string;
  /** In-VM absolute path to the backing image. */
  vmPath: string;
  /**
   * Size of the finished image in bytes, read back from the VM after the
   * atomic `mv`. Always present: `stat` is free, and reading it back is what
   * proves the build script reached its last line.
   */
  sizeBytes: number;
  /**
   * sha256 of the synthesised image, or `null` when the caller did not ask for
   * one (see {@link EnsureBackingFileOpts.computeSha256}).
   *
   * The HFS+ branch always populates this: there the digest is not a
   * verification but the input to a real decision — whether to re-send the
   * image over `limactl copy` — so it is cheaper than the transfer it avoids.
   */
  sha256: string | null;
  /**
   * `true` when the image already at `vmPath` was byte-identical to the one
   * this call produced, `null` when no hash was computed and the question was
   * therefore never asked.
   *
   * Telemetry on the FAT32 paths (they rebuild regardless — see the note on
   * the module about why that rebuild is the reset). Load-bearing on the HFS+
   * path, where `true` means the `limactl copy` was skipped.
   */
  wasAlreadyIdentical: boolean | null;
}

/** Options for {@link ensureBackingFile}. */
export interface EnsureBackingFileOpts {
  vmName: string;
  persona: DevicePersona;
  /**
   * Also hash the finished image (and the pre-existing one, to populate
   * `wasAlreadyIdentical`). Off by default.
   *
   * The hash proves the recipe → bytes mapping is stable, which is a property
   * of the recipe and needs asserting once, not on every `prepare()`. Paying
   * for it per persona per test file is what made this path the slowest thing
   * in `prepare()`: two `sha256sum` passes over ~1.5 GiB of images is ~9s of
   * the ~12s the batch takes uncontended, and multiples of that on a loaded
   * host. Callers that want the digest — the determinism test and the
   * out-of-band `build:backing-file` driver — ask for it.
   */
  computeSha256?: boolean;
  subprocess?: SubprocessRunner;
}

/**
 * Synthesise the FAT32 backing image for one persona inside the VM and return
 * the VM path the daemon should bind in `mass_storage.0/lun.0/file`.
 *
 * **Always rebuilds**, and the rebuild is the reset: the gadget serves
 * `vmPath` directly, so tests mutate the image in place, and re-running the
 * deterministic recipe is what puts the persona back in its declared initial
 * state. The atomic `mv` from `<vmPath>.tmp.<pid>` keeps a half-written image
 * from ever being visible.
 *
 * Throws if the persona has no `massStorageBackingFile` or has only a
 * pre-built `imagePath` (we don't synthesise in that case).
 */
export async function ensureBackingFile(
  opts: EnsureBackingFileOpts
): Promise<EnsureBackingFileResult> {
  const subprocess = opts.subprocess ?? defaultSubprocessRunner;
  if (!opts.vmName) throw new Error('ensureBackingFile: vmName is required.');
  const backing = opts.persona.massStorageBackingFile;
  if (!backing) {
    throw new Error(
      `ensureBackingFile: persona '${opts.persona.id}' has no massStorageBackingFile.`
    );
  }
  if (!backing.synthesis) {
    throw new Error(
      `ensureBackingFile: persona '${opts.persona.id}' has no synthesis recipe — ` +
        `committed pre-built images (imagePath) are not supported by this helper.`
    );
  }
  const { sizeMiB, filesystem, label } = backing.synthesis;
  if (filesystem !== 'FAT32' && filesystem !== 'HFS+') {
    throw new Error(
      `ensureBackingFile: persona '${opts.persona.id}' synthesis.filesystem must be 'FAT32' or 'HFS+' ` +
        `(got '${filesystem}'). FAT16 + other future filesystems are not yet wired up.`
    );
  }
  if (!Number.isInteger(sizeMiB) || sizeMiB <= 0) {
    throw new Error(
      `ensureBackingFile: persona '${opts.persona.id}' synthesis.sizeMiB must be a positive integer (got ${String(sizeMiB)}).`
    );
  }
  // FAT label rules (11-char uppercase) only apply to mkfs.vfat. The HFS+
  // writer doesn't embed the label anywhere (label lives in the catalog
  // file we don't synthesise), so validating against FAT rules for an HFS+
  // persona would produce a misleading rejection for a legitimate HFS+
  // name like 'My iPod'. Skip the check on HFS+.
  if (filesystem === 'FAT32') {
    validateFatLabel(label, opts.persona.id);
  }

  // HFS+ rejects seeding outright — the mtools path is FAT-only. Check before
  // resolveSeedEntries so a HFS+ persona declaring initialContent fails with
  // an HFS+-specific message instead of a generic "fixture not readable" one.
  if (filesystem === 'HFS+' && (backing.synthesis.initialContent?.length ?? 0) > 0) {
    throw new Error(
      `ensureBackingFile: persona '${opts.persona.id}' has initialContent but ` +
        `filesystem='HFS+'. Seeding is only implemented for FAT32 (mtools); ` +
        `HFS+ images are used by the refusal scenarios that never mount.`
    );
  }

  const vmPath = vmPathForPersona(opts.persona.id);

  // HFS+ takes a separate host-side path: hfsprogs isn't packaged for arm64
  // in Debian bookworm, so we cannot shell out to `mkfs.hfsplus` inside the
  // VM. Instead we build a sparse image on the host via a pure-TS volume-
  // header writer and limactl-copy it in. The refusal scenario only needs
  // blkid to identify `fstype: 'hfsplus'`, which the on-disk volume header
  // magic provides on its own — no real mkfs is required.
  if (filesystem === 'HFS+') {
    return synthesiseHfsplusBackingFile({
      vmName: opts.vmName,
      personaId: opts.persona.id,
      vmPath,
      sizeMiB,
      subprocess,
    });
  }

  const computeSha256 = opts.computeSha256 ?? false;

  // Resolve + validate `initialContent` host paths up front so a bad fixture
  // surfaces before we touch the VM. Returns empty when no seeding is needed.
  const seedEntries = resolveSeedEntries(opts.persona);

  // Partitioned FAT32: an MBR-wrapped single FAT32 partition (not whole-disk).
  // This takes a dedicated in-VM build path (loop device + sfdisk + mkfs on the
  // partition node) and does not support `initialContent` seeding — the mtools
  // path targets a bare FAT image, not a partition offset. The only consumer
  // (the daemon lsblk-lane test) seeds via gpod-tool after mounting, so this
  // restriction costs nothing today.
  if (backing.synthesis.partitioned) {
    if (seedEntries.length > 0) {
      throw new Error(
        `ensureBackingFile: persona '${opts.persona.id}' sets synthesis.partitioned with ` +
          `initialContent — seeding a partitioned image is not implemented (seed post-mount instead).`
      );
    }
    return synthesisePartitionedFat32BackingFile({
      vmName: opts.vmName,
      personaId: opts.persona.id,
      vmPath,
      sizeMiB,
      label,
      computeSha256,
      subprocess,
    });
  }

  // Stage host fixtures into the VM under a per-persona scratch dir before
  // `mkfs.vfat` so the seeding step can `mcopy` from local VM paths (no
  // host roundtrip per file inside the build script). The build script's
  // trailing `rm -rf` cleans up on success; the `finally` below covers
  // the failure path (the script's `set -e` aborts before the rm).
  const stageDir = `/tmp/initial-content/${opts.persona.id}`;
  await stageSeedFixtures({
    vmName: opts.vmName,
    stageDir,
    entries: seedEntries,
    subprocess,
  });

  // Build the synthesis command. `truncate` makes a sparse file at the
  // exact size; `mkfs.vfat --invariant` writes a deterministic header. The
  // `-I` flag suppresses the "you are formatting a whole block device"
  // safety check (the file looks like a regular file, but mkfs warns about
  // non-block-device targets on some versions).
  //
  // Stages, all under one `sh -c` so a partial failure cleans up:
  //   1. mkdir -p <dir>
  //   2. write to <vmPath>.tmp
  //   3. seed initialContent into <vmPath>.tmp via mtools (mmd + mcopy)
  //      while the file is still the .tmp — so post-mv the image is byte-
  //      complete before any consumer can observe it.
  //   4. atomic rename to <vmPath>
  //   5. emit the finished image's size on stdout, then its sha256 when the
  //      caller asked for one
  //
  // `set -e` is portable (dash + bash). We deliberately avoid `-o pipefail`
  // because Debian's `/bin/sh` is dash, which does not support it. The
  // pipeline (`sha256sum | awk`) is the only place a silent partial-failure
  // could matter, and a missing file there fails the build via -e on the
  // preceding `sudo mv` (the file is the same one we just wrote).
  //
  // Seeding determinism: mtools writes a current-time timestamp into every
  // directory entry by default. Exporting `SOURCE_DATE_EPOCH` (the
  // reproducible-builds.org standard) makes mtools burn a fixed timestamp
  // instead, which is what gives the post-seed image a byte-stable sha256
  // across runs. `MTOOLS_SKIP_CHECK=1` lets mtools operate on the partition-
  // less FAT32 file directly (it otherwise expects a partition table).
  // The scratch path embeds the in-VM shell PID (`$$`) because two
  // concurrent `bun run test:vm` invocations (turbo runs the device-testing
  // and e2e-vm-tests packages in parallel) both call `prepare()` and race on
  // the per-persona path. A fixed `.tmp` name made the first process's
  // `rm -f` silently delete the second process's in-flight file, and the
  // second process's `mv` then failed with "cannot stat <TMP>". PID-suffixing
  // guarantees a unique scratch per invocation; the final `mv` to the
  // canonical `<vmPath>` is atomic within the filesystem and last-writer-
  // wins, which is safe because synthesis is deterministic.
  //
  // (mktemp would be cleaner but its template rules require the X-run to be
  // the trailing characters — `${vmPath}.XXXXXX.tmp` is invalid, and
  // suffix-flag variants differ between BSD and GNU mktemp.)
  // mkfs.vfat: `--invariant` fixes the volume ID + creation timestamps, `-I`
  // suppresses the "you are formatting a whole block device" check, both
  // stderr-noisy. Output deterministic across runs.
  const buildScript = [
    'set -e',
    `sudo mkdir -p ${shellQuote(BACKING_FILES_VM_DIR)}`,
    `TMP=${shellQuote(`${vmPath}.tmp.`)}$$`,
    'sudo rm -f "$TMP"',
    `sudo truncate -s ${sizeMiB}M "$TMP"`,
    `sudo mkfs.vfat --invariant -F 32 -n ${shellQuote(label)} -I "$TMP" >/dev/null 2>&1`,
    ...buildSeedCommands({ stageDir, tmpVar: '"$TMP"', entries: seedEntries }),
    `sudo mv "$TMP" ${shellQuote(vmPath)}`,
    `sudo rm -rf ${shellQuote(stageDir)}`,
    ...buildReportCommands({ vmPath, computeSha256 }),
  ].join('; ');

  // Byte-stability probe: hash whatever is already at `vmPath` so the result
  // can report whether the rebuild changed anything. Skipped unless the caller
  // asked for a digest — on a 256 MiB image this single call costs 60x the
  // build it is asking about.
  const existingSha = computeSha256
    ? await probeExistingSha256({
        vmName: opts.vmName,
        vmPath,
        sizeMiB,
        subprocess,
      })
    : null;

  // Build (or rebuild) the image. The script writes a deterministic image, so
  // a stale image at `vmPath` — including one a previous run's tests wrote
  // through the gadget — is safe to overwrite.
  let build;
  try {
    build = await runLimactl(subprocess, ['shell', opts.vmName, '--', 'sh', '-c', buildScript], {
      timeoutMs: imageWorkTimeoutMs(sizeMiB),
    });
  } finally {
    // Build-script `rm -rf` only runs on the success path (set -e aborts
    // earlier on failure). Always sweep the stage dir on the way out so a
    // partial-build failure does not leave fixtures behind for later runs.
    if (seedEntries.length > 0) {
      await runLimactl(
        subprocess,
        ['shell', opts.vmName, '--', 'sh', '-c', `rm -rf ${shellQuote(stageDir)}`],
        { timeoutMs: VM_ROUND_TRIP_TIMEOUT_MS }
      ).catch(() => undefined);
    }
  }
  if (build.exitCode !== 0) {
    throw limactlError(
      `failed to synthesise backing file for persona '${opts.persona.id}' in ${opts.vmName}`,
      build
    );
  }
  const report = parseBuildReport({
    personaId: opts.persona.id,
    stdout: build.stdout,
    sizeMiB,
    computeSha256,
  });

  return {
    personaId: opts.persona.id,
    vmPath,
    sizeBytes: report.sizeBytes,
    sha256: report.sha256,
    wasAlreadyIdentical: existingSha === null ? null : existingSha === report.sha256,
  };
}

/** Options for {@link probeExistingSha256}. */
interface ProbeExistingSha256Opts {
  vmName: string;
  vmPath: string;
  sizeMiB: number;
  subprocess: SubprocessRunner;
}

/**
 * sha256 whatever is currently at `vmPath` inside the VM, or return `'absent'`
 * when nothing is there.
 *
 * Bounded by {@link imageWorkTimeoutMs}. The bound is the whole reason this is
 * a named function: an unbounded version of this exact call once ran for 20
 * minutes on an image that hashes in 750 ms and surfaced as a bare
 * `Command failed: …` at the end of it.
 */
async function probeExistingSha256(opts: ProbeExistingSha256Opts): Promise<string> {
  const probe = await runLimactl(
    opts.subprocess,
    [
      'shell',
      opts.vmName,
      '--',
      'sh',
      '-c',
      `if [ -f ${shellQuote(opts.vmPath)} ]; then sha256sum ${shellQuote(opts.vmPath)} | awk '{print $1}'; else echo absent; fi`,
    ],
    { timeoutMs: imageWorkTimeoutMs(opts.sizeMiB) }
  );
  if (probe.exitCode !== 0) {
    throw limactlError(`failed to probe backing file at ${opts.vmName}:${opts.vmPath}`, probe);
  }
  return probe.stdout.trim();
}

/**
 * Trailing lines every build script emits: the finished image's size, then its
 * sha256 when the caller asked for one.
 *
 * The size line is not optional. `stat` costs nothing on a sparse file, and it
 * is what makes a silently-truncated script detectable: it can only appear on
 * stdout if the script survived `set -e` all the way past the atomic `mv`, and
 * its value is checked against the recipe by {@link parseBuildReport}.
 */
function buildReportCommands(opts: { vmPath: string; computeSha256: boolean }): string[] {
  const quoted = shellQuote(opts.vmPath);
  const cmds = [`stat -c %s ${quoted}`];
  if (opts.computeSha256) cmds.push(`sha256sum ${quoted} | awk '{print $1}'`);
  return cmds;
}

/** Parsed trailing output of a build script. */
interface BuildReport {
  sizeBytes: number;
  sha256: string | null;
}

/**
 * Parse (and validate) the trailing lines {@link buildReportCommands} emits.
 *
 * The size is checked against the recipe rather than merely recorded — a build
 * that produced the wrong number of bytes is a broken image, and the daemon
 * would happily serve it.
 */
function parseBuildReport(opts: {
  personaId: string;
  stdout: string;
  sizeMiB: number;
  computeSha256: boolean;
}): BuildReport {
  const lines = opts.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const sizeLine = lines[0] ?? '';
  if (!/^\d+$/.test(sizeLine)) {
    throw new Error(
      `ensureBackingFile: persona '${opts.personaId}' synthesis returned ` +
        `non-numeric size stdout '${sizeLine.slice(0, 80)}' — VM output unexpected.`
    );
  }
  const sizeBytes = Number(sizeLine);
  const expectedBytes = opts.sizeMiB * 1024 * 1024;
  if (sizeBytes !== expectedBytes) {
    throw new Error(
      `ensureBackingFile: persona '${opts.personaId}' synthesis produced ${sizeBytes} bytes, ` +
        `expected ${expectedBytes} (${opts.sizeMiB} MiB).`
    );
  }

  if (!opts.computeSha256) return { sizeBytes, sha256: null };

  const shaLine = lines[1] ?? '';
  if (!/^[0-9a-f]{64}$/.test(shaLine)) {
    throw new Error(
      `ensureBackingFile: persona '${opts.personaId}' synthesis returned ` +
        `non-sha256 stdout '${shaLine.slice(0, 80)}' — VM output unexpected.`
    );
  }
  return { sizeBytes, sha256: shaLine };
}

/**
 * HFS+ branch of {@link ensureBackingFile}. Builds the image on the HOST
 * via the pure-TS volume-header writer, then `limactl copy`s it into the
 * VM and installs it at {@link vmPathForPersona}.
 *
 * The image is a sparse file of declared `sizeMiB`; only the 512-byte
 * volume header is actual content. blkid identifies it as `hfsplus` from
 * the on-disk magic — no kernel hfsplus driver or `hfsprogs` userspace
 * required, which is what makes this approach portable across the arm64
 * test VM (where hfsprogs is unpackaged).
 *
 * Idempotency: sha256 the just-written host image, probe the VM-side
 * file's sha256, skip the copy on match.
 *
 * This is the one branch that hashes unconditionally, and it is not
 * verification — the digest decides whether to re-send the image over
 * `limactl copy`, and hashing 32 MiB is cheaper than transferring it. So
 * `sha256` and `wasAlreadyIdentical` are always populated here even when the
 * caller did not ask for a digest.
 */
interface SynthesiseHfsplusBackingFileOpts {
  vmName: string;
  personaId: string;
  vmPath: string;
  sizeMiB: number;
  subprocess: SubprocessRunner;
}

async function synthesiseHfsplusBackingFile(
  opts: SynthesiseHfsplusBackingFileOpts
): Promise<EnsureBackingFileResult> {
  const hostTmp = path.join(os.tmpdir(), `podkit-hfsplus-${randomUUID()}.img`);
  writeMbrWrappedHfsplusImage(hostTmp, { sizeMiB: opts.sizeMiB });
  try {
    // sha256 the synthesised image by streaming — the file is sparse on disk
    // but `read()` returns zero-filled bytes for holes, so the digest is
    // over the full logical content.
    const sha256 = sha256HostFile(hostTmp);
    const sizeBytes = opts.sizeMiB * 1024 * 1024;

    // Probe — skip the limactl copy if the VM already has a byte-identical
    // image. Without skip, every `prepare()` re-uploads the full sizeMiB.
    const existingSha = await probeExistingSha256({
      vmName: opts.vmName,
      vmPath: opts.vmPath,
      sizeMiB: opts.sizeMiB,
      subprocess: opts.subprocess,
    });
    const wasAlreadyIdentical = existingSha === sha256;
    if (wasAlreadyIdentical) {
      return {
        personaId: opts.personaId,
        vmPath: opts.vmPath,
        sizeBytes,
        sha256,
        wasAlreadyIdentical,
      };
    }

    // Ensure target directory exists. `mkdir -p` is idempotent.
    const ensureDir = await runLimactl(
      opts.subprocess,
      ['shell', opts.vmName, '--', 'sudo', 'mkdir', '-p', BACKING_FILES_VM_DIR],
      { timeoutMs: VM_ROUND_TRIP_TIMEOUT_MS }
    );
    if (ensureDir.exitCode !== 0) {
      throw limactlError(`failed to ensure ${BACKING_FILES_VM_DIR} in ${opts.vmName}`, ensureDir);
    }

    // limactl copy into /tmp (no sudo needed; tmpfs), then `sudo install`
    // to the canonical path. `install -D -m 0644` is atomic (rename within
    // the same fs) and sets mode in one step.
    const vmTmp = `/tmp/hfsplus-${randomUUID()}.img`;
    const copy = await runLimactl(opts.subprocess, ['copy', hostTmp, `${opts.vmName}:${vmTmp}`], {
      timeoutMs: FILE_COPY_TIMEOUT_MS,
    });
    if (copy.exitCode !== 0) {
      throw limactlError(
        `limactl copy failed sending HFS+ backing image to ${opts.vmName}:${vmTmp}`,
        copy
      );
    }
    // `install` copies the whole image between two VM-local filesystems, so it
    // gets the size-derived bound rather than the flat round-trip one.
    const install = await runLimactl(
      opts.subprocess,
      ['shell', opts.vmName, '--', 'sudo', 'install', '-D', '-m', '0644', vmTmp, opts.vmPath],
      { timeoutMs: imageWorkTimeoutMs(opts.sizeMiB) }
    );
    if (install.exitCode !== 0) {
      // Best-effort cleanup of the staging file before propagating.
      await runLimactl(opts.subprocess, ['shell', opts.vmName, '--', 'rm', '-f', vmTmp], {
        timeoutMs: VM_ROUND_TRIP_TIMEOUT_MS,
      }).catch(() => undefined);
      throw limactlError(
        `sudo install failed promoting ${vmTmp} → ${opts.vmPath} in ${opts.vmName}`,
        install
      );
    }
    await runLimactl(opts.subprocess, ['shell', opts.vmName, '--', 'rm', '-f', vmTmp], {
      timeoutMs: VM_ROUND_TRIP_TIMEOUT_MS,
    }).catch(() => undefined);

    return {
      personaId: opts.personaId,
      vmPath: opts.vmPath,
      sizeBytes,
      sha256,
      wasAlreadyIdentical: false,
    };
  } finally {
    try {
      fs.unlinkSync(hostTmp);
    } catch {
      // Best-effort: a stuck file in os.tmpdir() does no harm.
    }
  }
}

/**
 * Fixed MBR disk signature burned into every partitioned image via
 * `sfdisk label-id`. `sfdisk` otherwise writes a RANDOM 4-byte disk id, which
 * would break byte-determinism (and the idempotency sha probe). The value is
 * arbitrary but stable; it never surfaces to a user (blkid derives PARTUUID
 * `<diskid>-01` from it, which tests do not assert on).
 */
const PARTITIONED_MBR_DISK_ID = '0x1204d15c';

/** Options for {@link synthesisePartitionedFat32BackingFile}. */
interface SynthesisePartitionedFat32Opts {
  vmName: string;
  personaId: string;
  vmPath: string;
  sizeMiB: number;
  label: string;
  computeSha256: boolean;
  subprocess: SubprocessRunner;
}

/**
 * Partitioned-FAT32 branch of {@link ensureBackingFile}. Builds an MBR-wrapped
 * single FAT32 partition image entirely in-VM and installs it at
 * {@link vmPathForPersona}.
 *
 * On-disk shape: a `dos` MBR with a fixed disk signature and one partition of
 * type `0x0C` (W95 FAT32 LBA) starting at LBA 2048 (1 MiB alignment). The
 * partition is formatted with `mkfs.vfat --invariant` (deterministic) via a
 * `losetup --partscan` loop device so the mkfs targets the partition node, not
 * the whole disk. When the mass-storage gadget serves this image, the guest
 * kernel presents `/dev/sd<x>` (disk) + `/dev/sd<x>1` (`type: "part"`, vfat) —
 * the real MBR/FAT32 iPod shape.
 *
 * Determinism: `truncate` (fixed size) + `sfdisk label-id` (fixed disk id) +
 * `mkfs.vfat --invariant -n <label>` (fixed volume id + timestamps) give a
 * byte-identical image across runs, which is what makes the unconditional
 * rebuild a reset rather than a source of drift (verified: two builds hash
 * identically).
 *
 * The whole build runs under one `sudo sh -c` with `set -e`, and the loop
 * device is detached on every path via a `trap` so a mid-build failure never
 * leaks a `/dev/loop*` attachment.
 */
async function synthesisePartitionedFat32BackingFile(
  opts: SynthesisePartitionedFat32Opts
): Promise<EnsureBackingFileResult> {
  // Byte-stability probe (mirrors the whole-disk path): read any existing
  // image's sha so `wasAlreadyIdentical` reflects byte-stability. Only when
  // the caller asked for a digest — see the note on `computeSha256`.
  const existingSha = opts.computeSha256
    ? await probeExistingSha256({
        vmName: opts.vmName,
        vmPath: opts.vmPath,
        sizeMiB: opts.sizeMiB,
        subprocess: opts.subprocess,
      })
    : null;

  // Build script. `$$`-suffixed scratch path avoids the concurrent-prepare
  // race documented on the whole-disk path. The `trap` detaches the loop on
  // any exit so a failed mkfs cannot leak an attachment.
  const buildScript = [
    'set -e',
    `sudo mkdir -p ${shellQuote(BACKING_FILES_VM_DIR)}`,
    `TMP=${shellQuote(`${opts.vmPath}.tmp.`)}$$`,
    'sudo rm -f "$TMP"',
    `sudo truncate -s ${opts.sizeMiB}M "$TMP"`,
    // Deterministic MBR: fixed disk id + one FAT32-LBA partition at LBA 2048.
    `printf 'label: dos\\nlabel-id: ${PARTITIONED_MBR_DISK_ID}\\n\\n2048,,c\\n' | sudo sfdisk "$TMP" >/dev/null 2>&1`,
    // Attach a partscan loop so ${LOOP}p1 exists; detach on any exit.
    'LOOP=$(sudo losetup --find --show --partscan "$TMP")',
    'trap \'sudo losetup -d "$LOOP" 2>/dev/null || true\' EXIT',
    `sudo mkfs.vfat --invariant -F 32 -n ${shellQuote(opts.label)} -I "${'$'}{LOOP}p1" >/dev/null 2>&1`,
    'sudo losetup -d "$LOOP"',
    'trap - EXIT',
    `sudo mv "$TMP" ${shellQuote(opts.vmPath)}`,
    ...buildReportCommands({ vmPath: opts.vmPath, computeSha256: opts.computeSha256 }),
  ].join('; ');

  const build = await runLimactl(
    opts.subprocess,
    ['shell', opts.vmName, '--', 'sh', '-c', buildScript],
    { timeoutMs: imageWorkTimeoutMs(opts.sizeMiB) }
  );
  if (build.exitCode !== 0) {
    throw limactlError(
      `failed to synthesise partitioned FAT32 backing file for persona '${opts.personaId}' in ${opts.vmName}`,
      build
    );
  }
  const report = parseBuildReport({
    personaId: opts.personaId,
    stdout: build.stdout,
    sizeMiB: opts.sizeMiB,
    computeSha256: opts.computeSha256,
  });

  return {
    personaId: opts.personaId,
    vmPath: opts.vmPath,
    sizeBytes: report.sizeBytes,
    sha256: report.sha256,
    wasAlreadyIdentical: existingSha === null ? null : existingSha === report.sha256,
  };
}

/**
 * sha256 a regular file on the host by streaming 64 KiB chunks. Sparse
 * regions read back as zeros, so the digest is over the full logical
 * content — matches what `sha256sum` returns inside the VM.
 */
function sha256HostFile(filePath: string): string {
  const hash = createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  try {
    const chunk = Buffer.alloc(64 * 1024);
    let bytesRead = 0;
    while ((bytesRead = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) {
      hash.update(chunk.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

/** Options for {@link ensureBackingFilesForPersonas}. */
export interface EnsureBackingFilesForPersonasOpts {
  vmName: string;
  /** Iterable of personas; only those with a `synthesis` recipe are synthesised. */
  personas: Iterable<DevicePersona>;
  subprocess?: SubprocessRunner;
}

/**
 * Convenience batcher: walks `personas`, synthesises the backing file for
 * every persona with a `synthesis` recipe, and returns a `Map<personaId, vmPath>`
 * suitable for {@link import('./lima-test-vm.js').ensurePersonaSidecar}'s
 * `backingFilePaths` option.
 *
 * Personas with `imagePath` (pre-built) are skipped here — the older
 * `stageBackingFile()` helper handles those.
 *
 * **No digests.** This is the `prepare()` hot path: every VM test file's
 * `beforeAll` runs it, against the whole registry, inside the per-group cold
 * budget. It wants the images correct and present, and nothing it returns
 * mentions a hash — so it does not pay for one. That takes the batch from
 * ~12s (of which ~9s was `sha256sum`) to roughly one SSH round trip per
 * persona.
 *
 * **No heartbeat.** `startHeartbeat` earns its place on waits long enough that
 * an operator has to decide whether to keep waiting; with the hashing gone this
 * loop is a second of round trips, and each call inside it now carries a bound
 * that names the persona and the `limactl` argv when it fires. There is also no
 * progress sink to wire it to — `TestRuntime.prepare()` takes no reporter, and
 * threading one through the interface to narrate a one-second loop would be a
 * worse trade than the silence.
 */
export async function ensureBackingFilesForPersonas(
  opts: EnsureBackingFilesForPersonasOpts
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const persona of opts.personas) {
    const backing = persona.massStorageBackingFile;
    if (!backing) continue;
    if (!backing.synthesis) continue; // imagePath case — caller handles
    const result = await ensureBackingFile({
      vmName: opts.vmName,
      persona,
      subprocess: opts.subprocess,
    });
    out.set(persona.id, result.vmPath);
  }
  return out;
}

/** Compute the canonical in-VM path for a persona's backing image. */
export function vmPathForPersona(personaId: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(personaId)) {
    throw new Error(
      `vmPathForPersona: persona id '${personaId}' must match /^[a-z0-9][a-z0-9-]*$/ ` +
        `(used as a filename component).`
    );
  }
  return `${BACKING_FILES_VM_DIR}/${personaId}.img`;
}

/** A validated, host-resolved seed entry ready to be staged into the VM. */
interface ResolvedSeedEntry {
  /** Persona-declared image-relative target path (already validated). */
  imagePath: string;
  /** Absolute host path to the source fixture (already validated + stat'd). */
  hostPath: string;
  /** Basename used when staging in the VM (so collisions across paths fail loudly). */
  stagedBasename: string;
}

/**
 * Resolve every `initialContent` entry on `persona` to an absolute host path,
 * validating each one against the constraints below. Returns `[]` when the
 * persona declares no seeding.
 *
 * Validation (defence-in-depth — these strings are piped into a shell):
 *   - `sourceFixture` must not contain `..` segments and must be a regular file.
 *   - `path` (in-image) must not start with `/`, must not contain `..`, and
 *     must match `/^[A-Za-z0-9_./-]+$/` (no shell metacharacters, no spaces).
 *   - Basenames of `sourceFixture` are required to be unique across entries —
 *     they collide in the per-persona stage dir otherwise, and a silent
 *     overwrite would corrupt one of the seeded files.
 *
 * Throws with the persona id in the message on any violation.
 */
function resolveSeedEntries(persona: DevicePersona): ResolvedSeedEntry[] {
  const recipe = persona.massStorageBackingFile?.synthesis;
  const entries = recipe?.initialContent;
  if (!entries || entries.length === 0) return [];

  const personaDir = path.resolve(personasRoot(), persona.id);
  const seen = new Set<string>();
  const out: ResolvedSeedEntry[] = [];

  for (const entry of entries) {
    if (typeof entry.path !== 'string' || entry.path.length === 0) {
      throw new Error(
        `ensureBackingFile: persona '${persona.id}' initialContent entry has empty 'path'.`
      );
    }
    if (entry.path.startsWith('/')) {
      throw new Error(
        `ensureBackingFile: persona '${persona.id}' initialContent path '${entry.path}' ` +
          `must be image-relative (no leading '/').`
      );
    }
    if (entry.path.split('/').some((seg) => seg === '..' || seg === '.')) {
      throw new Error(
        `ensureBackingFile: persona '${persona.id}' initialContent path '${entry.path}' ` +
          `must not contain '..' or '.' segments.`
      );
    }
    if (!/^[A-Za-z0-9_./-]+$/.test(entry.path)) {
      throw new Error(
        `ensureBackingFile: persona '${persona.id}' initialContent path '${entry.path}' ` +
          `must match /^[A-Za-z0-9_./-]+$/ (ASCII letters, digits, '/', '-', '_', '.').`
      );
    }

    if (typeof entry.sourceFixture !== 'string' || entry.sourceFixture.length === 0) {
      throw new Error(
        `ensureBackingFile: persona '${persona.id}' initialContent entry has empty 'sourceFixture'.`
      );
    }
    if (entry.sourceFixture.split('/').includes('..')) {
      throw new Error(
        `ensureBackingFile: persona '${persona.id}' initialContent sourceFixture ` +
          `'${entry.sourceFixture}' must not contain '..' segments.`
      );
    }

    const hostPath = path.resolve(personaDir, entry.sourceFixture);
    // Resolved path must remain inside the persona dir even after normalising
    // any leading `./` segments — a defence-in-depth check on top of the
    // explicit `..` rejection above.
    if (!hostPath.startsWith(personaDir + path.sep) && hostPath !== personaDir) {
      throw new Error(
        `ensureBackingFile: persona '${persona.id}' initialContent sourceFixture ` +
          `'${entry.sourceFixture}' resolves outside the persona directory.`
      );
    }
    let stat: fs.Stats;
    try {
      stat = fs.statSync(hostPath);
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(
        `ensureBackingFile: persona '${persona.id}' initialContent sourceFixture ` +
          `'${entry.sourceFixture}' not readable at ${hostPath} (${cause}).`
      );
    }
    if (!stat.isFile()) {
      throw new Error(
        `ensureBackingFile: persona '${persona.id}' initialContent sourceFixture ` +
          `'${entry.sourceFixture}' is not a regular file at ${hostPath}.`
      );
    }

    const stagedBasename = path.basename(hostPath);
    if (seen.has(stagedBasename)) {
      throw new Error(
        `ensureBackingFile: persona '${persona.id}' initialContent sourceFixture ` +
          `basename '${stagedBasename}' is used by multiple entries; basenames must be unique.`
      );
    }
    seen.add(stagedBasename);

    out.push({ imagePath: entry.path, hostPath, stagedBasename });
  }

  return out;
}

/** Options for {@link stageSeedFixtures}. */
interface StageSeedFixturesOpts {
  vmName: string;
  /** Per-persona scratch directory inside the VM (e.g. `/tmp/initial-content/<id>`). */
  stageDir: string;
  /** Already-resolved + validated seed entries. Empty array short-circuits. */
  entries: ResolvedSeedEntry[];
  subprocess: SubprocessRunner;
}

/**
 * `limactl copy` each resolved seed fixture into the VM scratch dir. No-op
 * when `entries` is empty.
 */
async function stageSeedFixtures(opts: StageSeedFixturesOpts): Promise<void> {
  if (opts.entries.length === 0) return;

  // Create the per-persona scratch dir (idempotent). /tmp is tmpfs, no sudo
  // needed; the trailing `rm -rf` in the build script cleans it up.
  const mkdir = await runLimactl(
    opts.subprocess,
    [
      'shell',
      opts.vmName,
      '--',
      'sh',
      '-c',
      `rm -rf ${shellQuote(opts.stageDir)} && mkdir -p ${shellQuote(opts.stageDir)}`,
    ],
    { timeoutMs: VM_ROUND_TRIP_TIMEOUT_MS }
  );
  if (mkdir.exitCode !== 0) {
    throw limactlError(`failed to prepare seed stage dir ${opts.vmName}:${opts.stageDir}`, mkdir);
  }

  for (const entry of opts.entries) {
    const dest = `${opts.vmName}:${opts.stageDir}/${entry.stagedBasename}`;
    // Single-file transfer — the substrate's own primitive and its own bound.
    const copy = await runLimactl(opts.subprocess, ['copy', entry.hostPath, dest], {
      timeoutMs: FILE_COPY_TIMEOUT_MS,
    });
    if (copy.exitCode !== 0) {
      throw limactlError(`failed to copy seed fixture ${entry.hostPath} → ${dest}`, copy);
    }
  }
}

/** Options for {@link buildSeedCommands}. */
interface BuildSeedCommandsOpts {
  stageDir: string;
  /**
   * Shell expression that expands to the in-VM path of the FAT32 image. The
   * caller uses `"$TMP"` (double-quoted) so the var-expansion happens at
   * script-eval time rather than at JS time.
   */
  tmpVar: string;
  entries: ResolvedSeedEntry[];
}

/**
 * Emit the shell fragments that seed `entries` into the image at `tmpVar` via
 * mtools. Returns `[]` when no seeding is needed.
 *
 * Directory pre-creation: every unique ancestor of every `imagePath` is
 * `mmd`'d in shortest-first order so deeper paths see their parent created
 * first. `mkfs.vfat` immediately precedes this block, so every dir is brand
 * new — `mmd` should never fail and we let `set -e` propagate any error.
 *
 * mcopy preserves bytes verbatim by default — CRLF translation is `-t`
 * (opt-in), and `-b` is *batch streaming* (not binary) and triggers
 * "Streamcache allocation problem" on multi-MiB FAT32 images. No flag
 * needed for binary fidelity.
 */
function buildSeedCommands(opts: BuildSeedCommandsOpts): string[] {
  if (opts.entries.length === 0) return [];

  // SOURCE_DATE_EPOCH gives mtools a deterministic timestamp; MTOOLS_SKIP_CHECK
  // lets it operate on the partition-less FAT32 file. Export them at the top
  // of the seeding block so every mtools call sees the same env.
  const cmds: string[] = [
    `export MTOOLS_SKIP_CHECK=1`,
    `export SOURCE_DATE_EPOCH=${SEED_FIXED_EPOCH}`,
  ];

  // Collect every ancestor dir of every image path, in shortest-first order
  // so `mmd Music` is created before `mmd Music/Artist`. Using `Set` for
  // dedupe keeps a single mmd per unique path.
  const dirs = new Set<string>();
  for (const entry of opts.entries) {
    const segments = entry.imagePath.split('/').slice(0, -1);
    for (let i = 1; i <= segments.length; i++) {
      dirs.add(segments.slice(0, i).join('/'));
    }
  }
  for (const dir of Array.from(dirs).sort((a, b) => a.split('/').length - b.split('/').length)) {
    cmds.push(`sudo -E mmd -i ${opts.tmpVar} ${shellQuote(`::${dir}`)}`);
  }

  for (const entry of opts.entries) {
    const src = `${opts.stageDir}/${entry.stagedBasename}`;
    cmds.push(
      `sudo -E mcopy -i ${opts.tmpVar} ${shellQuote(src)} ${shellQuote(`::${entry.imagePath}`)}`
    );
  }

  return cmds;
}

/**
 * Filesystem root of the persona source directories at
 * `test-packages/device-testing/src/personas/`. Used by `resolveSeedEntries` to
 * resolve `sourceFixture` paths declared on a persona.
 *
 * The compiled module lives at `dist/runners/lima-test-vm-backing-files.js`,
 * but persona raw fixture files (the `raw/` sibling dirs) ship only under
 * `src/personas/` — they are not copied into `dist/`. We therefore resolve
 * to the source tree explicitly: four `..` segments reach the repo root,
 * then re-enter `test-packages/device-testing/src/personas`.
 */
export function personasRoot(): string {
  return path.resolve(devTestingPackageRoot(), 'src', 'personas');
}

/**
 * Validate a FAT volume label. `mkfs.vfat -n` accepts up to 11 ASCII chars;
 * spaces are technically permitted but break shell round-tripping when the
 * runner echoes the label in a script, so we restrict to a portable subset.
 */
function validateFatLabel(label: string, personaId: string): void {
  if (typeof label !== 'string' || label.length === 0) {
    throw new Error(
      `ensureBackingFile: persona '${personaId}' synthesis.label must be a non-empty string.`
    );
  }
  if (label.length > 11) {
    throw new Error(
      `ensureBackingFile: persona '${personaId}' synthesis.label '${label}' exceeds 11 chars (FAT limit).`
    );
  }
  if (!/^[A-Z0-9_-]+$/.test(label)) {
    throw new Error(
      `ensureBackingFile: persona '${personaId}' synthesis.label '${label}' must match /^[A-Z0-9_-]+$/ ` +
        `(uppercase ASCII letters, digits, underscore, hyphen).`
    );
  }
}
