/**
 * Type declarations for @nervosnetwork/fiber-js
 *
 * This is a minimal type stub for the optional peer dependency.
 * The actual types come from the installed package when users opt in.
 */

declare module '@nervosnetwork/fiber-js' {
  export class Fiber {
    constructor(inputBufferSize?: number, outputBufferSize?: number);
    start(
      config: string,
      fiberKeyPair: Uint8Array,
      ckbSecretKey?: Uint8Array,
      chainSpec?: string,
      logLevel?: 'trace' | 'debug' | 'info' | 'error',
      databasePrefix?: string,
    ): Promise<void>;
    stop(): Promise<void>;
    invokeCommand(name: string, args?: unknown[]): Promise<unknown>;
  }

  export function randomSecretKey(): Uint8Array;
}
