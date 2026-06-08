/**
 * Dev hooks — compile-time-stripped test seams.
 *
 * Hook bodies are guarded by the build-time boolean `__PODKIT_DEV_HOOKS__`,
 * injected by the bundler via `--define`. Production builds set it to `false`
 * so the conditional collapses to a no-op arrow and the entire `if` branch
 * gets tree-shaken away — the production binary contains no trace of the
 * hook body, the symbol name, or the env var name.
 *
 * Pattern: a test arranges observable state (e.g. waits for a `.podkit-tmp`
 * file to land on disk), then SIGKILLs the paused process. There are no
 * resume semantics — the process is expected to be killed once the surround-
 * ing state confirms the pause was reached.
 *
 * Boundaries: hooks may carry test seams and dev observability ONLY. They
 * are never to be used for feature flags, prod toggles, billing gates, A/B
 * tests, or any user-facing behaviour. Anyone tempted to use them for runtime
 * config: stop and use a config flag instead.
 *
 * See `documents/architecture/dev-builds.md` for the full pattern, the
 * production-cleanliness smoke test, and the recipe for adding new hooks.
 *
 * @module
 */

/**
 * Block forever when the hook is active and the configured pause key matches.
 *
 * **Active build (`__PODKIT_DEV_HOOKS__ === true`):** if the process was
 * invoked with `PODKIT_DEV_PAUSE_KEY=<key>` matching the call's `key`
 * argument, the returned promise never resolves — the caller (a test) is
 * expected to SIGKILL the process once the surrounding state (e.g. a
 * `.podkit-tmp` file landing on disk) confirms the pause was reached. When
 * the env var is unset or does not match, this is a no-op.
 *
 * **Production build (`__PODKIT_DEV_HOOKS__ === false`):** no-op arrow.
 * The bundler folds the inline guard expression to the literal `false`,
 * collapses the ternary, and tree-shakes the active branch away —
 * `bin/podkit` and `dist/main.js` contain no reference to the hook body,
 * the `PODKIT_DEV_PAUSE_KEY` env-var name, or the active arrow.
 *
 * **Unbundled runtime (bare `bun -e`, `bun test` against source):** the
 * symbol is not defined; the `typeof` guard short-circuits to the no-op.
 * No `ReferenceError`. Required because cross-process tests spawn the
 * core module via `bun -e` without a bundler.
 *
 * The guard expression must stay inline in the ternary condition. Hoisting
 * it to a `const` defeats the bundler's constant-folding (it stops at
 * statement boundaries), and the active branch survives in the bundled
 * output. The `dev-hooks-strip.test.ts` smoke test pins this.
 *
 * No resume semantics by design. If a future consumer needs resume, extend
 * this primitive then (e.g. SIGUSR1-driven release).
 *
 * @param key Match against `PODKIT_DEV_PAUSE_KEY`. Choose a stable, unique
 *            string per pause point (e.g. `'pre-sync-sweep:before-unlink'`)
 *            so tests can target one specific seam.
 */
export const devPause: (key: string) => Promise<void> =
  typeof __PODKIT_DEV_HOOKS__ !== 'undefined' && __PODKIT_DEV_HOOKS__
    ? async (key) => {
        if (process.env.PODKIT_DEV_PAUSE_KEY === key) {
          await new Promise<void>(() => {});
        }
      }
    : async () => {};

/**
 * Synchronous variant of {@link devPause} for use inside sync code paths.
 *
 * Same key-match + tree-shake semantics as {@link devPause}, but blocks the
 * thread synchronously via `Atomics.wait` on a `SharedArrayBuffer` futex.
 * Tests SIGKILL the process to release the block; there is no resume
 * mechanism (matching the async variant).
 *
 * **When to use:** the call site is a sync interface contract that cannot
 * be made async without a cascading refactor (e.g. `DeviceTrack.copyFile`,
 * which is invoked across iPod + mass-storage adapters). Prefer
 * {@link devPause} in async paths — the async form costs nothing and the
 * Atomics-based block is heavier-handed.
 *
 * Atomics.wait + a one-cell `SharedArrayBuffer` is the JavaScript-native
 * way to park a thread indefinitely without busy-spinning. The Bun and
 * Node.js runtimes both implement this on top of a real OS futex, so the
 * paused process consumes no CPU until the SIGKILL arrives.
 *
 * Same compile-time-strip story as the async variant: the bundler folds
 * the inline `__PODKIT_DEV_HOOKS__` guard to `false` in production builds
 * and tree-shakes both the active arrow and the `SharedArrayBuffer`
 * allocation away. The `dev-hooks-strip.test.ts` smoke test pins this.
 */
export const devPauseSync: (key: string) => void =
  typeof __PODKIT_DEV_HOOKS__ !== 'undefined' && __PODKIT_DEV_HOOKS__
    ? (key) => {
        if (process.env.PODKIT_DEV_PAUSE_KEY === key) {
          // Park the thread on a futex that is never woken. SIGKILL is the
          // only way out — matches the async variant's "no resume" contract.
          const cell = new Int32Array(new SharedArrayBuffer(4));
          Atomics.wait(cell, 0, 0);
        }
      }
    : () => {};
