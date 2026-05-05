import type { ReadinessLevel, ReadinessStage, ReadinessStageResult } from './types.js';
import { STAGE_ORDER } from './types.js';

export function skipRemaining(stages: ReadinessStageResult[], fromIndex: number): void {
  for (let i = fromIndex; i < STAGE_ORDER.length; i++) {
    stages.push({
      stage: STAGE_ORDER[i]!,
      status: 'skip',
      summary: 'Skipped — previous check failed',
    });
  }
}

interface ReadinessRule {
  /** Human-readable description for maintainability */
  description: string;
  /** Returns true if this rule matches the given stage results */
  match: (stages: Map<ReadinessStage, ReadinessStageResult>) => boolean;
  /** The readiness level to return when matched */
  level: ReadinessLevel;
}

const READINESS_RULES: ReadinessRule[] = [
  {
    description: 'I/O error in any stage',
    match: (stages) =>
      [...stages.values()].some(
        (s) =>
          typeof s.details?.error === 'string' &&
          /i\/o error|input\/output error/i.test(s.details.error as string)
      ),
    level: 'hardware-error',
  },
  {
    description: 'USB detection failed',
    match: (stages) => stages.get('usb')?.status === 'fail',
    level: 'hardware-error',
  },
  {
    description: 'Partition check failed',
    match: (stages) => stages.get('partition')?.status === 'fail',
    level: 'needs-partition',
  },
  {
    description: 'Filesystem check failed',
    match: (stages) => stages.get('filesystem')?.status === 'fail',
    level: 'needs-format',
  },
  {
    description: 'Mount failed — no iPod_Control directory',
    match: (stages) => {
      const mount = stages.get('mount');
      return mount?.status === 'fail' && mount.details?.ipodControlExists === false;
    },
    level: 'needs-init',
  },
  {
    description: 'Mount failed — stale mount or OS error (mountPoint/errno present)',
    match: (stages) => {
      const mount = stages.get('mount');
      return (
        mount?.status === 'fail' &&
        (mount.details?.mountPoint !== undefined || mount.details?.errno !== undefined)
      );
    },
    level: 'hardware-error',
  },
  {
    description: 'Mount failed — unmounted device (fallback)',
    match: (stages) => stages.get('mount')?.status === 'fail',
    level: 'needs-init',
  },
  {
    description: 'Database failed — does not exist',
    match: (stages) => {
      const db = stages.get('database');
      return db?.status === 'fail' && db.details?.exists === false;
    },
    level: 'needs-init',
  },
  {
    description: 'Database failed — exists but corrupt',
    match: (stages) => stages.get('database')?.status === 'fail',
    level: 'needs-repair',
  },
  {
    description: 'SysInfo check failed',
    match: (stages) => stages.get('sysinfo')?.status === 'fail',
    level: 'needs-repair',
  },
  {
    description: 'All stages passed or warned — device is ready',
    match: (stages) => {
      const db = stages.get('database')?.status;
      return db === 'pass' || db === 'warn';
    },
    level: 'ready',
  },
];

export function determineLevel(stages: ReadinessStageResult[]): ReadinessLevel {
  const byStage = new Map(stages.map((s) => [s.stage, s]));

  for (const rule of READINESS_RULES) {
    if (rule.match(byStage)) return rule.level;
  }

  return 'unknown';
}
