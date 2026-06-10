---
id: TASK-419
title: >-
  Bidirectional quality-change: re-encode iPod tracks when bitrate or format
  drifts from cap
status: To Do
assignee: []
created_date: '2026-06-10 14:45'
labels:
  - sync
  - transcoding
  - quality
dependencies: []
references:
  - documents/architecture/sync/upgrades.md
  - packages/podkit-core/src/sync/engine/upgrades.ts
  - packages/podkit-core/src/sync/music/handler.ts
  - packages/podkit-core/src/sync/music/classifier.ts
  - packages/podkit-core/src/sync/music/transfer.ts
priority: medium
ordinal: 134000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Goal

Make iPod-side bitrate match the device's effective transcode cap **in both directions** by default. Today only the upgrade direction fires (source bitrate > iPod bitrate). When a user lowers their bitrate cap, format-upgrades a device, or re-rips the source at a different quality, existing iPod tracks stay stale. Extend the quality decision so a sync re-encodes existing tracks down (or up) to whatever the current policy says.

Single user-facing event name: **`quality-change`**. Replaces / generalises today's `quality-upgrade`. Direction is carried in the event payload.

## Current state

- `quality-upgrade` fires when `source.bitrate > ipod.bitrate` (`sync/engine/upgrades.ts:230-263`).
- Downgrade has no classifier path: lowering the cap does not re-encode anything.
- `format-upgrade` fires on source-format ≠ device-format; suppressed when transcode is active (the transcode itself subsumes the format swap).
- Bitrate is now correctly written on copy + upgrade (TASK-360.03 — the post-upgrade `prepared.bitrate ?? source.bitrate` fix closed the infinite loop and unblocks bidirectional comparison).
- VBR and CBR are treated identically — the device-stored bitrate is the value libgpod wrote at transcode/copy time; the classifier doesn't reason about encoding mode.

## Proposed behaviour

### Effective target bitrate

For a given track at sync time, the effective target is:

```
effective_target = lossless_source ? cap : min(source.bitrate, cap)
```

`cap` comes from device config (transcode quality preset → bitrate). When source is lossless, only cap matters. When source is lossy, the target never exceeds the source.

### Triggers for `quality-change`

A track on the device re-encodes when ANY of these holds (and the configured policy permits the resulting direction):

