# Design Workspaces

This directory hosts long-running **design workspaces** for podkit features that
are bigger than a single PRD or ADR. A design workspace is a place to *shape*
a solution collaboratively over many sessions before any of it gets formalised
as a backlog PRD or implemented.

Each workspace lives in its own subdirectory under `design/` and follows the
common structure described below.

## Why this exists

podkit has three other places where design lives:

- **`adr/`** — Architecture Decision Records. Atomic, point-in-time decisions
  that are made once and rarely revisited. Good for "we chose X over Y because
  Z" but not for sprawling, evolving design conversations.
- **`backlog/docs/`** — Formal PRDs (managed via the Backlog.md MCP tooling).
  Ready to be sliced into tasks and built. Each PRD is a single document with
  a single problem statement.
- **GitHub Discussions** — Feature requests and ideation from users. Not where
  technical design happens.

None of those is the right home for **work-in-progress architecture** that
spans multiple features, has open principles, requires research spikes, and
needs to be refined across many sessions before crystallising into PRDs. That
is what `design/` is for.

When a workspace's thinking converges, its principles become ADRs, its
features become backlog PRDs, and its roadmap becomes tasks. The workspace
itself stays around as the shaping record.

## Working in `design/` as an AI agent

If you're an AI agent landing here to work on a design workspace cold —
without the conversation history that produced its current state — read
this section first.

1. **Read this file** (the one you're reading). It documents shared
   conventions every workspace follows.
2. **Then read the target workspace's own `README.md`.** It frames the
   problem, sketches the conceptual model, and maps to the rest of the
   workspace.
3. **Check `open-questions/README.md`** to see what is deliberately
   undecided. Don't try to silently resolve open questions — flag your
   reasoning and let the human decide.
4. **Use the workspace's `specs/terminology.md`** (if it has one) as
   the canonical vocabulary. Don't introduce new synonyms for existing
   terms. If you need a new term, add it to `terminology.md` *first*,
   then use it elsewhere.
5. **Treat `tentative` principles as challengeable but visible.** A
   `tentative` status means the principle is on the table, not
   settled. You may push back on it — but make the challenge visible,
   don't quietly modify or remove it.
6. **Run the link lint after any frontmatter change:**

   ```bash
   bun run scripts/lint-frontmatter-links.ts design/<workspace>/.lint.yaml
   ```

   If the lint fails, fix the missing backrefs before continuing.
   Bidirectional links are how the workspace stays internally
   consistent.
7. **Don't delete archived files.** Archives (under
   `<subdir>/archive/`) are the historical record of resolved
   decisions. They matter even when they're no longer active.
8. **Prefer adding annotated content to overwriting.** When you change
   an existing principle, open question, or spec, update its
   `last-updated`, adjust its `status` if appropriate, and leave a
   short note about what changed. The workspace is a long-running
   record, not a notebook.

## Workspace structure

Every workspace follows the same shape. The convention is enforced by
convention, not tooling — copy the structure when starting a new one.

```
design/<workspace-name>/
├── README.md                # Master PRD — entry point; problem statement; map of everything else
├── roadmap.md               # Sequenced plan of features/tiers
├── .lint.yaml               # Bidirectional-link lint config (see "Link consistency" below)
├── user-stories/            # Registry of user stories driving the design
│   ├── README.md            # Overview + ranked index table
│   ├── <us-id-slug>.md      # One per story
│   └── archive/             # Solved / out-of-scope stories
│       └── README.md
├── principles/              # Discrete design principles — one per file
│   ├── README.md            # Index + status of each principle
│   └── <principle-name>.md
├── specs/                   # Living end-state documents (config schema, terminology, …)
│   ├── README.md            # Index of specs
│   └── <spec-name>.md
├── features/                # Sub-PRDs — one per feature (stub-then-draft)
│   ├── README.md            # Inventory of features; status of each
│   └── <feature-name>.md
├── spikes/                  # Technical research / investigations
│   ├── README.md            # Index of active and completed spikes
│   ├── <spike-name>.md
│   └── archive/             # Spikes whose findings have been actioned
│       └── README.md
└── open-questions/          # Unresolved design questions
    ├── README.md            # Index of open and resolved questions
    ├── <question-name>.md
    └── archive/             # Questions that have been resolved
        └── README.md
```

