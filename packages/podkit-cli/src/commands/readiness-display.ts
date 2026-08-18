/**
 * Shared readiness display utilities.
 *
 * Provides rendering primitives for readiness stages and issues,
 * used by `device scan`, `device info`, and `doctor` commands.
 */

import { STAGE_DISPLAY_NAMES, DOCS_URLS } from '@podkit/core';
import type {
  ReadinessStageResult,
  ReadinessLevel,
  ReadinessResult,
  ReadinessUnsupportedReason,
} from '@podkit/core';
import {
  resolveGenerationSupport,
  IPOD_GENERATION_IDS,
  type IpodGenerationId,
  type DeviceAccess,
} from '@podkit/devices-ipod';
import type { OutputContext } from '../output/index.js';

/**
 * The device's access tier resolved from a readiness result's model, or
 * `undefined` when no generation is known. Prefers the USB-derived model (the
 * PID is available even in path-mode without SysInfo) over the SysInfo model.
 * Read-only vs none is the distinction the displays need but the readiness
 * `level` (`unsupported`) doesn't carry.
 */
export function readinessAccess(readiness: ReadinessResult): DeviceAccess | undefined {
  const genId = readiness.usbModel?.generationId ?? readiness.deviceModel?.generationId;
  if (!genId || !(IPOD_GENERATION_IDS as readonly string[]).includes(genId)) return undefined;
  return resolveGenerationSupport(genId as IpodGenerationId).access;
}

/**
 * Honest presentation lines for a read-only device: it is readable and
 * archivable — only syncing is refused — so point the user at `device archive`
 * rather than framing it as an unusable "not supported" device.
 */
export function formatReadOnlyLines(unsupported: ReadinessUnsupportedReason | undefined): string[] {
  const lines = ['Read-only — podkit can read and archive this device, but cannot sync to it.'];
  if (unsupported?.headline) lines.push(`Reason: ${unsupported.headline}`);
  lines.push('Back it up with: podkit device archive');
  if (unsupported?.docsUrl) lines.push(`See: ${unsupported.docsUrl}`);
  return lines;
}

// ── Stage marker ────────────────────────────────────────────────────────────

export function stageMarker(status: string): string {
  switch (status) {
    case 'pass':
      return '\u2713'; // ✓
    case 'fail':
      return '\u2717'; // ✗
    case 'warn':
      return '!';
    case 'skip':
      return '-';
    default:
      return '?';
  }
}

// ── Readiness level ─────────────────────────────────────────────────────────

export function formatReadinessLevel(level: ReadinessLevel, deviceName: string): string {
  switch (level) {
    case 'ready':
      return 'Ready';
    case 'needs-repair':
      return 'Needs repair \u2014 run: podkit doctor -d ' + deviceName;
    case 'needs-init':
      return 'Needs initialization \u2014 run: podkit device init -d ' + deviceName;
    case 'needs-format':
      return 'Needs formatting \u2014 device has no recognized filesystem';
    case 'needs-partition':
      // `podkit device init` is the wrong remediation here: it does not
      // partition or format, and it requires the device to be already
      // mounted. Point at the docs instead \u2014 the troubleshooting page
      // covers the external tools (iPod Reset Utility, parted/gparted,
      // mkfs.vfat, Rockbox utility) that actually do this work.
      return `No mountable partition detected \u2014 see: ${DOCS_URLS.troubleshooting}`;
    case 'hardware-error':
      return 'Hardware error \u2014 device may be disconnected or failing';
    case 'unsupported':
      return 'Not supported \u2014 podkit cannot operate on this device';
    default:
      return 'Unknown state';
  }
}

/**
 * Render the multi-line rendering of an `unsupported` readiness payload.
 *
 * Doctor / device info / device scan all share the same prompt so users see
 * a consistent message regardless of where the rejection surfaces. The
 * structured payload comes from `ReadinessResult.unsupported` (canonical
 * source \u2014 Apple unsupported-PID table, iOS-range fallback, mass-storage
 * preset registry, or filesystem policy).
 *
 * Returns a list of lines: a `Reason: <headline>` first line, then each
 * `details` entry indented, then a `See: <docsUrl>` footer when set.
 */
export function formatUnsupportedReasonLines(
  unsupported: ReadinessUnsupportedReason | undefined
): string[] {
  if (!unsupported) {
    return ['Reason: this device is not on podkit\u2019s supported-device list.'];
  }
  const lines: string[] = [`Reason: ${unsupported.headline}`];
  if (unsupported.details && unsupported.details.length > 0) {
    for (const line of unsupported.details) {
      lines.push(`  ${line}`);
    }
  }
  if (unsupported.docsUrl) {
    lines.push(`See: ${unsupported.docsUrl}`);
  }
  return lines;
}

