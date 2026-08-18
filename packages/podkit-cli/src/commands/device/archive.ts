/**
 * `podkit device archive [path]` — archive a connected iPod.
 *
 * Two-stage design (see doc-047): a lossless **raw dump** followed by a
 * device-free **transform** into a browsable archive. The bare invocation runs
 * BOTH stages (`runArchive`), producing one self-contained output directory.
 * `--dump-only` runs just the raw dump (stage 1); `--from-dump <path>` runs just
 * the device-free transform (stage 2) against an existing dump, no device.
 *
 * The command is a thin shell: resolve the iPod mountpoint the same way the
 * other device subcommands do (or, for `--from-dump`, skip device resolution
 * entirely), then delegate to `@podkit/ipod-archive`. No archive logic lives
 * here. iPod-only — mass-storage devices are out of scope.
 */
import { Command } from 'commander';
import { basename, join } from 'node:path';
import {
  runArchive,
  runDump,
  runTransform,
  type ArchiveProgressEvent,
  type ArchiveProgressCallback,
  type DumpDeviceIdentity,
  type TransformStats,
} from '@podkit/ipod-archive';
import { existsSync } from '../../utils/fs.js';
import { getContext } from '../../context.js';
import { CliError, runAction } from '../../errors.js';
import { loadCoreOrFail, type CoreLoaderDeps } from '../../handler-deps.js';
import {
  resolveDevicePath,
  formatDeviceError,
  getDeviceIdentity,
  formatDeviceLookupMessage,
} from '../../device-resolver.js';
import { OutputContext, formatNumber } from '../../output/index.js';
import { formatOverallLine } from '../../utils/progress.js';
import { mergedPresets } from '../../config/preset-registry.js';
import { displayFor } from '@podkit/core';
import type { DiscoveredDeviceIpod, PlatformDeviceInfo } from '@podkit/core';
import { DeviceErrorCodes } from './error-codes.js';
import { resolveDeviceArg } from './shared.js';
import type { DeviceArchiveOutput } from './output-types.js';
import { resolvePodkitVersion } from '../../version.js';

interface ArchiveOptions {
  /** Run stage 1 (raw dump) only. */
  dumpOnly?: boolean;
  /** Run stage 2 (transform) only, against an existing dump. */
  fromDump?: string;
  /**
   * Proceed even when the device's firmware identity could not be captured.
   * Only meaningful when a live capture was actually needed and attempted —
   * see {@link captureSysInfoXml}. The archive still succeeds, but records the
   * gap honestly (README note + `library.sqlite` row) instead of leaving
   * identity fields silently blank.
   */
  force?: boolean;
}

/**
 * Dependency injection seam for `runDeviceArchive`. Tests pass stubs to avoid
 * real USB walks; `runDump` is injectable so the dump itself can be faked.
 */
export interface DeviceArchiveDeps extends CoreLoaderDeps {
  getDeviceManager?: () => import('@podkit/core').DeviceManager;
  /**
   * Override the connected-device discovery used by the auto-detect path (no
   * explicit `--device`). Defaults to `core.discoverConnectedDevices`. Test
   * seam: lets unit tests inject a fake discovered-device list without real
   * USB walks. Mirrors `DeviceScanDeps`.
   */
  discoverConnectedDevices?: typeof import('@podkit/core').discoverConnectedDevices;
  /** Override the full both-stages orchestrator so tests don't need a real iPod. */
  runArchive?: typeof runArchive;
  /** Override the raw-dump orchestrator so tests don't need a real iPod. */
  runDump?: typeof runDump;
  /** Override the transform orchestrator so tests don't need a real dump. */
  runTransform?: typeof runTransform;
}

export const archiveSubcommand = new Command('archive')
  .description('archive a connected iPod (raw dump + browsable archive)')
  .argument('[path]', 'output directory (defaults to the current directory)')
  .option('--dump-only', 'run only the raw-dump stage (stage 1)')
  .option(
    '--from-dump <path>',
    'transform an existing raw dump into a browsable archive, without a device (stage 2)'
  )
  .option(
    '-f, --force',
    "archive even when the device's firmware identity could not be captured " +
      '(records identity as unknown instead of failing)'
  )
  .action(async (path: string | undefined, options: ArchiveOptions) => {
    const { globalOpts } = getContext();
    const out = OutputContext.fromGlobalOpts(globalOpts);
    await runAction(out, () => runDeviceArchive(path, options, out));
  });

