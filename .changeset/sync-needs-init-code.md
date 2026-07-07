---
"podkit": minor
---

`podkit sync` refuses a blank iPod with a distinct `IPOD_NEEDS_INIT` error

A mounted iPod with no database (never initialised) previously failed at the database-open step with the overloaded `IPOD_OPEN_FAILED` code, indistinguishable from a corrupt database. Sync now detects the missing iTunesDB before opening and refuses with a typed `IPOD_NEEDS_INIT` error whose remediation points at `podkit device init`. JSON consumers branching on the error code for blank devices should switch from `IPOD_OPEN_FAILED` to `IPOD_NEEDS_INIT`.
