---
"podkit": minor
---

`DeviceConfig.unsupported` (the marker for devices the user added via the warn-allow flow in TASK-317.03) is now a structured object (`{ kind, confirmedAt }`) instead of a bare boolean. The `kind` captures which unsupported-reason class triggered the prompt (iOS device, hashAB nano, mass-storage with no preset, etc.) so a future reader can tell why the device was confirmed. The `confirmedAt` ISO timestamp records when. Legacy `unsupported = true` config entries are silently coerced to the new shape on load.