export async function runDeviceArchive(
  path: string | undefined,
  options: ArchiveOptions,
  out: OutputContext,
  deps: DeviceArchiveDeps = {}
): Promise<void> {
  const { globalOpts } = getContext();

  // Stage 2 (transform) runs against an existing dump and needs no device.
  // Handle it entirely here, then return — no device resolution at all.
  // --from-dump accepts either the named dump dir (containing raw dump/) or a
  // bare iPod root (containing iPod_Control/); loadDump resolves either form.
  if (options.fromDump) {
    await runTransformStage(options.fromDump, out, deps);
    return;
  }

  const destDir = path ?? process.cwd();

  // Select the iPod to archive. With an explicit `--device`, honour it (path
  // or named device) via the existing resolver. Without one, auto-detect the
  // connected iPod — the PRD targets second-hand / unconfigured iPods, so we
  // must not gate on the configured default device.
  const { volumeRoot, deviceName } = globalOpts.device
    ? await selectExplicitDevice(out, deps)
    : await selectAutoDetectedIpod(out, deps);

  if (!existsSync(volumeRoot)) {
    throw new CliError({
      message: `iPod not found at path: ${volumeRoot}`,
      code: DeviceErrorCodes.DEVICE_PATH_NOT_FOUND,
      details: { device: volumeRoot },
    });
  }

  const volumeLabel = basename(volumeRoot);

  // Capture the device's firmware identity now, while it is connected — the
  // transform runs device-free and cannot reach USB. Read-only; persisted into
  // the dump by stage 1 (only when the device has no on-disk SysInfoExtended).
  const { capturedSysInfoXml, identityCaptureFailureReason } = await resolveIdentityCapture(
    volumeRoot,
    options,
    out,
    deps
  );

  // `--dump-only` stops after stage 1; the bare invocation runs both stages.
  if (options.dumpOnly) {
    await runDumpStage(
      volumeRoot,
      destDir,
      { deviceName, volumeLabel, capturedSysInfoXml, identityCaptureFailureReason },
      out,
      deps
    );
    return;
  }
  await runBothStages(
    volumeRoot,
    destDir,
    {
      deviceName,
      volumeLabel,
      capturedSysInfoXml,
      identityCaptureFailureReason,
      podkitVersion: resolvePodkitVersion(),
    },
    out,
    deps
  );
}

/** The iPod selected for archiving: where it's mounted and a human label. */
interface SelectedDevice {
  volumeRoot: string;
  deviceName: string;
}

/**
 * Explicit-`--device` selection. The user named a device (path or config
 * entry), so honour it via the existing resolver. The iPod-only gate stays
 * here: an explicitly-targeted mass-storage device is rejected, since archive
 * has no meaning without an iTunesDB.
 */
