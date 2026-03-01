#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT_DIR = resolve(__dirname, '..')
const CLI_ENTRY = join(ROOT_DIR, 'packages', 'cli', 'dist', 'cli.js')
const IS_WIN = platform() === 'win32'

function env(name, fallback) {
  const value = process.env[name]
  if (value === undefined || value === '') return fallback
  return value
}

function envInt(name, fallback) {
  const value = process.env[name]
  if (value === undefined || value === '') return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) return fallback
  return parsed
}

function envBool(name, fallback) {
  const value = process.env[name]
  if (value === undefined || value === '') return fallback
  return value === '1' || value.toLowerCase() === 'true'
}

function timestamp() {
  const now = new Date()
  const pad = (v) => String(v).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

function log(message, details) {
  if (details === undefined) {
    process.stderr.write(`[e2e-dual-node] ${message}\n`)
    return
  }
  process.stderr.write(`[e2e-dual-node] ${message}: ${details}\n`)
}

function fail(message) {
  throw new Error(message)
}

function ensureDir(path) {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true })
  }
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms))
}

function nowSec() {
  return Math.floor(Date.now() / 1000)
}

function resolveCmd(cmd) {
  if (IS_WIN && ['pnpm', 'npm', 'npx'].includes(cmd)) return `${cmd}.cmd`
  return cmd
}

function run(cmd, args, { cwd = ROOT_DIR, envOverrides = {}, ignoreError = false } = {}) {
  try {
    const stdout = execFileSync(resolveCmd(cmd), args, {
      cwd,
      env: { ...process.env, ...envOverrides },
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(IS_WIN ? { shell: true } : {}),
    })
    return stdout
  } catch (error) {
    if (ignoreError) return ''
    const stderr = (error.stderr ?? '').toString()
    const stdout = (error.stdout ?? '').toString()
    const cmdline = [cmd, ...args].join(' ')
    fail(
      [`Command failed (exit=${error.status ?? 'unknown'}): ${cmdline}`, stderr && `stderr: ${stderr.trim()}`, stdout && `stdout: ${stdout.trim()}`]
        .filter(Boolean)
        .join('\n'),
    )
  }
}

function runSafe(cmd, args, { cwd = ROOT_DIR, envOverrides = {} } = {}) {
  try {
    const stdout = execFileSync(resolveCmd(cmd), args, {
      cwd,
      env: { ...process.env, ...envOverrides },
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(IS_WIN ? { shell: true } : {}),
    })
    return { exitCode: 0, stdout, stderr: '' }
  } catch (error) {
    return {
      exitCode: error.status ?? 1,
      stdout: (error.stdout ?? '').toString(),
      stderr: (error.stderr ?? '').toString(),
    }
  }
}

function parseJsonMaybe(raw) {
  const direct = raw.trim()
  if (direct.length > 0) {
    try {
      return JSON.parse(direct)
    } catch {}
  }

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i])
    } catch {}
  }

  return undefined
}

function normalizeHex32(value, label) {
  const normalized = value.trim().toLowerCase().replace(/^0x/, '')
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    fail(`${label} must be a 32-byte hex string`)
  }
  if (/^0+$/.test(normalized)) {
    fail(`${label} must not be zero`)
  }
  return normalized
}

function extractStateName(stateValue) {
  if (typeof stateValue === 'string') return stateValue
  if (stateValue && typeof stateValue.state_name === 'string') return stateValue.state_name
  return ''
}

function isClosedState(stateName) {
  return stateName === 'CLOSED' || stateName === 'Closed'
}

