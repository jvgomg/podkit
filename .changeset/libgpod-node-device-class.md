---
"@podkit/libgpod-node": minor
---

Add standalone Device class for capability queries without opening a database

- `Device.fromMountPoint(path)` — reads SysInfo from filesystem, determines capabilities
- `Device.fromModelNumber(num)` — cached lookup from model number string, no filesystem needed
- Exposes `supportsArtwork`, `supportsVideo`, `supportsPhoto`, `supportsPodcast`, `generation`, `modelNumber`, `modelName`, `capacity`
- Add `ArtworkFormat` type (reserved for future artwork dimension exposure)
