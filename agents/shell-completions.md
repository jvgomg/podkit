# Shell Completions

Guidance for working on the shell completion system. See [AGENTS.md](../AGENTS.md) for project overview.

The `podkit completions` command generates shell completion scripts (zsh, bash) by walking the Commander.js command tree at runtime. Completions are **auto-generated from the actual CLI structure** — there is no static completion file to maintain.

## How It Works

The completion system supports three tiers:
1. **Subcommands and flags** — auto-generated from the Commander.js tree
2. **Static argument values** — options using `.choices()` or `.addOption(new Option(...).choices([...]))` auto-complete their values (e.g. `--quality` → `max`, `high`, `medium`, `low`)
3. **Dynamic argument values** — `--device` and `--collection` complete with names from the user's config via a hidden `__complete` command

## Impact on CLI Changes

- Adding or removing commands, subcommands, or options requires **no changes** to the completions system. The generator reads the Commander.js program tree dynamically, so new commands automatically appear in completions.
- When adding an option with known values, use `.addOption(new Option(...).choices([...]))` instead of `.option()` — the completion generator picks up `argChoices` automatically.
- For options with a custom parse function (like sync's repeatable `-t, --type`), use `new Option()` with manual `argChoices` assignment to preserve the parser while exposing choices for completions.
- The hidden `__complete` command reads the config file directly (no validation) and outputs names. Dynamic completions for new option types require updating `extractCommandTree` (to tag the option) and the zsh/bash generators.
- The `--cmd` flag on `completions zsh/bash` controls which binary the dynamic helpers call. This is important for dev binaries with non-standard names (e.g. `podkit-dev`).

## Testing Completions During Development

The completions generator derives the function prefix from `--cmd`: `podkit-dev` → `_podkit_dev`,
`podkit` → `_podkit`. This means each binary gets its own isolated function namespace and the
two completion scripts can coexist without clobbering each other.

```bash
bun run --filter podkit install:dev   # Build and install podkit-dev binary
# Add to ~/.zshrc:
#   source <(podkit completions zsh)                              # prod binary (_podkit namespace)
#   source <(podkit-dev completions zsh --cmd podkit-dev)        # dev binary (_podkit_dev namespace)
```

No extra `compdef` line needed — each source line registers its own binding.

See [docs/developers/development.md](../docs/developers/development.md) for full setup.