function writeArtifact(name, content) {
  const target = join(ARTIFACT_DIR, name)
  writeFileSync(target, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf-8')
}

function nodeEnv(nodeName) {
  const isA = nodeName === 'A'
  const dataDir = isA ? NODE_A_DIR : NODE_B_DIR
  const rpcPort = isA ? NODE_A_RPC_PORT : NODE_B_RPC_PORT
  const p2pPort = isA ? NODE_A_P2P_PORT : NODE_B_P2P_PORT
  return {
    FIBER_DATA_DIR: dataDir,
    FIBER_NETWORK: NETWORK,
    FIBER_KEY_PASSWORD: KEY_PASSWORD,
    FIBER_RPC_PORT: String(rpcPort),
    FIBER_P2P_PORT: String(p2pPort),
    FIBER_RPC_URL: `http://127.0.0.1:${rpcPort}`,
  }
}

function fiberPayRaw(nodeName, args, { allowFailure = false } = {}) {
  return run('pnpm', ['--filter', '@fiber-pay/cli', 'exec', 'node', CLI_ENTRY, ...args], {
    envOverrides: nodeEnv(nodeName),
    ignoreError: allowFailure,
  })
}

function fiberPaySafe(nodeName, args) {
  return runSafe('pnpm', ['--filter', '@fiber-pay/cli', 'exec', 'node', CLI_ENTRY, ...args], {
    envOverrides: nodeEnv(nodeName),
  })
}

function writeOptionalJsonArtifact(name, commandResult) {
  const parsed = parseJsonMaybe(commandResult.stdout)
  writeArtifact(name, {
    exitCode: commandResult.exitCode,
    stdout: parsed ?? commandResult.stdout,
    stderr: commandResult.stderr,
  })
}

function fiberPayJson(nodeName, args, { allowFailure = false } = {}) {
  const raw = fiberPayRaw(nodeName, [...args, '--json'], { allowFailure })
  const parsed = parseJsonMaybe(raw)
  if (!parsed) {
    fail(`Invalid JSON from node ${nodeName}: ${args.join(' ')}\n${raw}`)
  }
  return { raw, parsed }
}

async function retry(action, { retries, delaySec, label }) {
  let lastError
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await action()
    } catch (error) {
      lastError = error
      log(`${label} attempt ${attempt}/${retries} failed`, error.message ?? String(error))
      if (attempt < retries) {
        await sleep(delaySec * 1000)
      }
    }
  }
  fail(`${label} failed after ${retries} attempts: ${lastError?.message ?? lastError}`)
}

async function waitForNodeReady(nodeName, timeoutSec) {
  const deadline = nowSec() + timeoutSec
  while (nowSec() < deadline) {
    const { exitCode, stdout } = fiberPaySafe(nodeName, ['node', 'ready', '--json'])
    if (exitCode === 0) {
      const parsed = parseJsonMaybe(stdout)
      if (
        parsed?.success === true &&
        parsed?.data?.nodeRunning === true &&
        parsed?.data?.rpcReachable === true
      ) {
        return parsed
      }
    }
    await sleep(POLL_INTERVAL_SEC * 1000)
  }
  fail(`Node ${nodeName} not ready within ${timeoutSec}s`)
}

function listChannels(nodeName, { includeClosed = true } = {}) {
  const args = ['channel', 'list']
  if (includeClosed) args.push('--include-closed')
  const { parsed } = fiberPayJson(nodeName, args)
  return Array.isArray(parsed?.data?.channels) ? parsed.data.channels : []
}

function findLatestChannel(channels, peerId, { stateName, includeClosed = true } = {}) {
  const candidates = channels.filter((channel) => {
    if (channel?.peer_id !== peerId) return false
    const channelState = extractStateName(channel?.state)
    if (!includeClosed && isClosedState(channelState)) return false
    if (stateName && channelState !== stateName) return false
    return typeof channel?.channel_id === 'string'
  })

  if (candidates.length === 0) return undefined

  const sorted = candidates.sort((left, right) => {
    const l = BigInt(left?.created_at ?? '0x0')
    const r = BigInt(right?.created_at ?? '0x0')
    if (l === r) return 0
    return l > r ? -1 : 1
  })

  return sorted[0]
}