The master `README.md` is the entry point. Anyone landing on a workspace cold
should be able to read it and understand what the workspace is about, where
the thinking has got to, and where to look for more depth.

## Frontmatter convention

Every file (other than the `README.md` indices) carries YAML frontmatter:

```yaml
---
status: tentative          # see "Status values" below
last-updated: 2026-05-11
links:                     # optional cross-references to other workspace files
  - principles/<other>.md
  - features/<other>.md
---
```

### Status values

| Status        | Meaning |
|---------------|---------|
| `open`        | Actively under discussion. Decision not made. |
| `tentative`   | Proposed; not strongly challenged; could change. |
| `agreed`      | Settled. Captured here as the canonical statement. |
| `superseded`  | Replaced by something newer. Retained for history with a `superseded-by` link. |

For spikes, additional values:

| Status        | Meaning |
|---------------|---------|
| `proposed`    | Spike identified but not started. |
| `in-progress` | Spike work happening. |
| `complete`    | Findings written up; awaiting actioning. |
| `actioned`    | Findings have been turned into PRDs/tasks; spike is ready to archive. |

## Lifecycle

- **New principles, questions, spikes** start as files in their respective
  directory.
- **Principles** move from `tentative` → `agreed` (or `superseded`) over time.
- **Open questions** move to `archive/` when resolved. The archived file
  stays as-is but adds a final "Resolution" section explaining the outcome
  and pointing at the principle/feature/spike where the resolution lives.
- **Spikes** move to `archive/` once their findings have been actioned into
  PRDs, tasks, or principles. The archived spike retains its findings.
- **Features** start as draft sub-PRDs in `features/`. When a feature's design
  converges enough to be implemented, it migrates to `backlog/docs/doc-NNN`
  via the Backlog.md MCP tooling, and the workspace's `features/<name>.md`
  is updated with a "shipped to backlog as doc-NNN" link.
- **Workspaces themselves** persist indefinitely as the shaping record, even
  after most of their contents have graduated.

## Bidirectional link conventions

Several files cross-link bidirectionally — e.g., a user story names the
features that address it, and each feature names the stories it
addresses. The full set of relations is declared in the workspace's
`.lint.yaml` config and validated by the
[`scripts/lint-frontmatter-links.ts`](../scripts/lint-frontmatter-links.ts)
script.

Run the lint from the repo root:

```bash
bun run scripts/lint-frontmatter-links.ts design/<workspace>/.lint.yaml
```

Standard relations (configured per workspace; not all need to be used):

| Forward edge                           | Backref                       |
|----------------------------------------|-------------------------------|
| user-stories → features (`addressed-by.features`) | features `user-stories-addressed` |
| user-stories → principles (`addressed-by.principles`) | principles `user-stories-addressed` |
| user-stories → open-questions (`addressed-by.open-questions`) | open-questions `user-stories-addressed` |
| user-stories → spikes (`addressed-by.spikes`) | spikes `user-stories-addressed` |
| spikes → features (`informs.features`) | features `informed-by-spikes` |
| spikes → open-questions (`informs.open-questions`) | open-questions `informed-by-spikes` |
| features → open-questions (`gated-by.open-questions`) | open-questions `gates-features` |
| features → features (`depends-on.features`) | features `depended-on-by-features` |

When you add a forward link, update the backref. Run the lint
to catch what you missed. CI integration is optional — for now, the
script is runnable manually.

## Specs

A workspace's `specs/` directory holds **living end-state documents**:
the consolidated, normative statement of one cross-cutting concern (e.g.,
the config schema, the terminology, the selector semantics). Specs are
distinct from features (which design new work) and principles (which
capture rules). A spec is the *result* — what the world looks like once
the relevant principles, features, and open questions have had their
say.

