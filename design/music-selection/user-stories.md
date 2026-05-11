---
status: open
last-updated: 2026-05-11
links:
  - README.md
  - features/README.md
  - roadmap.md
---

# User Stories

A registry of user-facing scenarios driving the music-selection design. Each
story has an ID for cross-referencing from features, principles, and
open questions.

This list is **append-only with revision** — once a story has an ID, the ID
sticks. Edit the description if the story sharpens; do not renumber.

| ID    | Persona / context                | Story summary |
|-------|----------------------------------|---------------|
| US-01 | Newbie, one source, one device    | Point podkit at a music folder and an iPod, sync everything, no config beyond paths. |
| US-02 | Power user, multiple devices      | Define content rules once and apply to several devices. |
| US-03 | Cross-source                      | Have the same music in two places (local directory and Subsonic) and sync from either with the same selection rules. |
| US-04 | Multi-content-type device         | One device gets music + TV + movies; each from its own source, each with its own collection. |
| US-05 | Curated playlists + big pool      | Sync a handful of named playlists onto the device *and* fill remaining capacity from a larger constraining playlist. |
| US-06 | Different selection per device    | Big iPod gets everything; nano gets a curated subset. Both reference the same source. |
| US-07 | Subsonic-as-curator               | Maintain playlists in Navidrome and have those reflected on the device. |
| US-08 | Strict gate                       | Only sync tracks that are in named playlists; nothing else (intersect mode). |
| US-09 | Genre filter                      | Jazz-only iPod from a general music source. |
| US-10 | TV viewer                         | Sync the last N unwatched episodes per show, automatically. |
| US-11 | Per-device tweak                  | Use the same collection on two devices but skip one playlist on the smaller one. |
| US-12 | Self-named playlist               | Maintain a Subsonic playlist named after the iPod that is used both as the constraining filter and as a materialised playlist on the device. |
| US-13 | Two devices, same rules           | Two iPods syncing the same content set with no duplication of config. |
| US-14 | Standalone M3U directory          | Keep M3U playlist files in their own directory, separate from where music files live, and use them as selection input. |
| US-15 | Podkit-native playlists           | Define playlists *in podkit* (not in any external source) to enhance syncing rules. |
| US-16 | Subsonic curation, local files    | Maintain "Commute Mix" in Subsonic but sync the actual track files from a local directory. |
| US-17 | OTG protection                    | A track the user added to an On-The-Go playlist on the device should not be removed by the next sync. |
| US-18 | Capacity-aware sync               | The sync should fit within the device's capacity without surprises or repeated retries. |
| US-19 | Estimation transparency           | When estimates are uncertain, the user is told — not silently surprised when a sync overflows. |
| US-20 | Self-healing sync                 | Detect changed source files and upgrade them on the device (already covered by ADR-009). |
| US-21 | Audiobooks                        | Sync only unread audiobooks from a source dedicated to audiobook content. *(future content type)* |
| US-22 | Podcasts                          | Sync the last N unplayed episodes per feed. *(future content type)* |

## Notes on personas

We have not yet formalised personas. Implicit groups so far:

- **Newbie / single-device** — wants minimal config, defaults to "everything".
- **Curator** — defines selection rules in collections; reuses across devices.
- **Power user / multi-source** — runs Subsonic, has a local library, swaps
  between them.
- **Cross-platform listener** — uses on-device playlists (OTG, "Continue
  Watching") and expects podkit to respect them.
- **Multi-media** — syncs TV / movies alongside music.
- **Future**: audiobook collector, podcast listener.

Personas may become their own section if the user-story matrix grows.

## Adding a story

1. Append to the table with the next ID.
2. Cross-reference from any feature, principle, or open question that the
   story drives.
3. If a story is contentious or motivates an open principle, link to the
   relevant `open-questions/` file.
