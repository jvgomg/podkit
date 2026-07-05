---
title: "ADR-023: Lossy Reduction Is a Down-Only, Transfer-Mode-Defaulted Axis"
description: Lossy bitrate reduction is its own user-overridable axis (convert/preserve), defaulted by transfer mode, never up, never cross-codec without opt-in, with the quality preset as a hard ceiling. Reverses the "transfer-mode-primary" thesis.
sidebar:
  order: 24
---

# ADR-023: Lossy Reduction Is a Down-Only, Transfer-Mode-Defaulted Axis

## Status

**Accepted** (2026-06-30)

Revises the transfer-mode orthogonality stance of the **PRD: Transfer Mode** (doc-011) and **Spec: Transfer Mode Behavior Matrix** (doc-012); reaffirms the "compatible/device-native lossy → copy as-is" decision of [ADR-010](/developers/adr/adr-010-quality-preset-redesign); reshapes the lossy cap-enforcement portion of doc-051 and TASK-437.08. Stands on [ADR-022](/developers/adr/adr-022-sync-tag-sole-quality-truth) (the sync tag is the sole quality truth). See the full supersession map below.

> **This ADR reverses the thesis of the task that produced it.** TASK-437.09 was opened proposing "transfer mode is the FIRST policy; bitrate policy is secondary — transfer mode decides whether reduction is on the table." Design review reversed that: transfer mode stays the **metadata/artwork** axis it was designed to be (doc-011/012), and lossy reduction is a **separate, independent, user-overridable axis** for which transfer mode supplies only the *default*.

## Context

The bidirectional quality-change epic (TASK-437, PRD doc-051) shipped on the local branch `feat/quality-change-bidirectional`. Its final slice — TASK-437.08, "enforce lossy cap at add time" — broke **16 cells of the codec matrix**: device-native lossy sources (AAC on iPod, OGG/Opus on Rockbox) that ADR-010 mandates be **copied** were instead **transcoded down** to the cap on first add (even same-codec AAC→AAC) at `quality=low`. The regression slipped because the slice's e2e gate never ran the codec matrix.

Root-cause investigation found the conflict was not isolated to 437.08 — the epic's whole cap design had drifted from settled policy:

- **ADR-010** decided: compatible/device-native lossy → **copy as-is, always, regardless of preset**; never re-encode lossy→lossy for preference (the only sanctioned exception being incompatible OGG/Opus, transcoded at `min(source, preset)` with a warning). User docs reinforce it: *"Re-encoding MP3 to AAC only loses quality. podkit avoids this entirely."*
- **doc-011 / doc-012** declared transfer mode (`fast`/`optimised`/`portable`) **orthogonal** to the bitrate/codec transcode decision — it governed only artwork handling and copy-passthrough. The epic never considered transfer mode when deciding to re-encode.
- The epic also **re-encoded up** (lossy cap-up / source-improved), which is pointless for lossy — re-compressing to a higher bitrate cannot recover discarded information.

The branch was deliberately left RED for this redesign. This ADR records the model that resolves it.

## Decision drivers

- **Never silently degrade; never grow a file.** A re-encode must either shrink the file or be a forced necessity (the device cannot play the codec). podkit never performs a cosmetic lossy→lossy re-encode.
- **A quality setting is a ceiling and means what it says.** `quality=low` caps quality; podkit never silently exceeds a stated preset.
- **Honor the original where the device can play it** (ADR-010). The default for a device-native lossy source is to copy it untouched.
- **Idempotent sync.** Running sync twice with no source change produces no work on the second run.
- **Powerful but principled, clean-breaking config.** Sensible defaults derived from evident intent, with explicit overrides; no deprecation cycles.

## Decision

### 1. Two orthogonal axes

| Axis | Owns | Values |
|---|---|---|
| **Transfer mode** | Metadata / artwork strategy, relative to the device's storage (unchanged from doc-011/012) | `fast` (speed) · `optimised` (space) · `portable` (fidelity / self-contained) |
| **Lossy reduction** | Whether an over-cap lossy source is re-encoded down | `[bitrate].reduce = auto \| always \| never` |

The reduction axis is tri-state. `always` = **convert** (reduce over-cap lossy). `never` = **preserve** (never reduce; keep the original codec and bitrate where the device plays it natively). `auto` (default) **follows the transfer mode**: `fast`/`portable` → preserve, `optimised` → convert. An explicit `always`/`never` overrides the mode's lean, so `fast + always`, `portable + always`, and `optimised + never` are all reachable.

