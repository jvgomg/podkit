# Features (sub-PRDs)

Inventory of feature-level sub-PRDs. Each feature has a **stub file** in
this directory that reserves its slug, records its dependencies, and
tracks the user stories it addresses. The stub is upgraded to a full
sub-PRD when the feature is drafted.

We discuss each feature's scope before drafting its full PRD. Stub
files exist so the bidirectional-link lint has stable targets and so
the dependency graph is checkable.

## Inventory

| Feature | Tier | Status | Depends on | Summary |
|---------|------|--------|------------|---------|
| [Sources & Collections architecture](sources-and-collections.md) | 0 | not drafted | source-collection-decoupling open question | The config grammar: source declarations, collection definitions, content typing. Foundational. |
| [Selector pipeline](selector-pipeline.md) | 0 | not drafted | Sources & Collections | Pin > pool ordering, capacity-fit, eviction policy, over-budget UX. Where intent meets reality. |
| [File-size estimation accuracy](estimation-accuracy.md) | 0 | not drafted | estimation spike findings | Better estimates + cache + confidence-interval UX. Gates capacity-fit reliability. |
| [Per-content-type collections (TV/movies)](per-content-type-collections.md) | 1 | not drafted | Tier 0 | Replaces doc-007. Music / TV / movies as first-class content types with declared content, no auto-detection. |
| [Device playlists (write side)](device-playlists-write.md) | 1 | not drafted | Tier 0 | `collection.playlists` materialised on the device. union/intersect modes. Pin source for selector. |
| [Track identity matching](track-identity.md) | 2 | not drafted | Tier 0 | Foundational primitive. Identity record + matching cascade. Used by cross-source playlists, OTG protection, self-healing sync. |
| [Cross-source playlists](cross-source-playlists.md) | 3 | parked (WIP) | Tier 2; resolution of source-collection-decoupling | Resolve playlist references against a source other than the active music source. Gated on cross-source surviving the source-collection-decoupling decision. |
| [Device state read + OTG protection](device-state-read.md) | 3 | not drafted | Tier 2; libgpod / ipod-db read capability | Reading device-side state (play counts, on-device playlists) to inform selector behaviour. Enables OTG-protection-during-eviction. |
| [Smart / rotational selection](smart-selection.md) | 4 | not drafted | Tier 3 (needs play counts) | Play-count-aware selection, rotation policies, freshness. |
| [Audiobook content type](audiobook-content-type.md) | 4 | not drafted | Tier 0/1 | Audiobook-specific collection schema and selector behaviours. |
| [Podcast content type](podcast-content-type.md) | 4 | not drafted | Tier 0/1, possibly Tier 2 | Podcast-specific collection schema (last-N-unplayed-per-feed). |

## Status values

| Status        | Meaning |
|---------------|---------|
| `not drafted` | Feature identified; sub-PRD not yet written. |
| `drafting`    | Sub-PRD being written in this workspace. |
| `agreed`      | Sub-PRD complete and agreed; ready to migrate to backlog. |
| `shipped`     | Migrated to `backlog/docs/doc-NNN`. The local file becomes a stub linking to the backlog doc. |
| `parked`      | Drafted but intentionally not progressing (e.g., gated on an open question). |

## Drafting workflow

When we agree to draft a feature:

1. Create `features/<slug>.md` with frontmatter `status: drafting`.
2. Use a consistent template:
   - **Problem** — what user pain or design gap does this solve?
   - **Scope** — what's in.
   - **Non-goals** — what's explicitly out.
   - **Design sketch** — config shape, data model, key behaviours.
   - **Open questions** — anything not yet resolved (link to
     `../open-questions/`).
   - **Dependencies** — link to other features, principles, spikes.
   - **User stories addressed** — link to `../user-stories.md` IDs.
3. Update this index row.
4. Iterate the sub-PRD across sessions.
5. When agreed, set status to `agreed`. When ready to ship, migrate to
   `backlog/docs/doc-NNN` and replace the file's body with a short
   redirect.

## Sequencing

See [`../roadmap.md`](../roadmap.md) for the tier ordering and dependency
graph. The roadmap and this index should agree; if they ever disagree, this
index is the source of truth for status (the roadmap describes intent).
