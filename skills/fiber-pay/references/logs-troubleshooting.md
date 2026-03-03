# Logs Troubleshooting Playbook

Use this when `fiber-pay node start` / channel open-close / payment execution feels like a black box.

## 0) Default run mode for agents

Prefer background/daemon-style operation in automation:

- run `fiber-pay node start --json --quiet-fnn` in a background terminal/session
- if node is up but runtime is down, run `fiber-pay runtime start --daemon --json`
- avoid blocking foreground sessions unless doing manual interactive debugging

## 1) Know where logs live

Per profile/data-dir, runtime and fnn persist logs under daily-rotated directories:

- `<data-dir>/logs/<YYYY-MM-DD>/fnn.stdout.log`
- `<data-dir>/logs/<YYYY-MM-DD>/fnn.stderr.log`
- `<data-dir>/logs/<YYYY-MM-DD>/runtime.alerts.jsonl`

Each day (UTC) gets its own subdirectory. All daily directories are kept indefinitely.

Runtime metadata file:

- `<data-dir>/runtime.meta.json` (contains runtime/log paths and `logsBaseDir`)

Prefer CLI log access first (no manual `cat` needed):

```bash
fiber-pay logs --list-dates --json          # discover available log dates
fiber-pay logs --source all --tail 80       # today's logs (default)
fiber-pay logs --source runtime --tail 120
fiber-pay logs --source fnn-stderr --tail 120
fiber-pay logs --date 2026-03-01 --source all --tail 200  # specific date
fiber-pay logs --source runtime --follow    # follow today's logs live
```

Notes:

- `logs` has alias `log`
- `--date YYYY-MM-DD` selects a specific day's logs (default: today UTC)
- `--list-dates` lists available log date directories and exits
- `--follow` is human-output mode (do not combine with `--json`); follows today's log files only

## 2) Quick health triage

Run in order:

```bash
fiber-pay node status --json
fiber-pay node ready --json
fiber-pay runtime status --json
```

Interpretation:

- `running=false` → process-level issue (startup/config/port/binary)
- `rpcResponsive=false` with `running=true` → node unhealthy or blocked init
- `recommendation=INSTALL_BINARY` → run `fiber-pay binary download`

## 3) Job-first debugging (recommended)

For channel/payment/invoice workflows, always pivot from job ID:

```bash
fiber-pay job list --json
fiber-pay job get <jobId> --json
fiber-pay job events <jobId> --with-data
fiber-pay job trace <jobId>
```

What to look at:

- `state` transitions (`queued -> ... -> failed/succeeded`)
- `event.data` fields (`action`, `channelId`, `peerId`, `retryCount`, `error`)
- `job trace` matched log lines in fnn/runtime logs

## 4) Startup failure triage

If `node start` exits early:

1. `fiber-pay logs --source fnn-stderr --tail 200`
2. `fiber-pay logs --source fnn-stdout --tail 200`
3. `fiber-pay logs --source runtime --tail 200`
4. for live retry loops, run `fiber-pay logs --source all --follow`

Common symptom:

- Config parse errors (invalid `code_hash`/`tx_hash`/`args` length) indicate malformed `config.yml`.

## 5) Noise control

`node start` supports both streaming and persistence:

- default: mirror fnn logs to console + persist to files
- `--quiet-fnn`: persist only, no fnn console/json-event mirroring

## 6) Safe smoke-test pattern (isolated dir)

Avoid contaminating default profile while debugging:

```bash
fiber-pay --data-dir ~/.fiber-pay-smoke config init --network testnet --force --json
fiber-pay --data-dir ~/.fiber-pay-smoke binary download --json
fiber-pay --data-dir ~/.fiber-pay-smoke node start --json
fiber-pay --data-dir ~/.fiber-pay-smoke logs --source all --tail 120
fiber-pay --data-dir ~/.fiber-pay-smoke node status --json
fiber-pay --data-dir ~/.fiber-pay-smoke node stop --json
```

## 7) Agent debugging micro-habits (logs-first)

These are small, high-leverage habits for external agents that don't yet know local operator context.

### 7.1 Use `--json` and a job-id driven troubleshooting chain

Always use machine-readable output and pivot from job id:

```bash
fiber-pay job list --json
fiber-pay job get <jobId> --json
fiber-pay job events <jobId> --with-data
fiber-pay job trace <jobId>
```

### 7.2 Minimal checks for possible "false success"

When a command returns success too quickly, verify all three:

1. whether `jobId` is being reused
2. whether `updatedAt` moved forward
3. whether key `result` fields changed (for example `temporaryChannelId`, `channelId`)

If these do not change, treat it as possible terminal-result reuse and investigate idempotency behavior before trusting the outcome.

### 7.3 Log source priority

Use this order for faster triage:

1. `fnn-stderr` (fatal startup/config issues)
2. `runtime` (orchestration/monitoring layer)
3. `fnn-stdout` (state context, usually noisier)

### 7.4 Prefer CLI log aggregation first

Do not open raw files first. Start with CLI logs:

```bash
fiber-pay logs --list-dates --json
fiber-pay logs --source fnn-stderr --tail 200
fiber-pay logs --source runtime --tail 200
fiber-pay logs --source fnn-stdout --tail 200
fiber-pay logs --date <YYYY-MM-DD> --source all --tail 200  # for past dates
```

Use `--follow` only when continuous observation is needed.

### 7.5 Runtime alerts are high-value signals

`runtime.alerts.jsonl` fields (`type`, `priority`, `source`) are useful for fast classification of disconnect/retry/failure patterns.

### 7.6 Startup triage fixed three-check sequence

When startup is suspicious, always run:

```bash
fiber-pay node status --json
fiber-pay runtime status --json
fiber-pay logs --source fnn-stderr --tail 200
```

This quickly separates "process not started" from "process started but unhealthy".

### 7.7 Keep startup and diagnostics separated

- Default to daemon/background mode for automation stability.
- Use foreground startup only when you need live startup logs.
- After diagnosis, switch back to daemon mode.

### 7.8 Validate profile identity before drawing conclusions

In multi-profile workflows, always confirm that logs and status belong to the intended profile:

```bash
fiber-pay --profile <name> node status --json
fiber-pay --profile <name> runtime status --json
```

Do not compare outcomes across profiles unless peer IDs are explicitly verified.

### 7.9 Use isolated smoke directories for repeatable debugging

Use `--data-dir ~/.fiber-pay-smoke` for reproducible smoke tests without polluting default profile logs and runtime state.

### 7.10 Use clean execution contexts when shell noise appears

If terminal hooks/plugins pollute output, run commands in a fresh non-interactive session and keep `--json` parsing strict. Otherwise, log conclusions can be wrong even when command behavior is correct.
