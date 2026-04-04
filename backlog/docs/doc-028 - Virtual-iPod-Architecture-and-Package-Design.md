---
id: doc-028
title: 'Virtual iPod: Architecture and Package Design'
type: other
created_date: '2026-04-03 19:57'
updated_date: '2026-04-03 20:15'
---
# Virtual iPod: Architecture and Package Design

## Overview

A virtual iPod application for demonstrating podkit. The system consists of four packages that together create a standalone macOS app presenting a functional iPod 5th generation (Video) that reads real iTunesDB databases, plays music, and can be "plugged in" to a Linux VM where podkit commands work against it as if it were a real USB device.

The iPod web UI is designed as a reusable React component that can also run standalone in a browser (e.g., on a website) with a browser-based storage adapter.

## Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| V1 | Target device | iPod 5th gen (Video) | Most iconic, richest feature set |
| V2 | Content scope | Music only (no video) | Simplifies initial scope |
| V3 | Screen rendering | Higher resolution (2x-3x) with iPod aesthetic | Crisp on modern displays |
| V4 | Click wheel input | Full rotational drag + keyboard arrows | Authentic interaction |
| V5 | UI framework | React + Jotai | Jotai atoms map well to iPod state |
| V6 | Mac app shell | Tauri | Smaller bundle (~10MB vs ~150MB Electron), ipod-web stays a pure React package with no Tauri deps |
| V7 | Window style | Frameless + transparent (iPod-shaped window) | `decorations: false` + `transparent: true` in Tauri; CSS border-radius on iPod body |
| V8 | Storage adapters | In ipod-web package, not separate packages | Avoids premature abstraction |
| V9 | Browser storage | Stub that throws; full implementation deferred to backlog | Needs ipod-db write support (m-8 Phase 2) |
| V10 | WASM for libgpod | Rejected (doc-027) | GLib has no official WASM support; pure TS parser instead |
| V11 | iTunesDB parsing | @podkit/ipod-db pure TypeScript (shared with m-8) | Browser-compatible, zero native deps |
| V12 | USB gadget approach | configfs + dummy_hcd + usb_f_mass_storage | Legacy g_mass_storage not in Bookworm; configfs available and creates real sysfs entries |
| V13 | VM kernel | Debian 12 Bookworm stock kernel (6.1) | dummy_hcd and configfs mass storage both available as modules |
| V14 | Font | Source Sans 3 (variable) | Clean, readable at small sizes, open source |

## Spike Results

### WASM Compilation (doc-027) — REJECTED
GLib has no official WASM support. Community forks are fragile. Pure TypeScript parser is smaller, simpler, runs everywhere. See doc-027 for full findings.

### dummy_hcd in Lima VM — CONFIRMED WORKING
- `dummy_hcd` available in Debian 12 Bookworm (`CONFIG_USB_DUMMY_HCD=m`)
- `usb_f_mass_storage` available via configfs (`CONFIG_USB_CONFIGFS_MASS_STORAGE=y`)
- Works inside QEMU/Lima — purely software, no real USB hardware needed
- Creates real `/sys/bus/usb/` entries with Apple vendor/product IDs
- podkit's Linux device scanner finds it without modification
- Root required for modprobe and configfs writes

