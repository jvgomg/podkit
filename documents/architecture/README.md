---
title: Architecture Docs
description: The map of podkit's architecture documentation — what's settled, what's pending, and the eventual shape of the docs library.
sidebar:
  order: 0
---

The architecture documentation series. Describes podkit's design at a
level of abstraction that a contributor needs to make a change without
re-reading the codebase end-to-end.

Audience: contributors and AI agents working in the repository. Not
end-users (those are served by [`docs/`](../../docs/), the Starlight site).

These docs evolve slowly, are written once a convention is settled, and
should not require updating on every PR. If you find yourself rewriting
an architecture doc to match a change you're shipping, ask whether the
*convention* changed — if not, the doc is fine and the code drifted.

---

## What's here today

- **[conventions](./conventions.md)** — Cross-cutting rules that apply to
  every subsystem (typed errors, no `console.warn` in core, sink-not-stderr,
  test-pins-contract).
- **[sync/error-handling](./sync/error-handling.md)** — How errors and
  warnings flow through the sync engine. The first per-subsystem doc.
- **[sync/save-transactions](./sync/save-transactions.md)** — How `save()`
  works in podkit's device adapters, what survives a partial failure, and
  how the next sync's rescan self-heals. Companion to doc-041's living
  journal.
- **[sync/upgrades](./sync/upgrades.md)** — How the sync engine decides a
  track on the device should be re-transferred from the source —
  format-upgrade vs quality-upgrade gates, why format-upgrade is
  suppressed under transcoding, and how the bitrate baseline is written
  on copy + backfilled via `--force-sync-tags`.
- **[testing/vm-build-orchestration](./testing/vm-build-orchestration.md)** —
  How `bun run test:vm` guarantees a fresh podkit binary lands in the
  device-harness VM and detects baseline drift.
- **[testing/vm-testing](./testing/vm-testing.md)** — How to author a
  Tier-3 end-to-end test against a synthesised iPod inside the VM:
  personas, system states, FunctionFS daemon, mount lifecycle, and the
  mechanical constraints (USB descriptor cap, configfs path cap, mount
  uid/gid, SCSI VPD gap) that bite test authors.
- **[dev-builds](./dev-builds.md)** — Compile-time-stripped dev hooks:
  why `bin/podkit` and `bin/podkit-debug` exist side by side, the
  `__PODKIT_DEV_HOOKS__` strip pattern, and the e2e wiring that opts
  into test seams.
- **[device/capabilities](./device/capabilities.md)** — How
  `DeviceCapabilities` are resolved from the merged (built-in ∪
  user-defined) preset registry plus per-device overrides, and the
  threading convention CLI consumers follow.
- **[ipod-archive](./ipod-archive.md)** — How `podkit device archive`
  extracts a self-contained archive off an iPod: the two-stage
  raw-dump → transform design, the leaf `@podkit/ipod-archive` package,
  why the read path is libgpod-node-only with a ported artwork decoder,
  and the stage-boundary / lossless-extract / count-matches-output
  conventions.

