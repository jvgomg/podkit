@AGENTS.md

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A `graphify` MCP server is declared in `.mcp.json` alongside `backlog`. Like
  that one it runs via `mise exec` — Claude Code spawns it itself and does not
  inherit the directory's mise activation, so a project tool is not on plain
  PATH. It needs the `mcp` extra, which is why `mise.toml` pins graphify with
  `extras = ["mcp"]`.

Setup: nothing under `graphify-out/` is committed — it is gitignored in full,
and each checkout builds its own. graphify itself is pinned in `mise.toml`
(`"pipx:graphifyy"`), so a clone needs only:

```bash
mise install          # installs graphify (and bun, ffmpeg, ...)
mise run graph:build  # builds graphify-out/ — AST-only, offline, ~45s
```

The git hooks then keep it current on every commit and branch switch. They find
the interpreter via `mise where`, so no absolute path is committed.

**Worktrees:** `.husky/post-commit` and `post-checkout` deliberately no-op in a
worktree (they compare `git rev-parse --git-dir` against `--git-common-dir` and
exit when they differ), so nothing rebuilds the graph there automatically.

Instead of rebuilding, worktrees *inherit and validate* the graph.
`.worktreeinclude` copies `graphify-out/` into every worktree Claude Code
creates, which takes ~0s against ~45s to build one. Copy-then-rebuild would
save nothing — `graphify update` re-extracts ~1160 of 1486 files even when the
graph is already current — so the `SessionStart` hook
(`.claude/hooks/graphify-graph-check.sh`) compares `built_at_commit` in
`graph.json` against the checkout's HEAD instead:

- **match** — the copy is correct, nothing runs (the common case when the
  worktree branches from the commit you were on).
- **mismatch** — the graph is retired to `graph.stale.json` and rebuilt in the
  background. Agents fall back to grep meanwhile, because graphify's
  `PreToolUse` guard goes quiet when no graph is present.

`.claude/settings.json` sets `worktree.baseRef: "head"`, so worktrees branch
from the commit you are on rather than the remote default branch. That makes the
match case — and so the zero-cost path — the norm rather than the exception, and
it is also what subagents want when they need to operate on in-progress work.
The cost is that a worktree inherits your current branch state instead of
starting clean from `main`.

Do not commit absolute paths into the hooks: `graphify hook install` regenerates
`.husky/post-commit` and `.husky/post-checkout` with a machine- and
version-specific interpreter path baked in, and those files are tracked. If you
re-run it, re-apply the portability block (the `_PINNED` mise lookup) and the
`|| true` on `command -v graphify` — without the latter, husky's `sh -e` aborts
the hook with code 127 on any machine where graphify is not on PATH.

## Agent skills

### Issue tracker

Issues and specs are Backlog.md tasks under `backlog/`, read and written only through the Backlog.md MCP tools — never by editing files directly. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, applied as Backlog.md labels under their default names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `CONTEXT.md`, ADRs in `docs/adr/`. See `docs/agents/domain.md`.
