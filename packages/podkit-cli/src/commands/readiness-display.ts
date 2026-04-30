/**
 * Shared readiness display utilities.
 *
 * Provides rendering primitives for readiness stages and issues,
 * used by `device scan`, `device info`, and `doctor` commands.
 */

import { STAGE_DISPLAY_NAMES } from '@podkit/core';
import type { ReadinessStageResult, ReadinessLevel } from '@podkit/core';
import type { OutputContext } from '../output/index.js';

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
      return 'Needs partitioning \u2014 see: podkit device init';
    case 'hardware-error':
      return 'Hardware error \u2014 device may be disconnected or failing';
    default:
      return 'Unknown state';
  }
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

// ── Summary rendering ───────────────────────────────────────────────────────

const SYSINFO_DOCS_URL = 'https://jvgomg.github.io/podkit/devices/supported-devices';

/**
 * Print compact one-line-per-stage readiness summary.
 *
 * Each stage gets a single line with marker + name + short summary.
 * SysInfoExtended status is shown as a sub-line for checksum devices.
 */
export function printReadinessSummary(out: OutputContext, stages: ReadinessStageResult[]): void {
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
      out.print(`  ${marker} ${name}    ${inlineSummary}`);
    } else {
      out.print(`  ${marker} ${name}`);
    }

    // SysInfoExtended sub-line for checksum devices
    if (stage.stage === 'sysinfo' && stage.status !== 'skip') {
      const present = stage.details?.sysInfoExtendedExists;
      const checksumType = stage.details?.checksumType as string | undefined;
      const needsChecksum =
        checksumType === 'hash58' || checksumType === 'hash72' || checksumType === 'hashAB';
      if (present === true) {
        out.print('    SysInfoExtended: present');
      } else if (present === false && needsChecksum) {
        out.print('    SysInfoExtended: missing (required for database checksums)');
      } else if (present === false) {
        out.print('    SysInfoExtended: not present');
      }
    }
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
 * Print collected issues with full details, docs URLs, and fix commands.
 */
export function printIssues(out: OutputContext, issues: ReadinessIssue[]): void {
  if (issues.length === 0) return;

  out.print('Issues:');
  for (const issue of issues) {
    out.print(`  ${issue.marker} ${issue.label} \u2014 ${issue.summary}`);

    for (const line of issue.details) {
      out.print(`    ${line}`);
    }

    if (issue.docsUrl || issue.fixCommand) {
      // Blank line before links
      if (issue.details.length > 0) {
        out.newline();
      }
      if (issue.docsUrl) {
        out.print(`    Docs: ${issue.docsUrl}`);
      }
      if (issue.fixCommand) {
        out.print(`    Fix:  ${issue.fixCommand}`);
      }
    }
  }
}
