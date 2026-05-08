/**
 * Test helper: an OutputSink that captures writes into a string buffer.
 *
 * Use to assert against text/JSON output from handlers without mocking
 * `console.log` (which is process-global and breaks concurrent tests).
 */

import type { OutputSink } from '../output/types.js';

export class BufferSink implements OutputSink {
  private chunks: string[] = [];

  write(chunk: string): boolean {
    this.chunks.push(chunk);
    return true;
  }

  /** All written content joined as one string. */
  text(): string {
    return this.chunks.join('');
  }

  /** Lines split on \n with the trailing empty entry dropped. */
  lines(): string[] {
    const t = this.text();
    if (t === '') return [];
    return t.endsWith('\n') ? t.slice(0, -1).split('\n') : t.split('\n');
  }

  /** Parse the buffer as JSON. Throws if invalid. */
  json<T = unknown>(): T {
    return JSON.parse(this.text()) as T;
  }

  clear(): void {
    this.chunks = [];
  }
}
