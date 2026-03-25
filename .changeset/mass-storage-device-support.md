---
"podkit": minor
"@podkit/core": minor
"@podkit/daemon": minor
---

Add mass-storage device support for non-iPod portable music players.

**Supported device types:** Echo Mini, Rockbox, and generic mass-storage DAPs. iPod support is unchanged.

**New in CLI (`podkit`):**
- `podkit device add --type <type>` registers mass-storage devices by type and mount path
- `podkit device info/music/video` work with mass-storage devices via `DeviceAdapter` interface
- `podkit device scan` shows configured path-based devices alongside auto-detected iPods
- `podkit sync` routes to the correct adapter (iPod or mass-storage) based on device config
- Video sync now uses capabilities-based gating instead of iPod-only checks
- Safety gates on `device init/reset/clear` (iPod-only commands) for mass-storage devices
- Mount and eject commands show device-appropriate messaging
- Config validation rejects capability overrides on iPod devices (capabilities are auto-detected from generation)
- Shared `openDevice()` function eliminates duplicated device-opening logic across commands

**New in core (`@podkit/core`):**
- `DeviceAdapter` interface — generic abstraction over device databases (iPod, mass-storage)
- `MassStorageAdapter` — filesystem-based track management with `.podkit/state.json` manifest
- `IpodDeviceAdapter` — thin wrapper making `IpodDatabase` implement `DeviceAdapter`
- Device capability presets for Echo Mini, Rockbox, and generic devices
- `resolveDeviceCapabilities()` merges preset defaults with user config overrides
- `DeviceTrack` type used throughout sync engine (replaces `IPodTrack` casts in execution paths)
- Video file placement on mass-storage: `Video/Movies/` and `Video/{Show}/Season {N}/`
- Video scanning support for mass-storage devices (.m4v, .mp4, .mov, .avi, .mkv)

**New in daemon (`@podkit/daemon`):**
- Mass-storage device polling via `PODKIT_MASS_STORAGE_PATHS` env var (colon/comma separated)
- Second `DevicePoller` + `SyncOrchestrator` pair for mass-storage devices
- No-op mount/eject runners (mass-storage devices are externally managed)
- Graceful shutdown handles both iPod and mass-storage sync pipelines

**Configuration:**
```toml
[devices.echo]
type = "echo-mini"
path = "/Volumes/ECHO"

# Optional capability overrides (mass-storage only)
artworkMaxResolution = 800
supportedAudioCodecs = ["aac", "mp3", "flac"]
```
