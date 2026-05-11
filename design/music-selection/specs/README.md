# Specs

Living end-state documents that crystallise the agreed shape of one
cross-cutting concern of the music-selection design. Distinct from:

- **Principles** (rules of thinking)
- **Features** (PRDs for discrete units of work)
- **Open questions** (decisions yet to be made)

A spec is **the consolidated result**: the canonical statement of what the
config (or CLI surface, or vocabulary) looks like once all the principles,
features, and open questions have had their say.

Specs evolve continually. Each spec block / field / term carries an
annotation indicating its source of authority and confidence:

- `(agreed)` — settled, backed by a `status: agreed` principle or
  feature.
- `(tentative)` — proposed, may still change.
- `(pending: <open-question-name>)` — depends on a specific open
  question.
- `(stretch)` — only realised if a later-tier feature ships.

When an open question resolves, the corresponding annotations in specs
should be updated (typically `pending` → `agreed` or `tentative`). When
a principle changes, dependent specs follow.

## Active specs

| Spec | Status | Description |
|------|--------|-------------|
| [config-schema](config-schema.md) | draft | The agreed end-state of the TOML config: sources, collections, devices, content-type blocks. |
| [terminology](terminology.md) | draft | Canonical names for entities, concepts, and supporting technology. |

## Specs we anticipate but haven't seeded

These are scheduled to be created when their source sub-PRDs are
drafted:

- `selector-semantics.md` — the precise selection algorithm and its
  capacity-fit / pin / eviction rules. Seeded when selector-pipeline
  sub-PRD is drafted.
- `cli-surface.md` — the CLI vocabulary, especially around source /
  collection / playlist overrides. Seeded when those surfaces firm up.
- `track-identity.md` — the matching cascade and normalisation rules.
  Seeded when the track-identity sub-PRD is drafted.
- `diagnostics-vocabulary.md` — the canonical diagnostic / warning
  shapes used across the runtime. Seeded after three or more concrete
  shapes exist in features.

## Status values

| Status        | Meaning |
|---------------|---------|
| `draft`       | Initial form; many parts still tentative or pending. |
| `converging`  | Most parts agreed; small number of pending items. |
| `agreed`      | All parts agreed; spec is the canonical reference. |

## Updating a spec

Specs change in response to:

- A principle changing status (`tentative` → `agreed` or vice versa).
- An open question being resolved.
- A feature drafting that crystallises a previously-vague area.

When you update a spec, also update:

- Its frontmatter `last-updated` date.
- Its annotations on the changed blocks/fields.
- Any cross-references in `derived-from` if new principles/features
  fed in.

## Conventions

- Specs are *normative* within their scope. If a principle or feature
  later contradicts a spec, either the spec needs updating or the
  contradicting thing does — but the inconsistency is a real problem
  to resolve.
- Specs should be readable in isolation. A reader landing on
  `config-schema.md` cold should understand the structure without
  needing to read every principle first.
- Specs carry minimal prose — they are *what is*, not *why*. Reasoning
  lives in principles and features; specs cite them when context is
  needed.
