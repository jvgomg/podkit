---
title: 'principles: transcoding'
description: The bitrate and codec axis — down-only reduction, convert vs preserve, the cap as a hard ceiling, the source-proximity tolerance, codec selection from the resolved stack, and where codec efficiency does and does not apply.
sidebar:
  order: 3
---

How podkit decides whether to re-encode audio, to what bitrate, and in what
codec. This is the bitrate/codec axis — separate from, and composed with,
the metadata/artwork axis ([transfer-modes](./transfer-modes.md)).

The decision of record is
[ADR-023](../../adr/adr-023-lossy-reduction-down-only.md); the classifier
mechanics live in `documents/architecture/sync/upgrades.md`; the codec/container
type-model lives in doc-036. This doc states the principles those instantiate.

---

## 1. Reduction is down-only

podkit never re-encodes a lossy file **up** in bitrate. Re-compressing to a
higher bitrate cannot recover discarded information — it only inflates the file.
A lossy source either stays as it is or is reduced; it is never lifted. Raising
a quality cap therefore does not re-improve already-reduced tracks; they are
**reported** (with `--force-transcode` as the explicit lift), never silently
re-encoded. See [library-safety](./library-safety.md) §4, §6.

A **lossless** source is a different case: it is transcoded to the quality
preset as a matter of course (the device cannot store the lossless original, or
the preset asks for a lossy copy). That is not a "reduction" of a lossy file —
it is the lossless→lossy boundary, and the preset is its target.

## 2. Convert vs preserve

For a source the device plays **natively**, the choice is binary:

- **preserve** — copy it untouched (original codec and bitrate). The default
  for `fast` and `portable`. Honours the original ([library-safety](./library-safety.md) §3).
- **convert** — reduce an over-cap source down to the cap. The default for
  `optimised`, and an explicit, named opt-in everywhere else.

Reduction is **never** a silent consequence of having a quality preset — it is
opted into, by the transfer-mode default or an explicit `[bitrate].reduce`.

## 3. The cap is a hard ceiling

The quality preset's bitrate bounds **every** target — convert, and even a
`preserve` *forced* transcode. podkit never produces a file above the user's
stated quality ([library-safety](./library-safety.md) §2). The consequence:
for a large incompatible-codec source, `preserve` and `convert` converge at the
cap; `preserve` earns its keep only *below* the cap, where it stops a small
forced source from being needlessly under-encoded.

## 4. The source-proximity tolerance is a percentage, and it guards the source side only

Reduce only when the source meaningfully exceeds the cap:

> `reduce iff source > cap × (1 + tolerance)`  (default `0.25`)

This guards the **source** bitrate, which comes from ffprobe and can wobble
(VBR variance is proportional, ~30%). It is a **percentage**, not a
bitrate-step ladder — proportional noise wants a proportional guard, and the
standard ladder is already roughly geometric, so `0.25` reproduces the
"don't bother reducing within ~a tier" intent without a ladder table.

The other comparison — the device's **recorded** bitrate (the sync tag,
deterministic because podkit wrote it) against the cap — carries **no
tolerance**. It is exact: a cap change the user makes applies fully on the next
sync. Tolerance belongs only where the input is noisy.

## 5. File size is raw kbps; only quality-matching is efficiency-weighted

A 128 kbps file is ~128 kbps of bytes regardless of codec. So every decision
about **space** — the reduce tolerance, and the convert target — uses **raw
kbps**. Codec efficiency (Opus needs fewer kbps than AAC for equal quality) is
applied in **exactly one place**: the **preserve-necessity** target, where the
goal is to match the source's *quality* in a codec podkit is *forced* to switch
to (e.g. an Opus source on a device that cannot play Opus).

Using efficiency anywhere else would misfire: in the tolerance it would reduce a
track for ~zero space gain; in the convert target it would inflate the file.

The unified target-bitrate rule (one seam, shared by the add path and the
re-sync path so a track is never decided two ways — see
[ADR-023](../../adr/adr-023-lossy-reduction-down-only.md)):

| Case | Target |
|---|---|
| device-native + preserve | copy (original codec + bitrate) |
| device-native + convert | reduce iff `source > cap × (1+tol)` → `cap` |
| incompatible codec + preserve | `min(round(source × eff[target]/eff[source]), cap, deviceMax)` |
| incompatible codec + convert | `min(source, cap)` |
| lossless source | quality preset |

## 6. Codec selection follows the resolved stack — never a hardcoded assumption

The transcode target codec is the user's **resolved lossy preference stack**
(`[codec] lossy`, constrained to device-supported codecs) — not a fixed "AAC".
A device with a different codec stack, or a user with different preferences,
gets their codec.

Once a re-encode is happening, podkit does **not** try to stay in the source's
own codec: the value is in the user *choosing* to convert, and a cross-codec
target is accepted. (Preserving the original codec is the job of **preserve**,
which copies and does not re-encode at all.) podkit produces only canonical
containers and a deliberately narrow set of output codecs — it never emits
Vorbis, for instance (doc-036 §7), so a Vorbis source under convert targets the
stack's producible codec.

## 7. CBR/VBR mode changes never re-encode a lossy track

A standalone CBR↔VBR flip never re-encodes a lossy-source track: it would be a
lossy→lossy degradation and can *grow* the file. The encoding-mode precondition
survives only for **lossless-source** transcodes, where the re-encode reads the
lossless source and is bounded by the cap. With reduction down-only and
cap-bounded, this seals the guarantee that a lossy file is never grown
([library-safety](./library-safety.md) §1).

VBR is otherwise handled without special-casing: the source-file bitrate is
reliable for size (filesize ÷ duration), and a convert records the **nominal**
target in the sync tag (not the measured VBR output), so the next sync compares
exactly and does not chase.

## Related

- [ADR-023](../../adr/adr-023-lossy-reduction-down-only.md) — the decision and
  the full rule table.
- [ADR-010](../../adr/adr-010-quality-preset-redesign.md) — quality presets and
  the compatible-lossy-copy rule.
- [ADR-022](../../adr/adr-022-sync-tag-sole-quality-truth.md) — the sync tag as
  sole quality truth.
- doc-036 — Codec and Container Design Principles (codec/container axes,
  producible codecs, canonical containers).
- `documents/architecture/sync/upgrades.md` — the classifier mechanics.
- [transfer-modes](./transfer-modes.md) — the axis that defaults this one.
