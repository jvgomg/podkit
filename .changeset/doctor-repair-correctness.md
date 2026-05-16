---
"podkit": patch
"@podkit/core": patch
"@podkit/ipod-firmware": patch
---

Fix three `podkit doctor` repair correctness bugs:

- `--repair sysinfo-consistency` now overwrites a stale on-disk SysInfoExtended (previously short-circuited on file existence, reporting success without rewriting).
- `--repair sysinfo-extended` no longer requires an existing iTunesDB — repairs without a `database` requirement skip the DB open so identity-populating repairs work on freshly formatted iPods. New `'database'` value on `RepairRequirement`.
- The readiness `SysInfoExtended:` status line distinguishes a missing file from a present-but-unparseable one.
