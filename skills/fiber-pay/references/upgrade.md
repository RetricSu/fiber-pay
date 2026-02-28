# Upgrade & Migration

Covers upgrading the Fiber node binary and migrating the on-disk database between versions.

## Overview

Fiber's database schema may change between versions. The `fnn-migrate` binary (shipped alongside `fnn` in release archives) handles schema migration. fiber-pay automates the full upgrade flow via `fiber-pay node upgrade`.

## Upgrade flow

```bash
# 1. Stop the node
fiber-pay node stop

# 2. Upgrade binary + migrate store
fiber-pay node upgrade                    # latest version
fiber-pay node upgrade --version v0.7.1   # specific version

# 3. Restart
fiber-pay node start
```

## Key flags

| Flag | Effect |
|------|--------|
| `--version <ver>` | Pin target version instead of latest |
| `--no-backup` | Skip store backup before migration |
| `--check-only` | Dry-run: report migration status without executing |
| `--force` | Re-download binary even if version matches |
| `--json` | Machine-readable output |

## Startup guard

`fiber-pay node start` automatically checks store compatibility before launching fnn. If migration is needed, it exits with `MIGRATION_REQUIRED` and directs the user to run `node upgrade`.

## When auto-migration fails

Some breaking changes require closing all channels first. The error message includes step-by-step manual instructions and a link to the upstream [Migration Guide](https://github.com/nervosnetwork/fiber/wiki/Fiber-Breaking-Change-Migration-Guide).

## Backup & rollback

- Backup created at `<dataDir>/fiber/store.bak-<timestamp>` by default
- Rollback: delete the current store directory and restore the backup in its place

## Programmatic API (`@fiber-pay/node`)

```typescript
import { BinaryManager, MigrationManager } from '@fiber-pay/node';
import * as os from 'os';

const dataDir = `${os.homedir()}/.fiber-pay`;
const bm = new BinaryManager(`${dataDir}/bin`);
const migrateBin = bm.getMigrateBinaryPath();  // path to fnn-migrate

const mm = new MigrationManager(migrateBin);
const storePath = MigrationManager.resolveStorePath(dataDir);

// Check
const check = await mm.check(storePath);
// check.needed / check.valid / check.message

// Migrate (with backup)
const result = await mm.migrate({ storePath });
// result.success / result.backupPath / result.message

// Rollback
mm.rollback(storePath, result.backupPath!);
```

## File layout

```
<dataDir>/
  bin/
    fnn              # Fiber node binary
    fnn-migrate      # Migration tool binary
  fiber/
    store/           # Node database (managed by fnn)
    store.bak-*/     # Timestamped backups (created by upgrade)
```
