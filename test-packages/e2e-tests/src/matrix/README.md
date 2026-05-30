# E2E sync-matrix harness

Shared machinery for podkit's rule-based **prediction vs observation** matrix
tests. Full strategy, rationale, and roadmap: **backlog `doc-039 — E2E Sync
Matrix Testing Strategy`**. This README is the how-to for the code here.

## The pattern

A matrix walks a cross-product of axes (scenario, format, `--check-artwork`, …)
and, for each cell:

1. `predict(cell, pass)` → the outcome we *believe* podkit produces today, plus
   a `reason` string documenting *why*.
2. `runPass(pass)` → performs a real sync sequence and returns the *observed*
   outcome per cell.
3. The harness asserts `predict === observe`, cell by cell, with a precise diff
   on mismatch.

The prediction **is** the assertion — there is no `expectedBroken` flag. When a
code change flips a cell, the test fails and you either accept the change
(update the rule) or revert the regression. Cells whose `reason` mentions "bug"
encode current-but-wrong behaviour as a living regression catalogue.

## Modules

| File | Role |
|------|------|
| `axes.ts` | Typed axis values (`Scenario`, `Format`), the artist/title maps, `trackId`, cell builders. The home for new axes. |
| `devices.ts` | The **device axis**: `DeviceSpec` (id + raw capabilities + a fresh-target factory) for `[ipod-MA147, ms-echo-mini, ms-generic, ms-rockbox]`, and `deviceAddressing()` (path vs. `[devices.*]` stanza). |
| `reference-model.ts` | Capability functions (`sourceEmbedsArt`, `effectiveSupportedCodecs`, `deviceAction`, `codecOutcome`, `copyOpKind`, `artworkReaches`, `fileArtworkSurvives`, `expectedFileArtworkSize`) — a small model of podkit's sync semantics that `predict()` composes. **Not** per-format/per-device `if` branches. |
| `harness.ts` | Generic engine: op-classification, `opsForTrack`/`isArtworkIdempotent`/`isStableNoFileOp`/`formatOpsString`/`findDeviceTrack`, the cell diff, and `defineArtworkMatrix()` (per-pass `beforeAll` + `describe`/`it` generation, with `skip()` support). |
| `device-artwork.ts` | The **device-file artwork reader**: `probeFileArtwork` ffprobes the audio files written to a device for attached-picture presence + dimensions (works on either backend); `probeIpodDbArtwork` reads the iTunesDB ArtworkDB thumbnail sizes via `@podkit/ipod-db`. The only way to observe transfer-mode strip (#1) and resize (#3), which are invisible to the plan and to `TrackInfo.hasArtwork`. |
| `artwork-rules.ts` | The artwork concern: `predictDirectory` (device-swept) / `predictSubsonic` / `predictChange` (transition-swept) / `predictCompilation` / `predictTransferArtwork` / `predictResize`, `skipArtworkCell`, and the `observe*` sync sequences shared by the test files. |
| `codec-rules.ts` | The codec concern (a **decision matrix**): `predictCodec` + `observeCodecMatrix`. Reads the dry-run plan only — no transfer — so it asserts copy-vs-transcode op type and resolved lossy codec across the device × format × codec-config × transfer-mode product. |

The thin test files only choose a source, devices, and wire a predictor +
pass-runner into `defineArtworkMatrix`:

| File | Concern |
|------|---------|
| `art-matrix.test.ts` | directory artwork, device × scenario × format × pipeline |
| `art-matrix.docker.test.ts` | Subsonic artwork (Navidrome) |
| `art-matrix-change.test.ts` | artwork change detection, transition (updated/removed) × format; asserts the applied change converges (no churn loop) |
| `art-matrix-compilation.test.ts` | various-artist album → album-cache `(artist,album)` split, iPod; proves no collision by matching each anchor's DB-thumbnail colour to its own cover |
| `art-matrix-transfer.test.ts` | transfer-mode × artwork file strip/preserve (DB vs file), iPod |
| `art-matrix-resize.test.ts` | cover resize vs `artworkMaxResolution` × transfer-mode, generic + iPod |
| `codec.test.ts` | codec decision matrix (plan-only) |

## Why `predict()` composes the reference model

Per-format / per-device `if` branches explode combinatorially as axes are
added. Expressing rules as composition of capability functions
(`sourceEmbedsArt(scenario, format)`, and — later — `deviceAction`,
`deviceStoresArt`, `artSurvives`) keeps the rule set linear in the number of
capabilities, not the number of cells. When the reference model and the real
system disagree, exactly one is wrong; the cell's `reason` says which we
currently believe.

## The `--check-artwork` pass dimension

`defineArtworkMatrix` runs each matrix twice (`[false, true]`) — this is the
`passes` dimension. Each value gets its own `runPass`, and the predictor
receives the pass value. Override `passes` / `passLabel` for non-artwork
concerns.

## Host vs docker (filename gate)

The test runner gates on the `*.docker.test.ts` suffix (`--exclude` for host,
`--pattern` for docker), so Subsonic cells **cannot** share a file with host
cells. The directory and Subsonic matrices are therefore separate test files
that import the **same** `artwork-rules.ts` — duplication lives in neither.

## Pruning with `skip()` — and the structural-vs-bug distinction

`defineArtworkMatrix` takes an optional `skip(cell) → SkipDecision | null`. A
skipped cell becomes an `it.skip` and is never looked up in the observed map,
so `runPass` consults the same predicate to avoid syncing the pruned combo.

The crucial part is the **`kind`** on `SkipDecision`, because a skip can mean
two completely different things and they must never be confused:

| Constructor | `kind` | Meaning | Is it work? |
|-------------|--------|---------|-------------|
| `skipRedundant(reason)` | `redundant` | A no-op everywhere it's pruned (e.g. transfer mode on a database-artwork device). | No — permanent, correct by design. |
| `skipImpossible(reason)` | `impossible` | The cell cannot exist (e.g. sidecar art on a non-sidecar adapter). | No — permanent. |
| `skipEnvGated(reason)` | `env` | Needs an absent environment (Docker, real hardware). | No — situational. |
| `skipBug(reason, ref)` | `bug` | podkit is **currently broken** for this cell; fenced rather than failing the suite. | **Yes — deferred work.** |

This is how a developer reads the state of the world:

- **In the code:** every deferred bug is a literal `skipBug(` call with a
  `reason` and a `ref` (task id / doc section). Grep `skipBug(` to enumerate
  exactly what needs fixing. Structural prunings use the other three
  constructors and are self-evidently *not* work.
- **In the runner:** `skipBug` cells render as `[BUG] <ref> <cell> — <reason>`;
  structural skips render as `[skip:<kind>] <cell> — <reason>`. Run with a
  reporter that prints skip titles (e.g. `bun test --reporter=junit
  --reporter-outfile=out.xml`) and `grep '\[BUG\]' out.xml` to count/list them.

**The story you can rely on:** a green run where *every* skip is structural
(`[skip:redundant|impossible|env]`, zero `[BUG]`) means podkit matches the
model with no known bugs hidden behind a pass. Any `[BUG]` skip is outstanding
work that is present, counted, and documented — never silently dropped.
Likewise, a device with a whole-sync bug (e.g. echo-mini) stays *in* the axis
with its cells `skipBug`-fenced, so the deferred coverage is visible rather
than an invisible gap. Known bugs are catalogued in doc-039 §"Mass-storage
sync gaps".

## Surfacing deferred work (what bugs the suite has captured)

Two ways to list the deferred work, depending on whether you want to run
anything:

**Static — grep the rules (no run, instant).** Every deferred bug is a literal
`skipBug(` call carrying its reason and a `ref`:

```sh
grep -rn 'skipBug(' test-packages/e2e-tests/src
```

That is the canonical to-do list: each hit is a cell (or family of cells)
podkit is currently broken for, with a pointer to where it's tracked. A clean
grep means the matrices are fencing off no known bugs.

**Dynamic — run and list the `[BUG]` cells.** To see exactly which cells are
deferred (and confirm the structural skips are *only* structural), run with a
reporter that prints skip titles and filter:

```sh
# host matrices
bun run test:e2e --filter @podkit/e2e-tests -- art-matrix.test \
  -- --reporter=junit --reporter-outfile=/tmp/e2e.xml
grep -oE 'name="\[BUG\][^"]*"' /tmp/e2e.xml   # deferred-bug cells
grep -coE 'name="\[skip:[a-z]+\]'  /tmp/e2e.xml   # structural skips (expected > 0)
```

(The default reporter prints only counts, not skip titles — use junit, or run
`bun test <file>` directly with the same flags.) The healthy state is: tests
green, structural skips present, `[BUG]` cells either zero or matching the
known list in doc-039 §"Mass-storage sync gaps".

## Decision-assertion seam

`diffCell` compares object-valued fields structurally (JSON). The codec concern
already realises a slice of this: it asserts the resolved lossy codec
podkit *chose* (`json.codec`) and the planned op type, not just the artifact.
A richer `decisions` object (e.g. auto-selected transfer mode) will diff out of
the box once podkit exposes it (TASK-357). See doc-039 §"Two assertion
dimensions".

## Adding a new axis

1. Add the axis values + types to `axes.ts` (or `devices.ts` for devices).
2. Add the capability function(s) it affects to `reference-model.ts`.
3. Extend the concern's `predict()` to compose the new capability.
4. Extend the concern's `observe*` to vary the axis in the sync sequence (a
   fresh target per device × pipeline — never share one, or idempotency lies).
5. Add/extend the `skip(cell)` predicate to prune impossible/redundant/
   env-gated/known-bug combinations before the product explodes.
