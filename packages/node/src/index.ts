/**
 * @fiber-pay/node
 * Fiber Network node binary management and process lifecycle
 *
 * @packageDocumentation
 */

export type {
  BinaryInfo,
  DownloadOptions,
  DownloadProgress,
} from './binary/index.js';
// Binary management
export {
  BinaryManager,
  DEFAULT_FIBER_VERSION,
  downloadFiberBinary,
  ensureFiberBinary,
  getDefaultBinaryPath,
  getFiberBinaryInfo,
} from './binary/index.js';
export type {
  MigrationCheckResult,
  MigrationOptions,
  MigrationResult,
} from './migration/index.js';
// Migration management
export { MigrationManager } from './migration/index.js';

// Process management
export { ProcessManager } from './process/index.js';
export type { FiberNodeConfig } from './process/manager.js';

// Security / Key management
export { createKeyManager, KeyManager } from './security/key-manager.js';