That's it for now. The rest of the library is pending — see
[Goals and migration plan](#goals-and-migration-plan) below.

---

## The eventual shape

The architecture series mirrors the mental model of the codebase. The
folders match the major subsystems; each subsystem's docs cover its
primitives, responsibility boundaries, conventions for new contributors,
and the open work still asymmetric.

```text
documents/architecture/
├── README.md                         # this file
├── conventions.md                    # cross-cutting rules
├── sync/                             # sync engine
│   ├── error-handling.md             # ✅ landed
│   ├── planning.md                   # ✅ landed
│   ├── execution-pipeline.md         # ⏳ pending
│   ├── save-transactions.md          # ✅ landed (companion to doc-041 journal)
│   ├── upgrades.md                   # ✅ landed
│   ├── content-type-handlers.md      # ⏳ pending
│   └── transfer-modes.md             # ⏳ pending (settled version of doc-012)
├── device/                           # device adapter pattern
│   ├── adapter-contract.md           # ⏳ pending
│   ├── capabilities.md               # ⏳ pending
│   ├── ipod-adapter.md               # ⏳ pending
│   └── mass-storage-adapter.md       # ⏳ pending
├── collection-adapters/              # source adapters
│   ├── adapter-contract.md           # ⏳ pending
│   ├── subsonic.md                   # ⏳ pending
│   └── directory.md                  # ⏳ pending
├── transcode/                        # FFmpeg integration
│   ├── codec-resolution.md           # ⏳ pending
│   └── ffmpeg-runtime.md             # ⏳ pending
├── artwork/                          # artwork pipeline
│   ├── album-cache.md                # ⏳ pending
│   └── artwork-sinks.md              # ⏳ pending (embedded / sidecar / database)
├── ipod/                             # libgpod binding + iTunesDB
│   ├── libgpod-binding.md            # ⏳ pending
│   ├── itunes-db.md                  # ⏳ pending
│   └── artwork-db.md                 # ⏳ pending
├── ipod-archive.md                   # ✅ landed (device archive: dump + transform)
├── cli/                              # CLI structure
│   ├── output-context.md             # ⏳ pending
│   ├── decisions-and-provenance.md   # ⏳ pending
│   └── shell-completions.md          # ⏳ pending
└── testing/                          # testing infrastructure
    ├── vm-build-orchestration.md     # ✅ landed
    └── vm-testing.md                 # ✅ landed
```

This list is **a planning artefact, not a contract.** Folders are added
when content is written; section names are renamed as understanding
evolves. The list exists so future maintainers (and agents) can see
where new work plugs in.

### Per-doc shape (the template)

Each architecture doc follows roughly the same eight-section shape so
readers can navigate them with one mental model:

1. **Map** — what the subsystem owns, what it doesn't, two paragraphs max.
2. **Primitives** — the core types with their signatures and the *why*,
   not the *what*. (`new Foo({...})` belongs in JSDoc, not here.)
3. **Responsibility boundaries** — who knows what (adapter / handler /
   pipeline / CLI).
4. **Conventions for new contributors** — checklist.
5. **Scope boundaries** — what's NOT covered, with pointers elsewhere.
6. **Open work** — named asymmetries, planned cleanup, follow-ups from
   the most recent refactor.
7. **References** — file paths + companion docs (especially
   `backlog/docs/doc-NNN` journals if one is still active for the
   subsystem).

`sync/error-handling.md` is the canonical example. When in doubt, copy
its skeleton.

### Cross-doc anchors

Em-dash characters in markdown headings produce **double-dash** anchors when
GitHub or Starlight auto-generates them — e.g. the heading
`### Free-space contract — plan-time` becomes
`#free-space-contract--plan-time` (two dashes around the em-dash, not one).
When linking to such headings, use `#section--name`, not `#section-name`;
the single-dash form silently 404s. Existing examples to grep from:
`sync/planning.md` → `#free-space-contract--plan-time`,
`sync/save-transactions.md` → `#free-space-contract--execute-time`,
`sync/error-handling.md` → `#2-hard-failures--categorizedsyncerror`.

---

## Goals and migration plan

These are tracked here so a future contributor can pick one up as part of
a refactor in the relevant area, rather than as standalone documentation
work. Each item should be done **alongside** a code change in the same
subsystem — the architecture doc should reflect the settled shape of the
code that just landed.

### Migrate from `backlog/docs/`

The `backlog/docs/doc-NNN` files are *living rough-edges journals*. The
parts that have settled belong in architecture docs; the parts still in
flux stay in the journal. Migration is **not** "move and delete" —
extract the settled portion, leave the journal as a working log.

- [ ] **doc-041 — Save-Transaction Design and State of Play.** Extract §1
  (definitions), §2 (per-adapter flows), §7 (principles) into
  `sync/save-transactions.md`. Keep §3 (rough-edges catalogue), §4 (test
  gaps), §5 (failure modes) in the journal — those evolve as new edges
  surface.
- [ ] **doc-012 — Transfer Mode Behavior Matrix.** Extract the
  fundamentals (what each mode means, what it controls) into
  `sync/transfer-modes.md`. The full matrix probably stays in the
  journal — it's reference data, not architecture.
- [ ] **doc-039 — E2E Sync Matrix Testing Strategy.** May not need
  migration; it's testing-strategy doc, not architecture. If lifted,
  belongs in a new `testing/` folder, not in `sync/`.

### New docs to extract from code

Each of these should ideally happen as part of a refactor in the area —
the architecture doc captures the convention the refactor pinned, just
like `sync/error-handling.md` did for TASK-381.

- [x] **`sync/planning.md`** — Source → diff → plan. `SyncDiffer` and
  `SyncPlanner` + the device-scoped `PlanPreliminaries` pre-flight
  (TASK-398).
- [ ] **`sync/execution-pipeline.md`** — `MusicPipeline` three-stage
  (download / prepare / transfer), the executor's per-op state, save
  checkpoints. ADR-011 captures the original design decision; the
  architecture doc would capture the current settled shape. Triggered
  by: pipeline tuning work or video-pipeline parity.
- [ ] **`sync/content-type-handlers.md`** — `ContentTypeHandler` pattern.
  How music and video share the engine while keeping content-specific
  logic isolated. Triggered by: any new content type, or a video-pipeline
  refactor.
- [ ] **`device/adapter-contract.md`** — `DeviceAdapter` interface. The
  contract a new device must implement. Triggered by: any new device
  adapter (e.g. a third mass-storage variant, or a new native target).
- [x] **`device/capabilities.md`** — `DeviceCapabilities` model. How
  capabilities flow from device → resolver → planner → adapter, plus the
  built-in / user-defined preset registry.
- [ ] **`collection-adapters/adapter-contract.md`** — `CollectionAdapter`
  interface. Triggered by: any new source adapter.
- [ ] **`transcode/codec-resolution.md`** — How the planner picks a
  codec given source + device + user preferences. Triggered by: any
  codec resolution work or a new encoder.
- [ ] **`artwork/artwork-sinks.md`** — Embedded / sidecar / database
  artwork sinks. Triggered by: any artwork pipeline work.
- [ ] **`ipod/libgpod-binding.md`** — N-API surface, why we own the
  binding instead of consuming an existing one. ADR-002 has the
  decision; the architecture doc would have the settled shape.
  Triggered by: any libgpod-node refactor.
- [ ] **`cli/output-context.md`** — `OutputContext` pattern, text vs
  JSON. Triggered by: any CLI output shape change.

### Series-level

- [ ] **Frontmatter linting.** Once published to Starlight, frontmatter
  consistency matters (title, description, sidebar.order). Add a tiny
  validator script (probably in `tools/`) to keep them honest.
- [ ] **Publish to the Starlight site.** Today the architecture docs
  live in `documents/architecture/`. Eventually they'll mount in the
  Starlight site under `/architecture/`. Astro frontmatter is already
  Starlight-compatible; the publish step is mostly a config change in
  `packages/docs-site/`.
- [ ] **Cross-link with ADRs.** Every architecture doc should mention
  the ADRs that decided the relevant trade-offs (where applicable), so
  the *why* sits next to the *what*.

---

## Companion systems

The architecture docs are one of three persistent docs systems in the
repository:

| System                 | Lives in                       | Lifecycle                                                  |
|------------------------|--------------------------------|------------------------------------------------------------|
| **Architecture docs**  | `documents/architecture/`      | Slow-moving settled conventions. Updated when a refactor changes the convention. |
| **Doc-NNN journals**   | `backlog/docs/`                | Living rough-edges + open question logs. Refreshed often.  |
| **ADRs**               | `adr/`                         | Frozen-at-decision-time, status evolves (Accepted/Superseded). |

Each has its own role. Don't duplicate content across them — link
instead. See [conventions §7](./conventions.md#7-documentation-lives-in-three-places-not-one).

User-facing documentation (the Starlight site under `docs/`) is a
separate audience — install guides, troubleshooting, config reference.
Don't mix architecture (for contributors) with user-facing (for users).