// ── Issue type ──────────────────────────────────────────────────────────────

export interface ReadinessIssue {
  /** Stage marker symbol (✗ or !) */
  marker: string;
  /** Stage display name (e.g., "SysInfo") */
  label: string;
  /** One-line problem description */
  summary: string;
  /** Multi-line explanation lines */
  details: string[];
  /** Documentation URL */
  docsUrl?: string;
  /** Command to fix the issue */
  fixCommand?: string;
}

/**
 * Line substituted for a `Fix:` command when the device refuses writes.
 *
 * A read-only device can still surface a finding whose only remedy is a
 * write. The finding is worth reporting — the user owns the hardware and
 * deserves to know — but printing a `podkit doctor --repair …` command that
 * podkit would refuse to run is worse than printing nothing. The command is
 * dropped and this line explains its absence.
 */
export const READ_ONLY_NO_REPAIR_NOTE =
  'No repair is offered: repairing writes to the device, and podkit does not write to a read-only device.';

/**
 * Drop every `fixCommand` from a set of issues, replacing it with
 * {@link READ_ONLY_NO_REPAIR_NOTE} so the reader learns why no command is
 * shown. Issues that carried no fix command are returned untouched.
 */
export function suppressRepairSuggestions(issues: ReadinessIssue[]): ReadinessIssue[] {
  return issues.map((issue) => {
    const { fixCommand, ...rest } = issue;
    if (!fixCommand) return issue;
    return { ...rest, details: [...issue.details, READ_ONLY_NO_REPAIR_NOTE] };
  });
}

// ── Summary rendering ───────────────────────────────────────────────────────

const SYSINFO_DOCS_URL = DOCS_URLS.supportedDevices;

/**
 * Format compact one-line-per-stage readiness summary as a list of lines.
 *
 * Pure: no I/O, no `OutputContext`. See `printReadinessSummary` for the
 * `OutputContext`-driven counterpart.
 */
export function formatReadinessSummaryLines(stages: ReadinessStageResult[]): string[] {
  const lines: string[] = [];
  for (const stage of stages) {
    const marker = stageMarker(stage.status);
    const name = STAGE_DISPLAY_NAMES[stage.stage] || stage.stage;

    // Determine inline summary text
    let inlineSummary = '';
    if (stage.status === 'pass' || stage.status === 'warn' || stage.status === 'fail') {
      if (stage.stage === 'mount' && stage.status === 'warn') {
        inlineSummary = `${stage.details?.mountPoint} (read-only)`;
      } else if (
        stage.status !== 'pass' ||
        stage.stage === 'filesystem' ||
        stage.stage === 'mount' ||
        stage.stage === 'sysinfo' ||
        stage.stage === 'database'
      ) {
        inlineSummary = stage.summary;
      }
    } else if (stage.status === 'skip') {
      inlineSummary = stage.summary;
    }

    if (inlineSummary) {
      lines.push(`  ${marker} ${name}    ${inlineSummary}`);
    } else {
      lines.push(`  ${marker} ${name}`);
    }

    // SysInfoExtended sub-line for checksum devices
    if (stage.stage === 'sysinfo' && stage.status !== 'skip') {
      const present = stage.details?.sysInfoExtendedExists;
      const unparseable = stage.details?.sysInfoExtendedUnparseable === true;
      const checksumType = stage.details?.checksumType as string | undefined;
      const needsChecksum =
        checksumType === 'hash58' || checksumType === 'hash72' || checksumType === 'hashAB';
      if (present === true) {
        lines.push('    SysInfoExtended: present');
      } else if (unparseable) {
        // File is on disk but XML failed to parse. Distinguishing this from a
        // truly missing file matters because the user's mental model differs
        // — corruption needs a refresh, missing needs a first write — and
        // both reach the same `--repair sysinfo-extended` action.
        lines.push('    SysInfoExtended: present but unparseable');
      } else if (present === false && needsChecksum) {
        lines.push('    SysInfoExtended: missing (required for database checksums)');
      } else if (present === false) {
        lines.push('    SysInfoExtended: not present');
      }
    }
  }
  return lines;
}

/**
 * Print compact one-line-per-stage readiness summary.
 *
 * Each stage gets a single line with marker + name + short summary.
 * SysInfoExtended status is shown as a sub-line for checksum devices.
 */
export function printReadinessSummary(out: OutputContext, stages: ReadinessStageResult[]): void {
  for (const line of formatReadinessSummaryLines(stages)) {
    out.print(line);
  }
}

// ── Issue collection ────────────────────────────────────────────────────────

/**
 * Walk readiness stages and collect structured issues for deferred rendering.
 *
 * Each issue includes an impact explanation so users understand *why* the
 * problem matters, not just *what* is wrong.
 */
