---
"podkit": minor
---

CLI flag standardisation and `device init --name` (task-432.05, task-432.06):

- **`device init --name <name>`** — fresh database can now be named at init time; passes through to `IpodDatabase.initializeIpod({ name })`. Without `--name`, libgpod default applies.
- **`-y, --yes` everywhere** (breaking: `--confirm` removed). `device clear` and `device remove` previously used `--confirm` to skip the confirmation prompt; they now use `-y, --yes` consistent with the rest of the CLI. Scripts that passed `--confirm` must switch to `--yes`.
- **`-n, --dry-run` short form** added to: `device clear`, `device reset`, `device reset-artwork`, `device mount`, `mount`, and `doctor`. Commands that already had `-n` or had no `--dry-run` are unchanged.
