---
"podkit": patch
"@podkit/core": patch
---

Improve mount command error output when elevated privileges are required. Instead of immediately failing with a generic sudo error, podkit now attempts `diskutil mount` first (which doesn't need sudo) and only prompts for sudo when the fallback `mount -t msdos` path is needed. When sudo is required, the error message includes device details, iFlash detection evidence explaining why macOS refuses to automount, and a tip linking to the macOS mounting troubleshooting guide.
