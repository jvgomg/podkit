---
id: TASK-275
title: 'virtual-ipod-server: REST/WebSocket API and USB gadget lifecycle'
status: Done
assignee: []
created_date: '2026-04-03 20:18'
updated_date: '2026-04-03 21:11'
labels:
  - virtual-ipod-server
milestone: m-17
dependencies: []
references:
  - doc-028
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Implement the virtual-ipod-server that runs inside the Lima VM. This is a single package that handles everything: USB gadget management, iPod filesystem serving, and real-time event notifications.

**Package setup:**
- `packages/virtual-ipod-server/package.json`
- Runtime: Bun or Node.js (must work in the Lima VM)
- HTTP framework: Hono or Bun.serve (lightweight)
- Runs as root (needed for modprobe and configfs)

**REST API:**

| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /status` | Status | Connection state, device info, track count |
| `POST /plug` | Plug in | Load kernel modules, create configfs gadget, mount image |
| `POST /unplug` | Unplug | Unmount, tear down configfs, unload modules |
| `GET /database` | Database | Serve iTunesDB binary |
| `GET /artwork-db` | ArtworkDB | Serve ArtworkDB binary |
| `GET /sysinfo` | SysInfo | Serve SysInfo text |
| `GET /ithmb/:filename` | Artwork | Serve .ithmb cache files |
| `GET /audio/*path` | Audio | Stream audio file from mount, support range requests |
| `WS /events` | Events | Push: plugged, unplugged, database-changed |

**USB gadget lifecycle (`gadget.ts`):**
- `plug()`: modprobe dummy_hcd + libcomposite, create configfs gadget at `/sys/kernel/config/usb_gadget/virtual_ipod`, set Apple vendor/product IDs (0x05ac/0x1209), bind to UDC, mount /dev/sda1
- `unplug()`: unmount, unbind UDC, tear down configfs dirs, rmmod
- `status()`: check if gadget is bound, if image is mounted
- All operations write to configfs via `fs.writeFileSync` (sysfs/configfs requires sync writes)
- See doc-028 for exact configfs commands

**FAT32 image management (`image.ts`):**
- Create image: `dd` + `mkfs.vfat -F 32 -n IPOD`
- Initialize iPod structure: run `gpod-tool` or create directories manually (iPod_Control/iTunes/, iPod_Control/Device/, iPod_Control/Music/F00-F19/)
- Write SysInfo with ModelNumStr for iPod 5th gen
- Image stored at `/var/lib/virtual-ipod.img` (configurable size, default 2GB)

**Database change watcher (`watcher.ts`):**
- Watch `/mnt/ipod/iPod_Control/iTunes/iTunesDB` with `fs.watch` or inotify
- Debounce 2-3 seconds (podkit writes multiple files during sync)
- Emit `database-changed` on WebSocket to all connected clients

**Audio serving:**
- Range request support (essential for `<audio>` seeking)
- Correct MIME types: `.m4a` → `audio/mp4`, `.mp3` → `audio/mpeg`
- Path: iPod colon-separated paths converted to filesystem paths
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 POST /plug creates configfs gadget with Apple USB IDs and mounts image
- [x] #2 POST /unplug cleanly tears down gadget and unmounts
- [x] #3 GET /status reports correct connection state
- [x] #4 GET /database serves raw iTunesDB binary
- [x] #5 GET /audio/* streams audio files with range request support
- [x] #6 WebSocket pushes plugged/unplugged/database-changed events
- [x] #7 FAT32 image created and initialized with iPod directory structure
- [x] #8 Database change watcher debounces and notifies on iTunesDB modification
- [ ] #9 podkit device scan detects the virtual iPod after plug
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Hono HTTP server with Bun.serve WebSocket. configfs gadget lifecycle (plug/unplug with full setup/teardown). FAT32 image creation + iPod structure init. Range request audio streaming. Debounced iTunesDB watcher. CORS enabled. Graceful SIGINT/SIGTERM shutdown. Configurable via env vars (PORT, IMAGE_PATH, MOUNT_POINT). 9 tests (path conversion + watcher debounce). AC #9 requires running in the VM with real kernel modules.
<!-- SECTION:NOTES:END -->