async function selectExplicitDevice(
  out: OutputContext,
  deps: DeviceArchiveDeps
): Promise<SelectedDevice> {
  const { globalOpts } = getContext();

  const resolved = resolveDeviceArg();
  if ('error' in resolved) {
    throw new CliError({ message: resolved.error, code: DeviceErrorCodes.DEVICE_NOT_RESOLVED });
  }
  const { resolvedDevice, cliPath } = resolved;

  // iPod-only — mass-storage devices have no iTunesDB / archival history.
  // A device discovered by path (no config.type, so resolvedType is undefined)
  // passes this gate and is validated later by loadDump's typed DUMP_NOT_READABLE.
  const resolvedType = resolvedDevice?.config?.type;
  if (resolvedType && resolvedType !== 'ipod') {
    throw new CliError({
      message: 'Archive is only supported for iPod devices.',
      code: DeviceErrorCodes.IPOD_ONLY,
      printText: (o) =>
        o.error(
          'Archive is only supported for iPod devices. Mass-storage devices are out of scope.'
        ),
    });
  }

  const core = await loadCoreOrFail(deps, DeviceErrorCodes.CORE_LOAD_FAILED);
  const manager = (deps.getDeviceManager ?? core.getDeviceManager)();

  const deviceIdentity = getDeviceIdentity(resolvedDevice);
  if (deviceIdentity?.volumeUuid && !out.isJson) {
    out.print(formatDeviceLookupMessage(resolvedDevice?.name, deviceIdentity, out.isVerbose));
  }

  const resolveResult = await resolveDevicePath({
    cliDevice: cliPath,
    deviceIdentity,
    manager,
    requireMounted: true,
    quiet: globalOpts.quiet,
  });

  if (!resolveResult.path) {
    throw new CliError({
      message: resolveResult.error ?? formatDeviceError(resolveResult),
      code: DeviceErrorCodes.DEVICE_PATH_UNRESOLVED,
    });
  }

  // The package is a leaf and must not read podkit config. Pass the best
  // human label we have: a configured device name, else the volume label.
  const volumeRoot = resolveResult.path;
  return { volumeRoot, deviceName: resolvedDevice?.name || basename(volumeRoot) };
}

/**
 * Auto-detect selection — no explicit `--device`. Walk the connected devices
 * and pick the iPod that's actually plugged in, ignoring any configured
 * default. Clear, ordered errors for the ambiguous / empty cases.
 */
async function selectAutoDetectedIpod(
  out: OutputContext,
  deps: DeviceArchiveDeps
): Promise<SelectedDevice> {
  const { config } = getContext();
  const core = await loadCoreOrFail(deps, DeviceErrorCodes.CORE_LOAD_FAILED);
  const manager = (deps.getDeviceManager ?? core.getDeviceManager)();

  // Unsupported platform: discovery returns [] and there's no block pipeline.
  // Tell the user to target the iPod explicitly.
  if (!manager.isSupported) {
    throw new CliError({
      message: 'Auto-detecting iPods is not supported on this platform.',
      code: DeviceErrorCodes.NO_DEVICE_FOUND,
      printText: (o) => {
        o.error('Auto-detecting iPods is not supported on this platform.');
        o.print('Pass `--device <path>` to point podkit at the iPod volume.');
      },
    });
  }

  const discover = deps.discoverConnectedDevices ?? core.discoverConnectedDevices;
  const discovered = await discover({
    deviceManager: manager,
    massStoragePresets: mergedPresets(config),
  });

  // Mounted iPods we can archive right now.
  const mountedIpods = discovered
    .filter((d): d is DiscoveredDeviceIpod => d.kind === 'ipod' && d.matchedBy !== 'usb-only')
    .map((d) => d.block)
    .filter(
      (b): b is PlatformDeviceInfo & { isMounted: true; mountPoint: string } =>
        b !== undefined && b.isMounted
    );

  if (mountedIpods.length === 1) {
    const block = mountedIpods[0]!;
    return {
      volumeRoot: block.mountPoint,
      deviceName: block.volumeName || basename(block.mountPoint),
    };
  }

  if (mountedIpods.length > 1) {
    const labels = mountedIpods.map((b) => `${b.volumeName || '(unnamed)'} (${b.mountPoint})`);
    throw new CliError({
      message: 'Multiple iPods are connected. Choose one with `--device <name|path>`.',
      code: DeviceErrorCodes.MULTIPLE_IPODS,
      printText: (o) => {
        o.error('Multiple iPods are connected. Choose one with `--device <name|path>`.');
        for (const label of labels) o.print(`  - ${label}`);
      },
    });
  }

  // No mounted iPod. Is an iPod present but unmounted — either a block iPod
  // that isn't mounted, or one recognised over USB with no mounted disk?
  // (A usb-only *mass-storage* device is intentionally not handled here; it
  // falls through to the non-iPod branch below.)
  const unmountedIpod = discovered.some(
    (d) => d.kind === 'ipod' && (d.matchedBy === 'usb-only' || d.block?.isMounted === false)
  );
  if (unmountedIpod) {
    throw new CliError({
      message: 'Found an iPod, but it is not mounted.',
      code: DeviceErrorCodes.IPOD_NOT_MOUNTED,
      printText: (o) => {
        o.error('Found an iPod, but it is not mounted.');
        o.print('Run `podkit device scan --mount` first, or pass `--device <path>`.');
      },
    });
  }

  // No iPod at all. A non-iPod device may still be present — say no iPod first,
  // then the iPod-only caveat (the reverse of the old, confusing ordering).
  const nonIpod = discovered.find((d) => d.kind === 'mass-storage' || d.kind === 'unsupported');
  if (nonIpod) {
    const detected = displayFor(nonIpod).short;
    throw new CliError({
      message: 'No iPod found. Archiving is only supported for iPods.',
      code: DeviceErrorCodes.IPOD_ONLY,
      printText: (o) => {
        o.error('No iPod found. Archiving is only supported for iPods.');
        o.print(`A non-iPod device is connected (${detected}) — it cannot be archived.`);
      },
    });
  }

  // Nothing connected at all.
  throw new CliError({
    message: 'No iPod found. Connect an iPod and try again.',
    code: DeviceErrorCodes.NO_DEVICE_FOUND,
    printText: (o) => {
      o.error('No iPod found. Connect an iPod and try again.');
      o.print('Run `podkit device scan` to see connected devices, or pass `--device <path>`.');
    },
  });
}