async function waitForChannelState({ nodeName, channelId, targetState, timeoutSec }) {
  const deadline = nowSec() + timeoutSec
  while (nowSec() < deadline) {
    const channels = listChannels(nodeName, { includeClosed: true })
    const channel = channels.find((item) => item?.channel_id === channelId)
    const stateName = extractStateName(channel?.state)
    if (stateName === targetState) return channel
    await sleep(POLL_INTERVAL_SEC * 1000)
  }
  fail(`Channel ${channelId} on node ${nodeName} did not reach ${targetState} within ${timeoutSec}s`)
}

async function waitForReadyChannel(peerId, timeoutSec) {
  const deadline = nowSec() + timeoutSec
  while (nowSec() < deadline) {
    const channelsA = listChannels('A', { includeClosed: false })
    const channelsB = listChannels('B', { includeClosed: false })
    const channelA = findLatestChannel(channelsA, peerId, {
      stateName: 'CHANNEL_READY',
      includeClosed: false,
    })
    const channelB = findLatestChannel(channelsB, EXPECTED_NODE_A_PEER_ID, {
      stateName: 'CHANNEL_READY',
      includeClosed: false,
    })
    if (channelA?.channel_id && channelB?.channel_id && channelA.channel_id === channelB.channel_id) {
      return channelA.channel_id
    }
    await sleep(POLL_INTERVAL_SEC * 1000)
  }
  fail(`Channel did not reach CHANNEL_READY within ${CHANNEL_READY_TIMEOUT_SEC}s`)
}

async function closeActiveChannels(peerId) {
  const channels = listChannels('A', { includeClosed: true })
  const active = channels.filter((channel) => {
    if (channel?.peer_id !== peerId) return false
    const stateName = extractStateName(channel?.state)
    return stateName !== '' && !isClosedState(stateName)
  })

  if (active.length === 0) return

  for (const channel of active) {
    try {
      fiberPayJson('A', ['channel', 'close', channel.channel_id])
    } catch {
      fiberPayJson('A', ['channel', 'close', channel.channel_id, '--force'])
    }
  }

  const deadline = nowSec() + CHANNEL_CLOSE_TIMEOUT_SEC
  while (nowSec() < deadline) {
    const snapshot = listChannels('A', { includeClosed: true })
    const stillActive = snapshot.some((channel) => {
      if (channel?.peer_id !== peerId) return false
      const stateName = extractStateName(channel?.state)
      return stateName !== '' && !isClosedState(stateName)
    })
    if (!stillActive) return
    await sleep(POLL_INTERVAL_SEC * 1000)
  }

  fail('Pre-cleanup channels did not close in time')
}

function checkFundingBalance(statusData, nodeLabel) {
  const total = Number(statusData?.balance?.fundingAddressTotalCkb ?? Number.NaN)
  if (!Number.isFinite(total)) {
    fail(`Unable to read fundingAddressTotalCkb for node ${nodeLabel}`)
  }
  if (total < MIN_FUNDING_BALANCE_CKB) {
    fail(
      `Node ${nodeLabel} funding balance ${total} CKB is below MIN_FUNDING_BALANCE_CKB=${MIN_FUNDING_BALANCE_CKB}. Please pre-fund fixed node first.`,
    )
  }
}

function writeFixedKeys(nodeName, fiberKeyHex, ckbKeyHex) {
  const dataDir = nodeName === 'A' ? NODE_A_DIR : NODE_B_DIR
  const fiberDir = join(dataDir, 'fiber')
  const ckbDir = join(dataDir, 'ckb')
  ensureDir(fiberDir)
  ensureDir(ckbDir)

  writeFileSync(join(fiberDir, 'sk'), Buffer.from(fiberKeyHex, 'hex'))
  writeFileSync(join(ckbDir, 'key'), `${ckbKeyHex}\n`, 'utf-8')
}

function clearNodeDirs() {
  for (const dirPath of [NODE_A_DIR, NODE_B_DIR]) {
    try {
      rmSync(dirPath, { recursive: true, force: true })
    } catch {}
  }
}

