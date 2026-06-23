/**
 * Migration store path utilities
 */

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

export function resolveStorePath(dataDir: string): string {
  return join(dataDir, 'fiber', 'store');
}

export function storeExists(dataDir: string): boolean {
  const storePath = resolveStorePath(dataDir);
  if (!existsSync(storePath)) return false;
  try {
    return statSync(storePath).isDirectory();
  } catch {
    return false;
  }
}
