# Upgrade & Migration

Covers upgrading the Fiber node binary and migrating the on-disk database between versions.

## Overview

Fiber's database schema may change between versions. Starting with `fnn v0.9.0-rc4`, the separate `fnn-migrate` binary is no longer shipped in release archives; migration logic is built into `fnn` itself and runs automatically when the node starts. fiber-pay handles the full upgrade flow via `fiber-pay node upgrade`.

`fiber-pay node upgrade` is migration-first:

- Managed binary mode (default profile-managed path): download/replace `fnn` when needed, then run the legacy migration step if the store exists.
- Custom binary mode (`--binary-path` or profile `binaryPath`): skip binary download and run the legacy migration step only.

## Upgrade flow

```bash
# 1. Stop the node
fiber-pay node stop

# 2. Upgrade binary + prepare store
fiber-pay node upgrade                    # latest version
fiber-pay node upgrade --version v0.9.0-rc4   # specific version

# custom binary path: migration-only (no auto-download)
fiber-pay --binary-path /opt/fiber/custom/fnn node upgrade

# 3. Restart
fiber-pay node start
```

## Key flags

| Flag | Effect |
|------|--------|
| `--version <ver>` | Pin target version instead of latest |
| `--no-backup` | Skip store backup before legacy migration |
| `--check-only` | Dry-run: report whether legacy migration would run |
| `--json` | Machine-readable output |

## Migration model in v0.9.0-rc4

- `fnn v0.9.0-rc4` no longer ships a separate `fnn-migrate` binary.
- `fiber-pay node upgrade` automatically downloads the `v0.8.1` release archive and runs its `fnn-migrate` against the store when a legacy store is present. This brings old stores up to the v0.9.0 epoch.
- `fiber-pay node start` pipes `y` to `fnn` stdin so the built-in migration prompt (`Continue? [y/N]`) is confirmed automatically.
- Do not invoke `fnn-migrate` as a standalone binary; it is only used internally as a legacy bridge.

## Startup behavior

`fiber-pay node start` no longer runs a pre-start migration guard. Instead, it relies on `fnn`'s built-in migration. If the store is too old for `fnn v0.9.0-rc4` to open, the node exits with `NODE_STARTUP_EXITED` and the error message directs you to run `fiber-pay node upgrade` first.

## Custom binary behavior

- `node upgrade` does not overwrite custom binaries.
- Legacy migration still runs against the current store when present.
- `binaryPath` must be an explicit file path (absolute like `/opt/fiber/fnn` or relative like `./fnn`), not a bare command name like `fnn`.

## When auto-migration fails

Some breaking changes may require closing all channels first. If the legacy migration fails, the error message includes the migration output and, if a backup was created, the backup path.

Recommended operator sequence:

1. Back up the current store directory first (default: `<dataDir>/fiber/store`).
2. Run `fiber-pay node upgrade`.
3. If migration still fails, close channels using the old fnn version, then remove the store and restart with a fresh store.
4. If backup was created, roll back by restoring the backup directory.

## Backup & rollback

- Backup created at `<dataDir>/fiber/store.bak-<timestamp>` by default
- Rollback: delete the current store directory and restore the backup in its place
- `--no-backup` skips the backup (use with caution)

## Programmatic API (`@fiber-pay/node`)

```typescript
import { BinaryManager, LegacyMigration, resolveStorePath, storeExists } from '@fiber-pay/node';
import * as os from 'os';

const dataDir = `${os.homedir()}/.fiber-pay`;
const bm = new BinaryManager(`${dataDir}/bin`);

// Download only the fnn binary (no fnn-migrate extracted)
const info = await bm.download({ version: 'v0.9.0-rc4' });

// Run legacy migration if needed
if (storeExists(dataDir)) {
  const legacy = new LegacyMigration('v0.8.1');
  const storePath = resolveStorePath(dataDir);
  const result = await legacy.migrate({ storePath });
  // result.success / result.backupPath / result.message
}
```

## File layout

```
<dataDir>/
  bin/
    fnn              # Fiber node binary
  fiber/
    store/           # Node database (managed by fnn)
    store.bak-*/     # Timestamped backups (created by upgrade)
```
