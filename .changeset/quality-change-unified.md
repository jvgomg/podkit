---
"podkit": minor
"@podkit/core": minor
---

Unify the music quality-change event vocabulary under `quality-change`

The sync event and JSON output reason vocabulary for music quality moves is
consolidated under a single `quality-change` update reason, replacing the four
previous reason strings (`format-upgrade`, `quality-upgrade`, `preset-upgrade`,
`preset-downgrade`). This is a clean rename — no deprecation window.

## What changed

### Update reason

`DiffUpdateEntry.reasons[0]` now uses `'quality-change'` for all music quality
moves. The direction and detail are carried in `DiffUpdateEntry.qualityChange`
(a new `{ reason, direction, reEncodes, targetBitrate, ... }` object).

### JSON breakdown keys

`updateBreakdown` gains direction-split keys for the quality axis:

```json
{
  "quality-change-up": 12,
  "quality-change-down": 3,
  "quality-change-suppressed": 0
}
```

The old `format-upgrade`, `quality-upgrade`, `preset-upgrade`, and
`preset-downgrade` keys are gone.

### Per-collection `qualityChanges[]`

Each music collection block now includes a `qualityChanges[]` array when
quality moves are planned. Each entry carries `track`, `direction`,
`reason` (classifier reason: `lossless-boundary`, `source-improved`,
`cap-up`, `cap-down`), `targetBitrate`, and optional `sourceBitrate`
/ `encodedBitrate` for diagnostics.

### `@podkit/core` exports

`classifyQualityChange`, `classifySourceBound`, `classifyDeviceBound`,
`QualityChange`, and `QualityTarget` are exported from `@podkit/core`.

## Migrating JSON consumers

| Old key / reason | New key / reason |
|-----------------|-----------------|
| `format-upgrade` | `quality-change` (direction: `up`, reason: `lossless-boundary`) |
| `quality-upgrade` | `quality-change` (direction: `up`, reason: `source-improved`) |
| `preset-upgrade` | `quality-change` (direction: `up`, reason: `cap-up`) |
| `preset-downgrade` | `quality-change` (direction: `down`, reason: `cap-down`) |
| `updateBreakdown["format-upgrade"]` | `updateBreakdown["quality-change-up"]` |
| `updateBreakdown["preset-upgrade"]` | `updateBreakdown["quality-change-up"]` |
| `updateBreakdown["preset-downgrade"]` | `updateBreakdown["quality-change-down"]` |

Inspect `update.qualityChange.reason` for the specific sub-reason when you
need to distinguish lossless-boundary from cap-up.

Per CLI breaking-change convention this is a minor bump.