function collectArtifacts() {
  for (const [name, dirPath] of [
    ['node-a', NODE_A_DIR],
    ['node-b', NODE_B_DIR],
  ]) {
    const configPath = join(dirPath, 'config.yml')
    if (existsSync(configPath)) {
      copyFileSync(configPath, join(ARTIFACT_DIR, `${name}.config.yml`))
    }
  }
}

async function stopNodesBestEffort() {
  fiberPayRaw('A', ['node', 'stop', '--json'], { allowFailure: true })
  fiberPayRaw('B', ['node', 'stop', '--json'], { allowFailure: true })
}

const ARTIFACT_DIR = env(
  'ARTIFACT_DIR',
  join(ROOT_DIR, '.artifacts', `e2e-dual-node-${timestamp()}`),
)

const DEFAULT_PROFILE_ROOT = join(homedir(), '.fiber-pay', 'profiles')
const NODE_A_DIR = env('NODE_A_DIR', join(DEFAULT_PROFILE_ROOT, 'e2e-a'))
const NODE_B_DIR = env('NODE_B_DIR', join(DEFAULT_PROFILE_ROOT, 'e2e-b'))

const NODE_A_RPC_PORT = envInt('NODE_A_RPC_PORT', 8727)
const NODE_A_P2P_PORT = envInt('NODE_A_P2P_PORT', 8728)
const NODE_B_RPC_PORT = envInt('NODE_B_RPC_PORT', 8827)
const NODE_B_P2P_PORT = envInt('NODE_B_P2P_PORT', 8828)

const NETWORK = env('NETWORK', 'testnet')
const KEY_PASSWORD = env('FIBER_KEY_PASSWORD', 'fiber-pay-e2e-key')
const FIBER_BINARY_VERSION = env('FIBER_BINARY_VERSION', 'v0.7.1')

const FIXED_NODE_A_FIBER_SK_HEX = normalizeHex32(
  env('FIXED_NODE_A_FIBER_SK_HEX', '0000000000000000000000000000000000000000000000000000000000000001'),
  'FIXED_NODE_A_FIBER_SK_HEX',
)
const FIXED_NODE_B_FIBER_SK_HEX = normalizeHex32(
  env('FIXED_NODE_B_FIBER_SK_HEX', '0000000000000000000000000000000000000000000000000000000000000002'),
  'FIXED_NODE_B_FIBER_SK_HEX',
)
const FIXED_NODE_A_CKB_SK_HEX = normalizeHex32(
  env('FIXED_NODE_A_CKB_SK_HEX', '0000000000000000000000000000000000000000000000000000000000000011'),
  'FIXED_NODE_A_CKB_SK_HEX',
)
const FIXED_NODE_B_CKB_SK_HEX = normalizeHex32(
  env('FIXED_NODE_B_CKB_SK_HEX', '0000000000000000000000000000000000000000000000000000000000000012'),
  'FIXED_NODE_B_CKB_SK_HEX',
)

let EXPECTED_NODE_A_PEER_ID = ''

const CHANNEL_FUNDING_CKB = envInt('CHANNEL_FUNDING_CKB', 200)
const INVOICE_AMOUNT_CKB = envInt('INVOICE_AMOUNT_CKB', 1)
const MIN_FUNDING_BALANCE_CKB = envInt(
  'MIN_FUNDING_BALANCE_CKB',
  CHANNEL_FUNDING_CKB + INVOICE_AMOUNT_CKB + 5,
)

const NODE_READY_TIMEOUT_SEC = envInt('NODE_READY_TIMEOUT_SEC', 120)
const CHANNEL_READY_TIMEOUT_SEC = envInt('CHANNEL_READY_TIMEOUT_SEC', 360)
const PAYMENT_TIMEOUT_SEC = envInt('PAYMENT_TIMEOUT_SEC', 180)
const CHANNEL_CLOSE_TIMEOUT_SEC = envInt('CHANNEL_CLOSE_TIMEOUT_SEC', 360)
const POLL_INTERVAL_SEC = envInt('POLL_INTERVAL_SEC', 3)

