# Principles

Discrete design principles that have emerged during the music-selection
shaping work. Each principle is a short standalone document.

A principle is **a rule for thinking** — a heuristic the design should
respect. When a feature design contradicts a principle, either the feature
needs to change or the principle needs to be re-examined.

| Principle | Status | Summary |
|-----------|--------|---------|
| [collections-are-content-sets](collections-are-content-sets.md) | tentative | Collections encapsulate content sets (intent); devices apply them with state and constraints (reality). |
| [content-type-is-explicit](content-type-is-explicit.md) | agreed | Content type is declared on sources. No auto-detection. |
| [inline-collections-on-devices](inline-collections-on-devices.md) | tentative | Inline collection definitions on devices are sugar; same mechanism as named collections. |
| [playlist-roles-separated](playlist-roles-separated.md) | agreed | Playlist-as-constraint (filter input) and playlist-as-content (sync output) are distinct roles with distinct config slots. |
| [source-capabilities](source-capabilities.md) | tentative | Sources declare capabilities; collections are portable; source adapters implement what they can. |
| [track-identity-foundation](track-identity-foundation.md) | tentative | Track identity is a foundational primitive shared by multiple features. |
| [runtime-mismatches-not-config-errors](runtime-mismatches-not-config-errors.md) | tentative | Filter / source / playlist mismatches are runtime warnings, not config-time errors. Best-effort matching with clear diagnostics. |

## Open principle questions

Principles still under debate live in [`../open-questions/`](../open-questions/),
not here. The most foundational open principle is whether to
[decouple sources from collections](../open-questions/source-collection-decoupling.md)
at all.

## When to add a new principle

- A design conversation produced a rule of thumb that should be respected by
  every feature.
- A feature design surfaced a constraint that has implications beyond that
  feature.
- An open question is resolved in a way that should constrain future thinking.

Don't add a principle for something only one feature cares about — that
belongs in the feature PRD itself.

## When to retire a principle

- The principle has been proven wrong by a real use case.
- The principle has been replaced by a sharper formulation.

Set status to `superseded` and add a `superseded-by` link rather than
deleting the file.