export function collectReadinessIssues(
  stages: ReadinessStageResult[],
  deviceName: string
): ReadinessIssue[] {
  const issues: ReadinessIssue[] = [];

  for (const stage of stages) {
    if (stage.status !== 'fail' && stage.status !== 'warn') continue;
    if (stage.stage === 'usb' || stage.stage === 'partition' || stage.stage === 'filesystem')
      continue;

    const marker = stageMarker(stage.status);
    const label = STAGE_DISPLAY_NAMES[stage.stage] || stage.stage;
    const details: string[] = [];
    let docsUrl: string | undefined;
    let fixCommand: string | undefined;

    if (stage.stage === 'sysinfo') {
      const d = stage.details ?? {};

      if (d.generationMismatch) {
        details.push(`SysInfo reports: ${d.sysInfoGeneration}`);
        details.push(`USB reports: ${d.usbGeneration}`);
        details.push('The SysInfo file may have been copied from a different device.');
        details.push(
          'podkit uses device identity to determine artwork formats, video support,',
          'and database checksums. A mismatch may cause sync failures or incompatible files.'
        );
      } else {
        // Impact explanation for missing/corrupt SysInfo
        details.push(
          'Without device identity, podkit cannot determine artwork formats, video',
          'support, or database checksums. The device will be treated as a generic',
          'iPod, which may cause sync failures or incompatible files on the device.'
        );

        if (d.usbModelName) {
          details.push(`USB reports: ${d.usbModelName}`);
        }
      }

      if (d.sysInfoExtendedExists === false) {
        const checksumType = d.checksumType as string | undefined;
        const needsChecksum =
          checksumType === 'hash58' || checksumType === 'hash72' || checksumType === 'hashAB';
        if (needsChecksum) {
          details.push('SysInfoExtended is required for database checksums on this device.');
        }
      }

      if (d.checksumNote) {
        details.push(d.checksumNote as string);
      }

      docsUrl = SYSINFO_DOCS_URL;

      const suggestion = d.suggestion as string | undefined;
      if (suggestion) {
        const cmdMatch = suggestion.match(/`([^`]+)`/);
        if (cmdMatch) {
          fixCommand = cmdMatch[1]!.replace(
            /sysinfo-extended`?$/,
            `sysinfo-extended -d ${deviceName}`
          );
        }
      }
    } else if (stage.stage === 'mount') {
      if (stage.status === 'warn' && stage.details?.readOnly) {
        details.push('podkit cannot write to a read-only device. Syncing will fail.');
      } else if (stage.details?.ipodControlExists === false) {
        details.push(
          'The iPod_Control directory is missing. The device may not be initialized',
          'as an iPod, or the filesystem may be corrupted.'
        );
        fixCommand = `podkit device init -d ${deviceName}`;
      } else {
        if (stage.details?.interpretation) {
          details.push(stage.details.interpretation as string);
        }
        details.push('podkit cannot access the device. Check that it is connected and mounted.');
      }
    } else if (stage.stage === 'database') {
      details.push(
        'The iPod database stores the track listing and metadata that the iPod reads.',
        'Without it, the iPod shows no music. Initializing creates an empty database.'
      );
      fixCommand = `podkit device init -d ${deviceName}`;
    }

    issues.push({
      marker,
      label,
      summary: stage.summary,
      details,
      docsUrl,
      fixCommand,
    });
  }

  return issues;
}

// ── Issue rendering ─────────────────────────────────────────────────────────

/**
 * Format collected issues as a list of lines.
 *
 * Pure: no I/O, no `OutputContext`. Empty strings represent blank lines
 * (callers map them to `out.newline()`). Returns an empty array when
 * `issues` is empty.
 */
export function formatIssueLines(issues: ReadinessIssue[]): string[] {
  if (issues.length === 0) return [];

  const lines: string[] = [];
  lines.push('Issues:');
  for (const issue of issues) {
    lines.push(`  ${issue.marker} ${issue.label} \u2014 ${issue.summary}`);

    for (const line of issue.details) {
      lines.push(`    ${line}`);
    }

    if (issue.docsUrl || issue.fixCommand) {
      // Blank line before links
      if (issue.details.length > 0) {
        lines.push('');
      }
      if (issue.docsUrl) {
        lines.push(`    Docs: ${issue.docsUrl}`);
      }
      if (issue.fixCommand) {
        lines.push(`    Fix:  ${issue.fixCommand}`);
      }
    }
  }
  return lines;
}

/**
 * Print collected issues with full details, docs URLs, and fix commands.
 */
export function printIssues(out: OutputContext, issues: ReadinessIssue[]): void {
  for (const line of formatIssueLines(issues)) {
    if (line === '') out.newline();
    else out.print(line);
  }
}
