---
id: doc-038
title: PRD — Portable Transfer Mode (Strict Manual UX)
type: specification
created_date: '2026-05-13 15:24'
tags:
  - prd
  - transfer-mode
  - portable
  - ux
  - sync-planner
---
# PRD — Portable Transfer Mode (Strict Manual UX)

## Status

Proposed. Companion to [PRD — Container-Aware Sync](doc-037) and dependent on [Codec and Container Design Principles](doc-036).

## Background

podkit has three established transfer modes (per `doc-011 - PRD-Transfer-Mode` and `doc-012 - Spec-Transfer-Mode-Behavior-Matrix`):

- **fast** — minimal work. Strip embedded artwork from copies; embed full-resolution artwork only if required by the device. Quick.
- **optimized** — middle ground. Resize artwork, light tag rewrites where needed.
- **portable** — preserve source bytes as much as possible. Goal: file on device is bit-identical to source.

Today, all three modes silently apply transformations as needed for device compatibility — transcoding for codec incompatibility, artwork resizing for device limits, sometimes container changes. The naming suggests "portable" preserves the source, but in practice it transforms whenever device constraints force it.

This PRD reframes portable mode as the **strict / manual** mode. fast and optimized stay "automatic and easy" — they apply whatever transformations are needed, picking smart defaults. portable mode flips the contract: any transformation must be approved by the user, either at sync time or persistently via config/preset.

The motivation is real-user-facing: a portable-mode user wants to be told what podkit would change, not have podkit change it silently. Their goal is "files I can yank off the device and back into my main library" — a goal incompatible with silent transformations.

## Goals

1. Portable mode is the user-facing "I want to know about every change" mode. It refuses to sync if any transformation would happen without explicit user consent.
2. fast and optimized are unchanged — automatic, no decisions required.
3. Transformations that need consent in portable mode: **transcoding**, **reboxing**, **artwork resizing**, **artwork source rewriting** (e.g. sidecar → embedded conversion).
4. Users can grant consent in three forms: per-sync flags, per-collection config, or device preset overrides that expand the device's accepted capabilities.
5. The refusal output is a structured, actionable list — not a generic error.

## Non-goals

- Changing the behavior of fast or optimized modes.
- Adding new transformation types. The set is: transcode, rebox, artwork resize, artwork source change. Any future transformations slot into the same consent surface.
- Forcing portable mode users to confirm transformations they've already accepted in config. Once accepted via device preset or per-collection setting, it's persistent.

## Design

### Decision matrix

Portable mode evaluates every potential transformation a sync plan would produce. For each, it asks: has the user consented?

| Transformation | Required when… | Consent surfaces |
|---|---|---|
| **Transcode** (codec change) | Source codec not in device's `supportedAudioCodecs` | Per-sync `--accept-transcoding`; per-collection `portable.acceptTranscoding = true`; device preset extends `supportedAudioCodecs` to include source codec (with user-supplied encoder); per-source decision to skip the file (`--skip-incompatible`) |
| **Rebox** (container change) | Source container not in accepted containers for codec (see Container PRD) | Per-sync `--accept-rebox`; per-collection `portable.acceptRebox = true`; device preset extends `containerConstraints` to accept source container |
| **Artwork resize** | Source artwork > device's `artworkMaxResolution` | Per-sync `--accept-artwork-resize`; per-collection `portable.acceptArtworkResize = true`; device preset increases `artworkMaxResolution`; per-source decision to keep artwork unchanged and accept device rejection |
| **Artwork source change** | Source has embedded artwork but device only reads sidecar (or vice versa) | Per-sync `--accept-artwork-source-change`; per-collection `portable.acceptArtworkSourceChange = true`; device preset adjusts `artworkSources` |

Each transformation requires its own consent. A user accepting `--accept-rebox` does not implicitly accept transcoding; they're orthogonal.

### Pre-flight output

When portable mode is requested, the sync command runs the plan analysis up to the point of detecting required transformations, then either proceeds (everything is accepted) or refuses with a structured report:

```
podkit sync --device echo-mini --mode portable

Cannot start sync in portable mode — 4 transformations would be required
without explicit consent:

  Transcoding (2 tracks)
    Source codec 'flac' not accepted by echo-mini in portable mode.
    Reason: echo-mini supports flac but only in native FLAC container,
    not OGG-FLAC.
    Affected:
      Music/Live/Hidden Mass.ogg
      Music/Live/Sundown.ogg
    Resolutions:
      --accept-rebox                    Allow reboxing for this sync.
      --skip-incompatible               Skip these tracks this sync.
      Edit echo-mini device override to accept FLAC-in-OGG:
        [devices.echo-mini.containerConstraints]
        flac = ["flac", "ogg"]

  Artwork resize (12 tracks)
    Embedded artwork (1500×1500) exceeds echo-mini's max 600×600.
    Affected:
      [first 3 paths, "... and 9 more"]
    Resolutions:
      --accept-artwork-resize           Resize for this sync.
      Edit echo-mini device override to allow larger artwork:
        [devices.echo-mini]
        artworkMaxResolution = 1500
      (verify your device renders this size — see device profile)

Re-run with the chosen flags, or update your config and try again.
Use --dry-run to preview transformations without writing.
```

### Sync-time vs config-time consent

Two channels:

- **Per-sync flag (`--accept-*`)**: One-off. Doesn't persist. Useful for "yes, this once."
- **Per-collection setting**: Lives in `[collections.<name>.portable]`. Persists. Useful for "for this music source, always accept rebox."
- **Device preset override**: Lives in `[devices.<name>]`. Persists. Useful for "my device actually supports this — fix the preset, don't keep asking." This is the preferred channel for any device capability that's a permanent fact rather than a per-sync preference.

