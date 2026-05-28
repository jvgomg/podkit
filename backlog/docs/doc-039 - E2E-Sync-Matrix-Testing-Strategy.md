---
id: doc-039
title: E2E Sync Matrix Testing Strategy
type: specification
created_date: '2026-05-28 07:51'
tags:
  - testing
  - e2e
  - matrix
  - sync
  - strategy
---
## Purpose

podkit's sync behaviour is the cross-product of many variables: source adapter, audio format, artwork placement, device, codec preference, quality preset, transfer mode, and the `--check-artwork` flag. The `art-matrix*` test files proved a powerful pattern for one slice of this space (artwork). This document defines how to generalise that pattern into a coherent, scalable e2e matrix-testing strategy — what the axes are, how to control the combinatorial explosion, what we assert, and how to organise it in the codebase.

This is a living strategy doc. The axis catalogue and reference model grow as podkit grows. Code is the source of truth for *what* is tested; this doc explains *why* and *how to extend*.

Related: [[doc-012]] (Transfer Mode Behavior Matrix), [[doc-014]] (Operation Types & Sync Tags), [[doc-036]] (Codec & Container Design Principles).

## The matrix pattern (what we already have)

`test-packages/e2e-tests/src/features/art-matrix*.test.ts` established a **rule-based prediction vs observation** harness:

1. A `predict(cell) → Expected` function encodes podkit's *believed* behaviour for every cell of an axis cross-product. Each cell carries a `reason` string documenting *why* the outcome is what it is.
2. A pass runner performs a real sync (and a second idempotency sync), then reads the device state and the dry-run operations to produce `Observed`.
3. The test asserts `predict === observe` cell-by-cell, emitting a precise diff on mismatch.

