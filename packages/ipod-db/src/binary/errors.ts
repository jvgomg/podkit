/**
 * Error thrown when parsing iPod binary database records.
 *
 * Carries the byte offset where the error occurred and an optional
 * breadcrumb trail (`recordPath`) that higher-level parsers append as
 * they descend into nested records.
 */
export class ParseError extends Error {
  readonly offset: number;
  readonly expected?: string;
  readonly actual?: string;
  readonly recordPath: string[];

  constructor(
    message: string,
    options: {
      offset: number;
      expected?: string;
      actual?: string;
      recordPath?: string[];
    }
  ) {
    const parts: string[] = [message];

    if (options.expected !== undefined) {
      parts.push(`expected ${options.expected}`);
    }
    if (options.actual !== undefined) {
      parts.push(`got ${options.actual}`);
    }
    parts.push(`at offset ${options.offset}`);

    if (options.recordPath && options.recordPath.length > 0) {
      parts.push(`in ${options.recordPath.join(' > ')}`);
    }

    super(parts.join('; '));

    this.name = 'ParseError';
    this.offset = options.offset;
    this.expected = options.expected;
    this.actual = options.actual;
    this.recordPath = options.recordPath ?? [];
  }
}