Transfer mode is therefore **not** primary for the reduce decision — it owns the metadata/artwork axis and *sets the default* of the independent reduction axis.

### 2. Down-only; the cap is a hard ceiling

podkit never re-encodes a lossy track **up** in bitrate, and never crosses codecs for mere preference. The quality preset's bitrate is a **ceiling** that bounds every target — including a `preserve` forced transcode. Raising the cap does **not** re-improve already-reduced tracks (see §7).

### 3. The unified target-bitrate rule

A single seam — `resolveTargetBitrate(sourceCodec, sourceBitrate, targetCodec, cap, axis, deviceMax)` — is shared by the **add path** and the **re-sync (device-bound) path**, so a track decided one way on add is never re-decided differently on re-sync (the failure mode that bit 437.08).

`cap*` is the **effective cap** — `min(cap, deviceMax)` when the device declares a `maxAudioBitrate`, else the quality `cap`. `deviceMax` is a hard *device constraint* (a bitrate the device cannot store or play), distinct from the quality preset (a user preference), so it is enforced on every transcode target and forces even a `preserve` device-native source above it to reduce.

| Case | Target |
|---|---|
| device-native + **preserve** | **copy** (original codec + bitrate); or reduce to `cap*` iff `source > deviceMax` |
| device-native + **convert** | reduce iff `source > cap* × (1 + tol)` (or `source > deviceMax`) → `cap*`; else **copy** |
| incompatible codec (necessity) + **preserve** | `min( round(source × eff[target] / eff[source]), cap* )` |
| incompatible codec (necessity) + **convert** | `min( source_raw, cap* )` |
| lossless source | transcode to the quality preset (unchanged) |

All targets are **down-only** and **cap-bounded**. (The uniform `deviceMax` ceiling — folding it into `cap*` on every row rather than only the preserve-necessity target — was completed under TASK-456; no device profile populates `maxAudioBitrate` yet.)

### 4. Source-proximity tolerance is a percentage

The reduce gate is `reduce iff source > cap × (1 + tol)`, default `tol = 0.25`. It is **source-side only**: it guards the wobbly ffprobe source bitrate. The other comparison — the device's **recorded** bitrate (the sync tag, deterministic because podkit wrote it) against the cap, the "drift" — is **exact (0)**: a cap change you make applies fully on the next sync.

The tolerance is a **percentage**, not a bitrate-step ladder. The noise it guards (VBR variance) is proportional (~30% spread per ADR-010), so a proportional guard is the right shape; the standard bitrate ladder is already roughly geometric, so `0.25` reproduces the "don't reduce within ~a tier" intent (`160 @128 → reduce`, `140 @128 → copy`) without a ladder table or off-ladder special cases.

### 5. Codec selection and efficiency

The transcode target codec is the **resolved lossy preference stack** (`[codec] lossy`, constrained to device-supported codecs) — **never a hardcoded AAC assumption**. A convert that crosses codecs is accepted (the user opted in); podkit does **not** try to preserve the source codec once a re-encode is happening.

Codec efficiency is content- and encoder-dependent and is therefore applied in **exactly one place**: the **preserve-necessity** target, where the goal is to match the source's *quality* in a codec we are forced to switch to. Everywhere else the decision is about **file size**, which is raw kbps regardless of codec, so efficiency is deliberately **not** applied (using it in the tolerance would reduce a track for no space gain; using it in the convert target would inflate the file).

Efficiency factors (kbps relative to AAC for equal quality; internal constants behind the seam, overridable later):

| Codec | `eff` |
|---|---|
| opus | 0.75 |
| vorbis | 0.90 |
| aac | 1.00 |
| mp3 | 1.30 |

### 6. CBR/VBR encoding-mode changes do not re-encode lossy tracks

A standalone CBR↔VBR flip never re-encodes a **lossy-source** track: doing so is a lossy→lossy degradation and can *grow* the file (a VBR file at nominal 128, actual ~115, re-encoded to 128 CBR comes out larger). The CBR/VBR encoding-mismatch precondition survives **only** for **lossless-source** transcodes, where the re-encode reads the lossless source and is size-governed by the cap. Combined with §2/§4 (a convert always lands below a source that exceeds the cap), this guarantees a lossy file is **never** grown.

### 7. Config surface and surfacing

```toml
[bitrate]
reduce = "auto"      # auto (follow transfer mode) | always (convert) | never (preserve)
tolerance = 0.25     # reduce only when source exceeds cap by > this fraction (0 = exact)
```

