# Issue tracker: Backlog.md (via MCP)

Issues, tickets and specs for this repo live as **Backlog.md tasks** under `backlog/`,
and are read and written **exclusively through the Backlog.md MCP tools**.

> **Never edit files under `backlog/` directly** — not with `Edit`, not with `sed`, not
> with a heredoc. The MCP server owns their format, IDs and frontmatter. Always go
> through the tools below.

GitHub is *not* the issue tracker for this repo. GitHub **Discussions** are used for
user-facing feature requests only — see [`docs/agents/feature-requests.md`](../../agents/feature-requests.md).
Don't open GitHub issues in place of Backlog.md tasks.

## Conventions

- **Create a ticket**: `task_create` with `title`, `description`, and where known
  `acceptanceCriteria`, `labels`, `priority`, `type`, `milestone`, `dependencies`.
- **Read a ticket**: `task_view` with the task `id` (e.g. `TASK-031`). Returns the
  description, acceptance criteria, plan, notes and comments.
- **List tickets**: `task_list`, filtered by `status`, `labels`, `milestone`,
  `assignee` / `unassigned`, or `ready: true` (only tasks whose dependencies are Done).
- **Search tickets**: `task_search` with `query`, optionally narrowed by `status`,
  `type`, `priority` or `modifiedFiles`.
- **Comment on a ticket**: `task_edit` with `commentsAppend` (and `commentAuthor`).
- **Apply / remove labels**: `task_edit` with `labels` — this **replaces** the whole
  array, so read the current labels with `task_view` first and pass the merged set.
- **Close**: `task_edit` with `status: "Done"`, plus a `finalSummary`. Do **not** use
  `task_complete` — that tool is reserved for batch cleanup.

Statuses are `Draft`, `To Do`, `In Progress`, `Done`. Task IDs are `TASK-NNN`.

**Before creating anything**, search for existing related work (`task_search` /
`task_list`) and read the guidance tools: `get_task_creation_guide` for new tickets,
`get_task_execution_guide` while working, `get_task_finalization_guide` before closing.

Trivial mechanical changes (typos, version bumps, obvious one-liners) don't get a
ticket. Work that needs planning or a decision does.

## When a skill says "publish to the issue tracker"

Call `task_create`.

## When a skill says "fetch the relevant ticket"

Call `task_view` with the `TASK-NNN` id.

## Long-form documents

Specs and research write-ups that outgrow a task body become Backlog.md documents via
`document_create` / `document_update` (read with `document_list` / `document_view`).
Note the repo's other homes for settled prose, which are ordinary files and *not*
MCP-managed: architecture docs in `docs/architecture/`, principles in
`docs/principles/`, and ADRs in `docs/adr/`.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a parent task; **children** are its subtasks.

- **Map**: a task labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog
  body in its `description`. Create with `task_create`.
- **Child ticket**: `task_create` with `parentTaskId` set to the map's id, and a
  `wayfinder:<type>` label (`research` / `prototype` / `grilling` / `task`).
- **Blocking**: the `dependencies` array on the child, listing blocker task ids. A
  ticket is unblocked when every dependency is `Done`.
- **Frontier query**: `task_list` with `ready: true`, `unassigned: true` and
  `status: "To Do"`, then keep the children of the map; first in ordinal order wins.
- **Claim**: `task_edit` with `assignee` and `status: "In Progress"` — the session's
  first write.
- **Resolve**: `task_edit` with `commentsAppend` (the answer), `finalSummary`, and
  `status: "Done"`; then append a context pointer to the map's Decisions-so-far with a
  second `task_edit` on the map.

## If the MCP tools are missing

The server is declared in this repo's `.mcp.json` and runs as
`mise exec -- backlog mcp start`. Project-scope servers must be named in
`enabledMcpjsonServers` (or approved interactively) before they load.
