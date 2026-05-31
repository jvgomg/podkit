/**
 * CLI-override concern: end-to-end precedence for the decisions block.
 *
 * Where the config-inheritance matrix asks "which resolver level did each
 * decision come from?", this concern asks "when a CLI flag and a config
 * entry collide, which wins — and does the JSON report it correctly?".
 *
 * The pure-function precedence rules are unit-tested in
 * `sync-decisions.test.ts` (including the explicit-false trap that sonnet
 * caught during TASK-357). The wiring from commander → `deriveSettings()` →
 * `buildSyncDecisions()` → JSON is *not* asserted end-to-end in the unit
 * tests. A commander option rename, a missing thread-through, or a default-
 * value collision would pass every unit test and still break `--flag`.
 *
 * Each cell pins one (combo, focal-setting) pair: the combo describes the
 * config + CLI-flag scenario, the focal-setting is the decision key whose
 * `{value, source}` pair the cell asserts. Multiple cells can share a combo
 * — `observeCliMatrix` runs the sync once per combo and reads each focal
 * setting's decision from the resulting JSON.
 *
 * @module
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCliJson } from '@podkit/e2e-shared';
import type { SyncOutput } from 'podkit/types';

import { createMassStorageTarget, type SyncTarget } from '../targets';

import { type CellExpectation } from './harness.js';

// ---------------------------------------------------------------------------
// Axes
// ---------------------------------------------------------------------------

/**
 * The CLI scenarios this matrix sweeps. Each is a tuple of (config baseline,
 * CLI flags). `baseline` is the no-flags / no-overrides reference.
 */
export type CliCombo =
  | 'baseline'
  | 'audio-quality-only'
  | 'quality-only'
  | 'audio-quality-wins-quality'
  | 'transfer-mode-over-global'
  | 'transfer-mode-over-device'
  | 'check-artwork-over-global'
  | 'check-artwork-over-device';

export const CLI_COMBOS: readonly CliCombo[] = [
  'baseline',
  'audio-quality-only',
  'quality-only',
  'audio-quality-wins-quality',
  'transfer-mode-over-global',
  'transfer-mode-over-device',
  'check-artwork-over-global',
  'check-artwork-over-device',
];

/** Decision keys this matrix asserts. Other keys are covered by config-rules. */
export type FocalSetting = 'transferMode' | 'quality' | 'checkArtwork';

export interface CliCell {
  combo: CliCombo;
  focal: FocalSetting;
}

/**
 * The asserted product. Each combo gets one cell per focal whose decision
 * it meaningfully exercises — `baseline` covers all three (proves the
 * defaults), each CLI-overlay combo asserts the setting its flag stamps.
 */
const CELL_DEFS: readonly CliCell[] = [
  // Baseline — every focal should report its `--flag absent` provenance.
  { combo: 'baseline', focal: 'transferMode' },
  { combo: 'baseline', focal: 'quality' },
  { combo: 'baseline', focal: 'checkArtwork' },
  // Quality precedence — both flags stamp 'cli', but via different branches in
  // `buildSyncDecisions`: `audio-quality-only` exercises the `overrides.audioQuality`
  // branch, `quality-only` exercises `overrides.quality`. The
  // `audio-quality-wins-quality` cell proves the audioQuality branch is checked
  // first when both flags are present.
  { combo: 'audio-quality-only', focal: 'quality' },
  { combo: 'quality-only', focal: 'quality' },
  { combo: 'audio-quality-wins-quality', focal: 'quality' },
  // Transfer mode — `--transfer-mode` overrides both global and per-device config.
  { combo: 'transfer-mode-over-global', focal: 'transferMode' },
  { combo: 'transfer-mode-over-device', focal: 'transferMode' },
  // checkArtwork — `--check-artwork` overrides both global and per-device config.
  { combo: 'check-artwork-over-global', focal: 'checkArtwork' },
  { combo: 'check-artwork-over-device', focal: 'checkArtwork' },
];

export function cliCells(): readonly CliCell[] {
  return CELL_DEFS;
}

export function cliCellKey(cell: CliCell): string {
  return `${cell.combo}/${cell.focal}`;
}

export function cliCellLabel(cell: CliCell): string {
  return `${cell.combo} → ${cell.focal}`;
}

// ---------------------------------------------------------------------------
// Combo specs (config overlays + CLI flags)
// ---------------------------------------------------------------------------

/** TOML config overlay for a combo. */
interface ConfigOverlay {
  /** Settings written to the top-level (`[]`) config block. */
  global?: { transferMode?: string; checkArtwork?: boolean };
  /** Settings written inside `[devices.<name>]`. */
  device?: { transferMode?: string; checkArtwork?: boolean };
}

/** A combo's full setup: config overlay + extra CLI flags. */
interface ComboSpec {
  overlay: ConfigOverlay;
  cliArgs: readonly string[];
}

