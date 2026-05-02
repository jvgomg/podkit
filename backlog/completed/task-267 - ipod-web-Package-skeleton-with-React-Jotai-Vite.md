---
id: TASK-267
title: 'ipod-web: Package skeleton with React, Jotai, Vite'
status: Done
assignee: []
created_date: '2026-04-03 20:16'
updated_date: '2026-04-03 20:31'
labels:
  - ipod-web
  - setup
milestone: m-17
dependencies: []
references:
  - doc-028
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Set up the `@podkit/ipod-web` package in the monorepo with build tooling and dev server.

**Package setup:**
- `packages/ipod-web/package.json` with name `@podkit/ipod-web`
- Dependencies: `react`, `react-dom`, `jotai`, `@podkit/ipod-db`
- Dev dependencies: `vite`, `@vitejs/plugin-react`, `typescript`
- `packages/ipod-web/tsconfig.json` extending root config
- Vite config for library mode (exports React component) + dev server mode
- Source Sans 3 font (variable weight) — either `@fontsource-variable/source-sans-3` or self-hosted woff2

**Directory structure (empty/stub files):**
```
src/
  index.ts                    # Public exports: VirtualIpod, StorageProvider, RemoteStorage, BrowserStorage
  firmware/menu.ts, playback.ts, types.ts
  store/database.ts, navigation.ts, playback.ts, device.ts, settings.ts
  ui/VirtualIpod.tsx, Shell.tsx, Screen.tsx, ClickWheel.tsx
  ui/screens/  (empty dir)
  ui/shared/   (empty dir)
  audio/player.ts
  storage/types.ts, browser.ts, remote.ts
```

**Dev server (`bun run dev`):**
- Vite dev server with hot reload
- Entry page renders `<VirtualIpod>` with a mock StorageProvider that returns fixture data
- Allows UI development without any VM or backend

**Storage stubs:**
- `browser.ts` — every method throws `Error("BrowserStorage is not yet implemented")`
- `remote.ts` — scaffold with TODO, connects to `http://localhost:3456`
- `types.ts` — `StorageProvider` interface as defined in doc-028
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Package builds in monorepo (bun run build)
- [x] #2 bun run dev opens Vite dev server with VirtualIpod component rendered
- [x] #3 Source Sans 3 font loads correctly
- [x] #4 StorageProvider interface exported
- [x] #5 BrowserStorage stub throws on all methods
- [x] #6 Package importable from other workspace packages
<!-- AC:END -->