Specs evolve continually. Each block / field / term in a spec carries
an annotation indicating its source of authority and confidence
(`agreed` / `tentative` / `pending: <open-question>`).

## Relationship to other artefacts

- A workspace **produces** ADRs (in `adr/`) when discrete technical decisions
  crystallise. The workspace links to the ADR; the ADR can reference back.
- A workspace **produces** backlog PRDs (in `backlog/docs/`) when feature
  designs are ready to execute.
- A workspace **may reference** GitHub Discussions when user-facing roadmap
  items align with discussions in the Ideas category.

## Starting a new workspace

To create a new design workspace for a different problem area:

1. **Pick a slug** (lowercase, hyphenated). Examples: `music-selection`,
   `device-capabilities`, `daemon-hotplug`. The slug becomes the
   directory name under `design/`.

2. **Create the directory structure.** Standard layout (omit any
   subdirectories your workspace genuinely won't use):

   ```bash
   mkdir -p design/<slug>/{principles,features,specs}
   mkdir -p design/<slug>/{open-questions,spikes,user-stories}/archive
   ```

3. **Seed the minimum files:**

   - `design/<slug>/README.md` — master PRD: problem statement,
     conceptual model, and a "Where to read more" map pointing into
     each subdirectory.
   - `design/<slug>/<each-subdir>/README.md` — short index for each
     subdir (what lives there, how to add a new entry, how to retire
     one).
   - `design/<slug>/<each-subdir>/archive/README.md` — for the three
     subdirs that have archives (`user-stories`, `open-questions`,
     `spikes`).
   - `design/<slug>/.lint.yaml` — bidirectional-link config (see "Lint
     config schema" below).

4. **Seed at least one of each substantive item:**
   - One user story (you have to be designing *for someone*).
   - One principle (the rule that emerges from the first story).
   - One open question (the first thing you don't yet know).
   - One feature stub (the first work that the principle implies).

   Stubs are fine; the point is to have something the lint can
   validate and something a reader landing cold can use as a starting
   point.

5. **Add the new workspace to the
   [Active workspaces](#active-workspaces) table at the bottom of this
   file.**

6. **Run the lint:**

   ```bash
   bun run scripts/lint-frontmatter-links.ts design/<slug>/.lint.yaml
   ```

   It should pass on first run if the seeded items have matching
   forward links and backrefs.

### Lint config schema

Each workspace's `.lint.yaml` declares its directory layout and the
bidirectional relations the link lint enforces. Schema:

```yaml
# Workspace root, resolved relative to this YAML file's directory.
# Almost always ".".
root: .

# One entry per markdown-bearing subdirectory. Each entry says how to
# find files and how to derive each file's "id" — the string that
# appears in other files' frontmatter when this category is
# referenced.
categories:
  <category-name>:                    # e.g., principles, features
    dir: <relative-path>              # subdir containing the files
    id-from: filename | <fm-key>      # "filename" → slug from filename
                                      # otherwise → read this frontmatter key
    exclude: [<filename>, <subdir>]   # files / subdirs to skip
                                      # (archive subdirs typically go here)

# One entry per bidirectional relation. For each file in `from`, the
# frontmatter value at `via` is treated as a list of ids in the `to`
# category. Each referenced target file must carry the source file's
# id in its `backref` field.
relations:
  - from: <category-name>             # category holding the forward link
    via: <frontmatter-path>           # dotted path, e.g., "addressed-by.features"
    to: <category-name>               # category the link targets
    backref: <frontmatter-key>        # field on the target holding the back-ref
```

A workspace can use any subset of categories and any set of relations
appropriate to its problem. The script is fully generic — it knows
only what the config declares. See
[`music-selection/.lint.yaml`](music-selection/.lint.yaml) for a
worked example with five categories and eight relations.

## Active workspaces

| Workspace | Status | Description |
|-----------|--------|-------------|
| [`music-selection/`](music-selection/README.md) | shaping | Architecture for how podkit selects, constrains, and curates music (and other content) for a device. |
