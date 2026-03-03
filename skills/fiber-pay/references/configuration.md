# Fiber Config Reference

This repo keeps Fiber config artifacts in `skills/fiber-pay/references/`:

- `skills/fiber-pay/references/fnn.reference.yml` — full commented reference (all known keys)

## Runtime source of truth

For each profile/data-dir, the runtime config is:

- `<data-dir>/config.yml`

`fiber-pay node start` launches `fnn` with that `config.yml`.

## CLI config management

`fiber-pay config` supports generalized YAML path operations:

- `config get <path>`
- `config set <path> <value> [--type auto|string|number|boolean|null|json]`
- `config unset <path>`
- `config list [--prefix <path>]`
- `config show`
- `config show --effective` (debug view of resolved values + source)

Path format:

- Dot notation for objects: `fiber.chain`
- Bracket notation for arrays: `ckb.udt_whitelist[0].name`

Compatibility alias:

- `chain` resolves to `fiber.chain`

## Profile config scope

`profile.json` is intentionally limited to CLI-only keys:

- `binaryPath`
- `keyPassword`
- `runtimeProxyListen`

Runtime node settings (`fiber.*`, `rpc.*`, `ckb.*`) belong in `config.yml`.

## FNN binary/runtime notes (from reference config)

The reference file includes useful operational notes:

- FNN supports overriding config via CLI flags and env vars.
- Secret key path is under the base directory (`$BASE_DIR/fiber/sk`).
- `FIBER_SECRET_KEY_PASSWORD` protects key encryption/decryption.
- `fnn --config /path/to/config.yml` and `fnn --dir /path/to/base_dir` are supported runtime entry patterns.

Use `skills/fiber-pay/references/fnn.reference.yml` when exploring advanced keys that are not yet exposed as first-class CLI flags.

For RPC Biscuit authentication setup and token usage, see `skills/fiber-pay/references/auth.md`.
