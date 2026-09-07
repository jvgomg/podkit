#!/usr/bin/env bash
# SessionStart: validate the graphify graph against the checkout it is sitting in.
#
# .worktreeinclude copies graphify-out/ into every worktree Claude Code creates,
# so a new worktree has a usable graph in ~0s instead of waiting ~45s to build
# one. That copy is only correct if the worktree is at the commit the graph was
# built from — a worktree created from an arbitrary base carries a map of
# someone else's tree.
#
# Copy-then-rebuild is not an option: `graphify update` re-extracts ~1160 of
# 1486 files even when the graph is already current, so refreshing costs the
# same as building from scratch. We validate instead: graph.json records
# `built_at_commit`.
#
# On a mismatch the graph is retired rather than trusted. CLAUDE.md tells agents
# to query the graph before grepping, and graphify's PreToolUse guard goes quiet
# when no graph is present — so retiring it makes agents fall back to grep,
# which is correct, while a background rebuild catches up.
set -uo pipefail

input=$(cat 2>/dev/null || true)
cwd=$(printf '%s' "$input" | jq -r '.cwd // empty' 2>/dev/null || true)
[ -n "${cwd:-}" ] || cwd="$PWD"

graph="$cwd/graphify-out/graph.json"
[ -f "$graph" ] || exit 0

built=$(jq -r '.built_at_commit // empty' "$graph" 2>/dev/null || true)
head=$(git -C "$cwd" rev-parse HEAD 2>/dev/null || true)
[ -n "${built:-}" ] && [ -n "${head:-}" ] || exit 0
[ "$built" = "$head" ] && exit 0

mv -f "$graph" "$cwd/graphify-out/graph.stale.json" 2>/dev/null || true

# Probe by running it, not with `command -v`: graphify is pinned in mise.toml,
# so the mise shim is on PATH but errors with "No version is set for shim" in a
# checkout whose mise.toml predates the pin.
if graphify --version >/dev/null 2>&1; then
  # Log rather than discard: a silent background failure would leave the
  # checkout with no graph and no explanation.
  log="${HOME}/.cache/graphify-rebuild.log"
  mkdir -p "$(dirname "$log")" 2>/dev/null || true
  ( cd "$cwd" && nohup graphify update . >>"$log" 2>&1 & ) >/dev/null 2>&1
  echo "graphify: graph was built at ${built:0:8} but this checkout is at ${head:0:8}. Retired it and started a background rebuild (~45s, log: $log) — use grep until it lands."
else
  echo "graphify: graph was built at ${built:0:8} but this checkout is at ${head:0:8}. Retired it; run 'mise run graph:build' for a current one."
fi
exit 0
