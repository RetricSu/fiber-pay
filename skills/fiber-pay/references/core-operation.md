# Core Operation Runbook

Use this guide for day-to-day payment operations with `fiber-pay`: bootstrapping a node, establishing channel liquidity, sending/receiving payments, and handling failures with repeatable checks.

## 1) Readiness gate before any payment

Before `payment send`, verify all of the following:

- node process is running
- RPC is reachable
- runtime proxy is available
- at least one usable `ChannelReady` path exists

```bash
fiber-pay node ready --json
fiber-pay runtime status --json
fiber-pay channel list --state ChannelReady --json
```

If any check fails, do **not** send payment yet; fix readiness first.

## 2) Bootstrap node safely

```bash
fiber-pay node start --daemon
fiber-pay node ready --json
```

Operational notes:

1. Use daemon mode for normal operation.
2. Use foreground mode only for interactive debugging.
3. `node start` handles initial binary/config/key/runtime bootstrap.

## 3) Peer and channel bring-up

Minimal path to obtain outbound liquidity:

```bash
fiber-pay peer connect <peer-multiaddr> --json
fiber-pay channel open --peer <peer-address> --funding <CKB> --json
fiber-pay channel watch --until CHANNEL_READY --json
```

Verification checks:

```bash
fiber-pay peer list --json
fiber-pay channel list --json
```

## 4) Send payment (happy path)

```bash
fiber-pay payment send <invoice> --wait --json
```

Expect a terminal success/failure result. Keep output in JSON for reliable agent parsing.

## 5) Receive payment

Create invoice:

```bash
fiber-pay invoice create --amount <CKB> --description "<desc>" --json
```

Track invoice/payment state:

```bash
fiber-pay invoice get <paymentHash> --json
fiber-pay invoice list --json
```

## 6) Failure handling sequence

When `payment send` fails:

1. Classify by `error.code` (or job state if async path is used).
2. Re-check readiness (`node ready`, `runtime status`, `channel list`).
3. Inspect recent job and logs.
4. Apply targeted fix (peer reconnect, wait channel ready, adjust route conditions).
5. Retry with bounded attempts (avoid infinite loops).

Useful diagnostics:

```bash
fiber-pay job list --json
fiber-pay job get <jobId> --json
fiber-pay job trace <jobId> --json
fiber-pay logs --source all --tail 120
fiber-pay logs --source runtime --follow
```

For deeper black-box diagnosis, use `references/logs-troubleshooting.md`.

## 7) Rebalance channel liquidity

Use high-level channel command:

```bash
fiber-pay channel rebalance --amount <CKB> --max-fee <CKB> --dry-run --json
fiber-pay channel rebalance --amount <CKB> --max-fee <CKB> --json
fiber-pay channel rebalance --amount <CKB> --from-channel <channelA_id> --to-channel <channelB_id> --json
```

Direction quick rule:

- Increase local balance on channel `X` => set `--to-channel X`
- Decrease local balance on channel `X` => set `--from-channel X`

For detailed concepts, route modes, and operator checklist, read:

- `references/rebalance.md`

## 8) Runtime-first operations (recommended)

In runtime-active scenarios, treat write operations as job-driven:

- submit operation
- read `jobId`
- observe `job get` / `job trace` / `job events`
- decide retry or recovery from terminal job state

This keeps automation deterministic and auditable.

## 9) Minimal end-to-end checklist

1. `node start --daemon`
2. `node ready`
3. `peer connect`
4. `channel open`
5. `channel watch --until CHANNEL_READY`
6. `invoice create` (receiver) or obtain invoice (sender)
7. `payment send --wait`
8. on failure: `job trace` + `logs` + bounded retry
