/**
 * Codec concern: predictions + observation for the codec-preference matrix.
 *
 * Where the artwork concern asks "does the cover survive?", the codec concern
 * asks "given this device and this lossy preference, what *output codec* and
 * copy-vs-transcode *action* does podkit choose?" — the questions the old
 * imperative `codec-preference.test.ts` answered for a single device.
 *
 * It is the first matrix to vary the **device** axis (doc-039 P4): every
 * prediction keys off `target.capabilities` via the reference model, never off
 * a device name. Artwork is disabled (`artwork = false`) so the concern stays
 * orthogonal to the artwork matrix and sidesteps FFmpeg's embed-into-OGG
 * limitation — the device axis on the *artwork* matrix is a separate slice.
 *
 * This is a **decision matrix**: it asserts what podkit *plans*, read entirely
 * from the dry-run JSON — no real transfer, no device file walking:
 * - the `add-*` op type per track (copy sub-type vs transcode),
 * - the sync-wide resolved lossy codec (`json.codec`) — a decision assertion
 *   the existing JSON already exposes (doc-039 §"Decision assertions").
 *
 * Output fidelity and idempotency of the actual transfer are the artwork
 * matrix's and the mass-storage-sync smoke's job; keeping this concern on the
 * plan keeps it fast (no transcoding) and immune to execution-path failures
 * unrelated to the codec decision (e.g. OGG optimized-copy choking on
 * embedded-art mass-storage devices).
 *
 * @module
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCliJson } from '@podkit/e2e-shared';
import type { AudioCodec } from '@podkit/device-types';
import type { SyncOutput } from 'podkit/types';

import type { SyncTarget } from '../targets';

import { FORMATS, FORMAT_TITLE, type Format } from './axes.js';
import {
  DEVICE_SPECS,
  DEVICE_SPEC_BY_ID,
  deviceAddressing,
  type DeviceId,
  type DeviceSpec,
} from './devices.js';
import {
  codecOutcome,
  copyOpKind,
  resolvedLossyCodec,
  TRANSFER_MODES,
  type TransferMode,
} from './reference-model.js';
import {
  skipRedundant,
  type CellExpectation,
  type OpSummary,
  type SkipDecision,
} from './harness.js';

/**
 * `Format` axis values are codec names ('aac', 'alac'). The directory adapter
 * reports the file's `fileType` (container/extension). For the .m4a container
 * — used by both AAC and ALAC sources — `fileType` is 'm4a'. This map
 * normalises the predictor's expected output for direct/optimized copy ops
 * (transcode ops emit the codec name, not the container, so they bypass it).
 */
const FORMAT_FILETYPE: Record<Format, string> = {
  wav: 'wav',
  aiff: 'aiff',
  flac: 'flac',
  alac: 'm4a',
  mp3: 'mp3',
  aac: 'm4a',
  ogg: 'ogg',
  opus: 'opus',
};

// ---------------------------------------------------------------------------
// Codec-config axis
// ---------------------------------------------------------------------------

export type CodecConfigId = 'opus-first' | 'aac-first';

/** A pinned lossy preference stack. `quality` is fixed at `low` (lossy). */
export interface CodecConfigSpec {
  id: CodecConfigId;
  lossy: AudioCodec[];
}

export const CODEC_CONFIGS: readonly CodecConfigSpec[] = [
  // opus-first exercises both opus selection (rockbox supports it) and the
  // fallback to aac (echo-mini/generic/iPod do not).
  { id: 'opus-first', lossy: ['opus', 'aac'] },
  { id: 'aac-first', lossy: ['aac'] },
];

export const CODEC_CONFIG_BY_ID: Record<CodecConfigId, CodecConfigSpec> = Object.fromEntries(
  CODEC_CONFIGS.map((c) => [c.id, c])
) as Record<CodecConfigId, CodecConfigSpec>;

// ---------------------------------------------------------------------------
// Cell
// ---------------------------------------------------------------------------