/**
 * Outcome of attempting to capture the connected iPod's SysInfoExtended from
 * firmware. Distinguishes "nothing to do" from "we tried and it didn't work" —
 * see {@link captureSysInfoXml}.
 */
type SysInfoCaptureOutcome =
  | { kind: 'not-needed' }
  | { kind: 'skipped-no-fingerprint' }
  | { kind: 'captured'; xml: string }
  | { kind: 'failed'; reason: string };

/**
 * Read the connected iPod's SysInfoExtended from firmware while it is still
 * live, so full identity (serial, model number, capacity, colour) survives into
 * the device-free transform. This is the only moment USB is reachable, and it is
 * the only way to identify a device with no on-disk SysInfo (every iPod shuffle).
 *
 * The inquiry is **read-only** — nothing is written to the device (unlike
 * `device add`, which persists SysInfoExtended).
 *
 * Returns one of four outcomes:
 * - `not-needed` — the device already carries on-disk SysInfoExtended (the raw
 *   dump copies it faithfully), so no capture is attempted.
 * - `skipped-no-fingerprint` — no live USB device correlates to this volume
 *   (unsupported platform, or a plain directory handed to `--device <path>`
 *   that isn't a currently-attached iPod). This is *not* a failure: nothing was
 *   attempted, and no retry or `--force` would ever change the outcome, so the
 *   caller does not gate on it — it degrades exactly as it always has.
 * - `captured` — the inquiry succeeded; `xml` is the raw SysInfoExtended.
 * - `failed` — a live USB endpoint was found and the inquiry was attempted, but
 *   it did not produce a result (unresponsive firmware, transport error). This
 *   IS a real failure the caller gates on (see {@link resolveIdentityCapture}).
 */
async function captureSysInfoXml(
  volumeRoot: string,
  deps: DeviceArchiveDeps
): Promise<SysInfoCaptureOutcome> {
  const core = await loadCoreOrFail(deps, DeviceErrorCodes.CORE_LOAD_FAILED);

  try {
    const assessment = await core.assessIpodIdentity(volumeRoot);

    if (assessment.existing?.present) return { kind: 'not-needed' };
    if (!assessment.usbFingerprint) return { kind: 'skipped-no-fingerprint' };

    const xml = await core.captureSysInfoExtendedXml(assessment.usbFingerprint);
    if (xml) return { kind: 'captured', xml };
    return {
      kind: 'failed',
      reason: 'the device did not respond to the firmware identity inquiry',
    };
  } catch (err) {
    // `assessIpodIdentity` / `captureSysInfoExtendedXml` are documented to
    // never throw, but treat any surprise the same as "the inquiry did not
    // succeed" rather than crashing the whole archive run over it.
    return { kind: 'failed', reason: err instanceof Error ? err.message : String(err) };
  }
}

