import type { FiberWasmFactory } from '@fiber-pay/sdk/browser';
import * as fiberJsModule from '@nervosnetwork/fiber-js';

function resolveFiberCtor(): new () => unknown {
  const moduleRecord = fiberJsModule as unknown as Record<string, unknown>;
  const defaultExport = moduleRecord.default as Record<string, unknown> | unknown;
  const maybeCtor =
    moduleRecord.Fiber ??
    (defaultExport && typeof defaultExport === 'object'
      ? (defaultExport as Record<string, unknown>).Fiber
      : undefined) ??
    defaultExport;

  if (!maybeCtor || typeof maybeCtor !== 'function') {
    throw new Error('Could not resolve Fiber class from @nervosnetwork/fiber-js');
  }

  return maybeCtor as new () => unknown;
}

export function createDefaultWasmFactory(): FiberWasmFactory {
  const FiberCtor = resolveFiberCtor();
  return () => new FiberCtor() as ReturnType<FiberWasmFactory>;
}
