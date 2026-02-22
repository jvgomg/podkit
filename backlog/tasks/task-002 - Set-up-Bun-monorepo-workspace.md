---
id: TASK-002
title: Set up Bun monorepo workspace
status: Done
assignee: []
created_date: '2026-02-22 18:32'
updated_date: '2026-02-22 20:47'
labels: []
milestone: 'M0: Project Bootstrap'
dependencies: []
references:
  - docs/adr/ADR-001-runtime.md
  - docs/ARCHITECTURE.md
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Initialize the Bun workspace/monorepo structure for the three packages:
- packages/libgpod-node
- packages/podkit-core  
- packages/podkit-cli

This includes:
- Root package.json with workspaces configuration
- Package-level package.json files with correct dependencies
- TypeScript configuration (tsconfig.json) for the monorepo
- Basic build scripts

Reference ADR-001 for runtime decisions (Bun dev, Node distribution).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Root package.json with workspaces configured
- [x] #2 All three package directories created with package.json
- [x] #3 TypeScript configured for monorepo
- [x] #4 bun install works without errors
- [x] #5 Basic bun test and bun run build scripts defined
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Implementation Notes

**Tooling versions (as of 2026-02-22):**
- Bun: 1.3.9 (via mise.toml)
- TypeScript: 5.9.3
- Turborepo: 2.8.10
- oxlint: 1.49.0
- Prettier: 3.8.1

**Files created:**
- `mise.toml` - Bun version management
- `package.json` - Root workspace with scripts
- `turbo.json` - Turborepo task config
- `tsconfig.json` - Shared TypeScript config
- `oxlint.json` - Linter config (correctness/suspicious rules)
- `.prettierrc` / `.prettierignore` - Formatter config (ignores markdown)
- `.gitignore` - Standard ignores
- `packages/*/package.json` - Package configs with workspace deps
- `packages/*/tsconfig.json` - Package TypeScript configs
- `packages/*/src/index.ts` - Stub exports
- `packages/*/src/*.test.ts` - Placeholder tests

**Commands available:**
- `bun run build` - Build all packages
- `bun run test` - Run all tests
- `bun run lint` / `lint:fix` - oxlint
- `bun run format` / `format:check` - Prettier
- `bun run typecheck` - TypeScript checking
- `bun run clean` - Clean build outputs
<!-- SECTION:NOTES:END -->