Sources: [Collabora blog](https://www.collabora.com/news-and-blog/blog/2019/06/24/using-dummy-hcd/), [Linux kernel gadget testing docs](https://docs.kernel.org/usb/gadget-testing.html), Debian bugs #931058, #962708.

## System Architecture

```
┌───────────────────────────────────────────────┐
│  macOS Host                                    │
│                                                │
│  ┌────────────────────┐    ┌────────────────┐  │
│  │ virtual-ipod-app   │    │ Terminal (SSH)  │  │
│  │ (Tauri)            │    │ into Lima VM    │  │
│  │                    │    │                 │  │
│  │ ┌────────────────┐ │    │ $ podkit sync   │  │
│  │ │ ipod-web       │ │    │ $ podkit doctor │  │
│  │ │ (React+Jotai)  │ │    │ $ podkit device │  │
│  │ │                │ │    │   scan          │  │
│  │ │ remote storage │ │    └────────┬────────┘  │
│  │ └───────┬────────┘ │             │ SSH        │
│  └─────────┼──────────┘             │            │
│            │ HTTP/WS                │            │
│            └──────────┬─────────────┘            │
│  ┌────────────────────▼─────────────────────┐   │
│  │  Lima VM (Debian 12 Bookworm)            │   │
│  │                                          │   │
│  │  virtual-ipod-server                     │   │
│  │  ├── REST API (database, audio, status)  │   │
│  │  ├── WebSocket (plug/unplug events)      │   │
│  │  ├── configfs USB gadget lifecycle       │   │
│  │  └── inotify watcher (DB changes)        │   │
│  │                                          │   │
│  │  Kernel modules:                         │   │
│  │  ├── dummy_hcd (virtual USB controller)  │   │
│  │  ├── libcomposite (configfs gadget)      │   │
│  │  └── usb_f_mass_storage (mass storage)   │   │
│  │                                          │   │
│  │  /dev/sda1 ← virtual USB block device    │   │
│  │  /mnt/ipod ← mounted FAT32 image        │   │
│  │  /sys/bus/usb/... ← Apple vendor/product │   │
│  │                                          │   │
│  │  podkit CLI (runs normally, zero changes)│   │
│  └──────────────────────────────────────────┘   │
└───────────────────────────────────────────────┘
```

## Package Design

### 1. @podkit/ipod-web

**Purpose:** The iPod itself — firmware logic, UI, audio playback, and storage adapters. A reusable React component. Has zero knowledge of Tauri, Electron, or any app shell.

**Tech:** React, Jotai, TypeScript, @podkit/ipod-db (read-only parser)

**Exports:** `<VirtualIpod>` component, `StorageProvider` interface, `RemoteStorage` adapter, `BrowserStorage` stub

```
packages/ipod-web/
├── src/
│   ├── index.ts                    # Public exports
│   │
│   ├── firmware/                   # iPod OS logic (pure state, no DOM)
│   │   ├── menu.ts                 # Menu tree definition + navigation state machine
│   │   ├── playback.ts             # Track queue, shuffle, repeat, scrub
│   │   └── types.ts                # MenuNode, PlaybackState, etc.
│   │
│   ├── store/                      # Jotai atoms (the iPod's "brain")
│   │   ├── database.ts             # IpodReader instance, track/playlist data
│   │   ├── navigation.ts           # Menu stack, selected index, scroll position
│   │   ├── playback.ts             # Current track, play/pause, position, volume
│   │   ├── device.ts               # Model info, connected state
│   │   └── settings.ts             # Backlight, shuffle, repeat, EQ
│   │
│   ├── ui/                         # React components
│   │   ├── VirtualIpod.tsx         # Root: shell + screen + wheel, accepts StorageProvider
│   │   ├── Shell.tsx               # iPod 5th gen body (CSS/SVG, high-res)
│   │   ├── Screen.tsx              # LCD display area (320x240 logical, scaled up)
│   │   ├── ClickWheel.tsx          # Full rotational input + cardinal buttons
│   │   ├── screens/
│   │   │   ├── MainMenu.tsx
│   │   │   ├── MusicMenu.tsx
│   │   │   ├── Artists.tsx, Albums.tsx, Songs.tsx, Genres.tsx
│   │   │   ├── Playlists.tsx, PlaylistDetail.tsx
│   │   │   ├── NowPlaying.tsx      # Album art, track info, scrubber
│   │   │   └── Settings.tsx
│   │   └── shared/
│   │       ├── ListView.tsx        # Scrollable list with selection highlight + inertia
│   │       ├── Header.tsx          # Title bar with battery, play indicator, clock
│   │       └── ProgressBar.tsx     # Scrubber, volume bar
│   │
│   ├── audio/
│   │   └── player.ts              # <audio> element wrapper, preloading
│   │
│   └── storage/
│       ├── types.ts                # StorageProvider interface
│       ├── browser.ts              # STUB — throws "not yet implemented", full impl deferred
│       └── remote.ts               # HTTP/WS adapter (talks to virtual-ipod-server)
│
├── package.json                    # deps: react, jotai, @podkit/ipod-db
└── tsconfig.json
```

#### Click Wheel Design

**Input model:** The click wheel supports three input modes simultaneously:

1. **Mouse/touch drag:** User clicks and drags around the wheel circumference. Angular velocity maps to scroll speed. Clockwise = scroll down, counter-clockwise = scroll up.
2. **Keyboard:** Arrow up/down for scrolling (equivalent to wheel rotation). Enter for select, Escape for menu/back.
3. **Button zones:** Five distinct hit areas — center (select), top (menu), bottom (play/pause), left (back), right (forward).

**Rotation tracking algorithm:**
- Convert mouse position to angle relative to wheel center
- Track angular delta between frames
- Apply dead zone near center (finger on center button, not wheel)
- Accumulate angular delta; emit scroll event per N degrees of rotation
- Direction: clockwise = positive (scroll down), counter-clockwise = negative (scroll up)

**Keyboard mapping:**
| Key | Action |
|-----|--------|
| Arrow Up | Scroll up (previous item) |
| Arrow Down | Scroll down (next item) |
| Arrow Right / Enter | Select / Forward |
| Arrow Left / Escape | Menu / Back |
| Space | Play / Pause |

#### Screen Rendering

- **Logical resolution:** 320x240 (matching real iPod 5th gen LCD)
- **Render resolution:** 640x480 or higher (2x-3x scale for crisp display)
- **Font:** Source Sans 3 (variable weight). Bundled with ipod-web package via `@fontsource-variable/source-sans-3` or self-hosted woff2.
- **Colors:** Match the iPod's actual color palette (blue highlight bar, black text, white background, grayscale status bar)

#### StorageProvider Interface

```typescript
interface StorageProvider {
  loadDatabase(): Promise<IpodReader>
  getAudioUrl(ipodPath: string): Promise<string>
  connected: boolean
  onConnectionChange(cb: (connected: boolean) => void): () => void
  reload(): Promise<IpodReader>
}
```

**BrowserStorage (STUB):** Throws "BrowserStorage is not yet implemented" on any method call. Full implementation deferred — requires ipod-db write support (m-8 Phase 2, TASK-117) to create iTunesDB from imported files.

**RemoteStorage:** Fetches database files and streams audio from virtual-ipod-server over HTTP. WebSocket for connection state changes and database reload notifications.

### 2. @podkit/virtual-ipod-server

**Purpose:** Runs inside Lima VM. Manages USB gadget lifecycle and serves iPod filesystem to the mac app.

```
packages/virtual-ipod-server/
├── src/
│   ├── main.ts                # Server entry point (Bun.serve or Hono)
│   ├── gadget.ts              # configfs USB gadget lifecycle (plug/unplug)
│   ├── image.ts               # FAT32 image creation + gpod-tool init
│   ├── mount.ts               # Loop mount/unmount
│   ├── api.ts                 # REST routes
│   ├── watcher.ts             # inotify for iTunesDB changes
│   └── types.ts
└── package.json
```

**API:**
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/status` | GET | Connection state, device info, track count |
| `/plug` | POST | Load gadget modules, bind to UDC, mount image |
| `/unplug` | POST | Unbind UDC, unmount, cleanup configfs |
| `/database` | GET | Raw iTunesDB + ArtworkDB + SysInfo as multipart or zip |
| `/audio/:path` | GET | Stream audio file from mounted image, range requests |
| `/events` | WS | Push: plugged, unplugged, database-changed |

**USB Gadget lifecycle (configfs approach):**

```bash
# Plug in
modprobe dummy_hcd
modprobe libcomposite

GADGET=/sys/kernel/config/usb_gadget/virtual_ipod
mkdir -p $GADGET
echo 0x05ac > $GADGET/idVendor          # Apple Inc.
echo 0x1209 > $GADGET/idProduct         # iPod Classic 6G

mkdir -p $GADGET/strings/0x409
echo "Apple Inc." > $GADGET/strings/0x409/manufacturer
echo "iPod"       > $GADGET/strings/0x409/product

mkdir -p $GADGET/configs/c.1/strings/0x409
mkdir -p $GADGET/functions/mass_storage.0/lun.0
echo /var/lib/virtual-ipod.img > $GADGET/functions/mass_storage.0/lun.0/file
ln -sf $GADGET/functions/mass_storage.0 $GADGET/configs/c.1/

echo "$(ls /sys/class/udc | head -1)" > $GADGET/UDC
# → /dev/sda appears, lsblk sees it, /sys/bus/usb has Apple IDs

mount /dev/sda1 /mnt/ipod

# Unplug
umount /mnt/ipod
echo "" > $GADGET/UDC
# cleanup configfs directories...
modprobe -r dummy_hcd
```

**Note:** Requires root. The server runs as root in the VM or uses sudo for gadget operations.

**Database change detection:**
- Watch `/mnt/ipod/iPod_Control/iTunes/iTunesDB` with inotify
- Debounce (podkit writes multiple files during sync)
- Emit `database-changed` event on WebSocket
- Client (ipod-web) calls `reload()` to re-parse database

### 3. @podkit/virtual-ipod-app

**Purpose:** Standalone macOS Tauri app. Hosts ipod-web in a frameless transparent window (iPod-shaped) and manages the Lima VM lifecycle.

```
packages/virtual-ipod-app/
├── src-tauri/
│   ├── Cargo.toml             # Rust dependencies
│   ├── src/
│   │   ├── main.rs            # Tauri entry point
│   │   ├── vm.rs              # Lima VM lifecycle (start, stop, health check)
│   │   └── commands.rs        # Tauri commands exposed to frontend
│   ├── tauri.conf.json        # Window config: decorations=false, transparent=true
│   └── icons/                 # App icon
├── src/                       # Frontend (loaded by Tauri WebView)
│   ├── index.html
│   └── App.tsx                # Mounts <VirtualIpod storage={remoteStorage}/>
├── package.json
└── tsconfig.json
```

**Window configuration (tauri.conf.json):**
```json
{
  "windows": [{
    "decorations": false,
    "transparent": true,
    "resizable": false,
    "width": 420,
    "height": 720
  }]
}
```

The entire window IS the iPod — the React component renders the device body with CSS border-radius, and the area outside is transparent. macOS composites it with a native drop shadow. Window is draggable via `data-tauri-drag-region` on the iPod body area.

**VM management (Rust backend):**
1. On launch: check if Lima VM `virtual-ipod` exists
2. If not: create from template (based on existing `tools/lima/debian.yaml`)
3. Start VM if not running
4. Wait for server health check (`GET /status`)
5. Emit ready event to frontend
6. On quit: optionally stop VM (or leave running for terminal use)

### 4. Lima VM Configuration

Extends existing `tools/lima/debian.yaml`:
- Debian 12 Bookworm stock kernel (6.1) — has dummy_hcd and configfs mass storage
- Pre-installed: `virtual-ipod-server`, podkit CLI, gpod-tool
- Provision script loads kernel modules on boot
- Port forwarding for server API port (e.g., host 3456 → guest 3456)
- Disk: 10GB+ for iPod image storage
- Shared filesystem: mount podkit repo read-write for development

## Dependency Graph

```
@podkit/ipod-db          ← Pure TS iTunesDB parser (read-only for m-17)
       ↑
@podkit/ipod-web         ← React + Jotai iPod component (pure web, no app shell deps)
       ↑
@podkit/virtual-ipod-app ← Tauri shell (Rust backend + loads ipod-web in WebView)
       │
       ↓ (HTTP/WS)
@podkit/virtual-ipod-server ← Lima VM backend
```

## Development Workflow

**ipod-web standalone dev:**
```bash
cd packages/ipod-web
bun run dev  # Vite dev server with hot reload
# Opens browser with <VirtualIpod> using a mock/fixture StorageProvider
# No VM needed for UI development
```

**Full stack dev:**
```bash
# Terminal 1: Start VM + server
lima virtual-ipod
# Inside VM: bun run --cwd /path/to/virtual-ipod-server start

# Terminal 2: Run Tauri app in dev mode
cd packages/virtual-ipod-app
cargo tauri dev  # Tauri with hot reload, connects to VM server

# Terminal 3: SSH into VM, run podkit
lima shell virtual-ipod
podkit device scan  # Should see the virtual iPod
podkit sync -c main --dry-run
```

## Open Questions

1. **Gapless playback** — Web Audio API can do this but adds complexity. Defer to later phase.
2. **Browser storage full implementation** — Deferred until ipod-db write support lands (m-8 Phase 2). Stub throws for now.