/** What {@link resolveIdentityCapture} threads into the dump/archive options. */
interface IdentityCaptureResult {
  capturedSysInfoXml?: string;
  identityCaptureFailureReason?: string;
}

/**
 * Run {@link captureSysInfoXml} and turn its outcome into what the rest of the
 * command needs: the XML to persist on success, a quiet `--verbose` note for
 * the benign no-fingerprint skip, and — for a real failure — either a typed
 * error (the default) or, with `--force`, a visible warning plus the failure
 * reason to persist so the archive records identity as unknown rather than
 * silently blank.
 */
async function resolveIdentityCapture(
  volumeRoot: string,
  options: ArchiveOptions,
  out: OutputContext,
  deps: DeviceArchiveDeps
): Promise<IdentityCaptureResult> {
  const capture = await captureSysInfoXml(volumeRoot, deps);

  switch (capture.kind) {
    case 'not-needed':
      return {};

    case 'captured':
      return { capturedSysInfoXml: capture.xml };

    case 'skipped-no-fingerprint':
      if (out.isVerbose) {
        out.print(
          'Note: no USB connection to inquire the device firmware identity from ' +
            '(unsupported platform, or a path not currently attached to a live iPod). ' +
            'Identity will be resolved from the dump instead.'
        );
      }
      return {};

    case 'failed':
      if (!options.force) {
        throw new CliError({
          message:
            `Could not capture the device's firmware identity (${capture.reason}). ` +
            'The resulting archive would not record which device it came from. ' +
            'Pass --force to archive anyway — the archive will record identity as unknown.',
          code: DeviceErrorCodes.IDENTITY_CAPTURE_FAILED,
          details: { device: volumeRoot },
        });
      }
      if (!out.isQuiet) {
        out.warn(
          `Proceeding without device firmware identity (${capture.reason}). ` +
            'The archive records identity as unknown (--force).'
        );
      }
      return { identityCaptureFailureReason: capture.reason };
  }
}

/**
 * Which invocation the progress renderer is decorating, used only to pick the
 * destination-header verb (the bare run *archives*, `--dump-only` only *dumps*).
 */
type ArchiveMode = 'both' | 'dump' | 'transform';

/**
 * Build the `onProgress` handler that renders archive progress events to `out`,
 * or `undefined` under `--json`/`--quiet` (where progress/meta text must never
 * leak — the JSON envelope is the only output). Mirrors the sync presenter's
 * TTY/non-TTY split: a TTY gets overwriting progress lines, a non-TTY gets a
 * couple of plain milestone lines and no per-item spam.
 *
 * All writes go through `out` (progress to the stderr sink, milestones via
 * `print`/`success`), so `--json` stdout stays clean even if a caller passes a
 * handler by mistake.
 */
function makeArchiveProgress(
  out: OutputContext,
  mode: ArchiveMode
): ArchiveProgressCallback | undefined {
  if (out.isJson || out.isQuiet) return undefined;

  return (event: ArchiveProgressEvent): void => {
    switch (event.kind) {
      case 'dump:start': {
        // One destination line at the very start — "where it's going".
        const verb = mode === 'dump' ? 'Dumping' : 'Archiving';
        out.print(`${verb} iPod ${quoteName(event.deviceName)} → ${event.outputDir}`);
        if (!out.isTty) out.print('Dumping...');
        break;
      }
      case 'dump:file': {
        // Live per-file count on a TTY; non-TTY skips the spam (the milestone
        // line above + the done line below bracket it).
        if (out.isTty) {
          out.progress(`Dumping...  ${formatNumber(event.copied)} files copied`);
        }
        break;
      }
      case 'dump:done': {
        out.clearProgress();
        out.print(
          `✓ raw dump — ${formatNumber(event.fileCount)} file${event.fileCount === 1 ? '' : 's'}`
        );
        break;
      }
      case 'transform:start': {
        // The `--from-dump` destination header is printed by runTransformStage
        // before the orchestrator runs (there is no dump:start event there).
        printDeviceMeta(out, event.identity);
        printLibraryBreakdown(out, event.stats);
        if (!out.isTty) out.print('Building archive...');
        break;
      }
      case 'transform:track': {
        if (out.isTty) {
          out.progress(formatOverallLine(event.done, event.total, 'tracks'));
        }
        break;
      }
      case 'transform:done': {
        out.clearProgress();
        break;
      }
    }
  };
}

