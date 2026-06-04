/**
 * Helpers for distinguishing user-typed option values from values
 * Commander synthesised as defaults.
 *
 * The motivating quirk: an option declared as `--no-X` makes Commander
 * publish `opts.X === true` even when the user did not pass `--no-X`. Code
 * that forwards raw `opts` into a config-merge layer (or that reads
 * `options.X !== undefined` to decide whether the user "asked" for
 * something) cannot tell the synthetic default apart from explicit user
 * intent — the synthetic value silently overrides config-file values and
 * mutates persistent state on every command run.
 *
 * The canonical Commander API for source tracking is
 * `Command.getOptionValueSource(name)`, which returns `'cli'`, `'env'`,
 * `'config'`, `'implied'`, `'default'`, or `undefined`. Use the helpers
 * here at the boundary between Commander and the rest of the CLI to drop
 * values whose source is `'default'` before they influence anything
 * downstream.
 */

/**
 * Minimal surface a Commander `Command` exposes for source lookup. We type
 * the parameter loosely so tests can pass a hand-rolled stub and so the
 * helper survives an older Commander that didn't expose the method (in
 * which case stripping is a no-op).
 */
export interface OptionSourceProbe {
  getOptionValueSource?(name: string): string | undefined;
}

/**
 * Return a new options object with every property whose Commander source
 * is `'default'` removed. The result is a `Partial<T>` because removed
 * keys become absent; downstream `??` chains take the resolved-config or
 * fallback path on those keys, which is the intended behavior when the
 * user did not actually pass the flag.
 *
 * Passes the original options through unchanged when the probe lacks
 * `getOptionValueSource` — Commander < 9 (we use 14, but defensive).
 */
export function stripDefaultOptionValues<T extends object>(
  options: T,
  command: OptionSourceProbe
): Partial<T> {
  if (typeof command.getOptionValueSource !== 'function') return options;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(options)) {
    if (command.getOptionValueSource(key) !== 'default') {
      out[key] = value;
    }
  }
  return out as Partial<T>;
}

/**
 * Wrap a Commander action callback so synthesised `'default'` option
 * values are stripped before the action body sees them. Use at the
 * `.action()` site to keep the strip declarative and impossible to
 * forget:
 *
 * ```ts
 * .action(withCleanOptions(async (options, command) => {
 *   // options.artwork is `false` only if user passed `--no-artwork`,
 *   // never the synthetic-default `true`.
 * }));
 * ```
 */
export function withCleanOptions<O extends object, R>(
  fn: (options: O, command: OptionSourceProbe) => R
): (options: O, command: OptionSourceProbe) => R {
  return (options, command) => fn(stripDefaultOptionValues(options, command) as O, command);
}
