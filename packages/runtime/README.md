# @fiber-pay/runtime

Runtime monitor + job orchestration for Fiber (`fnn v0.7.1`).

## Quick start

```bash
fiber-pay runtime start --daemon --json
fiber-pay runtime status --json
```

## Single-instance low-CPU defaults

Runtime defaults are tuned for lower idle CPU on one node:

- `channelPollIntervalMs=5000`
- `invoicePollIntervalMs=3000`
- `paymentPollIntervalMs=2000`
- `peerPollIntervalMs=15000`
- `healthPollIntervalMs=10000`
- `includeClosedChannels=false`
- `jobs.schedulerIntervalMs=1000`

If your machine is still busy when idle, start with slower polling explicitly:

```bash
fiber-pay runtime start \
  --channel-poll-ms 8000 \
  --invoice-poll-ms 5000 \
  --payment-poll-ms 3000 \
  --peer-poll-ms 20000 \
  --health-poll-ms 15000 \
  --include-closed false \
  --json
```

## Manual payment flow (runtime jobs)

前置：`jq`、`curl`、两边 profile 已有资金（示例 `rt-a` / `rt-b`）。

### 1) 启动两边节点（带 runtime proxy）

```bash
fiber-pay --profile rt-a config init --network testnet --proxy-port 9729
fiber-pay --profile rt-b config init --network testnet --rpc-port 9827 --p2p-port 9828 --proxy-port 9829

fiber-pay --profile rt-a node start --json
fiber-pay --profile rt-b node start --json
```

### 2) 连接 peer

```bash
A_MULTIADDR="$(fiber-pay --profile rt-a node status --json | jq -r '.data.multiaddr')"
B_MULTIADDR="$(fiber-pay --profile rt-b node status --json | jq -r '.data.multiaddr')"

fiber-pay --profile rt-a peer connect "$B_MULTIADDR" --timeout 12 --json
fiber-pay --profile rt-b peer connect "$A_MULTIADDR" --timeout 12 --json
```

### 3) 提交 job：open -> invoice -> payment -> shutdown

```bash
PROXY_A='http://127.0.0.1:9729'
PROXY_B='http://127.0.0.1:9829'
PEER_B="$(fiber-pay --profile rt-b node status --json | jq -r '.data.peerId')"

wait_job() {
  local proxy="$1"; local job_id="$2"
  while true; do
    local state="$(curl -fsS "$proxy/jobs/$job_id" | jq -r '.state')"
    echo "job=$job_id state=$state"
    case "$state" in succeeded|failed|cancelled) break;; esac
    sleep 2
  done
}

# open channel (200 CKB)
OPEN_JOB_ID="$(curl -fsS -X POST "$PROXY_A/jobs/channel" -H 'content-type: application/json' \
  -d "{\"params\":{\"action\":\"open\",\"openChannelParams\":{\"peer_id\":\"$PEER_B\",\"funding_amount\":\"0x2e90edd000\"},\"waitForReady\":true,\"pollIntervalMs\":1500},\"options\":{\"idempotencyKey\":\"manual-open-$(date +%s)\"}}" | jq -r '.id')"
wait_job "$PROXY_A" "$OPEN_JOB_ID"
CHANNEL_ID="$(curl -fsS "$PROXY_A/jobs/$OPEN_JOB_ID" | jq -r '.result.channelId')"

# create invoice (5 CKB)
INVOICE_JOB_ID="$(curl -fsS -X POST "$PROXY_B/jobs/invoice" -H 'content-type: application/json' \
  -d "{\"params\":{\"action\":\"create\",\"newInvoiceParams\":{\"amount\":\"0x1dcd6500\",\"currency\":\"Fibt\"},\"waitForTerminal\":false,\"pollIntervalMs\":1500},\"options\":{\"idempotencyKey\":\"manual-invoice-$(date +%s)\"}}" | jq -r '.id')"
wait_job "$PROXY_B" "$INVOICE_JOB_ID"
INVOICE_ADDRESS="$(curl -fsS "$PROXY_B/jobs/$INVOICE_JOB_ID" | jq -r '.result.invoiceAddress')"

# pay invoice
PAYMENT_JOB_ID="$(curl -fsS -X POST "$PROXY_A/jobs/payment" -H 'content-type: application/json' \
  -d "{\"params\":{\"invoice\":\"$INVOICE_ADDRESS\",\"sendPaymentParams\":{\"invoice\":\"$INVOICE_ADDRESS\"}},\"options\":{\"idempotencyKey\":\"manual-pay-$(date +%s)\"}}" | jq -r '.id')"
wait_job "$PROXY_A" "$PAYMENT_JOB_ID"

# shutdown channel
SHUTDOWN_JOB_ID="$(curl -fsS -X POST "$PROXY_A/jobs/channel" -H 'content-type: application/json' \
  -d "{\"params\":{\"action\":\"shutdown\",\"channelId\":\"$CHANNEL_ID\",\"shutdownChannelParams\":{\"channel_id\":\"$CHANNEL_ID\",\"force\":false},\"waitForClosed\":true,\"pollIntervalMs\":1500},\"options\":{\"idempotencyKey\":\"manual-close-$(date +%s)\"}}" | jq -r '.id')"
wait_job "$PROXY_A" "$SHUTDOWN_JOB_ID"

# inspect payment events
curl -fsS "$PROXY_A/jobs/$PAYMENT_JOB_ID/events" | jq
```

## One-command regression (recommended)

```bash
pnpm e2e
CHANNEL_READY_TIMEOUT_SEC=420 CHANNEL_CLOSE_TIMEOUT_SEC=180 pnpm e2e
```

## Handy job commands

```bash
fiber-pay job list --json
fiber-pay job get <jobId> --json
fiber-pay job trace <jobId>
fiber-pay job events <jobId> --json
fiber-pay job events <jobId> --with-data
fiber-pay job cancel <jobId> --json
fiber-pay logs --source all --tail 80
fiber-pay logs --source runtime --tail 50
fiber-pay logs --source runtime --follow
```

## Persistent logs (for agent debugging)

When started from `fiber-pay node start` or `fiber-pay runtime start`, runtime/fnn logs are persisted to:

- `<data-dir>/logs/fnn.stdout.log`
- `<data-dir>/logs/fnn.stderr.log`
- `<data-dir>/logs/runtime.alerts.jsonl`

`<data-dir>/runtime.meta.json` stores these paths so agents can read files directly during troubleshooting.

You can view these files directly via CLI without `cat` using `fiber-pay logs` (alias: `fiber-pay log`).
