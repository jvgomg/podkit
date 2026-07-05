import { describe, it, expect } from 'bun:test';
import type {
  ReadinessStageResult,
  ReadinessResult,
  ReadinessUnsupportedReason,
} from '@podkit/core';
import {
  stageMarker,
  collectReadinessIssues,
  formatReadinessLevel,
  formatReadinessSummaryLines,
  readinessAccess,
  formatReadOnlyLines,
} from './readiness-display.js';

describe('readinessAccess', () => {
  const mk = (generationId: string): ReadinessResult =>
    ({
      level: 'unsupported',
      stages: [],
      usbModel: { generationId },
    }) as unknown as ReadinessResult;

  it('resolves read-only for a shuffle 4g', () => {
    expect(readinessAccess(mk('shuffle_4g'))).toBe('read-only');
  });
  it('resolves syncable for a classic', () => {
    expect(readinessAccess(mk('classic_6g'))).toBe('syncable');
  });
  it('resolves none for an iPod touch', () => {
    expect(readinessAccess(mk('touch_5g'))).toBe('none');
  });
  it('is undefined when no generation is known', () => {
    expect(
      readinessAccess({ level: 'unsupported', stages: [] } as unknown as ReadinessResult)
    ).toBeUndefined();
  });
});

describe('formatReadOnlyLines', () => {
  it('frames the device as readable/archivable and points at device archive', () => {
    const lines = formatReadOnlyLines({
      kind: 'unsupported-device',
      headline: 'needs iTunes authentication',
      docsUrl: 'https://example.test/docs',
    } as ReadinessUnsupportedReason);
    expect(lines[0]).toMatch(/read-only/i);
    expect(lines.some((l) => l.includes('device archive'))).toBe(true);
    expect(lines.some((l) => l.includes('needs iTunes authentication'))).toBe(true);
    expect(lines.some((l) => l.startsWith('See:'))).toBe(true);
  });
});

// ── stageMarker ─────────────────────────────────────────────────────────────

describe('stageMarker', () => {
  it('returns ✓ for pass', () => {
    expect(stageMarker('pass')).toBe('\u2713');
  });

  it('returns ✗ for fail', () => {
    expect(stageMarker('fail')).toBe('\u2717');
  });

  it('returns ! for warn', () => {
    expect(stageMarker('warn')).toBe('!');
  });

  it('returns - for skip', () => {
    expect(stageMarker('skip')).toBe('-');
  });

  it('returns ? for unknown status', () => {
    expect(stageMarker('something')).toBe('?');
  });
});

// ── formatReadinessLevel ────────────────────────────────────────────────────

describe('formatReadinessLevel', () => {
  it('returns Ready for ready', () => {
    expect(formatReadinessLevel('ready', 'myipod')).toBe('Ready');
  });

  it('includes device name in needs-repair', () => {
    const result = formatReadinessLevel('needs-repair', 'myipod');
    expect(result).toContain('Needs repair');
    expect(result).toContain('myipod');
  });

  it('includes device name in needs-init', () => {
    const result = formatReadinessLevel('needs-init', 'myipod');
    expect(result).toContain('initialization');
    expect(result).toContain('myipod');
  });
});

// ── collectReadinessIssues ──────────────────────────────────────────────────

function makeStages(overrides: Partial<ReadinessStageResult>[] = []): ReadinessStageResult[] {
  const defaults: ReadinessStageResult[] = [
    { stage: 'usb', status: 'pass', summary: 'Device visible to OS' },
    { stage: 'partition', status: 'pass', summary: 'Partition table present' },
    { stage: 'filesystem', status: 'pass', summary: "James' iPod" },
    { stage: 'mount', status: 'pass', summary: "/Volumes/James' iPod" },
    { stage: 'sysinfo', status: 'pass', summary: 'iPod Classic (6th gen)' },
    { stage: 'database', status: 'pass', summary: '924 tracks' },
  ];

  for (const override of overrides) {
    const idx = defaults.findIndex((s) => s.stage === override.stage);
    if (idx >= 0) {
      defaults[idx] = { ...defaults[idx]!, ...override };
    }
  }

  return defaults;
}