`[bitrate].reduce` / `[bitrate].tolerance` cascade global → device → CLI (`--bitrate-reduce`, `--bitrate-tolerance`). The old `[bitrate].sync` five-mode enum (`off`/`match-cap`/`match-all`/`up-only`/`down-only`), the `--bitrate-sync` flag, the `bitrateTolerance` knob, and the `toleranceUp`/`toleranceDown` fields are **removed** (clean break — a minor version bump for `podkit` and `@podkit/core`, no migration).

Because reduction is down-only, a track that was reduced under an old cap and now sits **below** a raised cap is **not** lifted automatically. It is reported through the existing **report-only** channel ("N tracks below your quality target; `--force-transcode` to lift them") — visible, never automatic, and low-noise (only previously-reduced tracks qualify).

## Consequences

### Positive

- **Safe by construction.** A lossy file is never grown and never cosmetically degraded; the convert tolerance and the down-only/cap-bounded rule make every reduction a genuine shrink.
- **ADR-010 honored again.** Device-native lossy is copied untouched by default (`preserve`); converting it is an explicit, named opt-in.
- **Simpler classifier.** Cap-up, source-improved-as-up, the lossy CBR/VBR branch, and the five-mode policy enum all disappear. The lossy device-bound collapses to one comparison plus the shared target-bitrate seam.
- **Predictable config.** Two knobs with intent-derived defaults; the quality preset is a real ceiling.

### Negative

- **Raising the cap needs `--force-transcode`.** Already-reduced tracks do not climb when the cap rises; they are reported, not lifted.
- **`preserve` and `convert` converge for big forced sources.** With the cap as a hard ceiling, a large incompatible-codec source lands at the cap under either axis value; `preserve` earns its keep only *below* the cap (it stops a small forced source from being under-encoded).
- **Breaking config change.** `[bitrate].sync` / `bitrateTolerance` users must move to `[bitrate].reduce` / `tolerance`.

## Considered and deferred

- **Efficiency-weighted *tolerance*** — rejected. The reduce decision is about space, and space is raw kbps; efficiency-weighting it would reduce tracks for ~zero space gain (e.g. Opus@128 → AAC@128).
- **A VBR/CBR efficiency sub-factor** — deferred. The source-file bitrate is reliable for size (filesize/duration) even for VBR; the percentage tolerance plus recording the *nominal* (not measured) target in the sync tag handle VBR. Stacking a VBR/CBR factor on the codec table compounds fuzziness for marginal gain.
- **Per-device `deviceMax` bitrate data** — the seam exists now (an optional capability; absent → unbounded → preserve-necessity targets the source bitrate), but no device data is wired yet.
- **`preserve` overriding the cap for forced transcodes** — rejected. The quality preset is a ceiling; a `quality=low` user getting 320 kbps files would be the more surprising outcome.

## Supersession map

- **doc-011 / doc-012 (transfer mode):** *partially* revised. Transfer mode remains the metadata/artwork axis exactly as specified, but it is no longer fully orthogonal to bitrate — it now carries the **default** for the reduction axis. It does **not** "dictate" reduction (the task's claim); the explicit `[bitrate].reduce` overrides it.
- **ADR-010:** reaffirmed. "Compatible/device-native lossy → copy as-is" is honored under `preserve` (the default in `fast`/`portable`); `convert` is the explicit opt-in to lossy→lossy reduction.
- **ADR-022:** unchanged. The sync tag is the sole quality truth; untagged tracks are opted out; `--force-sync-tags-transcode` is the explicit adoption path.
- **doc-051 / TASK-437.08:** reshaped. The add-path cap becomes convert-gated, tolerance-bounded, and shares the `resolveTargetBitrate` seam with the re-sync path.
- **Removed:** lossy cap-up, `source-improved`-as-up (folds into ordinary content-change detection).

## Related decisions

- [ADR-010](/developers/adr/adr-010-quality-preset-redesign) — quality preset redesign (device-aware presets, sync tags).
- [ADR-022](/developers/adr/adr-022-sync-tag-sole-quality-truth) — the sync tag is the sole quality truth.
- doc-011 / doc-012 — Transfer Mode PRD and behavior matrix.
- doc-036 — Codec and Container Design Principles (codec/container axes, canonical containers).
- doc-051 — Bidirectional quality-change PRD.
- `documents/architecture/sync/upgrades.md` — the quality classifier mechanics this ADR reshapes.
- `documents/principles/transcoding.md`, `documents/principles/transfer-modes.md` — the principle-level statements this ADR instantiates.
