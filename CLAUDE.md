@AGENTS.md

## Agent skills

### Issue tracker

Issues and specs are Backlog.md tasks under `backlog/`, read and written only through the Backlog.md MCP tools — never by editing files directly. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles, applied as Backlog.md labels under their default names. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `CONTEXT.md`, ADRs in `docs/adr/`. See `docs/agents/domain.md`.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
