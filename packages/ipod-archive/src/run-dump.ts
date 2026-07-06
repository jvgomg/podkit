/**
 * `runDump` — stage-1 orchestrator.
 *
 * classify the volume → create the named output directory containing a
 * `raw/` tree → copy the whitelist (hashing through SHA-256) → write the
 * manifest → return a result the (later) report stage can consume.
 *
 * On-disk layout produced:
 *
 *   <destDir>/<deviceName>-<identity>-<timestamp>/
 *     raw/
 *       iPod_Control/...        (mirrored whitelist trees)
 *       Calendars/ Contacts/ Notes/
 *       manifest.sha256         (shasum -c compatible)
 *
 * The named directory is the self-contained archive root; later slices add an
 * `archive/` sibling to `raw/` inside it.
 */

import { mkdir, opendir, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { readSysInfoExtended } from '@podkit/ipod-firmware';
import { IpodArchiveError } from './errors.js';
import { classifyEntries, type VolumeClassification } from './volume-classifier.js';
import {
  dump as rawDump,
  MANIFEST_FILENAME,
  type ManifestEntry,
  type DumpFailure,
} from './raw-dumper.js';
import { buildOutputDirName, type OutputNameIdentity } from './output-naming.js';
import { ArchiveReport, type ReportStage1 } from './archive-report.js';
import type { ArchiveProgressCallback } from './progress-events.js';
import { writeCapturedSysInfo } from './device-identity.js';

/** Subdirectory under the named output dir that holds the lossless copy. */
export const RAW_DUMP_SUBDIR = 'raw';

/** Legacy name of {@link RAW_DUMP_SUBDIR}, still accepted when loading old dumps. */
export const LEGACY_RAW_DUMP_SUBDIR = 'raw dump';

/** Filename of the human-readable skip/failure report at the dump output root. */
export const REPORT_MD_FILENAME = 'report.md';

/** Filename of the machine-readable skip/failure report at the dump output root. */
export const REPORT_JSON_FILENAME = 'report.json';

/** Options for {@link runDump}. */
export interface RunDumpOptions {
  /**
   * Human label for the device — typically the volume label, or a configured
   * podkit device name passed in by the CLI. Used as the leading name segment
   * of the output directory and as the fallback identity token. The package is
   * a leaf and does not read podkit config itself.
   */
  deviceName?: string;
  /**
   * Volume label, used as the last-resort identity token when serial and
   * FireWire GUID are both absent. Defaults to the volume root's basename.
   */
  volumeLabel?: string;
  /** Clock injection for deterministic directory names in tests. */
  now?: Date;
  /**
   * When true, `runDump` still builds `report` in-memory and returns the path
   * fields but does NOT write `report.{md,json}` to disk. Used by `runArchive`
   * to suppress the stage-1-only report when the transform stage will emit a
   * unified two-stage report instead.
   */
  skipReport?: boolean;
  /**
   * Side-effect-only progress channel. Emits `dump:start` once the output
   * directory name is computed (before the copy), `dump:file` per copied file,
   * and `dump:done` after the copy. Optional; never affects the result.
   */
  onProgress?: ArchiveProgressCallback;
  /**
   * SysInfoExtended XML read read-only from the device's firmware at dump time
   * (the device is connected during stage 1). Provided by the CLI only when the
   * device carried no on-disk SysInfo — persisted as the
   * `podkit-sysinfo-extended.xml` sidecar so the transform can resolve full
   * identity (serial, model number, capacity, colour) for a device podkit will
   * not write to (every iPod shuffle). The leaf package does not perform the
   * inquiry itself — the CLI, which has `@podkit/core`, hands the XML in.
   */
  capturedSysInfoXml?: string;
}

/** Device identity surfaced for naming (and, later, the README). */
export interface DumpIdentity {
  serialNumber?: string;
  firewireGuid?: string;
}

/** Everything stage-1 produced, for the CLI summary and the later report stage. */
export interface DumpResult {
  /** Absolute path of the named archive root directory. */
  outputDir: string;
  /** Absolute path of the `raw/` tree inside {@link outputDir}. */
  rawDumpDir: string;
  /** Absolute path of the written `manifest.sha256`. */
  manifestPath: string;
  /** Resolved device identity (best-effort). */
  identity: DumpIdentity;
  /** How the volume's top-level entries were classified. */
  classification: VolumeClassification;
  /** One entry per copied + hashed file. */
  manifest: ManifestEntry[];
  /** Files that could not be copied (recorded, not fatal). */
  failures: DumpFailure[];
  /**
   * Stage-1 buckets surfaced for the report stage. The CLi threads these into a
   * subsequent transform (the default both-stages run); a `--dump-only` run also
   * has them rendered to `report.{md,json}` at {@link outputDir}.
   */
  report: ReportStage1;
  /** Absolute path of the human-readable `report.md` at the dump output root. */
  reportMarkdownPath: string;
  /** Absolute path of the machine-readable `report.json` at the dump output root. */
  reportJsonPath: string;
}

/** Read the top-level entry names of a directory, or throw a typed error. */
async function readTopLevelEntries(dirPath: string): Promise<string[]> {
  let info;
  try {
    info = await stat(dirPath);
  } catch (err) {
    throw new IpodArchiveError(
      'VOLUME_NOT_READABLE',
      `Cannot read iPod volume at ${dirPath}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  }
  if (!info.isDirectory()) {
    throw new IpodArchiveError(
      'VOLUME_NOT_READABLE',
      `iPod volume path is not a directory: ${dirPath}`
    );
  }

  const names: string[] = [];
  const dir = await opendir(dirPath);
  for await (const entry of dir) {
    names.push(entry.name);
  }
  return names;
}

/**
 * Run the raw-dump stage against a mounted iPod volume.
 *
 * @param volumeRoot - mounted iPod volume root (e.g. `/Volumes/IPOD`).
 * @param destDir - directory the named archive root is created under.
 * @param opts - device name / label / clock.
 */
export async function runDump(
  volumeRoot: string,
  destDir: string,
  opts: RunDumpOptions = {}
): Promise<DumpResult> {
  const entries = await readTopLevelEntries(volumeRoot);
  const classification = classifyEntries(entries);

  // Best-effort identity read. `readSysInfoExtended` never throws — it returns
  // null when the file is absent (common on stock/dying iPods).
  const sysInfo = readSysInfoExtended(volumeRoot);
  const identity: DumpIdentity = {
    ...(sysInfo?.serialNumber ? { serialNumber: sysInfo.serialNumber } : {}),
    ...(sysInfo?.firewireGuid ? { firewireGuid: sysInfo.firewireGuid } : {}),
  };

  const volumeLabel = opts.volumeLabel ?? basename(volumeRoot);
  const nameIdentity: OutputNameIdentity = {
    ...(opts.deviceName ? { deviceName: opts.deviceName } : { deviceName: volumeLabel }),
    ...(identity.serialNumber ? { serialNumber: identity.serialNumber } : {}),
    ...(identity.firewireGuid ? { firewireGuid: identity.firewireGuid } : {}),
    ...(volumeLabel ? { volumeLabel } : {}),
  };

  const dirName = buildOutputDirName(nameIdentity, opts.now);
  const outputDir = join(destDir, dirName);
  const rawDumpDir = join(outputDir, RAW_DUMP_SUBDIR);

  // Create the top-level output directory before the raw dump begins so that a
  // permission failure on the *destination* is reported as a typed error rather
  // than a raw Node fs error surfacing from deep inside RawDumper.
  try {
    await mkdir(rawDumpDir, { recursive: true });
  } catch (err) {
    throw new IpodArchiveError(
      'DEST_NOT_WRITABLE',
      `Cannot create archive output directory at ${rawDumpDir}: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err }
    );
  }

  // Announce the destination + best device label now that the output dir name
  // is known, but *before* the (potentially long) copy begins.
  opts.onProgress?.({
    kind: 'dump:start',
    outputDir,
    deviceName: opts.deviceName ?? volumeLabel,
    ...(identity.serialNumber ? { serialNumber: identity.serialNumber } : {}),
  });

  let copied = 0;
  const { manifest, failures } = await rawDump(volumeRoot, classification.copy, rawDumpDir, () => {
    copied += 1;
    opts.onProgress?.({ kind: 'dump:file', copied });
  });

  opts.onProgress?.({ kind: 'dump:done', fileCount: manifest.length });

  // Persist the firmware-captured SysInfoExtended beside `raw/` so the transform
  // (and any later `--from-dump`) can resolve full device identity. Written even
  // for `--dump-only` so the artifact always travels with the dump.
  if (opts.capturedSysInfoXml) {
    await writeCapturedSysInfo(outputDir, opts.capturedSysInfoXml);
  }

  // The stage-1 buckets, surfaced both for the report files written here (so a
  // `--dump-only` user still gets a paper trail) and for threading into a
  // subsequent transform when the default both-stages run continues.
  // Note: junk is intentionally omitted — it is a hardcoded system-file
  // exclusion list that is always skipped and not worth surfacing to users.
  const report: ReportStage1 = {
    foreignSkipped: classification.foreign,
    dumpFailures: failures.map((f) => ({ path: f.path, error: f.error })),
  };

  // Emit `report.{md,json}` at the named archive root (beside `raw/`). The
  // same `ArchiveReport` renderer used by the transform keeps the format DRY; a
  // dump-only run has no stage-2 section.
  const dumpReport = ArchiveReport.forDumpOnly(report);
  const reportMarkdownPath = join(outputDir, REPORT_MD_FILENAME);
  const reportJsonPath = join(outputDir, REPORT_JSON_FILENAME);
  if (!opts.skipReport) {
    await writeFile(reportMarkdownPath, dumpReport.renderMarkdown(), 'utf8');
    await writeFile(reportJsonPath, `${JSON.stringify(dumpReport.toJson(), null, 2)}\n`, 'utf8');
  }

  return {
    outputDir,
    rawDumpDir,
    manifestPath: join(rawDumpDir, MANIFEST_FILENAME),
    identity,
    classification,
    manifest,
    failures,
    report,
    reportMarkdownPath,
    reportJsonPath,
  };
}
