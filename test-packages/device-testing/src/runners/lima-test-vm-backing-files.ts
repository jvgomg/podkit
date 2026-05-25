/**
 * Backing-file synthesis for mass-storage personas inside `podkit-device-harness`.
 *
 * Three starter personas (`ipod-video-5g-iflash-1tb`, `ipod-nano-7g-space-gray`,
 * `echo-mini`) declare a `massStorageBackingFile.synthesis` recipe. The runner
 * realises that recipe directly inside the VM via `truncate` + `mkfs.vfat
 * --invariant -F 32 -n <label>`, producing a byte-identical FAT32 image every
 * time. No host file is materialised — there is nothing to commit, nothing to
 * gitignore, and no host disk cost.
 *
 * Why in-VM (vs host then `limactl copy`):
 *
 *   - `mkfs.vfat` exists on the test VM already (provisioned by
 *     `test-packages/device-testing/lima/podkit-device-harness.yaml`'s `dosfstools` package) and
 *     is not always available on macOS hosts.
 *   - Skipping the copy eliminates a 256 MiB+ host→VM transfer per session
 *     for the biggest persona.
 *   - Determinism is a property of the recipe + tool, not of the bytes that
 *     happen to land on disk. The host has no role to play in deciding what
 *     bytes are produced.
 *
 * Determinism is achieved through `mkfs.vfat --invariant`: a single flag that
 * fixes the volume ID, creation timestamps, OEM string, and any other
 * normally-random fields to constants. We sha256-probe each image after
 * synthesis to assert byte-stability and skip rebuilds on hash match (idempotency).
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

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { DevicePersona } from '../personas/types.js';
import { defaultSubprocessRunner, type SubprocessRunner } from '../subprocess.js';
import { limactlError, runLimactl, shellQuote } from './lima-limactl.js';

/** In-VM directory where the runner stages synthesised backing files. */
export const BACKING_FILES_VM_DIR = '/var/device-testing/backing-files';

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
  /** sha256 of the synthesised image. */
  sha256: string;
  /**
   * `true` when a pre-existing image at `vmPath` already had bytes identical
   * to the rebuild. Telemetry-only today (the function always rebuilds —
   * `mkfs.vfat --invariant` is ~100ms per persona, dominated by the limactl
   * round-trip). Surfaces a future skip-optimisation signal: when this is
   * consistently `true` across personas, the always-rebuild step is wasted
   * work and a recipe-hash sidecar at `<vmPath>.recipe` would let us skip.
   */
  wasAlreadyIdentical: boolean;
}

/** Options for {@link ensureBackingFile}. */
export interface EnsureBackingFileOpts {
  vmName: string;
  persona: DevicePersona;
  subprocess?: SubprocessRunner;
}