/** Quote a device name for the destination header, falling back gracefully. */
function quoteName(name: string): string {
  return name ? `"${name}"` : '(unnamed)';
}

/**
 * Print the device-meta line from a resolved dump identity, omitting fields the
 * dump couldn't surface (serial/model/capacity are all best-effort). Prints
 * nothing when no field is known.
 */
function printDeviceMeta(out: OutputContext, identity: DumpDeviceIdentity): void {
  const head = identity.modelName ?? identity.model;
  const parts: string[] = [];
  if (head) {
    parts.push(identity.capacityGb ? `${head} (${identity.capacityGb} GB)` : head);
  } else if (identity.capacityGb) {
    parts.push(`${identity.capacityGb} GB`);
  }
  if (identity.modelNumber) parts.push(identity.modelNumber);
  if (identity.serialNumber) parts.push(`serial ${identity.serialNumber}`);
  if (parts.length > 0) out.print(`  ${parts.join(' · ')}`);
}

/**
 * Print the one-line library breakdown. Songs always show; the other categories
 * (movies, podcasts, audiobooks, music videos, TV shows, playlists) appear only
 * when nonzero so the line stays readable on a music-only iPod.
 */
function printLibraryBreakdown(out: OutputContext, stats: TransformStats): void {
  const parts: string[] = [`${formatNumber(stats.songs)} song${stats.songs === 1 ? '' : 's'}`];
  const add = (count: number, label: string): void => {
    if (count > 0) parts.push(`${formatNumber(count)} ${label}`);
  };
  add(stats.movies, stats.movies === 1 ? 'movie' : 'movies');
  add(stats.podcasts, stats.podcasts === 1 ? 'podcast' : 'podcasts');
  add(stats.audiobooks, stats.audiobooks === 1 ? 'audiobook' : 'audiobooks');
  add(stats.musicVideos, stats.musicVideos === 1 ? 'music video' : 'music videos');
  add(stats.tvShows, stats.tvShows === 1 ? 'TV show' : 'TV shows');
  add(stats.playlists, stats.playlists === 1 ? 'playlist' : 'playlists');
  out.print(`  ${parts.join(' · ')}`);
}

/**
 * Stage 1 only — `--dump-only`. Run the raw dump and print its summary.
 */
async function runDumpStage(
  volumeRoot: string,
  destDir: string,
  opts: {
    deviceName: string;
    volumeLabel: string;
    capturedSysInfoXml?: string;
    identityCaptureFailureReason?: string;
  },
  out: OutputContext,
  deps: DeviceArchiveDeps
): Promise<void> {
  const dumpFn = deps.runDump ?? runDump;

  const onProgress = makeArchiveProgress(out, 'dump');

  let result;
  try {
    result = await dumpFn(volumeRoot, destDir, {
      ...opts,
      ...(onProgress ? { onProgress } : {}),
    });
  } catch (err) {
    throw new CliError({
      message: err instanceof Error ? err.message : String(err),
      code: DeviceErrorCodes.ARCHIVE_DUMP_FAILED,
      details: { device: volumeRoot },
    });
  }

  const fileCount = result.manifest.length;
  const foreign = result.classification.foreign;
  const failures = result.failures;

  out.result<DeviceArchiveOutput>(
    {
      success: true,
      stage: 'dump',
      outputDir: result.outputDir,
      rawDumpDir: result.rawDumpDir,
      manifestPath: result.manifestPath,
      fileCount,
      foreign,
      failures,
      reportMarkdownPath: result.reportMarkdownPath,
      reportJsonPath: result.reportJsonPath,
    },
    () => {
      // The destination + a `✓ raw dump — N files` line were already printed by
      // the progress renderer; the summary keeps only the informative notes.
      printDumpBuckets(out, foreign, failures);
    }
  );
}