export interface CodecCell {
  device: DeviceId;
  format: Format;
  config: CodecConfigId;
  transferMode: TransferMode;
}

export function codecCells(): CodecCell[] {
  const cells: CodecCell[] = [];
  for (const device of DEVICE_SPECS) {
    for (const format of FORMATS) {
      for (const config of CODEC_CONFIGS) {
        for (const transferMode of TRANSFER_MODES) {
          cells.push({ device: device.id, format, config: config.id, transferMode });
        }
      }
    }
  }
  return cells;
}

export function codecCellKey(cell: CodecCell): string {
  return `${cell.device}/${cell.format}/${cell.config}/${cell.transferMode}`;
}
export function codecCellLabel(cell: CodecCell): string {
  return `${cell.device} / ${cell.format} / ${cell.config} / ${cell.transferMode}`;
}

/**
 * Transfer mode only changes the *copy* sub-type, and only on devices whose
 * primary artwork source is not `embedded` (embedded-art devices always
 * `optimized-copy`). So we assert the full product at `fast`, and add the
 * `optimized`/`portable` modes only where they can differ: the iPod
 * (database-artwork) under a single codec config. Everything else is pruned —
 * these are all `redundant` (structural) skips, never deferred bugs.
 */
export function skipCodecCell(cell: CodecCell): SkipDecision | null {
  if (cell.transferMode === 'fast') return null;
  if (cell.device !== 'ipod-MA147') {
    return skipRedundant('transfer mode alters the copy op-type only on database-artwork devices');
  }
  if (cell.config !== 'aac-first') {
    return skipRedundant(
      'transfer-mode effect is codec-independent; exercised under aac-first only'
    );
  }
  return null;
}

/** Whether a (device, config, transferMode) sync is needed by any live cell. */
function syncIsLive(device: DeviceId, config: CodecConfigId, transferMode: TransferMode): boolean {
  // Mirror skipCodecCell at the sync granularity (format doesn't affect skip).
  return skipCodecCell({ device, format: 'flac', config, transferMode }) === null;
}

// ---------------------------------------------------------------------------
// Expectation / observation shapes
// ---------------------------------------------------------------------------

/**
 * Provenance attribution mirror of the `DecisionSource` union exported by
 * `packages/podkit-cli/src/commands/sync-decisions.ts`. Kept local to the
 * matrix to avoid the test package reaching into the CLI's source tree; if
 * podkit grows a new source value the matrix predictor will need updating
 * anyway (the diff fails until both sides agree).
 */
type DecisionSource =
  | 'default'
  | 'global'
  | 'global-quality'
  | 'device'
  | 'device-quality'
  | 'unsupported'
  | 'unknown'
  | 'cli';

export interface CodecExpected extends CellExpectation {
  /** The single `add-*` op type planned for this track on a fresh device. */
  addOp: string;
  /** Sync-wide resolved lossy codec (`json.decisions.lossyCodec.value`). */
  resolvedCodec: string | null;
  /**
   * Provenance of `resolvedCodec` (`json.decisions.lossyCodec.source`).
   * The codec concern always writes `[codec] lossy = [...]` to the config, so
   * every cell expects `'global'`. A regression in the resolver that produced
   * the right codec via the wrong inheritance path (e.g. swallowed the
   * device-level setting and fell through to the default) would flip this.
   */
  lossyCodecSource: DecisionSource;
  /**
   * Per-op `outputCodec` for the single `add-*` op (`json.operations[*].outputCodec`).
   * Disambiguates transcode-to-AAC vs transcode-to-Opus — both are
   * `add-transcode` at the op-type level. Null when no add op fired (which
   * shouldn't happen on a fresh-device dry-run of a known-format track).
   */
  outputCodec: string | null;
}

export interface CodecObserved extends Record<string, unknown> {
  addOp: string;
  resolvedCodec: string | null;
  lossyCodecSource: DecisionSource | null;
  outputCodec: string | null;
  planOps: OpSummary[];
}

