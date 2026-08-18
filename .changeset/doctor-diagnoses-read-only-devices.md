---
'@podkit/core': minor
'podkit': minor
---

`podkit doctor` now diagnoses read-only devices instead of refusing to start.

On a read-only generation (shuffle 3G/4G, nano 6G/7G) doctor printed one line — "this device is read-only" — and exited without running a single check, while `device info`, `device music`, and `device archive` read the same device perfectly well. Refusing to *diagnose* hardware podkit can read left owners with no health information about a device they can still back up.

Doctor now declares its intent when it asks the readiness pipeline for a verdict. Diagnosing is a read, so on a read-only device it runs its whole read-only surface:

- Host checks (codec encoders, FFmpeg, firmware inquiry methods, udev rule).
- The readiness cascade — USB, partition table, filesystem, mount, SysInfo, database — which previously collapsed to "skipped" rows.
- Every database-health check: artwork integrity, orphan files, debris files, identity consistency, shuffle playback database.

A read-only device whose contents are healthy now exits 0; it is no longer an error to own one.

Repairs are unchanged: `podkit doctor --repair` still refuses on a read-only device, because repairing writes. Where a finding's only remedy is a write, doctor reports the finding in full and replaces the command with an explanation, rather than printing a `--repair` command it would refuse to run. The JSON envelope gains an `access` field carrying the device's tier.

`checkReadiness()` gains an optional `requiredAccess: 'read' | 'write'` input. It defaults to `'write'`, so sync, `device init`, and `device add` keep refusing read-only devices up front, exactly as before.