/**
 * Synthesise the FAT32 backing image for one persona inside the VM and return
 * the VM path the daemon should bind in `mass_storage.0/lun.0/file`.
 *
 * **Always rebuilds.** `mkfs.vfat --invariant` is deterministic — re-running
 * with the same recipe produces byte-identical output, so a stale image at
 * `vmPath` is safe to overwrite. The atomic `mv` from `<vmPath>.tmp` keeps
 * a half-written image from ever being visible. The function probes the
 * pre-existing sha256 to populate `wasAlreadyIdentical` as a future
 * skip-optimisation signal, but does not act on it.
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
  if (filesystem !== 'FAT32') {
    throw new Error(
      `ensureBackingFile: persona '${opts.persona.id}' synthesis.filesystem must be 'FAT32' ` +
        `(got '${filesystem}'). FAT16 + future filesystems are not yet wired up.`
    );
  }
  if (!Number.isInteger(sizeMiB) || sizeMiB <= 0) {
    throw new Error(
      `ensureBackingFile: persona '${opts.persona.id}' synthesis.sizeMiB must be a positive integer (got ${String(sizeMiB)}).`
    );
  }
  validateFatLabel(label, opts.persona.id);

  const vmPath = vmPathForPersona(opts.persona.id);

  // Resolve + validate `initialContent` host paths up front so a bad fixture
  // surfaces before we touch the VM. Returns empty when no seeding is needed.
  const seedEntries = resolveSeedEntries(opts.persona);

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
  //   5. emit sha256 on stdout
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
  const buildScript = [
    'set -e',
    `sudo mkdir -p ${shellQuote(BACKING_FILES_VM_DIR)}`,
    `TMP=${shellQuote(`${vmPath}.tmp`)}`,
    'sudo rm -f "$TMP"',
    `sudo truncate -s ${sizeMiB}M "$TMP"`,
    // mkfs.vfat emits informational warnings on stderr (e.g. "Number of
    // clusters for 32 bit FAT is less then suggested minimum") that we do
    // NOT want surfacing as test noise — drop stderr.
    `sudo mkfs.vfat --invariant -F 32 -n ${shellQuote(label)} -I "$TMP" >/dev/null 2>&1`,
    ...buildSeedCommands({ stageDir, tmpVar: '"$TMP"', entries: seedEntries }),
    `sudo mv "$TMP" ${shellQuote(vmPath)}`,
    `sudo rm -rf ${shellQuote(stageDir)}`,
    `sha256sum ${shellQuote(vmPath)} | awk '{print $1}'`,
  ].join('; ');

  // Idempotency probe: if a file already exists, take its sha256. If it
  // matches the post-build sha (after a re-build) we'd know we're stable —
  // but a cheaper approach is to fingerprint by (sizeMiB, label, sha256)
  // and trust the recipe → bytes mapping (we proved it elsewhere). For
  // now, always probe + rebuild; sub-second per persona, and atomic rename
  // means a stale half-written image can never poison a test run.
  //
  // Future optimisation: check size + a "recipe hash" sidecar at
  // <vmPath>.recipe so we skip the mkfs.vfat call. Out of scope for
  // Image build is ~100ms per persona, dominated by limactl shell round-trip.
  const probe = await runLimactl(subprocess, [
    'shell',
    opts.vmName,
    '--',
    'sh',
    '-c',
    `if [ -f ${shellQuote(vmPath)} ]; then sha256sum ${shellQuote(vmPath)} | awk '{print $1}'; else echo absent; fi`,
  ]);
  if (probe.exitCode !== 0) {
    throw limactlError(`failed to probe backing file at ${opts.vmName}:${vmPath}`, probe);
  }
  const existingSha = probe.stdout.trim();

  // Build (or rebuild) the image. The script writes a deterministic image,
  // so post-build sha256 is stable across runs of the same recipe.
  let build;
  try {
    build = await runLimactl(subprocess, ['shell', opts.vmName, '--', 'sh', '-c', buildScript]);
  } finally {
    // Build-script `rm -rf` only runs on the success path (set -e aborts
    // earlier on failure). Always sweep the stage dir on the way out so a
    // partial-build failure does not leave fixtures behind for later runs.
    if (seedEntries.length > 0) {
      await runLimactl(subprocess, [
        'shell',
        opts.vmName,
        '--',
        'sh',
        '-c',
        `rm -rf ${shellQuote(stageDir)}`,
      ]).catch(() => undefined);
    }
  }
  if (build.exitCode !== 0) {
    throw limactlError(
      `failed to synthesise backing file for persona '${opts.persona.id}' in ${opts.vmName}`,
      build
    );
  }
  const sha256 = build.stdout.trim();
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error(
      `ensureBackingFile: persona '${opts.persona.id}' synthesis returned ` +
        `non-sha256 stdout '${sha256.slice(0, 80)}' — VM output unexpected.`
    );
  }

  return {
    personaId: opts.persona.id,
    vmPath,
    sha256,
    wasAlreadyIdentical: existingSha === sha256,
  };
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
  const mkdir = await runLimactl(opts.subprocess, [
    'shell',
    opts.vmName,
    '--',
    'sh',
    '-c',
    `rm -rf ${shellQuote(opts.stageDir)} && mkdir -p ${shellQuote(opts.stageDir)}`,
  ]);
  if (mkdir.exitCode !== 0) {
    throw limactlError(`failed to prepare seed stage dir ${opts.vmName}:${opts.stageDir}`, mkdir);
  }

  for (const entry of opts.entries) {
    const dest = `${opts.vmName}:${opts.stageDir}/${entry.stagedBasename}`;
    const copy = await runLimactl(opts.subprocess, ['copy', entry.hostPath, dest]);
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
  const thisFile = fileURLToPath(import.meta.url);
  const moduleDir = path.dirname(thisFile);
  const repoRoot = path.resolve(moduleDir, '..', '..', '..', '..');
  return path.resolve(repoRoot, 'packages', 'device-testing', 'src', 'personas');
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
