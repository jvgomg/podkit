# Open Questions

Decisions still to be made on the music-selection design. Each question is a
standalone file with its own status, framing, and resolution criteria.

When a question is resolved, move its file to [`archive/`](archive/) and add
a "Resolution" section to the bottom of the file explaining the outcome and
linking to the principle, feature, or spike where the decision now lives.

## Active questions

| Question | Status | Importance | Notes |
|----------|--------|------------|-------|
| [source-collection-decoupling](source-collection-decoupling.md) | open | **foundational** | Whether to allow swapping source per CLI/per-device with the same selection rules. Big impact on config simplicity. |
| [pinned-set-exceeds-capacity](pinned-set-exceeds-capacity.md) | open | medium | What to do when the user's pinned playlists alone exceed device capacity. |
| [normalization-aggressiveness](normalization-aggressiveness.md) | open | medium | How aggressive default tag normalisation should be in track-identity matching. Tunes the false-match vs missed-match dial. |
| [playlist-files-convention](playlist-files-convention.md) | open | low-medium | Where directory-source playlist files (M3U etc.) live by default and how discovery works. |
| [collection-extends-mechanism](collection-extends-mechanism.md) | open | medium | Whether collections can extend other collections as a first-class feature, or only inline-on-device extension is supported. |
| [filter-overrides-merge-rules](filter-overrides-merge-rules.md) | open | medium | When a device references a collection and adds inline overrides, how do the two compose? `.add`/`.remove` vs replace vs silent merge. |
| [multiple-music-sources-per-device](multiple-music-sources-per-device.md) | deferred | low (today) | Should one device be able to draw music from multiple sources? Currently limited to one per content type. |

"Importance" is the rough impact on the overall design if answered one way
vs the other. **Foundational** = answers here change the whole conceptual
model. Medium = answers shape a feature or sub-PRD. Low = ergonomics or
edge case.

## Archived (resolved) questions

See [`archive/`](archive/).

## Adding a question

1. Create a file under `open-questions/` with a descriptive slug name.
2. Add to the table above.
3. Cross-reference from any principle, feature, or user story whose
   resolution depends on this question.

## Resolving a question

1. Add a "Resolution" section to the bottom of the question file.
2. Update status to `resolved` in frontmatter.
3. Move the file to `archive/`.
4. Update this index to remove the row.
5. Update any principle, feature, or spike whose statement now depends on
   the resolved answer.