/**
 * Non-default values each combo uses. Picked so the asserted source vs value
 * are independent dimensions — e.g. `transferMode` config-baseline `portable`
 * and CLI `optimized` differ in both value (so the value alone proves the CLI
 * overlay fired) and would differ in source if precedence were broken.
 */
const CONFIG_TRANSFER_MODE = 'portable';
const CLI_TRANSFER_MODE = 'optimized';
const CLI_QUALITY_VALUE = 'low';
const CLI_QUALITY_LOSING = 'max';

const COMBO_SPECS: Record<CliCombo, ComboSpec> = {
  baseline: { overlay: {}, cliArgs: [] },
  'audio-quality-only': {
    overlay: {},
    cliArgs: ['--audio-quality', CLI_QUALITY_VALUE],
  },
  'quality-only': {
    overlay: {},
    cliArgs: ['--quality', CLI_QUALITY_VALUE],
  },
  'audio-quality-wins-quality': {
    overlay: {},
    // Pass `--quality max` and `--audio-quality low` — audioQuality wins.
    // The value alone proves the winner (max vs low); the source proves
    // the wiring stamps `'cli'`.
    cliArgs: ['--quality', CLI_QUALITY_LOSING, '--audio-quality', CLI_QUALITY_VALUE],
  },
  'transfer-mode-over-global': {
    overlay: { global: { transferMode: CONFIG_TRANSFER_MODE } },
    cliArgs: ['--transfer-mode', CLI_TRANSFER_MODE],
  },
  'transfer-mode-over-device': {
    overlay: { device: { transferMode: CONFIG_TRANSFER_MODE } },
    cliArgs: ['--transfer-mode', CLI_TRANSFER_MODE],
  },
  'check-artwork-over-global': {
    overlay: { global: { checkArtwork: false } },
    cliArgs: ['--check-artwork'],
  },
  'check-artwork-over-device': {
    overlay: { device: { checkArtwork: false } },
    cliArgs: ['--check-artwork'],
  },
};

// ---------------------------------------------------------------------------
// Expectation / observation
// ---------------------------------------------------------------------------

type DecisionSource = 'default' | 'global' | 'global-quality' | 'device' | 'device-quality' | 'cli';

export interface CliExpected extends CellExpectation {
  value: unknown;
  source: DecisionSource;
}

export interface CliObserved extends Record<string, unknown> {
  value: unknown;
  source: string | null;
}

// ---------------------------------------------------------------------------
// Prediction
// ---------------------------------------------------------------------------

export function predictCli(cell: CliCell): CliExpected {
  if (cell.combo === 'baseline') {
    switch (cell.focal) {
      case 'transferMode':
        return {
          value: 'fast',
          source: 'default',
          reason: 'no transferMode set in config and no --transfer-mode flag → resolver default',
        };
      case 'quality':
        // Loader unconditionally writes quality='high' into PodkitConfig. With
        // no audioQuality set anywhere, resolveDeviceAudio falls through to
        // `quality.value` from resolveDeviceQuality, which itself fell through
        // to global config.quality → source='global-quality'. So the audio
        // decision under baseline is `{value: 'high', source: 'global-quality'}`,
        // *not* `'global'` — that surfaces a quirk worth knowing: the
        // audio-quality source on a bare config is always the -quality fold,
        // never the literal `'global'`.
        return {
          value: 'high',
          source: 'global-quality',
          reason:
            'no audioQuality anywhere → resolveDeviceAudio falls through to resolveDeviceQuality which returns source=global-quality',
        };
      case 'checkArtwork':
        return {
          value: false,
          source: 'default',
          reason:
            'no checkArtwork set in config and no --check-artwork flag → resolver default false',
        };
    }
  }
  if (cell.combo === 'audio-quality-only' && cell.focal === 'quality') {
    return {
      value: CLI_QUALITY_VALUE,
      source: 'cli',
      reason: '--audio-quality stamps the audio quality decision with source=cli',
    };
  }
  if (cell.combo === 'quality-only' && cell.focal === 'quality') {
    return {
      value: CLI_QUALITY_VALUE,
      source: 'cli',
      reason: '--quality (no --audio-quality) stamps the audio quality decision with source=cli',
    };
  }
  if (cell.combo === 'audio-quality-wins-quality' && cell.focal === 'quality') {
    return {
      value: CLI_QUALITY_VALUE,
      source: 'cli',
      reason: '--audio-quality wins over --quality (buildSyncDecisions checks audioQuality first)',
    };
  }
  if (cell.combo === 'transfer-mode-over-global' && cell.focal === 'transferMode') {
    return {
      value: CLI_TRANSFER_MODE,
      source: 'cli',
      reason: '--transfer-mode overrides global config; CLI overlay stamps source=cli',
    };
  }
  if (cell.combo === 'transfer-mode-over-device' && cell.focal === 'transferMode') {
    return {
      value: CLI_TRANSFER_MODE,
      source: 'cli',
      reason: '--transfer-mode overrides [devices.<n>] config; CLI overlay stamps source=cli',
    };
  }
  if (cell.combo === 'check-artwork-over-global' && cell.focal === 'checkArtwork') {
    return {
      value: true,
      source: 'cli',
      reason: '--check-artwork overrides global checkArtwork=false; CLI overlay stamps source=cli',
    };
  }
  if (cell.combo === 'check-artwork-over-device' && cell.focal === 'checkArtwork') {
    return {
      value: true,
      source: 'cli',
      reason:
        '--check-artwork overrides [devices.<n>] checkArtwork=false; CLI overlay stamps source=cli',
    };
  }
  throw new Error(`predictCli: no prediction for cell ${cliCellKey(cell)}`);
}

