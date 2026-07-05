/**
 * Pure resolvers over a generation's support record.
 *
 * `resolveGenerationSupport` returns the two-axis {@link GenerationSupport}
 * (access + verification provenance) for a single generation.
 * `getSupportMatrix` projects the whole generation table into a flat,
 * serializable {@link SupportMatrixRow}[] for docs and CLI consumption.
 *
 * @module
 */

import { GENERATIONS } from './tables/generations.js';
import { formatIpodLabel } from './format.js';
import type { GenerationSupport, IpodGenerationId, SupportMatrixRow } from './types.js';

/**
 * Return the support record (access tier + verification provenance) for a
 * generation.
 *
 * `access` gates behavior (`none ⊂ read-only ⊂ syncable`); `verified` is
 * documentation confidence only and gates nothing.
 */
export function resolveGenerationSupport(generation: IpodGenerationId): GenerationSupport {
  return GENERATIONS[generation].support;
}

/**
 * Project every generation in the table into a serializable support matrix —
 * one row per generation carrying its display name, access tier, and
 * verification provenance.
 *
 * This is the single export docs and `device info` consume; a test pins it to
 * the table so the published matrix cannot drift from the source of truth.
 */
export function getSupportMatrix(): SupportMatrixRow[] {
  return Object.values(GENERATIONS).map((gen) => {
    const { access, verified, note } = gen.support;
    return {
      generation: gen.id,
      displayName: formatIpodLabel({ family: gen.family, ordinal: gen.ordinal }),
      access,
      verified,
      ...(note ? { note } : {}),
    };
  });
}

/**
 * Render {@link getSupportMatrix} as a GitHub-flavoured Markdown table.
 *
 * The single source of truth for the generation matrix printed in
 * `documents/formats/generations.md`: a drift test pins the doc's generated
 * region to this output, so the reference and the table can never diverge.
 *
 * Row order is the generation table's own insertion order (deterministic), and
 * a row with no `note` renders an em dash so every column stays populated.
 */
export function renderSupportMatrixMarkdown(): string {
  const header = '| Generation | ID | Access | Verified | Note |';
  const divider = '| --- | --- | --- | --- | --- |';
  const rows = getSupportMatrix().map(
    (row) =>
      `| ${row.displayName} | \`${row.generation}\` | ${row.access} | ${row.verified} | ${row.note ?? '—'} |`
  );
  return [header, divider, ...rows].join('\n');
}