// ---------------------------------------------------------------------------
// Prediction
// ---------------------------------------------------------------------------

export function predictCodec(cell: CodecCell): CodecExpected {
  const spec = DEVICE_SPEC_BY_ID[cell.device];
  const config = CODEC_CONFIG_BY_ID[cell.config];
  const outcome = codecOutcome(cell.format, spec.capabilities, spec.kind, config.lossy, 'low');
  const resolved = resolvedLossyCodec(config.lossy, spec.capabilities, spec.kind) ?? null;

  let addOp: string;
  let outputCodec: string | null;
  let reason: string;
  if (outcome.action === 'transcode') {
    addOp = 'add-transcode';
    // Transcode rewrites the audio stream into the resolved lossy codec.
    outputCodec = resolved;
    reason = `${cell.format} → transcode to ${resolved ?? '<none>'} (${outcome.extension}); preference ${config.lossy.join('>')} resolves to ${resolved ?? '<none>'} on this device`;
  } else {
    const kind = copyOpKind(spec.capabilities, cell.transferMode);
    addOp = `add-${kind}`;
    // Copy variants leave the file unchanged — output equals the source's
    // `fileType` (container/extension). For .m4a sources (AAC + ALAC) podkit
    // reports 'm4a', not the codec name; FORMAT_FILETYPE handles that.
    outputCodec = FORMAT_FILETYPE[cell.format];
    reason =
      kind === 'optimized-copy'
        ? `${cell.format} is device-native → copy, routed through FFmpeg (${spec.capabilities.artworkSources[0] === 'embedded' ? 'embedded-art device' : 'optimized mode'})`
        : `${cell.format} is device-native → direct copy (fast/portable, non-embedded-art device)`;
  }

  return {
    addOp,
    resolvedCodec: resolved,
    // Every codec-matrix cell writes `[codec] lossy = [...]` to the config, so
    // attribution is always `'global'`. A 'default' here means the resolver
    // silently dropped the config block; a 'device' means a config we don't
    // write somehow ended up at the device level.
    lossyCodecSource: 'global',
    outputCodec,
    reason,
  };
}

// ---------------------------------------------------------------------------
// Observation
// ---------------------------------------------------------------------------

/** Build a directory-source mass-storage/iPod config for the codec concern. */
async function createCodecConfig(opts: {
  sourceRoot: string;
  lossy: AudioCodec[];
  deviceFragment: string;
  deviceArg: string;
  isMassStorage: boolean;
}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'podkit-codec-cfg-'));
  const configPath = join(dir, 'config.toml');
  const lossyArray = opts.lossy.map((c) => `"${c}"`).join(', ');
  const defaultsDevice = opts.isMassStorage ? `device = "${opts.deviceArg}"\n` : '';
  const content = `version = 2

quality = "low"
artwork = false

[codec]
lossy = [${lossyArray}]

[music.default]
path = "${opts.sourceRoot}"

${opts.deviceFragment}[defaults]
music = "default"
${defaultsDevice}`;
  await writeFile(configPath, content);
  return configPath;
}

const ADD_OP_PREFIX = 'add-';

/**
 * Operations whose `track` ends with ` - <title>`. The codec concern uses one
 * fixture variant so titles are unique per format; matching on title alone
 * sidesteps the AIFF fixture's `Unknown Artist` tag (the others stamp
 * `Multi-Format Test`).
 */
function planOpsForTitle(dryJson: SyncOutput, title: string): OpSummary[] {
  const suffix = ` - ${title}`;
  return (dryJson.operations ?? [])
    .filter((op) => (op.track ?? '').endsWith(suffix))
    .map((op) => ({ type: op.type, reason: op.reason }));
}

/** Pick the single `add-*` op type for a track from a fresh-device dry-run. */
function addOpType(ops: OpSummary[]): string | null {
  const add = ops.find((op) => op.type.startsWith(ADD_OP_PREFIX));
  return add ? add.type : null;
}

