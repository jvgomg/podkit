/**
 * Config-inheritance concern: end-to-end provenance for the decisions block.
 *
 * Where the codec concern asks "which output codec did podkit pick?", this
 * concern asks the orthogonal "which *level* of the inheritance chain did
 * each decision come from?" — a question the unit tests around
 * `resolveDeviceSettings` and `buildSyncDecisions` can answer in isolation
 * but only this matrix proves end-to-end.
 *
 * The chain (resolve.ts:28):
 *   device-specific → device-quality → global-specific → global-quality → default
 *
 * On top of that the CLI overlay (sync.ts ~line 1077) can stamp `'cli'` for
 * the four flag-backed settings (`--transfer-mode`, `--audio-quality` /
 * `--quality`, `--check-artwork`).
 *
 * Each cell pins one setting at exactly one level of that chain and asserts
 * the resulting `json.decisions.<setting>.{value, source}` pair. A regression
 * that swallows one inheritance hop, mis-attributes a source, or silently
 * drops a CLI overlay flips at least one cell. Codec settings exercise the
 * `codecPreferenceFromConfig` branch in `buildSyncDecisions` — the same path
 * sonnet caught mis-using "presence" vs "length" during TASK-357.
 *
 * @module
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCliJson } from '@podkit/e2e-shared';
import type { SyncOutput } from 'podkit/types';

import { createMassStorageTarget, type SyncTarget } from '../targets';

import { skipBug, skipImpossible, type CellExpectation, type SkipDecision } from './harness.js';

// ---------------------------------------------------------------------------
// Axes
// ---------------------------------------------------------------------------

/**
 * The seven decision keys exposed by `SyncDecisions` (sync-decisions.ts).
 * `lossyCodec`/`losslessCodec` are scalar resolutions of the corresponding
 * preference stack; both are included so the matrix would catch a regression
 * that fanned one provenance without the other.
 */
export type ConfigSetting =
  | 'transferMode'
  | 'quality'
  | 'checkArtwork'
  | 'lossyCodec'
  | 'losslessCodec'
  | 'lossyPreference'
  | 'losslessPreference';

export const CONFIG_SETTINGS: readonly ConfigSetting[] = [
  'transferMode',
  'quality',
  'checkArtwork',
  'lossyCodec',
  'losslessCodec',
  'lossyPreference',
  'losslessPreference',
];

/**
 * The six layers a decision can be attributed to. `unsupported`/`unknown`
 * (resolver source values) are out of scope — those are device-capability
 * answers, not inheritance-chain answers, and would need a video/artwork
 * cell to provoke.
 */
export type SourceLevel =
  | 'default'
  | 'global'
  | 'global-quality'
  | 'device'
  | 'device-quality'
  | 'cli';

export const SOURCE_LEVELS: readonly SourceLevel[] = [
  'default',
  'global',
  'global-quality',
  'device',
  'device-quality',
  'cli',
];

export interface ConfigCell {
  setting: ConfigSetting;
  level: SourceLevel;
}

export function configCells(): ConfigCell[] {
  const cells: ConfigCell[] = [];
  for (const setting of CONFIG_SETTINGS) {
    for (const level of SOURCE_LEVELS) {
      cells.push({ setting, level });
    }
  }
  return cells;
}

export function configCellKey(cell: ConfigCell): string {
  return `${cell.setting}/${cell.level}`;
}
export function configCellLabel(cell: ConfigCell): string {
  return `${cell.setting} from ${cell.level}`;
}

// ---------------------------------------------------------------------------
// Skip rules
// ---------------------------------------------------------------------------

/**
 * Whether `setting` has a `-quality` inheritance fold (i.e. is folded into the
 * unified `quality` preset). Only audio/video do; the others are scalar
 * settings whose -quality variants are nonsensical.
 */
function foldsThroughQuality(setting: ConfigSetting): boolean {
  return setting === 'quality';
}

/** Whether the CLI has a flag that can overlay this setting. */
function hasCliOverlay(setting: ConfigSetting): boolean {
  switch (setting) {
    case 'transferMode':
    case 'quality':
    case 'checkArtwork':
      return true;
    // No CLI flags exist for codec preferences (see sync.ts; only env or config).
    case 'lossyCodec':
    case 'losslessCodec':
    case 'lossyPreference':
    case 'losslessPreference':
      return false;
  }
}

