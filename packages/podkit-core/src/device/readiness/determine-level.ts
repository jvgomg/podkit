import type { ReadinessLevel, ReadinessStage, ReadinessStageResult } from './types.js';
import { STAGE_ORDER } from './types.js';
import { lookupUnsupportedReason, lookupIosRangeFallbackReason } from '@podkit/devices-ipod';

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

/**
 * Result of the readiness cascade. When `level === 'unsupported'`, the
 * `unsupportedReason` field carries the canonical human-readable text.
 */
export interface DetermineLevelResult {
  level: ReadinessLevel;
  unsupportedReason?: string;
}

/**
 * USB descriptor inputs that let the cascade detect "recognised but not
 * supported" devices. When present, the unsupported short-circuit runs
 * before stage rules so the cascade does not collapse to `'unknown'` or a
 * stage-level fail for a device whose USB identity is already a known
 * rejection.
 */
export interface DetermineLevelContext {
  /** Bare-hex Apple vendor ID (`05ac`) if known; lower-case, no `0x`. */
  vendorId?: string;
  /** Bare-hex product ID for the unsupported-table lookup. */
  productId?: string;
  /**
   * Pre-computed rejection reason from a non-Apple classifier (mass-storage
   * vendor with no preset). Wins over the Apple table lookup because the
   * classifier owns the wording for non-Apple devices.
   */
  unsupportedReason?: string;
}

const APPLE_VENDOR_ID = '05ac';

function normaliseHex(id: string): string {
  return id.toLowerCase().replace(/^0x/, '');
}

/**
 * Compute the readiness level for a completed stage list.
 *
 * Two overloads — the legacy stages-only form preserves backwards-compatible
 * `ReadinessLevel` returns for existing call sites; the contextual form
 * returns a `DetermineLevelResult` so the unsupported reason can be
 * surfaced alongside `level: 'unsupported'`.
 */
export function determineLevel(stages: ReadinessStageResult[]): ReadinessLevel;
export function determineLevel(
  stages: ReadinessStageResult[],
  context: DetermineLevelContext
): DetermineLevelResult;
export function determineLevel(
  stages: ReadinessStageResult[],
  context?: DetermineLevelContext
): ReadinessLevel | DetermineLevelResult {
  // ── Unsupported short-circuit ──────────────────────────────────────────
  if (context) {
    let reason: string | undefined = context.unsupportedReason;
    if (!reason && context.productId !== undefined) {
      const isApple =
        context.vendorId === undefined || normaliseHex(context.vendorId) === APPLE_VENDOR_ID;
      if (isApple) {
        const pid = normaliseHex(context.productId);
        reason = lookupUnsupportedReason(pid) ?? lookupIosRangeFallbackReason(pid) ?? undefined;
      }
    }
    if (reason) {
      return { level: 'unsupported', unsupportedReason: reason };
    }
  }

  const byStage = new Map(stages.map((s) => [s.stage, s]));

  for (const rule of READINESS_RULES) {
    if (rule.match(byStage)) {
      return context ? { level: rule.level } : rule.level;
    }
  }

  return context ? { level: 'unknown' } : 'unknown';
}