/**
 * Dry-run one (device, config, transferMode) triplet against an empty target
 * and read the planned add op per format + the sync-wide resolved lossy codec.
 * Dry-run is read-only, so all triplets for a device can share one empty
 * target. Returns the observed map for the 8 formats, keyed by full cell key.
 */
async function observeCodecTriplet(opts: {
  spec: DeviceSpec;
  target: SyncTarget;
  config: CodecConfigSpec;
  transferMode: TransferMode;
  sourceRoot: string;
}): Promise<Map<string, CodecObserved>> {
  const { spec, target, config, transferMode, sourceRoot } = opts;
  const { deviceArg, configFragment } = deviceAddressing(target);
  const configPath = await createCodecConfig({
    sourceRoot,
    lossy: config.lossy,
    deviceFragment: configFragment,
    deviceArg,
    isMassStorage: spec.kind === 'mass-storage',
  });
  const args = [
    '--config',
    configPath,
    'sync',
    '--device',
    deviceArg,
    '--transfer-mode',
    transferMode,
    '--dry-run',
    '--json',
  ];

  try {
    const { result, json } = await runCliJson<SyncOutput>(args, { timeout: 120000 });
    if (result.exitCode !== 0 || !json) {
      throw new Error(
        `dry-run failed (${spec.id}/${config.id}/${transferMode}): exit=${result.exitCode}\n` +
          `  stderr: ${result.stderr.slice(0, 1500)}`
      );
    }
    // Decision attribution layer: TASK-357 moved the resolved lossy codec
    // from the top-level `json.codec` into `json.decisions.lossyCodec.value`,
    // and added `json.decisions.lossyCodec.source` for provenance.
    const resolvedCodec = json.decisions?.lossyCodec.value ?? null;
    const lossyCodecSource = (json.decisions?.lossyCodec.source ?? null) as DecisionSource | null;

    const byKey = new Map<string, CodecObserved>();
    for (const format of FORMATS) {
      const planOps = planOpsForTitle(json, FORMAT_TITLE[format]);
      const addOp = addOpType(planOps);
      // Per-op outputCodec lives on the operation entry. Disambiguates
      // transcode-to-AAC vs transcode-to-Opus at cell granularity.
      const addOpEntry = (json.operations ?? []).find(
        (op) =>
          (op.track ?? '').endsWith(` - ${FORMAT_TITLE[format]}`) &&
          op.type.startsWith(ADD_OP_PREFIX)
      );
      const key = codecCellKey({ device: spec.id, format, config: config.id, transferMode });
      byKey.set(key, {
        addOp: addOp ?? '<none>',
        resolvedCodec,
        lossyCodecSource,
        outputCodec: addOpEntry?.outputCodec ?? null,
        planOps,
      });
    }
    return byKey;
  } finally {
    await rm(join(configPath, '..'), { recursive: true, force: true }).catch(() => {});
  }
}

/**
 * Observe every live (device, config, transferMode) triplet (pruned to match
 * `skipCodecCell`) and merge into a single map keyed by cell. One empty target
 * per device, reused across that device's triplets (dry-run never mutates it).
 */
export async function observeCodecMatrix(sourceRoot: string): Promise<Map<string, CodecObserved>> {
  const merged = new Map<string, CodecObserved>();
  for (const spec of DEVICE_SPECS) {
    const target = await spec.create();
    try {
      for (const config of CODEC_CONFIGS) {
        for (const transferMode of TRANSFER_MODES) {
          if (!syncIsLive(spec.id, config.id, transferMode)) continue;
          const partial = await observeCodecTriplet({
            spec,
            target,
            config,
            transferMode,
            sourceRoot,
          });
          for (const [key, observed] of partial) merged.set(key, observed);
        }
      }
    } finally {
      await target.cleanup();
    }
  }
  return merged;
}
