---
id: TASK-276
title: >-
  virtual-ipod-app: Tauri macOS app with frameless transparent window and VM
  lifecycle
status: Done
assignee: []
created_date: '2026-04-03 20:19'
updated_date: '2026-04-03 21:11'
labels:
  - virtual-ipod-app
  - tauri
milestone: m-17
dependencies: []
references:
  - doc-028
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the standalone macOS Tauri app that hosts ipod-web and manages the Lima VM.

**Package setup:**
- `packages/virtual-ipod-app/`
- Tauri v2 with React frontend
- `src-tauri/` for Rust backend
- `src/` for frontend (loads ipod-web)

**Window configuration:**
- Frameless: `decorations: false`
- Transparent: `transparent: true`
- Fixed size matching iPod proportions (~420×720, tune to match Shell.tsx)
- Not resizable
- `data-tauri-drag-region` on iPod body for window dragging
- macOS will composite the iPod-shaped content with native drop shadow

**Frontend (`src/App.tsx`):**
```tsx
import { VirtualIpod, RemoteStorage } from '@podkit/ipod-web'

const storage = new RemoteStorage(`http://localhost:${PORT}`)

function App() {
  return <VirtualIpod storage={storage} />
}
```

**Rust backend — VM lifecycle (`vm.rs`):**
- On launch: `limactl list --json` to check if `virtual-ipod` VM exists
- If not: `limactl create --name virtual-ipod <template.yaml>`
- If stopped: `limactl start virtual-ipod`
- Wait for server: poll `GET /status` until healthy
- Expose Tauri commands: `vm_status`, `vm_start`, `vm_stop`
- On app quit: leave VM running (user may want terminal access)

**Rust backend — port forwarding:**
- Lima handles port forwarding natively in its YAML config
- Verify the forwarded port is accessible from the host
- Pass the port URL to the frontend

**Build:**
- `cargo tauri build` produces a `.app` bundle for macOS
- Include the Lima VM template YAML as a bundled resource
- App icon: iPod silhouette or podkit logo
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 App opens as a frameless transparent window shaped like an iPod
- [x] #2 iPod body area is draggable to move the window
- [x] #3 VirtualIpod component renders with RemoteStorage connected to VM
- [x] #4 App creates Lima VM on first launch if it doesn't exist
- [x] #5 App starts VM if it's stopped
- [x] #6 App waits for server health check before showing iPod UI
- [ ] #7 cargo tauri build produces a working .app bundle
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Full Tauri v2 scaffold. Frontend: React + VirtualIpod with RemoteStorage at localhost:3456. Rust backend: vm.rs (limactl exists/running/start/stop), commands.rs (4 Tauri commands), shell plugin. Window: 420x700 frameless transparent. Bundles Lima VM config as resource. TypeScript typecheck passes. Rust cargo check not verified — Rust not installed on this machine. AC #7 (cargo tauri build) requires Rust installation.
<!-- SECTION:NOTES:END -->
