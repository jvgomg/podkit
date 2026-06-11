/**
 * Quote a CLI argument so users can copy-paste a suggested command verbatim.
 *
 * Returns an unquoted token when the value contains only "safe" shell
 * characters (alphanumerics + a small punctuation allowlist). Otherwise
 * wraps in double quotes and escapes embedded `"`, `\`, `$`, and backtick
 * so the printed token survives a paste back into bash/zsh without
 * surprises.
 *
 * Used by doctor / sync / device suggestion blocks where the CLI echoes
 * back the user's `-d <arg>` so the "to fix this, run …" block is
 * copy-paste-ready regardless of what the user actually typed.
 */
export function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:@%+,=-]+$/.test(value)) return value;
  return `"${value.replace(/(["\\$`])/g, '\\$1')}"`;
}
