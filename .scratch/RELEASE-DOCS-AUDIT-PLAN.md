# Release Docs-Audit Plan (podkit 0.7.0)

> **Status:** working plan, do not commit. Load into a fresh session; the lead
> agent orchestrates the phases below.
>
> **Goal:** before cutting `podkit@0.7.0`, make the public docs (`docs/`) match
> the code, then ship a readable release. ~95 changesets have accumulated since
> `podkit@0.6.0` (released 2026-03-23). Several features landed with no doc
> update. The docs site (`docs-live` branch) **deploys from the release commit**,
> so stale docs go public the instant we release — docs genuinely gate the cut.

## Why this exists (context the lead agent needs)

- **The "broken automation" is not broken.** PR #48 ("Version Packages") hit
  GitHub's 65,536-char PR-body limit, so changesets-action dropped the changelog
  detail (`"The changelog information ... exceeds the size limit"`). The fix is a
  hand-authored summary body, not a pipeline change. See Phase 5.
- **Code is the source of truth, not the changeset.** A changeset records intent
  at write-time (some are 3 months old). Code may have moved since (renames,
  reshapes, removals under the no-deprecation policy). Every audit verifies
  **docs vs current code / CLI behavior**; changesets are only a *pointer to
  where to look*.
- **Out of scope (decided):**
  - Architecture docs (`documents/architecture/`) — internal, don't ship, don't
    gate. Deferred to a separate follow-up.
  - Full doc-page reconciliation net — skipped. Coverage is changeset-indexed.
  - Release branch mechanics, changeset freeze, PR-merge timing — the **user
    handles these personally**. Do not merge PR #48 or touch `main` release flow.

## Repo facts

- Public docs: `docs/` (symlinked into `packages/docs-site`). Sections:
  `getting-started/`, `user-guide/`, `reference/`, `devices/`, `troubleshooting/`,
  `developers/`, `project/`. Mostly `.md`, some `.mdx`.
- Changesets: `.changeset/*.md` (95 pending, excluding `README.md`/`config.json`).
- Docs build: `bun run --cwd packages/docs-site build` (Astro/Starlight; bad MDX
  breaks the build).
- CLI help is ground truth for command/flag docs: `podkit <cmd> --help`.

## Conventions (must honor — from project memory)

- **Sonnet review before any commit** — dispatch a sonnet reviewer over the diff,
  look for coverage gaps and drive-by cleanups, before committing.
- **Sub-agents run in the main directory** — no worktrees.
- **No task IDs / AC / milestone refs** in code, docs, comments, or doc prose.
- **No "deprecated" framing** — features that were removed/renamed are just gone;
  docs should describe current reality, not migration history.

---

## Phase 0 — Grouping pass (single opus agent)

Read **all** `.changeset/*.md`. Produce three artifacts, written to
`docs-audit-worklist.md` at repo root (uncommitted):

