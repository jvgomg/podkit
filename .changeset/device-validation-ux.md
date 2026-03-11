---
"@podkit/core": minor
"podkit": minor
---

Add device validation and capability communication

- Detect unsupported devices (iPod Touch, iPhone, iPad, buttonless Shuffles, Nano 6th gen) with clear error messages explaining why they won't work
- Warn when iPod model cannot be identified, with instructions to fix SysInfo
- Show device capability indicators (+/-) in `podkit device info` output
- Block `podkit device add` for unsupported devices and show capabilities during confirmation
- Add sync pre-flight checks that block unsupported devices and warn about incompatible content types
- Include structured capabilities and validation data in JSON output
