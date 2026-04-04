---
'podkit': patch
---

Fix config not found when running `podkit` under `sudo`. The default config path now resolves the invoking user's home directory via `SUDO_USER`/`DOAS_USER` and `/etc/passwd`, rather than using root's home.