/**
 * Both stages — the bare default. Run the dump then transform it in place,
 * producing one self-contained output directory, and print a combined summary.
 */
async function runBothStages(
  volumeRoot: string,
  destDir: string,
  opts: {
    deviceName: string;
    volumeLabel: string;
    podkitVersion: string;
    capturedSysInfoXml?: string;
    identityCaptureFailureReason?: string;
  },
  out: OutputContext,
  deps: DeviceArchiveDeps
): Promise<void> {
  const archiveFn = deps.runArchive ?? runArchive;

  const onProgress = makeArchiveProgress(out, 'both');

  let result;
  try {
    result = await archiveFn(volumeRoot, destDir, {
      ...opts,
      ...(onProgress ? { onProgress } : {}),
    });
  } catch (err) {
    throw new CliError({
      message: err instanceof Error ? err.message : String(err),
      code: DeviceErrorCodes.ARCHIVE_DUMP_FAILED,
      details: { device: volumeRoot },
    });
  }

  const { dump, transform } = result;
  const fileCount = dump.manifest.length;
  const foreign = dump.classification.foreign;
  const dumpFailures = dump.failures;
  const noAudioCount = transform.noAudio.length;
  const noArtworkCount = transform.noArtwork.length;
  const failureCount = transform.failures.length;
  const tagFailureCount = transform.tagFailures.length;

  out.result<DeviceArchiveOutput>(
    {
      success: true,
      stage: 'both',
      outputDir: result.outputDir,
      rawDumpDir: dump.rawDumpDir,
      manifestPath: dump.manifestPath,
      archiveDir: transform.archiveDir,
      fileCount,
      foreign,
      dumpFailures,
      written: transform.written,
      fallbackTaggedCount: transform.fallbackTagged,
      noAudioCount,
      noArtworkCount,
      failureCount,
      tagFailureCount,
      readmePath: transform.readmePath,
      reportMarkdownPath: transform.reportMarkdownPath,
      reportJsonPath: transform.reportJsonPath,
    },
    () => {
      // The destination header, raw-dump line, and device-meta / library lines
      // were already printed by the progress renderer. The final summary keeps
      // the track-extraction count and the informative skip/failure notes only;
      // the per-artifact path lines now live solely in the JSON envelope.
      out.success(
        `✓ archive — ${formatNumber(transform.written)} track${transform.written === 1 ? '' : 's'} extracted`
      );
      printDumpBuckets(out, foreign, dumpFailures);
      printTransformBuckets(out, {
        fallbackTagged: transform.fallbackTagged,
        noAudioCount,
        noArtworkCount,
        failures: transform.failures,
        tagFailures: transform.tagFailures,
      });
    }
  );
}

/** Print the shared stage-1 foreign / copy-failure summary lines. */
function printDumpBuckets(
  out: OutputContext,
  foreign: string[],
  failures: Array<{ path: string; error: string }>
): void {
  if (foreign.length > 0) {
    out.print(
      `  ${formatNumber(foreign.length)} foreign file${foreign.length === 1 ? '' : 's'} skipped (not copied):`
    );
    for (const name of foreign) out.print(`    - ${name}`);
  }
  if (failures.length > 0) {
    out.warn(
      `${formatNumber(failures.length)} file${failures.length === 1 ? '' : 's'} could not be copied:`
    );
    for (const f of failures) out.warn(`    - ${f.path}: ${f.error}`);
  }
}

/** The stage-2 buckets the summary surfaces, shared by both run paths. */
interface TransformBuckets {
  fallbackTagged: number;
  noAudioCount: number;
  noArtworkCount: number;
  failures: Array<{ relPath: string; error: string }>;
  tagFailures: Array<{ relPath: string; reason: string }>;
}