/**
 * Codec preferences are sourced under `[codec]` (global) or
 * `[devices.<n>.codec]` (device). sync.ts attributes both to `'global'`
 * because `buildSyncDecisions` is told only a boolean — see TASK-367.
 * Until that's fixed, the device cells are fenced as known-broken so the
 * suite reports them as deferred work without going red.
 */
function isCodec(setting: ConfigSetting): boolean {
  return (
    setting === 'lossyCodec' ||
    setting === 'losslessCodec' ||
    setting === 'lossyPreference' ||
    setting === 'losslessPreference'
  );
}

export function skipConfigCell(cell: ConfigCell): SkipDecision | null {
  // -quality folds only apply to audio/video quality settings.
  if (
    (cell.level === 'global-quality' || cell.level === 'device-quality') &&
    !foldsThroughQuality(cell.setting)
  ) {
    return skipImpossible(
      `${cell.setting} has no -quality fold (only the unified audio/video quality preset does)`
    );
  }
  // CLI overlay only exists for flag-backed settings.
  if (cell.level === 'cli' && !hasCliOverlay(cell.setting)) {
    return skipImpossible(`no CLI flag exists for ${cell.setting}`);
  }
  // quality is unconditionally written by the config loader (DEFAULT_CONFIG
  // sets quality='high'). resolveGlobalQuality treats it as `'global'`
  // permanently — a `'default'` attribution is unreachable without a
  // detector for "user didn't write quality in TOML".
  if (cell.setting === 'quality' && cell.level === 'default') {
    return skipImpossible(
      'loader unconditionally sets quality=high in DEFAULT_CONFIG; resolveGlobalQuality always emits source=global'
    );
  }
  // Device-level codec attribution is broken — buildSyncDecisions emits
  // `'global'` for any codecPreferenceFromConfig=true, regardless of which
  // level the preference came from.
  if (isCodec(cell.setting) && cell.level === 'device') {
    return skipBug(
      'sync.ts forwards codecPreferenceFromConfig as a boolean; device-level codec is attributed to source=global',
      'TASK-367'
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Expectation / observation shapes
// ---------------------------------------------------------------------------

export interface ConfigExpected extends CellExpectation {
  value: unknown;
  source: SourceLevel;
}

export interface ConfigObserved extends Record<string, unknown> {
  value: unknown;
  source: string | null;
}

// ---------------------------------------------------------------------------
// Test values per setting
// ---------------------------------------------------------------------------

/**
 * The single non-default value each setting carries at any non-default
 * level. Chosen so that:
 *   - the value alone distinguishes the cell from the `default` cell
 *     (catches "value resolved correctly but source was lost"), AND
 *   - the value alone is NOT enough to tell which level the cell came
 *     from (every non-default cell shares the same value — the *source*
 *     is the distinguishing assertion).
 *
 * Quality cells all use `low` so a regression that crossed the audio /
 * unified-quality wires would only show in the source, not the value.
 */
const TEST_VALUES = {
  transferMode: 'optimized',
  quality: 'low',
  checkArtwork: true,
  lossyCodecPreference: ['aac'] as const,
  losslessCodecPreference: ['flac'] as const,
} as const;

/** Resolved scalar lossy codec when `[codec] lossy = ["aac"]` is set. */
const EXPECTED_GLOBAL_LOSSY_CODEC = 'aac';
/** Resolved scalar lossless codec when `[codec] lossless = ["flac"]` is set. */
const EXPECTED_GLOBAL_LOSSLESS_CODEC = 'flac';

/**
 * Defaults that podkit produces when no codec preference is configured.
 * Mirrored from `@podkit/core`'s DEFAULT_LOSSY_STACK / DEFAULT_LOSSLESS_STACK
 * — kept local so the test package doesn't reach into core for constants
 * (a divergence would flip the predictor cell). Tied to the rockbox preset
 * (`['opus','aac','mp3']` → first-supported is 'opus' since rockbox supports
 * opus; `['source','flac','alac']` → resolvedLossless is null because the
 * 'source' sentinel passes through).
 */
const DEFAULT_LOSSY_STACK = ['opus', 'aac', 'mp3'] as const;
const DEFAULT_LOSSLESS_STACK = ['source', 'flac', 'alac'] as const;
const DEFAULT_RESOLVED_LOSSY = 'opus';
const DEFAULT_RESOLVED_LOSSLESS: string | null = null;

// ---------------------------------------------------------------------------
// Prediction
// ---------------------------------------------------------------------------

export function predictConfig(cell: ConfigCell): ConfigExpected {
  switch (cell.setting) {
    case 'transferMode':
      return predictScalar(cell, {
        defaultValue: 'fast',
        nonDefaultValue: TEST_VALUES.transferMode,
        defaultReason: 'no transferMode set anywhere → resolver default',
      });
    case 'quality':
      // The quality setting is special: it folds through audioQuality and the
      // unified quality preset. Every level is reachable except `default`
      // (skipped above as impossible).
      return predictQuality(cell);
    case 'checkArtwork':
      return predictScalar(cell, {
        defaultValue: false,
        nonDefaultValue: TEST_VALUES.checkArtwork,
        defaultReason: 'no checkArtwork set anywhere → resolver default false',
      });
    case 'lossyCodec':
      return predictCodecScalar(cell, {
        defaultValue: DEFAULT_RESOLVED_LOSSY,
        nonDefaultValue: EXPECTED_GLOBAL_LOSSY_CODEC,
      });
    case 'losslessCodec':
      return predictCodecScalar(cell, {
        defaultValue: DEFAULT_RESOLVED_LOSSLESS,
        nonDefaultValue: EXPECTED_GLOBAL_LOSSLESS_CODEC,
      });
    case 'lossyPreference':
      return predictCodecPreference(cell, {
        defaultValue: [...DEFAULT_LOSSY_STACK],
        nonDefaultValue: [...TEST_VALUES.lossyCodecPreference],
      });
    case 'losslessPreference':
      return predictCodecPreference(cell, {
        defaultValue: [...DEFAULT_LOSSLESS_STACK],
        nonDefaultValue: [...TEST_VALUES.losslessCodecPreference],
      });
  }
}

function predictScalar(
  cell: ConfigCell,
  opts: { defaultValue: unknown; nonDefaultValue: unknown; defaultReason: string }
): ConfigExpected {
  if (cell.level === 'default') {
    return { value: opts.defaultValue, source: 'default', reason: opts.defaultReason };
  }
  return {
    value: opts.nonDefaultValue,
    source: cell.level,
    reason: `${cell.setting} pinned at ${cell.level} level → resolver attributes to ${cell.level}`,
  };
}

function predictQuality(cell: ConfigCell): ConfigExpected {
  const value = TEST_VALUES.quality;
  switch (cell.level) {
    case 'global':
      return {
        value,
        source: 'global',
        reason: 'audioQuality pinned at top level → resolver attributes to global',
      };
    case 'global-quality':
      return {
        value,
        source: 'global-quality',
        reason:
          'unified quality pinned at top level (no audioQuality) → folds through global-quality',
      };
    case 'device':
      return {
        value,
        source: 'device',
        reason: 'audioQuality pinned in [devices.<name>] → resolver attributes to device',
      };
    case 'device-quality':
      return {
        value,
        source: 'device-quality',
        reason:
          'unified quality pinned in [devices.<name>] (no audioQuality) → folds through device-quality',
      };
    case 'cli':
      return {
        value,
        source: 'cli',
        reason: '--audio-quality on CLI → buildSyncDecisions stamps cli',
      };
    case 'default':
      // skipConfigCell prunes this; unreachable.
      throw new Error('quality/default cell should be skipped as impossible');
  }
}

function predictCodecScalar(
  cell: ConfigCell,
  opts: { defaultValue: string | null; nonDefaultValue: string }
): ConfigExpected {
  if (cell.level === 'default') {
    return {
      value: opts.defaultValue,
      source: 'default',
      reason: 'no [codec] block → codecPreferenceFromConfig=false → source=default',
    };
  }
  if (cell.level === 'global') {
    return {
      value: opts.nonDefaultValue,
      source: 'global',
      reason: '[codec] block at top level → codecPreferenceFromConfig=true → source=global',
    };
  }
  // device and bug-fenced; cli/quality-fold pruned as impossible.
  throw new Error(`unexpected codec cell level: ${cell.level}`);
}

function predictCodecPreference(
  cell: ConfigCell,
  opts: { defaultValue: readonly string[]; nonDefaultValue: readonly string[] }
): ConfigExpected {
  if (cell.level === 'default') {
    return {
      value: opts.defaultValue,
      source: 'default',
      reason: 'no [codec] block → preference stack is DEFAULT_*_STACK with source=default',
    };
  }
  if (cell.level === 'global') {
    return {
      value: opts.nonDefaultValue,
      source: 'global',
      reason: '[codec] preference array at top level → source=global',
    };
  }
  throw new Error(`unexpected codec-preference cell level: ${cell.level}`);
}

// ---------------------------------------------------------------------------
// TOML + CLI flag construction
// ---------------------------------------------------------------------------

interface ConfigContext {
  sourceRoot: string;
  targetPath: string;
  deviceName: string;
  deviceType: string;
}

/**
 * Build a TOML config that pins exactly one setting at the cell's level. All
 * other settings are left at their loader/resolver defaults so an unintended
 * leak across cells (e.g. a stale checkArtwork from a previous cell) would
 * flip multiple cells at once — making the diagnostic obvious.
 *
 * `quality` is intentionally omitted from the global block when the cell is
 * not a quality cell, so it defaults to 'high' from DEFAULT_CONFIG. Likewise
 * `artwork`/`tips` are loader-defaulted.
 */
function cellToml(cell: ConfigCell, ctx: ConfigContext): string {
  const lines: string[] = ['version = 2', ''];

  // Global settings
  const globalLines: string[] = [];
  if (cell.setting === 'transferMode' && cell.level === 'global') {
    globalLines.push(`transferMode = "${TEST_VALUES.transferMode}"`);
  }
  if (cell.setting === 'checkArtwork' && cell.level === 'global') {
    globalLines.push(`checkArtwork = ${TEST_VALUES.checkArtwork}`);
  }
  if (cell.setting === 'quality') {
    if (cell.level === 'global') {
      globalLines.push(`audioQuality = "${TEST_VALUES.quality}"`);
    } else if (cell.level === 'global-quality') {
      globalLines.push(`quality = "${TEST_VALUES.quality}"`);
    }
  }
  // Codec scalars and preferences both write `[codec]` blocks; the scalar
  // variant just uses the same single-element array (resolver picks the first
  // supported codec from the stack — `["aac"]` → resolvedLossyCodec='aac').
  const wantsCodecGlobal = isCodec(cell.setting) && cell.level === 'global';
  if (wantsCodecGlobal) {
    globalLines.push('');
    globalLines.push('[codec]');
    if (cell.setting === 'lossyCodec' || cell.setting === 'lossyPreference') {
      const arr = TEST_VALUES.lossyCodecPreference.map((c) => `"${c}"`).join(', ');
      globalLines.push(`lossy = [${arr}]`);
    }
    if (cell.setting === 'losslessCodec' || cell.setting === 'losslessPreference') {
      const arr = TEST_VALUES.losslessCodecPreference.map((c) => `"${c}"`).join(', ');
      globalLines.push(`lossless = [${arr}]`);
    }
  }

  for (const line of globalLines) lines.push(line);
  if (globalLines.length > 0) lines.push('');

  lines.push('[music.default]');
  lines.push(`path = "${ctx.sourceRoot}"`);
  lines.push('');

  // Device block
  lines.push(`[devices.${ctx.deviceName}]`);
  lines.push(`type = "${ctx.deviceType}"`);
  lines.push(`path = "${ctx.targetPath}"`);
  if (cell.setting === 'transferMode' && cell.level === 'device') {
    lines.push(`transferMode = "${TEST_VALUES.transferMode}"`);
  }
  if (cell.setting === 'checkArtwork' && cell.level === 'device') {
    lines.push(`checkArtwork = ${TEST_VALUES.checkArtwork}`);
  }
  if (cell.setting === 'quality') {
    if (cell.level === 'device') {
      lines.push(`audioQuality = "${TEST_VALUES.quality}"`);
    } else if (cell.level === 'device-quality') {
      lines.push(`quality = "${TEST_VALUES.quality}"`);
    }
  }
  lines.push('');

  lines.push('[defaults]');
  lines.push('music = "default"');
  lines.push(`device = "${ctx.deviceName}"`);
  lines.push('');

  return lines.join('\n');
}

/** Extra CLI flags appended to `sync` when the cell exercises the CLI level. */
function cellCliArgs(cell: ConfigCell): string[] {
  if (cell.level !== 'cli') return [];
  switch (cell.setting) {
    case 'transferMode':
      return ['--transfer-mode', TEST_VALUES.transferMode];
    case 'quality':
      return ['--audio-quality', TEST_VALUES.quality];
    case 'checkArtwork':
      return ['--check-artwork'];
    default:
      // skipConfigCell prunes other settings at cli level.
      return [];
  }
}

// ---------------------------------------------------------------------------
// Observation
// ---------------------------------------------------------------------------

/**
 * Extract `{value, source}` for the given setting from the sync-decisions
 * block. Returns `null` value/source if the decisions block is absent (e.g.
 * non-dry-run path on an early-failing sync — should never happen here, but
 * defensive so the diff message is "missing observed cell" rather than a
 * crash).
 */
function readDecisionForSetting(json: SyncOutput, setting: ConfigSetting): ConfigObserved {
  const decisions = json.decisions;
  if (!decisions) return { value: null, source: null };
  switch (setting) {
    case 'transferMode':
      return { value: decisions.transferMode.value, source: decisions.transferMode.source };
    case 'quality':
      return { value: decisions.quality.value, source: decisions.quality.source };
    case 'checkArtwork':
      return { value: decisions.checkArtwork.value, source: decisions.checkArtwork.source };
    case 'lossyCodec':
      return {
        value: decisions.lossyCodec.value ?? null,
        source: decisions.lossyCodec.source,
      };
    case 'losslessCodec':
      return {
        value: decisions.losslessCodec.value ?? null,
        source: decisions.losslessCodec.source,
      };
    case 'lossyPreference':
      return {
        value: [...decisions.lossyPreference.value],
        source: decisions.lossyPreference.source,
      };
    case 'losslessPreference':
      return {
        value: [...decisions.losslessPreference.value],
        source: decisions.losslessPreference.source,
      };
  }
}

async function observeConfigCell(cell: ConfigCell, ctx: ConfigContext): Promise<ConfigObserved> {
  const dir = await mkdtemp(join(tmpdir(), 'podkit-config-cell-'));
  const configPath = join(dir, 'config.toml');
  await writeFile(configPath, cellToml(cell, ctx));
  try {
    const args = [
      '--config',
      configPath,
      'sync',
      '--device',
      ctx.deviceName,
      '--dry-run',
      '--json',
      ...cellCliArgs(cell),
    ];
    const { result, json } = await runCliJson<SyncOutput>(args, { timeout: 60000 });
    if (result.exitCode !== 0 || !json) {
      throw new Error(
        `dry-run failed (${configCellKey(cell)}): exit=${result.exitCode}\n` +
          `  stderr: ${result.stderr.slice(0, 1500)}`
      );
    }
    return readDecisionForSetting(json, cell.setting);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Observe every live cell against a single rockbox mass-storage target.
 * Dry-run is read-only, so all cells can share one target — the target is
 * never written to and the cell's only state is the per-cell TOML.
 *
 * Rockbox is picked over generic because it supports the full lossy stack
 * (opus + aac + mp3) and the full lossless stack (alac + flac), so the
 * codec cells resolve to predictable, non-fallback codecs.
 */
export async function observeConfigMatrix(
  sourceRoot: string
): Promise<Map<string, ConfigObserved>> {
  const target: SyncTarget = await createMassStorageTarget({ preset: 'rockbox' });
  const fragment = target.deviceConfig();
  if (!fragment) {
    throw new Error('mass-storage target unexpectedly lacks a deviceConfig fragment');
  }
  const ctx: ConfigContext = {
    sourceRoot,
    targetPath: target.path,
    deviceName: fragment.name,
    deviceType: 'rockbox',
  };
  const observed = new Map<string, ConfigObserved>();
  try {
    for (const cell of configCells()) {
      if (skipConfigCell(cell) !== null) continue;
      observed.set(configCellKey(cell), await observeConfigCell(cell, ctx));
    }
  } finally {
    await target.cleanup();
  }
  return observed;
}
