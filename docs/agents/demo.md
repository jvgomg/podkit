# Demo GIF

Guidance for working on the animated demo. See [AGENTS.md](../../AGENTS.md) for project overview.

The `packages/demo/` package produces an animated GIF for the README using [VHS](https://github.com/charmbracelet/vhs). It compiles a standalone CLI binary with mocked `@podkit/core` and `packages/podkit-cli/src/utils/fs.ts` swapped at build time via Bun plugins.

```bash
bun run demo    # Build demo binary + record GIF
```

## Impact on CLI and Core Changes

- The demo binary compiles `packages/podkit-cli/src/main.ts` directly. CLI changes (new commands, changed flags, altered output) may break the demo build or recording.
- `src/mock-core.ts` must match the `@podkit/core` public API — adding/removing exports requires updating the mock.
- New filesystem usage in CLI commands should go through `packages/podkit-cli/src/utils/fs.ts` (not `node:fs` directly) so the demo's mock can intercept it.
- Run `bun run demo` after CLI or core changes to verify the demo still works.

See [packages/demo/README.md](../../packages/demo/README.md) for full details.