1. **Theme map** — cluster changesets by user-facing feature theme. Candidate
   themes seen in the set (refine, don't treat as fixed):
   - Mass-storage device support (Echo Mini / Rockbox / generic presets)
   - Device identification (sysinfo, firmware inquiry, model/identity cascade)
   - Doctor / diagnostics (checks, repairs, artwork integrity, orphan files)
   - Device commands (add/rename/archive/factory-reset/scan/eject, readiness)
   - Codec & quality (vorbis rename, quality-change, transfer modes, replaygain)
   - Sync behavior (self-healing, sidecar artwork, cross-process coordination)
   - CLI surface (flag standardisation, error shapes, output/tty)
   Each theme → list of its changeset filenames.

2. **Contradiction collapse** — find changesets that **disagree** with each other
   (added-then-renamed, added-then-removed, superseded designs). Examples to check:
   `codec-vorbis-rename-and-container-types` vs earlier vorbis changesets;
   the three `device-rename-*` files; `quality-change-unified` vs
   `quality-upgrade-infinite-loop-fix`; `remove-execute-music-plan` vs the
   sync-pipeline changesets. For each conflict cluster, **edit the `.changeset`
   files** to leave one coherent entry that describes the net current behavior.
   Preserve the **highest version bump** per package; lose no real user-facing
   detail. This is contradiction-removal only — do NOT cosmetically rewrite
   non-conflicting changesets.

3. **Internal / no-doc-impact list** — changesets with zero user-facing surface
   (pure refactors: `sync-engine-refactor`, `consolidate-discovery-frameworks`,
   `usb-enumeration-classify-refactor`, `remove-execute-music-plan`, etc.).
   Tagging one here is a **recorded decision** to skip it, not an omission.

**Done when:** every changeset is either assigned to a theme or on the
internal list, and contradictions are collapsed in the actual files.

---

## Phase 1 — Audit (parallel sonnet agents, one per theme)

Read-only, so fan out wide. Each agent gets its theme's changeset list and:

- Reads the **current code** for that theme (source + run `podkit <cmd> --help`
  for any commands/flags involved).
- Reads the relevant `docs/` pages.
- Produces a flagged worklist with a **bidirectional mandate**:
  - **(a) Gaps** — current behavior with no doc coverage (the silent features).
  - **(b) Stale / wrong** — docs that no longer match code: renamed flags,
    removed commands, changed defaults, old codec names, reshaped flows.
    Orient explicitly toward renames/removals so a "what's new" reading doesn't
    skip them.

Each agent appends its findings to `docs-audit-worklist.md` under its theme,
as concrete items: `file → section → problem → recommended change`.

**Done when:** every theme has a findings block; no agent reports "couldn't
locate the code/docs" without escalating.

---

## Phase 2 — Assemble the remediation plan (lead agent)

Consolidate all theme findings into an **ordered fix list partitioned by doc
file** (not by theme), because Phase 3 edits serially and collisions are tracked
per-file. Output: an ordered checklist in `docs-audit-worklist.md` —
`docs/<file>` → list of edits to apply. One file = one fix-agent task.

---

## Phase 3 — Fix (sequential fix agents)

Master/lead agent dispatches fix agents **one at a time** (serialized to avoid
collisions on shared pages like `reference/cli.md`). Each agent owns one doc
file, applies its edits, returns the diff. After all edits:

- Run a **sonnet review** over the full docs diff (coverage gaps + cleanups).
- Apply review feedback.

**Done when:** every Phase 2 checklist item is applied.

---

## Phase 4 — Verify

- `bun run --cwd packages/docs-site build` must pass (catches broken MDX / links).
- Lead agent summarizes the full diff for the user.
- **User reviews and commits.** Do not commit unreviewed.

---

## Phase 5 — Release notes (custom PR body)

- Author a **completely custom, human PR body** — curated highlights, not a
  changelog dump. Lead the big stories (mass-storage support, device
  identification, doctor/diagnostics, new device commands), then a tighter list.
- Store it as a **Backlog document** (RFCs/release notes live in Backlog).
- The user applies this body to PR #48 and handles merge / changeset-freeze /
  release timing. `release.yml` auto-appends the full `CHANGELOG.md` section +
  SHA256 checksums below the custom body in the GitHub Release — no workflow
  edit needed (the custom body is small, so the size limit is not hit).

---

## Handoff checklist for the fresh session

- [ ] Phase 0: themes mapped, contradictions collapsed in `.changeset/`, internal list recorded
- [ ] Phase 1: per-theme audit findings in `docs-audit-worklist.md`
- [ ] Phase 2: findings re-partitioned by doc file into an ordered fix list
- [ ] Phase 3: edits applied sequentially + sonnet review pass
- [ ] Phase 4: docs-site build green; diff summarized for user
- [ ] Phase 5: custom PR body authored as a Backlog doc
- [ ] Hand back to user for review/commit and release mechanics