The error output orders resolutions roughly by permanence:

1. Per-sync flag (one-shot)
2. Per-source skip flag (one-shot)
3. Device preset override (sticky, accurate)

### Config schema

New optional section per collection:

```toml
[collections.flacs.portable]
acceptTranscoding       = false   # Default false in portable mode
acceptRebox             = false
acceptArtworkResize     = false
acceptArtworkSourceChange = false
```

When any is `true`, that transformation requires no per-sync consent for the named collection. Other collections in the same config remain strict unless they have their own override.

The existing `[devices.<name>]` section already accepts `supportedAudioCodecs`, `artworkSources`, etc. Phase 2 adds `containerConstraints`. No new device-level keys required for this PRD — portable-mode consent re-uses the device preset surface that already exists.

### Mode resolution

The transfer mode resolves per-collection-per-device, same as today. portable strictness applies only to (collection, device) pairs that resolve to `portable`. A user can have one device on portable and another on fast in the same config; they don't interact.

### Doctor integration

The doctor `non-canonical-containers` check (Phase 2 of the Container PRD) extends to include portable-mode predictions:

```
[non-canonical-containers] FAIL
3 files with non-canonical containers would refuse to sync in portable
mode (active for collection 'flacs' → device 'echo-mini').
Run with --mode fast or set [collections.flacs.portable] acceptRebox = true
```

Doctor surfaces these issues before the user runs sync. Phase 1 of this PRD ships doctor integration alongside the planner refusal — they're the same predicate, reused.

## Open questions

1. **`--accept-all` umbrella flag?** Tempting for power users. Risk: defeats the point of strict mode. Lean towards no in the initial release; can add later if requested.
2. **Interactive prompt mode?** When the user runs `podkit sync` with portable in an interactive terminal, could prompt for each transformation type. Skipped in initial release — the structured refusal is sufficient.
3. **Behavior for `podkit sync --dry-run`** in portable mode: should it still refuse, or just show the structured report? Lean towards: dry-run prints the same structured report without refusing — the dry-run output IS the report.
4. **Per-source consent persistence.** If a user runs `--skip-incompatible` once, should podkit remember which tracks they skipped? Probably no — track-level skip persistence is its own large concept and overlaps with the future "exclude list" idea.
5. **Naming.** "portable" is established. "manual" is more accurate to the new semantics but renaming has its own cost. Lean towards keeping "portable" and documenting the strict-manual semantics under that name. Open to renaming if user confusion is reported.

## Acceptance criteria

- [ ] Portable mode refuses to start sync if any required transformation lacks consent.
- [ ] Refusal output lists each transformation type with affected file count and resolutions.
- [ ] Resolutions include per-sync flags, per-collection config snippet, and device-preset edit snippet.
- [ ] `--accept-transcoding`, `--accept-rebox`, `--accept-artwork-resize`, `--accept-artwork-source-change` flags grant per-sync consent.
- [ ] `[collections.<name>.portable]` config block grants persistent per-collection consent.
- [ ] Device preset overrides that eliminate the transformation (e.g. expand `containerConstraints`, raise `artworkMaxResolution`) make the transformation unnecessary — no consent needed because no transformation happens.
- [ ] fast and optimized modes are unchanged.
- [ ] Doctor `non-canonical-containers` check (Container PRD Phase 2) reports portable-mode-specific failures.
- [ ] `--dry-run` in portable mode prints the structured report without writing.
- [ ] Documentation: user guide page on "portable mode is strict mode," explaining the consent surfaces and when to use each.

## Sequencing relative to Container PRD

The two PRDs share the planner integration point but are largely independent:

- Container PRD Phase 2 (rebox + planner container awareness) is a prerequisite for portable's rebox refusal.
- Transcode consent, artwork resize consent, and artwork source consent do not depend on Container PRD.

If we wanted to ship portable-strict before Container PRD lands, the rebox transformation category is simply absent from the refusal output until Container ships. Likely cleaner to ship them together so the refusal output is complete from day one.

## Related documents

- [Codec and Container Design Principles](doc-036) — the codec/container model.
- [PRD — Container-Aware Sync (Phases 2 & 3)](doc-037) — the rebox infrastructure portable mode hooks into.
- `doc-011 - PRD-Transfer-Mode.md` — original transfer mode PRD.
- `doc-012 - Spec-Transfer-Mode-Behavior-Matrix.md` — existing mode behavior matrix; will need updating to reflect strict-portable.

## Risk and rollback

- **User confusion at first sync after upgrade.** Existing portable-mode users will see new refusals on libraries that previously synced silently. Mitigation: release-note callout; doctor surfaces the issue before sync.
- **Behavioral break for users who scripted portable mode in unattended jobs.** A cron job running `podkit sync --mode portable` may start failing if any non-canonical or oversized-artwork content is present. Mitigation: document `--accept-*` flags and per-collection config as the migration path.
- **Rollback.** Strict refusal is a single planner predicate. Reverting it restores today's permissive portable mode.

## Design-principle summary (for release-note copy)

> fast and optimized are automatic. Portable is manual. In portable mode, podkit will refuse to silently transform your files — every transcode, rebox, artwork resize, or artwork source change must be explicitly accepted, either for this sync (via flag), for this collection (via config), or by extending your device's preset to match what your device actually supports.
