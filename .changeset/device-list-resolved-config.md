---
"podkit": minor
---

Redesigned `podkit device list` output with resolved config values and provenance tracking

- Shows resolved quality, audio, video, and artwork settings per device with inheritance indicators
- Global config line shows top-level resolved values
- Connected devices detected automatically and marked with ● prefix
- Devices sorted by connection status, then default, then alphabetical
- Values explicitly set on a device shown without brackets; inherited values wrapped in [brackets]
- Unsupported capabilities shown as ✗, unknown (disconnected iPod) shown as ?
- TYPE column replaces VOLUME column
- New config resolution module (`config/resolve.ts`) with `ResolvedValue<T>` provenance tracking
- `device scan` "Configured devices" section renamed to "Not detected" and now includes iPod devices