1. **Format mismatch** — source format ≠ device format. Always fires when bitrate.sync ≠ off (per "Format mismatch always wins" decision below).
2. **Cap moved down** — `ipod.bitrate > effective_target`. The device file is at a higher bitrate than current policy allows.
3. **Cap moved up** — `ipod.bitrate < effective_target` AND `source.bitrate >= effective_target`. The device file is below policy and the source can support a higher re-encode.
4. **Source improved** — `source.bitrate > ipod.bitrate` (today's `quality-upgrade` path). Subsumed by cap-up when the effective target also moves; this exists for the case where cap is already high and the change was driven entirely by the source.

A track does NOT re-encode automatically when:

5. **Source bitrate dropped** — `source.bitrate < ipod.bitrate` AND cap unchanged. This means re-encoding lossy at a lower bitrate (quality-destroying); leave the device track in place. Logged in the JSON output so users can see it; default text output shows a one-line summary; verbose shows full details. User opts in via `bitrate.sync = "match-all"` (see schema).

### Format mismatch always wins

If `bitrate.sync = off` but format mismatches, `quality-change` still fires to swap the format. The bitrate policy controls bitrate-driven re-encodes only — format correctness is a precondition, not a policy choice.

## Config schema (per device)

```toml
[devices.<name>.bitrate]
sync = "match-cap"   # off | match-cap | match-all | up-only | down-only
```

| Value | Direction | Triggers |
|-------|-----------|----------|
| `match-cap` (default) | both | cap-moved-down, cap-moved-up, source-improved. Source-down logged only. |
| `match-all` | both | all of `match-cap` PLUS re-encode on source-down. |
| `up-only` | up only | cap-moved-up, source-improved. Cap-moved-down and source-down logged only. |
| `down-only` | down only | cap-moved-down. Up triggers logged only. |
| `off` | none | bitrate triggers never fire. Format-mismatch still fires. |

CLI override: `podkit sync --bitrate-sync=<value>` mirrors the config value for one run. Reuses the existing config-override pattern (no new dedicated flag — argument sets the config value).

## Classifier output

`detectQualityChange()` (replaces `detectUpgrades`) returns either `null` (no change) or:

```ts
{
  reason: 'format-mismatch' | 'cap-down' | 'cap-up' | 'source-improved' | 'source-down-suppressed';
  direction: 'up' | 'down' | 'format-only';
  oldBitrate: number;
  newBitrate: number;
  sourceBitrate: number | undefined;
  cap: number;
}
```

`source-down-suppressed` is emitted only for visibility in the JSON output when `bitrate.sync = match-cap`; the sync engine treats it as no-op for the track.

## Sync event surface

- New event: `quality-change` with payload `{ direction, reason, oldBitrate, newBitrate }`.
- Deprecate `quality-upgrade` — keep emitting it alongside `quality-change` for one minor version (with both pointing at the same track), then drop. Update the event consumers (CLI rendering, JSON output).
- The text-mode default sync output prints a one-line per direction summary ("3 quality-change ↓, 1 quality-change ↑, 2 source-down suppressed"). Verbose mode lists each track + reason.

## JSON output schema

`sync --json` output gains a `qualityChanges[]` array per collection:

```json
{
  "qualityChanges": [
    {
      "track": "...",
      "reason": "cap-down",
      "direction": "down",
      "oldBitrate": 256,
      "newBitrate": 128,
      "sourceBitrate": 320,
      "cap": 128
    }
  ]
}
```

Includes `source-down-suppressed` entries so external tools can surface them.

## Execution path

- Existing transcode/copy executor in `transfer.ts` handles the actual re-encode — `transferUpgradeToIpod` already replaces the device file with a new transcode. The change is in the classifier deciding when to invoke it.
- Downgrade re-encode uses the same transcode preset chain as a fresh add. No new transcode preset logic.
- Lossless source + cap change → transcode at new cap (existing path).
- Lossy source + cap-down → re-transcode the source to the new cap.

## Migration / first-sync

No explicit migration. Behaviour changes on first sync after upgrade — that's the design. Sync output makes the change visible (the new event count + JSON entries). When source-bitrate-drop is detected on an existing track with no sync-tag history, fall back to direct compare; emit the suppressed-info entry; no quality-destroying re-encode unless user opts in via `match-all`.

## Out of scope (follow-ups)

- **Source lossy → lossless detection**: would be ideal trigger for re-transcode at higher quality, but requires source-format tracking in sync-tag or per-sync re-probing. File separately.
- **Per-collection bitrate policy**: this task is per-device only. If users want different policies per collection-on-device, file separately.
- **Drift tolerance**: rejected — VBR and CBR are treated identically (device-stored bitrate is the value libgpod wrote), so there's no encoder-jitter floor to absorb. A future task can add tolerance if real-world friction emerges.

## Implementation hints

- Rename `detectUpgrades` → `detectQualityChange` in `engine/upgrades.ts`; keep both exported for one version with a deprecation comment.
- Add `bitrateSync: BitrateSyncMode` to the device config schema validator.
- Add the CLI option in `packages/podkit-cli/src/commands/sync.ts` mirroring existing config-override flags.
- Update `documents/architecture/sync/upgrades.md` to describe both directions + the source-down handling.
- Tests: e2e for each transition (cap-down, cap-up, source-improved, source-down with both `match-cap` and `match-all`); unit tests for the classifier; tests for each `bitrate.sync` mode.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `detectQualityChange` classifier in `engine/upgrades.ts` returns the correct `{reason, direction}` for each of: format-mismatch, cap-down, cap-up, source-improved, source-down-suppressed; covered by unit tests across each `bitrate.sync` mode (off / match-cap / match-all / up-only / down-only)
- [ ] #2 Device config schema accepts `[devices.<name>.bitrate].sync` with valid values `off | match-cap | match-all | up-only | down-only`; default is `match-cap` when unset; invalid values fail config validation with a clear error
- [ ] #3 CLI: `podkit sync --bitrate-sync=<value>` overrides the device config for one run; reuses existing config-override flag pattern (no new dedicated flag added)
- [ ] #4 Sync engine emits `quality-change` events with `{direction, reason, oldBitrate, newBitrate}` payload; existing `quality-upgrade` continues to fire in parallel for one minor release, then is removed in a follow-up
- [ ] #5 Re-encode execution path: downgrade uses the same `transferUpgradeToIpod` transcode path as upgrade; no new executor code beyond updating which trigger conditions invoke it
- [ ] #6 Format-mismatch always fires `quality-change` even when `bitrate.sync = off` (format correctness is a precondition, not a policy choice)
- [ ] #7 Source-down case (source.bitrate < ipod.bitrate, cap unchanged) under `match-cap`: track is NOT re-encoded; JSON output records a `source-down-suppressed` entry; text output shows a count in the per-collection summary; verbose lists each affected track
- [ ] #8 Lossless source + cap change re-encodes at the new cap; lossy source + cap-down re-encodes the source to the new cap; both verified by e2e tests
- [ ] #9 Documents/architecture/sync/upgrades.md updated to describe bidirectional behaviour, the five `bitrate.sync` modes, and source-down handling
- [ ] #10 E2E tests in `upgrades.test.ts` cover: cap-down re-encodes; cap-up + sufficient source re-encodes; source-down under match-cap leaves track alone; source-down under match-all re-encodes; bitrate.sync=off blocks bitrate re-encode but format-mismatch still fires
<!-- AC:END -->
