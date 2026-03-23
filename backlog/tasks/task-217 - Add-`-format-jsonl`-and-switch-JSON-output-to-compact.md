---
id: TASK-217
title: Add `--format jsonl` and switch JSON output to compact
status: To Do
assignee: []
created_date: '2026-03-23 18:25'
labels:
  - cli
  - ux
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
User testing identified two JSON output improvements:

1. **JSONL format**: Add `--format jsonl` (JSON Lines) where each record is a single-line JSON object. This is easier to stream through pipes, resilient to truncation (each line independently parseable), and grep-friendly. Requested for agent/scripting workflows.

2. **Compact JSON**: Switch `--format json` from pretty-printed (`JSON.stringify(data, null, 2)`) to compact (`JSON.stringify(data)`). Users requesting JSON are typically piping it somewhere; `| jq .` handles pretty-printing when needed.

Both changes should be applied as a sweeping change across all commands that support `--format`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 New `--format jsonl` option available on all commands that support `--format`
- [ ] #2 JSONL outputs one JSON object per line, no wrapping array, no indentation
- [ ] #3 Each JSONL line is independently parseable as valid JSON
- [ ] #4 `--format json` outputs compact JSON (no indentation/newlines within the structure)
- [ ] #5 JSONL respects `--fields` filtering the same way JSON and CSV do
- [ ] #6 `--help` lists jsonl as a valid format option
- [ ] #7 Tests cover: JSONL output parsing, compact JSON output, field filtering with JSONL
<!-- AC:END -->