// ---------------------------------------------------------------------------
// TOML construction
// ---------------------------------------------------------------------------

interface CliContext {
  sourceRoot: string;
  targetPath: string;
  deviceName: string;
  deviceType: string;
}

function comboToml(combo: CliCombo, ctx: CliContext): string {
  const spec = COMBO_SPECS[combo];
  const lines: string[] = ['version = 2', ''];

  if (spec.overlay.global?.transferMode !== undefined) {
    lines.push(`transferMode = "${spec.overlay.global.transferMode}"`);
  }
  if (spec.overlay.global?.checkArtwork !== undefined) {
    lines.push(`checkArtwork = ${spec.overlay.global.checkArtwork}`);
  }
  if (lines.length > 2) lines.push('');

  lines.push('[music.default]');
  lines.push(`path = "${ctx.sourceRoot}"`);
  lines.push('');

  lines.push(`[devices.${ctx.deviceName}]`);
  lines.push(`type = "${ctx.deviceType}"`);
  lines.push(`path = "${ctx.targetPath}"`);
  if (spec.overlay.device?.transferMode !== undefined) {
    lines.push(`transferMode = "${spec.overlay.device.transferMode}"`);
  }
  if (spec.overlay.device?.checkArtwork !== undefined) {
    lines.push(`checkArtwork = ${spec.overlay.device.checkArtwork}`);
  }
  lines.push('');

  lines.push('[defaults]');
  lines.push('music = "default"');
  lines.push(`device = "${ctx.deviceName}"`);
  lines.push('');

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Observation
// ---------------------------------------------------------------------------

function readFocal(json: SyncOutput, focal: FocalSetting): CliObserved {
  const decisions = json.decisions;
  if (!decisions) return { value: null, source: null };
  switch (focal) {
    case 'transferMode':
      return { value: decisions.transferMode.value, source: decisions.transferMode.source };
    case 'quality':
      return { value: decisions.quality.value, source: decisions.quality.source };
    case 'checkArtwork':
      return { value: decisions.checkArtwork.value, source: decisions.checkArtwork.source };
  }
}

/**
 * Run one combo against the shared rockbox target and read every focal
 * setting from the resulting decisions block. Returns a map keyed by full
 * cell key — cells for focals not in this combo's CELL_DEFS subset are
 * still emitted (cheap, and lets a future cell add itself without touching
 * the observer).
 */
async function observeCombo(combo: CliCombo, ctx: CliContext): Promise<Map<string, CliObserved>> {
  const dir = await mkdtemp(join(tmpdir(), 'podkit-cli-cell-'));
  const configPath = join(dir, 'config.toml');
  await writeFile(configPath, comboToml(combo, ctx));
  try {
    const args = [
      '--config',
      configPath,
      'sync',
      '--device',
      ctx.deviceName,
      '--dry-run',
      '--json',
      ...COMBO_SPECS[combo].cliArgs,
    ];
    const { result, json } = await runCliJson<SyncOutput>(args, { timeout: 60000 });
    if (result.exitCode !== 0 || !json) {
      throw new Error(
        `dry-run failed (combo=${combo}): exit=${result.exitCode}\n` +
          `  stderr: ${result.stderr.slice(0, 1500)}`
      );
    }
    const observed = new Map<string, CliObserved>();
    for (const focal of ['transferMode', 'quality', 'checkArtwork'] as const) {
      observed.set(cliCellKey({ combo, focal }), readFocal(json, focal));
    }
    return observed;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Observe every combo against a shared rockbox mass-storage target. Dry-run
 * is read-only so all combos can share one target; per-combo state lives in
 * its temporary config file.
 */
export async function observeCliMatrix(sourceRoot: string): Promise<Map<string, CliObserved>> {
  const target: SyncTarget = await createMassStorageTarget({ preset: 'rockbox' });
  const fragment = target.deviceConfig();
  if (!fragment) {
    throw new Error('mass-storage target unexpectedly lacks a deviceConfig fragment');
  }
  const ctx: CliContext = {
    sourceRoot,
    targetPath: target.path,
    deviceName: fragment.name,
    deviceType: 'rockbox',
  };
  const merged = new Map<string, CliObserved>();
  try {
    for (const combo of CLI_COMBOS) {
      const partial = await observeCombo(combo, ctx);
      for (const [key, observed] of partial) merged.set(key, observed);
    }
  } finally {
    await target.cleanup();
  }
  return merged;
}
