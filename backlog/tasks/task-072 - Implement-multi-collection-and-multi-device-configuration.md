---
id: TASK-072
title: Implement multi-collection and multi-device configuration
status: To Do
assignee: []
created_date: '2026-03-08 23:46'
labels:
  - config
  - cli
  - refactor
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Overview

Implement the configuration and CLI changes designed in ADR-008 to support multiple music/video collections and multiple iPod devices.

## Scope

This task covers the full implementation of:
1. New config schema with `[music.*]`, `[video.*]`, `[devices.*]` namespaces
2. Unified `sync` command handling both music and video
3. New `device` and `collection` management commands
4. Device-scoped quality and transform settings
5. Backwards compatibility for existing configs

## References

- [ADR-008](docs/adr/ADR-008-multi-collection-device-config.md): Full design specification
- TASK-062: Original design discussion
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 New config schema types defined and validated
- [ ] #2 Config loader parses new schema correctly
- [ ] #3 Backwards compatibility with old config format
- [ ] #4 Unified `sync` command with music/video subcommands
- [ ] #5 `-c` and `-d` flags work on sync command
- [ ] #6 `device` command (list, add, remove, show) implemented
- [ ] #7 `collection` command (list, add, remove, show) implemented
- [ ] #8 Device-scoped quality settings applied during sync
- [ ] #9 Device-scoped transforms applied during sync
- [ ] #10 All existing commands accept `-d` flag
- [ ] #11 Unit tests for config parsing
- [ ] #12 Integration tests for new CLI commands
- [ ] #13 E2E test for multi-device workflow
<!-- AC:END -->