const SKIP_BUILD = envBool('SKIP_BUILD', false)
const SKIP_BINARY_DOWNLOAD = envBool('SKIP_BINARY_DOWNLOAD', false)
const CLEAR_BEFORE_RUN = envBool('CLEAR_BEFORE_RUN', false)
const STOP_NODES_ON_EXIT = envBool('STOP_NODES_ON_EXIT', true)

async function main() {
  ensureDir(ARTIFACT_DIR)

  if (CLEAR_BEFORE_RUN) {
    log('Clearing node directories', `${NODE_A_DIR}, ${NODE_B_DIR}`)
    clearNodeDirs()
  }

  ensureDir(NODE_A_DIR)
  ensureDir(NODE_B_DIR)

  if (!SKIP_BUILD) {
    log('Building workspace')
    run('pnpm', ['build'])
  }

  log('Initializing configs')
  writeArtifact(
    'node-a.config-init.json',
    fiberPayRaw('A', ['config', 'init', '--network', NETWORK, '--force', '--json']),
  )
  writeArtifact(
    'node-b.config-init.json',
    fiberPayRaw('B', ['config', 'init', '--network', NETWORK, '--force', '--json']),
  )

  log('Writing fixed node keys')
  writeFixedKeys('A', FIXED_NODE_A_FIBER_SK_HEX, FIXED_NODE_A_CKB_SK_HEX)
  writeFixedKeys('B', FIXED_NODE_B_FIBER_SK_HEX, FIXED_NODE_B_CKB_SK_HEX)

  if (!SKIP_BINARY_DOWNLOAD) {
    log('Ensuring fiber binaries', FIBER_BINARY_VERSION)
    writeArtifact(
      'node-a.binary.json',
      fiberPayRaw('A', ['binary', 'download', '--version', FIBER_BINARY_VERSION, '--json']),
    )
    writeArtifact(
      'node-b.binary.json',
      fiberPayRaw('B', ['binary', 'download', '--version', FIBER_BINARY_VERSION, '--json']),
    )
  }

  log('Starting nodes')
  fiberPayRaw('A', ['node', 'start', '--daemon', '--json'], { allowFailure: true })
  fiberPayRaw('B', ['node', 'start', '--daemon', '--json'], { allowFailure: true })

  await waitForNodeReady('A', NODE_READY_TIMEOUT_SEC)
  await waitForNodeReady('B', NODE_READY_TIMEOUT_SEC)

  const statusA = fiberPayJson('A', ['node', 'status']).parsed.data
  const statusB = fiberPayJson('B', ['node', 'status']).parsed.data
  writeArtifact('node-a.status.json', statusA)
  writeArtifact('node-b.status.json', statusB)

  checkFundingBalance(statusA, 'A')
  checkFundingBalance(statusB, 'B')

  const peerA = statusA?.peerId
  const peerB = statusB?.peerId
  const multiaddrA = statusA?.multiaddr
  const multiaddrB = statusB?.multiaddr

  if (!peerA || !peerB || !multiaddrA || !multiaddrB) {
    fail('Missing peerId or multiaddr in node status')
  }

  EXPECTED_NODE_A_PEER_ID = peerA

  await closeActiveChannels(peerB)

  log('Connecting peers')
  await retry(() => fiberPayJson('A', ['peer', 'connect', multiaddrB]), {
    retries: 5,
    delaySec: 2,
    label: 'peer connect A->B',
  })
  await retry(() => fiberPayJson('B', ['peer', 'connect', multiaddrA]), {
    retries: 5,
    delaySec: 2,
    label: 'peer connect B->A',
  })

  log('Opening channel')
  const openResult = await retry(
    () =>
      fiberPayJson('A', [
        'channel',
        'open',
        '--peer',
        peerB,
        '--funding',
        String(CHANNEL_FUNDING_CKB),
      ]),
    {
      retries: 8,
      delaySec: 5,
      label: 'channel open',
    },
  )
  writeArtifact('channel-open.json', openResult.parsed)

  const channelId = await waitForReadyChannel(peerB, CHANNEL_READY_TIMEOUT_SEC)
  writeArtifact('channel-id.txt', channelId)

  log('Creating tiny invoice')
  const invoiceResult = fiberPayJson('B', [
    'invoice',
    'create',
    '--amount',
    String(INVOICE_AMOUNT_CKB),
    '--description',
    'e2e-fixed-node-smoke',
  ])
  writeArtifact('invoice-create.json', invoiceResult.parsed)

  const invoice = invoiceResult?.parsed?.data?.invoice
  if (typeof invoice !== 'string' || invoice.length === 0) {
    fail('Failed to extract invoice string from invoice create result')
  }

  log('Sending payment with wait')
  const paymentResult = fiberPayJson('A', [
    'payment',
    'send',
    '--invoice',
    invoice,
    '--wait',
    '--timeout',
    String(PAYMENT_TIMEOUT_SEC),
  ])
  writeArtifact('payment-send.json', paymentResult.parsed)

  log('Closing channel')
  const closeResult = fiberPayJson('A', ['channel', 'close', channelId])
  writeArtifact('channel-close.json', closeResult.parsed)

  await waitForChannelState({
    nodeName: 'A',
    channelId,
    targetState: 'CLOSED',
    timeoutSec: CHANNEL_CLOSE_TIMEOUT_SEC,
  })

  await waitForChannelState({
    nodeName: 'B',
    channelId,
    targetState: 'CLOSED',
    timeoutSec: CHANNEL_CLOSE_TIMEOUT_SEC,
  })

  writeArtifact('node-a.channels.json', listChannels('A', { includeClosed: true }))
  writeArtifact('node-b.channels.json', listChannels('B', { includeClosed: true }))
  writeOptionalJsonArtifact('node-a.jobs.json', fiberPaySafe('A', ['job', 'list', '--json']))
  writeOptionalJsonArtifact('node-b.jobs.json', fiberPaySafe('B', ['job', 'list', '--json']))

  const summary = {
    success: true,
    profiles: {
      nodeA: NODE_A_DIR,
      nodeB: NODE_B_DIR,
    },
    nodeIds: {
      nodeA: statusA.nodeId,
      nodeB: statusB.nodeId,
    },
    balances: {
      nodeA: statusA?.balance?.fundingAddressTotalCkb,
      nodeB: statusB?.balance?.fundingAddressTotalCkb,
    },
    channelId,
    paymentAmountCkb: INVOICE_AMOUNT_CKB,
  }
  writeArtifact('summary.json', summary)

  log('E2E completed', `channel=${channelId} invoiceAmount=${INVOICE_AMOUNT_CKB} CKB`)
}

async function finalize(exitCode) {
  try {
    collectArtifacts()
  } catch {}

  if (STOP_NODES_ON_EXIT) {
    try {
      await stopNodesBestEffort()
    } catch {}
  }

  if (exitCode === 0) {
    log('SUCCESS', `artifacts=${ARTIFACT_DIR}`)
  } else {
    log('FAILED', `artifacts=${ARTIFACT_DIR}`)
  }
}

let shutdownInProgress = false

async function finalizeAndExit(exitCode) {
  if (shutdownInProgress) return
  shutdownInProgress = true
  await finalize(exitCode)
  process.exit(exitCode)
}

main()
  .then(async () => {
    await finalizeAndExit(0)
  })
  .catch(async (error) => {
    log('Unhandled error', error?.message ?? String(error))
    if (error?.stack) {
      writeArtifact('error.stack.txt', error.stack)
    }
    await finalizeAndExit(1)
  })

process.on('SIGINT', async () => {
  log('Caught signal', 'SIGINT')
  await finalizeAndExit(130)
})

process.on('SIGTERM', async () => {
  log('Caught signal', 'SIGTERM')
  await finalizeAndExit(143)
})
