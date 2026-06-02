---
id: TASK-373
title: 'predictSubsonic: device-kind branching when docker matrix sweeps mass-storage'
status: To Do
assignee: []
created_date: '2026-06-02 16:01'
labels:
  - testing
  - e2e
  - matrix
  - subsonic
dependencies:
  - TASK-142
references:
  - test-packages/e2e-tests/src/matrix/artwork-rules.ts
  - test-packages/e2e-tests/src/features/art-matrix.docker.test.ts
priority: low
ordinal: 99000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Background

`test-packages/e2e-tests/src/matrix/artwork-rules.ts:predictSubsonic` currently claims `deviceHasArtwork = albumHasArt` for every non-A scenario. This is correct for iPod targets — `setArtworkFromData` reliably writes the iTunesDB — and the docker matrix (`art-matrix.docker.test.ts`) only runs against iPod targets via the default `withTarget` factory.

The function's input cell type `ScenarioFormatCell` has no device axis. The iPod-only assumption is documented in the function's JSDoc but not enforced structurally.

## What breaks

If a future docker matrix sweeps mass-storage Subsonic targets (e.g. test Navidrome → echo-mini), `predictSubsonic` will predict art lands on the device for `C-sidecar` / no-embed-format cells where it actually does not — same divergence `predictDirectory` had before TASK-142 fixed it. `MassStorageTrack.setArtworkFromData` is a no-op for non-OGG containers, so adapter-fallback bytes are silently dropped on those targets.

## What to do (when picking this up)

Mirror `predictDirectory`'s device-kind branching:

```ts
const oggCopyPath = action === 'copy' && isOggExtension(`x${SOURCE_EXTENSION[format]}`);
const deviceHasArtwork =
  spec.kind === 'ipod'
    ? artworkReaches(albumHasArt, spec.capabilities)
    : oggCopyPath
    ? artworkReaches(albumHasArt, spec.capabilities)
    : artworkReaches(sourceFileEmbeds, spec.capabilities);
```

That requires extending `ScenarioFormatCell` (or the docker matrix's cell variant) with a `device` field — same shape as `PipelineDeviceCell` used by the host matrix. Or, add a new `predictSubsonicDevice` and have `predictSubsonic` call it with a hardcoded iPod spec for backwards compat.

Also: the matching `skipArtworkCell` mass-storage non-OGG-copy `C-sidecar` skipBug would need to extend to the docker matrix once the device axis is in.

## Why deferred from TASK-142

Building the device-kind branching defensively now produces untested code (no docker mass-storage sweep exercises it). The JSDoc warning is the cheaper signal until the matrix actually gains the device axis.

TASK-371 (mass-storage non-OGG taglib embed) and TASK-372 (artworkSink primitive) may close the underlying gap before this task even becomes relevant — in which case this task can be deleted as obsolete.
<!-- SECTION:DESCRIPTION:END -->