The key property: **the matrix is a frozen snapshot of current behaviour, and `predict()` is the assertion.** When a code change flips a cell, the test fails and forces the maintainer to either accept the change (update the rule) or revert the regression. There is no `expectedBroken` flag — bugs are encoded as current behaviour with a `reason` that says "bug", which doubles as a living regression catalogue (this is exactly how TASK-355's subtasks were filed and closed).

## Current-state audit

| Variable | Where exercised today | Matrix form? |
|---|---|---|
| artwork scenario × format × `--check-artwork` | `art-matrix.test.ts`, `art-matrix.docker.test.ts`, `art-matrix-change.test.ts` | ✅ yes |
| source adapter (directory / subsonic) | split across `*.test.ts` (host) and `*.docker.test.ts` | partial — duplicated rules across two files |
| codec preference | `codec-preference.test.ts` | ❌ imperative |
| quality preset | `preset-change.test.ts`, `mass-storage-sync.test.ts` | ❌ imperative |
| transfer mode | `mass-storage-sync.test.ts` | ❌ imperative |
| device model (iPod) | `models/model-tests.test.ts` (DB-init + capability report only, no sync) | ❌ not sync |
| mass-storage device (echo-mini / generic) | `mass-storage-sync.test.ts`, `codec-preference.test.ts` (bespoke TOML per file) | ❌ imperative, not an axis |

Two abstractions exist but the matrices don't use them: `TestSource` (`e2e-shared/src/test-source.ts`) and `IpodTarget` (`e2e-tests/src/targets/`). `IpodTarget` is iPod-only and hardwired to model `MA147`; `TargetOptions` carries only `name`. **Device is therefore not an axis anywhere in the sync matrices.**

Duplication: `art-matrix.test.ts` and `art-matrix.docker.test.ts` independently re-declare `FORMATS`, `FORMAT_TITLE`, `SCENARIO_ARTIST`, the two-sync idempotency loop, the op-classification sets, and the "Cell X/Y mismatched" diff formatter. The change matrix duplicates a third time.

## The transcode-path reframe (a controlled axis, not an accident)

The artwork matrix's `format` axis secretly conflates two independent things: the container's embed mechanism **and** whether the track is copied or transcoded. Under the default `quality=high` on a 5G iPod, lossless formats transcode to AAC, mp3/aac direct-copy, ogg/opus transcode — so "embedded art survives" tests a *different code path per format*, invisibly. A transcode-only regression could hide behind a copy-path pass (or vice versa).

**Resolution: make transcode-vs-copy an explicit, controlled axis via rigid codec config.** Two pinned configurations expose both paths uniformly:

- **Copy-everything**: `quality=max`, lossless stack `['source']`, device that natively supports every source codec → every format direct-copies → asserts "art survives a byte-for-byte copy".
- **Transcode-everything**: `quality=high`, lossy `['aac']` → lossless + incompatible formats transcode to AAC → asserts "art survives FFmpeg re-embed".

This cleanly separates the **source-side question** (does the adapter *read* the embedded art?) from the **device-side question** (does the executor *preserve / re-embed* it through the chosen action?). The same reframe applies to any outcome that depends on the action taken, not just artwork.

## Two assertion dimensions

The matrix should assert two distinct kinds of thing. Today only the first exists.

### 1. Outcome assertions (have today)

"Did the right bytes/metadata land on the device?" — track present, `deviceHasArtwork`, idempotent second sync, codec on device, file extension, sync-tag fields. Observed by reading device state (`getTracks()`) and dry-run operations.

### 2. Decision assertions (future work — needs podkit changes or tooling)

"Did podkit *make the right decision* given the inputs?" — e.g. *"with device D and codec config C and no explicit transfer mode, did podkit auto-select transfer mode M?"*, or *"did it choose direct-copy vs transcode for format F on device D?"*. This is about the **reasoning**, not just the artifact.

This dimension is currently hard to assert because podkit doesn't fully expose its decisions. Options, in rough order of effort:

- **Parse `--json` sync output.** The dry-run already emits `operations[]` with `type` and `reason`. Extending the JSON to also surface the *resolved* config (chosen transfer mode, resolved lossy/lossless codec, per-track classification) would let the matrix assert decisions directly. Requires podkit changes to the JSON schema.
- **Inspect sync tags on the synced output.** The `[podkit:v1 …]` comment tag already records `quality`, `codec`, `transfer` (see [[doc-014]]). A test-side sync-tag reader could assert the decision was persisted correctly. Requires a sync-tag-reading test helper (partially exists in `artwork-sync-tags.test.ts`).
- **A dedicated `podkit sync --explain` / plan-dump mode.** Cleanest long-term: a machine-readable decision trace. Largest podkit change.

**Decision assertions are explicitly deferred.** They are the most valuable long-term extension of this strategy, but they need a podkit capability (richer JSON or a plan-dump) that does not exist yet. This doc records the intent so the harness is designed with a seam for it (the `observe()` step should be able to return a `decisions` block alongside `outcomes`).

## The reference model (capability composition, not name branches)

`predict()` must not grow a forest of `if (format === 'wav')` / `if (device === 'echo-mini')` branches — that explodes combinatorially as axes are added. Instead, express the rules as composition of small capability functions that mirror podkit's real semantics:

- `sourceEmbedsArt(format, scenario)` — does the source *file* carry embedded art? (a fixture property)
- `deviceAction(format, device, codecCfg)` — `copy | transcode-to-X | reject` (a reference mirror of the real classifier)
- `deviceStoresArt(device)` — `database | embedded | none`
- `artSurvives(action, device)` — does art reach the device given the action and its storage model?
- `autoTransferMode(device, codecCfg)` — what mode podkit should auto-select (feeds decision assertions later)

`predict()` becomes a thin composition of these. This *is* a reference model of podkit's sync semantics; the matrix's whole job is to assert the real system matches the reference model. When the two disagree, exactly one of them is wrong — and the `reason` string says which we currently believe.

## Combinatorial control

The full cross-product is large: ~8 formats × 4 artwork scenarios × 2 adapters × 3+ devices × 3 quality × 3 transfer × 2 check-artwork ≈ 3,500 cells. We do not run all of it. Two mechanisms keep it tractable:

- **`skip(cell) → reason | null`** alongside `predict()`. Prunes:
  - *Impossible* combos (e.g. sidecar-only artwork is meaningless for an adapter that can't read sidecars).
  - *Redundant* combos (transfer mode is a no-op on non-embedded-art devices; don't cross it there).
  - *Environment-gated* combos (subsonic needs Docker; real device needs hardware).
- **Concern-scoped axis subsets.** Each matrix file fixes most axes and varies only the few relevant to its concern (the artwork matrix need not vary quality across all 3 presets; the codec matrix need not vary all 4 artwork scenarios). The full product is never materialised — each concern picks its slice.

## Device axis: a generalised SyncTarget

The prerequisite for device-as-an-axis is replacing the iPod-specific `IpodTarget` with a `SyncTarget` that covers both iPod and mass-storage devices:

- `kind: 'ipod' | 'mass-storage'`, `model?`, and a `capabilities` snapshot (supported codecs, artwork storage model, max artwork resolution, video support).
- A normalised `getTracks(): TrackInfo[]` that works for both backends — iPod via `@podkit/gpod-testing`, mass-storage via filesystem walk + ffprobe.
- Construction from the existing capability sources: `@podkit/compatibility` `TESTABLE_MODELS` for iPod, `@podkit/devices-mass-storage` `BUILT_IN_PRESETS` for mass-storage.

With this, the artwork/codec/transcode matrices can run across `[ipod-MA147, mass-storage-echo-mini, mass-storage-generic]` and `predict()` keys off `target.capabilities` rather than a hardcoded model. This is the **largest single piece of work** in the strategy.

## Proposed code organisation

Split by **concern, not by adapter**. Extract the shared machinery so rules live exactly once.

```
test-packages/e2e-tests/src/matrix/
  axes.ts             # typed axis enums + cartesian-product helper
  harness.ts          # runMatrix(): product, 2-sync idempotency, op-classify, diff-report
  reference-model.ts  # capability fns: sourceEmbedsArt, deviceAction, deviceStoresArt, artSurvives, autoTransferMode
  skip.ts             # prune invalid / redundant / env-gated cells → reason | null
  README.md           # philosophy, axis meanings, invalid-combo rules, how to add an axis
  artwork.rules.ts    # predict() for the artwork concern — imported by BOTH host + docker files
  artwork.host.test.ts
  artwork.docker.test.ts
  codec.rules.ts + codec.test.ts
  transcode-fidelity.rules.ts + ...
```

Two structural notes:

- **The docker filename gate is a hard constraint.** The test runner splits on the `*.docker.test.ts` suffix (`--exclude` for host, `--pattern` for docker). Subsonic cells therefore *cannot* share a file with host cells. Keep host/docker as two thin test files that import the same `.rules.ts` — this removes rule duplication while respecting the runner. (Re-plumbing the runner to tag-gate instead of filename-gate is out of scope.)
- **`harness.ts` owns the duplicated machinery**: the cartesian walk, the fresh-sync + idempotency-sync sequence, the artwork op-classification sets, and the `Cell X/Y mismatched expectations` formatter — all currently copy-pasted across three files.

## Concrete test gaps to close (with existing variables)

Independent of the reorg, these are real missing cells:

1. **Transfer mode × artwork** — `optimized` strips embedded art on DB-artwork devices; `portable` preserves it. Absent from the artwork matrix entirely.
2. **Copy-path vs transcode-path × artwork** — the rigid-codec reframe above.
3. **`artwork-removed` transition** — the change matrix covers added/updated but never source-loses-art.
4. **Artwork resize** — embedded-art devices resize; iPod has `artworkMaxResolution`. Not asserted.
5. **Compilation / album-artist × album-cache** — the album cache keys on `(artist, album)`; various-artist compilations are a collision/split risk (relevant after the TASK-355.03 cache rework).

## Migration plan (phased, de-risked)

1. **Strategy doc + backlog** (this doc + tasks). Align before code.
2. **Extract `harness.ts` + `reference-model.ts` against the EXISTING artwork matrix.** Prove it reproduces today's green cells with zero behaviour change. Lowest-risk first concrete step.
3. **Add the rigid-codec transcode-vs-copy axis** to the artwork concern.
4. **Generalise `SyncTarget`** (iPod + mass-storage, capability-carrying). Largest piece; unblocks the device axis.
5. **Add device + transfer-mode axes**; migrate `codec-preference` / `mass-storage-sync` imperative tests into concern matrices.
6. **Future: decision assertions** — gated on podkit exposing resolved-config in `--json` or a plan-dump; add the `decisions` block to `observe()`.

## Tradeoffs & risks

- This refactors working, green tests. Payoff: adding an axis becomes declarative instead of a new bespoke file. Risk: churn on passing tests + an abstraction that over-fits if axes are guessed wrong. **Mitigation: build the harness against the existing artwork matrix first (phase 2) and prove cell-for-cell parity before adding anything.**
- The reference model is a second implementation of podkit's classifier logic. If it drifts from the real classifier it produces false failures. **Mitigation: keep it minimal and capability-driven; where feasible, have the reference model and the real code share the same capability tables (`@podkit/device-types`, `@podkit/devices-*`).**
- Combinatorial blow-up if `skip()` is under-specified. **Mitigation: concern-scoped subsets; never materialise the global product.**

## Open questions

- Decision-assertion mechanism: richer `--json` vs sync-tag inspection vs `--explain` plan-dump — which does podkit adopt? (Needs a separate PRD; likely the JSON route is cheapest first.)
- Should the reference model live in `e2e-tests` or be promoted to a shared package so unit tests can reuse it?
- Real-hardware (`IPOD_TARGET=real`) and VM (`e2e-vm-tests`) targets — do they participate in the same matrix harness, or stay separate smoke suites?
