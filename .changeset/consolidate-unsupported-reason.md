---
"podkit": minor
"@podkit/core": minor
"@podkit/devices-ipod": minor
"@podkit/device-types": minor
---

Consolidate the two ways podkit expressed "this device is unsupported" into one canonical shape. `ReadinessUnsupportedReason` moves to `@podkit/device-types` (its natural home), and `resolveIpodModel(bag)` now returns it directly on `IpodModel.unsupportedReason` instead of the bare-string `notSupportedReason`. The bridge functions in `@podkit/core` (`makeUnsupportedReasonFromModel`, `makeUnsupportedReasonFromAssessment`) are removed — consumers read `model.unsupportedReason` directly. Internal refactor; user-facing CLI behaviour is unchanged.
