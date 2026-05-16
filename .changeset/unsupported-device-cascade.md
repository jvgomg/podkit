---
"podkit": minor
"@podkit/core": minor
---

Unify the unsupported-device UX across `podkit device add`, `device scan`, `device info`, `sync`, and `doctor`. Every command now composes identity via the same cascade primitive (`resolveIpodModel(bag)`) — no command re-implements the check, no command leaks `libgpod` into user-facing copy.

Key behaviour changes:
- `device add` on an unsupported device (hashAB nano, etc.) now asks "Add anyway? [y/N]" rather than hard-refusing. Confirmed devices are recorded with `unsupported: true` in config; `--yes` flips the default to accept.
- `device add` against an iOS device (iPod touch) now surfaces the canonical unsupported message instead of the generic "No iPod devices found".
- `device scan` headers show the resolved model name (e.g. "iPod touch 5th generation") instead of "Unknown iPod (USB only)".
- `sync --dry-run` refuses cleanly on unsupported devices with the canonical message — no track plan generated.
- `sync` on a supported device with SysInfoExtended present resolves identity via the cascade; the legacy "Could not identify iPod model" warning is gone for that case.
- `device info` renders the cascade `displayName` instead of the libgpod-derived `info.device.modelName`.
- `doctor` on an unsupported device suppresses repair suggestions that would mutate device state and surfaces the canonical unsupported message instead.

Wording is centralised in `@podkit/core` (`makeUnsupportedReasonFromAssessment` / `makeUnsupportedReasonFromModel`) — every consumer imports.