/**
 * Print the stage-2 summary notes. The buckets are deliberately distinct:
 * - `could not be extracted` means the audio is genuinely NOT in the archive
 *   (the copy failed). This is the only real loss.
 * - `extracted but could not be tagged` means the file IS in the archive and
 *   playable; only its metadata could not be rewritten, so it keeps its
 *   original on-device tags. A warning, not a loss.
 * - `tagged via ffmpeg fallback` is informational — those tracks are fully
 *   tagged, just by the slower, more tolerant path.
 */
function printTransformBuckets(out: OutputContext, b: TransformBuckets): void {
  if (b.noAudioCount > 0) {
    out.print(
      `  ${formatNumber(b.noAudioCount)} track${b.noAudioCount === 1 ? '' : 's'} skipped (no audio file)`
    );
  }
  if (b.noArtworkCount > 0) {
    out.print(
      `  ${formatNumber(b.noArtworkCount)} track${b.noArtworkCount === 1 ? '' : 's'} had no album artwork`
    );
  }
  if (b.fallbackTagged > 0) {
    out.print(
      `  ${formatNumber(b.fallbackTagged)} track${b.fallbackTagged === 1 ? '' : 's'} tagged via ffmpeg fallback`
    );
  }
  if (b.failures.length > 0) {
    out.warn(
      `${formatNumber(b.failures.length)} track${b.failures.length === 1 ? '' : 's'} could not be extracted:`
    );
    for (const f of b.failures) out.warn(`    - ${f.relPath}: ${f.error}`);
  }
  if (b.tagFailures.length > 0) {
    out.warn(
      `${formatNumber(b.tagFailures.length)} track${b.tagFailures.length === 1 ? '' : 's'} extracted but could not be tagged (kept original tags):`
    );
    for (const f of b.tagFailures) out.warn(`    - ${f.relPath}: ${f.reason}`);
  }
}

/**
 * Stage 2 — transform an existing dump into a browsable archive. Device-free:
 * `runTransform` is a pure function of the dump and never opens a device.
 */
async function runTransformStage(
  dumpDir: string,
  out: OutputContext,
  deps: DeviceArchiveDeps
): Promise<void> {
  const transformFn = deps.runTransform ?? runTransform;

  const onProgress = makeArchiveProgress(out, 'transform');
  // No dump:start event on this path, so print the destination header here. The
  // archive lands at `<dumpDir>/archive` by default (the package's rule); the
  // exact resolved path remains in the JSON envelope.
  if (onProgress) out.print(`Building archive → ${join(dumpDir, 'archive')}`);

  let result;
  try {
    result = await transformFn(dumpDir, {
      podkitVersion: resolvePodkitVersion(),
      ...(onProgress ? { onProgress } : {}),
    });
  } catch (err) {
    throw new CliError({
      message: err instanceof Error ? err.message : String(err),
      code: DeviceErrorCodes.ARCHIVE_TRANSFORM_FAILED,
      details: { dump: dumpDir },
    });
  }

  const noAudioCount = result.noAudio.length;
  const noArtworkCount = result.noArtwork.length;
  const failureCount = result.failures.length;
  const tagFailureCount = result.tagFailures.length;

  out.result<DeviceArchiveOutput>(
    {
      success: true,
      stage: 'transform',
      archiveDir: result.archiveDir,
      written: result.written,
      fallbackTaggedCount: result.fallbackTagged,
      noAudioCount,
      noArtworkCount,
      failureCount,
      tagFailureCount,
      readmePath: result.readmePath,
      reportMarkdownPath: result.reportMarkdownPath,
      reportJsonPath: result.reportJsonPath,
    },
    () => {
      // Destination header + device-meta / library lines already printed by the
      // progress renderer; the per-artifact paths now live only in the JSON
      // envelope. Keep the extraction count + the informative skip/failure notes.
      out.success(
        `✓ archive — ${formatNumber(result.written)} track${result.written === 1 ? '' : 's'} extracted`
      );
      printTransformBuckets(out, {
        fallbackTagged: result.fallbackTagged,
        noAudioCount,
        noArtworkCount,
        failures: result.failures,
        tagFailures: result.tagFailures,
      });
    }
  );
}
