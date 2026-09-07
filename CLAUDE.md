@AGENTS.md

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).

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
exit when they differ), and `graphify-out/` is gitignored so a new worktree
starts without one. Run `mise run graph:build` inside the worktree if you want a
graph there; it costs ~45s and ~23 MB, and `git worktree remove` cleans it up.
Agents that skip this simply fall back to grep — the `PreToolUse` guard in
`.claude/settings.json` stays silent when no graph is present.

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
