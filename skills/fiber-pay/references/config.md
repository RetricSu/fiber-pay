# FNN Config Reference (v0.7.1)

- Structured reference for `config.yml` used by the Fiber Network Node (`fnn`). 
- All values are set via `fiber-pay config set <path> <value>`.
- Full commented fnn config.yml artifact: [references/fnn.reference.yml](references/fnn.reference.yml)

## Top-level

| Key | Type | Description |
|-----|------|-------------|
| `services` | string[] | Services to enable. At least one required. Values: `fiber`, `rpc`, `ckb`, `cch` |

---

## `fiber` — P2P Payment Channel Network

### Network

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `fiber.listening_addr` | string | `"/ip4/0.0.0.0/tcp/0"` | P2P listen address (multiaddr format) |
| `fiber.chain` | string | *required* | `"testnet"`, `"mainnet"`, or path to chain spec |
| `fiber.bootnode_addrs` | string[] | `[]` | Bootstrap peer multiaddrs |

### Node Announcement

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `fiber.announce_listening_addr` | bool | `false` | Announce listen addr to network |
| `fiber.announced_addrs` | string[] | `[]` | Public addresses to announce |
| `fiber.announce_private_addr` | bool | `false` | Announce private addrs (testing only) |
| `fiber.announced_node_name` | string | none | Node name (max 32 bytes UTF-8) |
| `fiber.auto_announce_node` | bool | `true` | Auto-announce on startup |
| `fiber.announce_node_interval_seconds` | number | `3600` | Re-announce interval. 0 = never |

### Channel Auto-Accept

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `fiber.open_channel_auto_accept_min_ckb_funding_amount` | number | `10000000000` (100 CKB) | Min opener funding to trigger auto-accept (shannons) |
| `fiber.auto_accept_channel_ckb_funding_amount` | number | `9900000000` (99 CKB) | Acceptor funds on auto-accept. **Set 0 to disable** |

### TLC Defaults

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `fiber.tlc_expiry_delta` | number | `14400000` (4h) | Forwarding expiry delta (ms) |
| `fiber.tlc_min_value` | number | `0` | Min TLC value. 0 = no min |
| `fiber.tlc_fee_proportional_millionths` | number | `1000` (0.1%) | Forwarding fee rate |

### Peer Connections

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `fiber.max_inbound_peers` | number | `16` | Max inbound connections |
| `fiber.min_outbound_peers` | number | `8` | Min outbound connections to maintain |

### Gossip

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `fiber.sync_network_graph` | bool | `true` | Sync graph from peers |
| `fiber.gossip_network_maintenance_interval_ms` | number | `60000` | Network maintenance interval |
| `fiber.gossip_store_maintenance_interval_ms` | number | `20000` | Store maintenance interval |

### Watchtower

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `fiber.watchtower_check_interval_seconds` | number | `60` | Check interval. 0 = disabled |
| `fiber.standalone_watchtower_rpc_url` | string | none | External watchtower RPC |
| `fiber.standalone_watchtower_token` | string | none | Auth token |
| `fiber.disable_built_in_watchtower` | bool | `false` | Disable built-in watchtower |

### Channel Limits

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `fiber.to_be_accepted_channels_number_limit` | number | `20` | Max pending channels per peer |
| `fiber.to_be_accepted_channels_bytes_limit` | number | `51200` | Max pending channel data (bytes) |
| `fiber.funding_timeout_seconds` | number | `86400` (1 day) | Auto-close funding timeout |

### WebSocket & Metrics

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `fiber.reuse_port_for_websocket` | bool | `true` | Reuse TCP port for WS |
| `fiber.metrics_addr` | string | none | Metrics endpoint (requires special build) |

### On-Chain Scripts (required)

| Key | Type | Description |
|-----|------|-------------|
| `fiber.scripts` | array | FundingLock and CommitmentLock configs. See `skills/fiber-pay/references/fnn.reference.yml` for full key documentation |

Each entry: `{ name, script: { code_hash, hash_type, args }, cell_deps: [...] }`

---

## `rpc` — JSON-RPC Server

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `rpc.listening_addr` | string | *required if rpc enabled* | Bind address. Use localhost for security |
| `rpc.cors_enabled` | bool | `false` | Whether to enable CORS for JSON-RPC |
| `rpc.cors_allowed_origins` | string[] | `[]` | Allowed CORS origins when CORS is enabled |
| `rpc.biscuit_public_key` | string | none | Biscuit auth public key |
| `rpc.enabled_modules` | string[] | all standard | Modules: `cch`, `channel`, `graph`, `payment`, `info`, `invoice`, `peer`, `watchtower`, `dev` |

---

## `ckb` — Layer 1 Connection

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `ckb.rpc_url` | string | `"http://127.0.0.1:8114"` | CKB node RPC endpoint |
| `ckb.tx_tracing_polling_interval_ms` | number | `4000` | TX tracing poll interval |
| `ckb.funding_tx_shell_builder` | string | none | External funding TX builder command |

### UDT Whitelist

| Key | Type | Description |
|-----|------|-------------|
| `ckb.udt_whitelist` | array | Whitelisted UDTs for channels |

Each entry: `{ name, script: { code_hash, hash_type, args }, cell_deps: [...], auto_accept_amount? }`

- `auto_accept_amount`: min opener amount (in token units) to auto-accept UDT channel. Omit to disable.

---

## `cch` — Cross-Chain Hub (BTC Lightning)

Requires `cch` in `services`.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `cch.lnd_rpc_url` | string | `"https://127.0.0.1:10009"` | LND gRPC endpoint |
| `cch.lnd_cert_path` | string | none | LND TLS cert path |
| `cch.lnd_macaroon_path` | string | none | LND macaroon path |
| `cch.wrapped_btc_type_script_args` | string | *required* | Wrapped BTC type script args |
| `cch.expiry_delta_seconds` | number | `3600` | Order expiry delta (seconds) |
| `cch.base_fee_sats` | number | `0` | Base fee per order (sats) |
| `cch.fee_rate_per_million_sats` | number | `1` | Proportional fee |
| `cch.btc_final_tlc_expiry` | number | `36` | BTC final TLC expiry (seconds) |

---

## Config priority

1. CLI flags (`--fiber-listening-addr ...`)
2. Environment variables (`FIBER_LISTENING_ADDR=...`)
3. `config.yml` (lowest priority)

## CLI config operations

```
fiber-pay config get <path>
fiber-pay config set <path> <value> [--type auto|string|number|boolean|null|json]
fiber-pay config unset <path>
fiber-pay config list [--prefix <path>]
fiber-pay config show
```

Path syntax: dot notation (`fiber.chain`) + bracket for arrays (`ckb.udt_whitelist[0].name`).
