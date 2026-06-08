/**
 * Ambient declaration for the bundler-injected dev-hooks flag.
 *
 * `__PODKIT_DEV_HOOKS__` is replaced by esbuild's `--define` at bundle time
 * (`false` in production, `true` in `compile:debug`). When unbundled (e.g.
 * `bun test` against source), the symbol is undefined — call sites must
 * guard with `typeof __PODKIT_DEV_HOOKS__ !== 'undefined' && …` to avoid
 * `ReferenceError`.
 *
 * The declaration is ambient (no imports/exports in this file) so any
 * `.ts` file under `src/` can reference the symbol without re-declaring
 * it. See `packages/podkit-core/src/dev/hooks.ts` and
 * `documents/architecture/dev-builds.md` for the broader pattern.
 */
declare const __PODKIT_DEV_HOOKS__: boolean;
