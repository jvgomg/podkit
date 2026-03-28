---
"podkit": minor
"@podkit/core": minor
---

Add audioNormalization device capability for device-appropriate Sound Check / ReplayGain handling

Devices now declare their normalization support: 'soundcheck' (iPod), 'replaygain' (Rockbox), or 'none' (Echo Mini, generic). Devices with no normalization support skip soundcheck upgrade detection entirely, and the dry-run output hides or relabels the normalization line accordingly. Configurable via `audioNormalization` in device config.
