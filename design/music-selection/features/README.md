# Features (sub-PRDs)

This directory holds one **stub file per feature** plus full sub-PRD
content as each feature gets drafted.

- A **stub** reserves the feature's slug, records its dependencies, and
  tracks the user stories it addresses. Stub frontmatter is the source
  of truth for the feature's tier, status, dependencies, and
  user-story mappings.
- A **drafted sub-PRD** is the stub plus the full body content
  (Problem / Scope / Non-goals / Design sketch / Open questions /
  Dependencies).
- A **shipped sub-PRD** has migrated to `backlog/docs/doc-NNN`; its
  file in this directory becomes a short redirect.

Each feature's status / tier / dependencies live in its own file's
frontmatter — there is no duplicate inventory table here. To see what
exists, list the files; to see status of a specific feature, open it.

For sequencing across features (which feature unblocks which, what's
in which tier), see [`../roadmap.md`](../roadmap.md).

## Status values

| Status        | Meaning |
|---------------|---------|
| `not-drafted` | Stub exists; full sub-PRD content not yet written. |
| `drafting`    | Sub-PRD body being written. |
| `agreed`      | Sub-PRD complete and agreed; ready to migrate to backlog. |
| `shipped`     | Migrated to `backlog/docs/doc-NNN`. File body is a redirect. |
| `parked`      | Drafted but intentionally not progressing (e.g., gated on an open question). |

## Drafting workflow

When we agree to draft a feature:

1. Update the stub's status to `drafting`.
2. Fill in the body using a consistent template:
   - **Problem** — what user pain or design gap does this solve?
   - **Scope** — what's in.
   - **Non-goals** — what's explicitly out.
   - **Design sketch** — config shape, data model, key behaviours.
   - **Open questions** — link to `../open-questions/` files where
     decisions are still being made.
   - **Dependencies** — already in frontmatter; expand on what depends
     on what and why.
   - **User stories addressed** — already in frontmatter; expand on
     which scenario each story exercises.
3. Run the lint to verify cross-references:
   `bun run scripts/lint-frontmatter-links.ts design/music-selection/.lint.yaml`.
4. When the sub-PRD is agreed, set status to `agreed`. When ready to
   ship, migrate to `backlog/docs/doc-NNN` via the Backlog.md MCP
   tooling and replace the file body with a one-line redirect.

## Adding a new feature

1. Pick a slug (lowercase, hyphenated).
2. Create `features/<slug>.md` with the standard frontmatter shape (see
   any existing stub for reference): `slug`, `title`, `tier`, `status`,
   `last-updated`, `user-stories-addressed`, `depends-on.features`,
   `depended-on-by-features`, `gated-by.open-questions`,
   `informed-by-spikes`.
3. Update any user stories, principles, open questions, or spikes that
   should link to the new feature (their corresponding
   `addressed-by.features` / `gates-features` / `informs.features`
   lists).
4. Add the new feature to the appropriate tier in `../roadmap.md`.
5. Run the lint.
