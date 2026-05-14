/**
 * Local ambient types for the dummy-hcd daemon.
 *
 * The daemon lives outside `packages/*` and is NOT a Bun workspace member,
 * which means it cannot resolve `@types/bun` or `@types/node` from the
 * workspace's hoisted node_modules. We declare the minimum surface we
 * actually use right here so `tsc --noEmit` runs clean without ferrying
 * a node_modules into this directory.
 *
 * The `bun build --compile` invocation does NOT consult this file — it
 * compiles TypeScript with its own resolver. This file exists purely to
 * make `tsc --noEmit` and editor IntelliSense work.
 */

declare module 'bun:test' {
  export interface ExpectMatchers<T = unknown> {
    toBe(expected: T): void;
    toBeUndefined(): void;
    toBeNull(): void;
    toBeNaN(): void;
    toEqual(expected: T): void;
    toContain(expected: string | T): void;
    toThrow(expected?: string | RegExp | Error): void;
    not: ExpectMatchers<T>;
  }
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export function beforeEach(fn: () => void | Promise<void>): void;
  export function afterEach(fn: () => void | Promise<void>): void;
  export function expect<T>(value: T): ExpectMatchers<T>;
}

// Minimal Node-ish globals the daemon uses. We deliberately avoid pulling
// the full @types/node surface so the dummy-hcd dir stays node_modules-free.

declare namespace NodeJS {
  interface ProcessEnv {
    [key: string]: string | undefined;
  }
  interface Process {
    argv: string[];
    env: ProcessEnv;
    exit(code?: number): never;
    on(event: 'SIGINT' | 'SIGTERM', handler: () => void): this;
    stdout: { write(chunk: string | Buffer): boolean };
    stderr: { write(chunk: string | Buffer): boolean };
  }
}
declare const process: NodeJS.Process;
declare const console: {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
};
declare const globalThis: { [key: string]: unknown } & typeof global;
declare const global: object;

declare class Buffer extends Uint8Array {
  static allocUnsafe(size: number): Buffer;
  static from(data: string | ArrayBuffer | Uint8Array, encoding?: string): Buffer;
  toString(encoding?: string): string;
}

// Subset of node:fs, node:fs/promises, node:os, node:path, node:child_process
// that the daemon uses. Only the call signatures we hit; not exhaustive.

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: string): string;
  export function readFileSync(path: string): Buffer;
  export function writeFileSync(path: string, data: string | Uint8Array): void;
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function readdirSync(path: string): string[];
  export function symlinkSync(target: string, linkPath: string): void;
  export function unlinkSync(path: string): void;
  export function rmdirSync(path: string): void;
  export function rmSync(path: string, options?: { force?: boolean; recursive?: boolean }): void;
  export function mkdtempSync(prefix: string): string;
  export namespace promises {
    export interface FileReadResult<T> {
      bytesRead: number;
      buffer: T;
    }
  }
}
declare module 'node:fs/promises' {
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  interface FileHandle {
    read<T extends Uint8Array>(
      buffer: T,
      offset: number,
      length: number,
      position: number | null
    ): Promise<{ bytesRead: number; buffer: T }>;
    write(data: Uint8Array): Promise<{ bytesWritten: number }>;
    close(): Promise<void>;
  }
  export function open(path: string, mode: string): Promise<FileHandle>;
}
declare module 'node:os' {
  export function tmpdir(): string;
}
declare module 'node:path' {
  export function join(...parts: string[]): string;
}
declare module 'node:child_process' {
  export interface SpawnSyncReturns {
    status: number | null;
    stderr?: Buffer;
    stdout?: Buffer;
  }
  export function spawnSync(command: string, args?: string[]): SpawnSyncReturns;
}
declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
}

// import.meta.path — Bun-specific, used only by the entry-point guard.
interface ImportMeta {
  path?: string;
  url: string;
}

// Web platform globals — available in Bun and modern Node.
declare class TextEncoder {
  encode(input?: string): Uint8Array;
}
declare class TextDecoder {
  decode(input?: Uint8Array): string;
}

// Timer globals — used by the FunctionFS BIND watchdog.
declare function setTimeout(handler: () => void, timeoutMs?: number): unknown;
declare function clearTimeout(handle: unknown): void;