describe('collectReadinessIssues', () => {
  it('returns empty array when all stages pass', () => {
    const stages = makeStages();
    const issues = collectReadinessIssues(stages, 'myipod');
    expect(issues).toHaveLength(0);
  });

  it('ignores usb/partition/filesystem failures', () => {
    const stages = makeStages([
      { stage: 'usb', status: 'fail', summary: 'No USB' },
      { stage: 'partition', status: 'fail', summary: 'No partition' },
      { stage: 'filesystem', status: 'fail', summary: 'No filesystem' },
    ]);
    const issues = collectReadinessIssues(stages, 'myipod');
    expect(issues).toHaveLength(0);
  });

  it('collects sysinfo failure with impact explanation and fix command', () => {
    const stages = makeStages([
      {
        stage: 'sysinfo',
        status: 'fail',
        summary: 'SysInfo file is empty',
        details: {
          suggestion:
            'Run `podkit doctor --repair sysinfo-extended` to read device identity from USB.',
        },
      },
    ]);
    const issues = collectReadinessIssues(stages, 'myipod');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.marker).toBe('\u2717');
    expect(issues[0]!.label).toBe('SysInfo');
    expect(issues[0]!.summary).toBe('SysInfo file is empty');
    expect(issues[0]!.fixCommand).toContain('doctor --repair sysinfo-extended');
    expect(issues[0]!.fixCommand).toContain('myipod');
    expect(issues[0]!.docsUrl).toContain('supported-devices');
    // Should explain why SysInfo matters
    const joined = issues[0]!.details.join(' ');
    expect(joined).toContain('artwork');
    expect(joined).toContain('device identity');
  });

  it('collects generation mismatch with impact explanation', () => {
    const stages = makeStages([
      {
        stage: 'sysinfo',
        status: 'warn',
        summary: 'iPod Video 60GB — generation mismatch with USB',
        details: {
          generationMismatch: true,
          sysInfoGeneration: 'iPod (5th Generation / Video)',
          usbGeneration: 'iPod Classic (6th Generation)',
          usbModelName: 'iPod Classic (6th Generation)',
          suggestion:
            'Run `podkit doctor --repair sysinfo-extended` to read device identity from USB.',
        },
      },
    ]);
    const issues = collectReadinessIssues(stages, 'terapod');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.marker).toBe('!');
    expect(issues[0]!.details).toContain('SysInfo reports: iPod (5th Generation / Video)');
    expect(issues[0]!.details).toContain('USB reports: iPod Classic (6th Generation)');
    expect(issues[0]!.fixCommand).toContain('terapod');
    // Should explain sync impact
    const joined = issues[0]!.details.join(' ');
    expect(joined).toContain('mismatch');
    expect(joined).toContain('sync failures');
  });

  it('includes USB model name for sysinfo failures', () => {
    const stages = makeStages([
      {
        stage: 'sysinfo',
        status: 'fail',
        summary: 'SysInfo not found',
        details: {
          usbModelName: 'iPod Classic (6th Generation)',
          suggestion:
            'Run `podkit doctor --repair sysinfo-extended` to read device identity from USB.',
        },
      },
    ]);
    const issues = collectReadinessIssues(stages, 'myipod');
    expect(issues[0]!.details).toContain('USB reports: iPod Classic (6th Generation)');
  });

  it('collects database failure with impact explanation and init command', () => {
    const stages = makeStages([
      {
        stage: 'database',
        status: 'fail',
        summary: 'iTunesDB not found',
      },
    ]);
    const issues = collectReadinessIssues(stages, 'myipod');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.fixCommand).toBe('podkit device init -d myipod');
    // Should explain what the database is for
    const joined = issues[0]!.details.join(' ');
    expect(joined).toContain('track listing');
    expect(joined).toContain('no music');
  });

  it('collects mount failure with impact explanation', () => {
    const stages = makeStages([
      {
        stage: 'mount',
        status: 'fail',
        summary: 'Device is not mounted',
        details: { interpretation: 'The device may need to be ejected and reconnected.' },
      },
    ]);
    const issues = collectReadinessIssues(stages, 'myipod');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.details).toContain('The device may need to be ejected and reconnected.');
    expect(issues[0]!.details.join(' ')).toContain('cannot access');
  });

  it('explains read-only mount impact', () => {
    const stages = makeStages([
      {
        stage: 'mount',
        status: 'warn',
        summary: 'Mounted read-only',
        details: { mountPoint: '/Volumes/iPod', readOnly: true },
      },
    ]);
    const issues = collectReadinessIssues(stages, 'myipod');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.details.join(' ')).toContain('read-only');
    expect(issues[0]!.details.join(' ')).toContain('Syncing will fail');
  });

  it('explains missing iPod_Control impact', () => {
    const stages = makeStages([
      {
        stage: 'mount',
        status: 'fail',
        summary: 'iPod_Control directory not found',
        details: { mountPoint: '/Volumes/iPod', ipodControlExists: false },
      },
    ]);
    const issues = collectReadinessIssues(stages, 'myipod');
    expect(issues).toHaveLength(1);
    expect(issues[0]!.details.join(' ')).toContain('not be initialized');
    expect(issues[0]!.fixCommand).toContain('device init');
  });
});

// ── Bug 4: SysInfoExtended status line distinguishes unparseable ───────────

describe('formatReadinessSummaryLines — SysInfoExtended status (Bug 4)', () => {
  it('renders "present but unparseable" when sysInfoExtendedUnparseable is true', () => {
    const stages = makeStages([
      {
        stage: 'sysinfo',
        status: 'fail',
        summary: 'iPod nano (5th gen) — generation mismatch',
        details: {
          sysInfoExtendedExists: false,
          sysInfoExtendedUnparseable: true,
        },
      },
    ]);
    const lines = formatReadinessSummaryLines(stages);
    const sub = lines.find((l) => l.includes('SysInfoExtended:'));
    expect(sub).toBeDefined();
    expect(sub).toContain('present but unparseable');
    // Must NOT regress to the misleading "not present" wording.
    expect(sub).not.toContain('not present');
  });

  it('renders "not present" when the file is genuinely missing', () => {
    const stages = makeStages([
      {
        stage: 'sysinfo',
        status: 'fail',
        summary: 'SysInfo file is empty',
        details: {
          sysInfoExtendedExists: false,
          // sysInfoExtendedUnparseable absent — file truly missing.
        },
      },
    ]);
    const lines = formatReadinessSummaryLines(stages);
    const sub = lines.find((l) => l.includes('SysInfoExtended:'));
    expect(sub).toBeDefined();
    expect(sub).toContain('not present');
    expect(sub).not.toContain('unparseable');
  });

  it('renders "present" when SysInfoExtended is on disk and parseable', () => {
    const stages = makeStages([
      {
        stage: 'sysinfo',
        status: 'pass',
        summary: 'iPod mini 4GB Pink (2nd Generation)',
        details: { sysInfoExtendedExists: true },
      },
    ]);
    const lines = formatReadinessSummaryLines(stages);
    const sub = lines.find((l) => l.includes('SysInfoExtended:'));
    expect(sub).toContain('present');
    expect(sub).not.toContain('unparseable');
    expect(sub).not.toContain('not present');
  });
});
