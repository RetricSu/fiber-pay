#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const asJson = process.argv.includes('--json');

const PROFILE_A = process.env.PROFILE_A ?? 'rt-a';
const PROFILE_B = process.env.PROFILE_B ?? 'rt-b';
const PROXY_A_URL = process.env.PROXY_A_URL;
const PROXY_B_URL = process.env.PROXY_B_URL;
const FALLBACK_PROXY_A_URL = 'http://127.0.0.1:9729';
const FALLBACK_PROXY_B_URL = 'http://127.0.0.1:9829';

const CHANNEL_FUNDING_CKB = Number(process.env.CHANNEL_FUNDING_CKB ?? '200');
const INVOICE_AMOUNT_CKB = Number(process.env.INVOICE_AMOUNT_CKB ?? '5');
const INVOICE_CURRENCY = process.env.INVOICE_CURRENCY ?? 'Fibt';
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS ?? '1500');
const JOB_TIMEOUT_SEC = Number(process.env.JOB_TIMEOUT_SEC ?? '240');
const PEER_CONNECT_TIMEOUT_SEC = Number(process.env.PEER_CONNECT_TIMEOUT_SEC ?? '12');
const CHANNEL_CLEANUP_TIMEOUT_SEC = Number(process.env.CHANNEL_CLEANUP_TIMEOUT_SEC ?? '180');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const DEFAULT_CLI_ENTRY = resolve(__dirname, '../packages/cli/dist/cli.js');

const FIBER_PAY_BIN = process.env.FIBER_PAY_BIN ?? process.execPath;
const FIBER_PAY_PREFIX_ARGS = process.env.FIBER_PAY_BIN ? [] : [DEFAULT_CLI_ENTRY];

function log(message, details) {
  const text =
    details === undefined
      ? `[e2e-runtime-orchestration] ${message}`
      : `[e2e-runtime-orchestration] ${message}: ${details}`;

  if (asJson) {
    process.stderr.write(`${text}\n`);
    return;
  }

  console.log(text);
}

function toHexShannons(ckb) {
  const shannons = BigInt(Math.round(ckb * 100_000_000));
  return `0x${shannons.toString(16)}`;
}

function randomHex32() {
  return `0x${randomBytes(32).toString('hex')}`;
}

function runFiberPay(profile, args) {
  const output = spawnSync(
    FIBER_PAY_BIN,
    [...FIBER_PAY_PREFIX_ARGS, '--profile', profile, ...args],
    {
      encoding: 'utf-8',
      maxBuffer: 20 * 1024 * 1024,
    },
  );

  if (output.status !== 0) {
    const stderr = (output.stderr ?? '').trim();
    const stdout = (output.stdout ?? '').trim();
    throw new Error(
      [
        `fiber-pay command failed for profile ${profile}: ${args.join(' ')}`,
        stderr ? `stderr: ${stderr}` : '',
        stdout ? `stdout: ${stdout}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    );
  }

  return output.stdout;
}

function runFiberPayJson(profile, args) {
  const raw = runFiberPay(profile, [...args, '--json']);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON from fiber-pay (${profile} ${args.join(' ')}): ${raw}`);
  }
  if (!parsed?.success) {
    throw new Error(
      `fiber-pay returned non-success (${profile} ${args.join(' ')}): ${JSON.stringify(parsed)}`,
    );
  }
  return parsed.data;
}

async function httpJson(url, method = 'GET', body) {
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`HTTP ${method} ${url} network error: ${reason}`);
  }

  let payload;
  try {
    payload = await res.json();
  } catch {
    payload = undefined;
  }

  if (!res.ok) {
    throw new Error(`HTTP ${method} ${url} failed (${res.status}): ${JSON.stringify(payload)}`);
  }

  return payload;
}

async function waitForJobTerminal(proxyUrl, jobId, timeoutSec) {
  const deadline = Date.now() + timeoutSec * 1000;
  let lastState;
  let lastProgressLogAt = 0;

  while (Date.now() < deadline) {
    const job = await httpJson(`${proxyUrl}/jobs/${jobId}`);
    if (job.state !== lastState) {
      log('Job state changed', `${jobId} -> ${job.state}`);
      lastState = job.state;
      lastProgressLogAt = Date.now();
    } else if (Date.now() - lastProgressLogAt >= 10_000) {
      log('Waiting job terminal', `${jobId} still ${job.state}`);
      lastProgressLogAt = Date.now();
    }

    if (job.state === 'succeeded' || job.state === 'failed' || job.state === 'cancelled') {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error(`Timeout waiting for job terminal state: ${jobId}`);
}

function extractChannelState(channel) {
  const state = channel?.state;
  if (typeof state === 'string') return state;
  if (state && typeof state.state_name === 'string') return state.state_name;
  return undefined;
}

function isChannelClosedState(state) {
  return (
    state === 'CLOSED' ||
    state === 'Closed' ||
    state === 'SHUTTING_DOWN' ||
    state === 'ShuttingDown'
  );
}

function isChannelActiveState(state) {
  if (!state) return false;
  return !isChannelClosedState(state);
}

function listPeerChannels(profile, peerId) {
  const data = runFiberPayJson(profile, ['channel', 'list', '--peer', peerId, '--include-closed']);
  return Array.isArray(data?.channels) ? data.channels : [];
}

async function cleanupPeerChannels(profile, peerId, timeoutSec) {
  const before = listPeerChannels(profile, peerId);
  const active = before.filter((channel) => isChannelActiveState(extractChannelState(channel)));

  if (active.length === 0) {
    return { removed: 0, waited: false, initial: before.length };
  }

  log(`Found ${active.length} active channel(s) for ${profile} -> ${peerId}, issuing close`);
  for (const channel of active) {
    const channelId = channel?.channel_id;
    if (!channelId || typeof channelId !== 'string') continue;
    try {
      runFiberPayJson(profile, ['channel', 'close', channelId, '--force']);
    } catch {
      // ignore close race; we'll verify final state by polling
    }
  }

  const deadline = Date.now() + timeoutSec * 1000;
  const abandonAt = Date.now() + Math.floor((timeoutSec * 1000) / 2);
  let lastProgressLogAt = Date.now();
  let abandonTriggered = false;
  while (Date.now() < deadline) {
    const channels = listPeerChannels(profile, peerId);
    const stillActive = channels.filter((channel) =>
      isChannelActiveState(extractChannelState(channel)),
    );
    if (stillActive.length === 0) {
      return { removed: active.length, waited: true, initial: before.length };
    }

    if (Date.now() - lastProgressLogAt >= 10_000) {
      const states = stillActive
        .map(
          (channel) =>
            `${channel?.channel_id ?? 'unknown'}:${extractChannelState(channel) ?? 'unknown'}`,
        )
        .join(', ');
      log('Waiting channel cleanup', `${profile} has ${stillActive.length} active: ${states}`);
      lastProgressLogAt = Date.now();
    }

    if (!abandonTriggered && Date.now() >= abandonAt) {
      abandonTriggered = true;
      log('Cleanup still pending, issuing abandon fallback', profile);
      for (const channel of stillActive) {
        const channelId = channel?.channel_id;
        if (!channelId || typeof channelId !== 'string') continue;
        try {
          runFiberPayJson(profile, ['channel', 'abandon', channelId]);
        } catch {
          // ignore race; poll loop decides final status
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  const snapshot = listPeerChannels(profile, peerId).map((channel) => ({
    channelId: channel?.channel_id,
    state: extractChannelState(channel),
  }));
  log(
    'Channel cleanup timeout, continue with best-effort state',
    `${profile} -> ${JSON.stringify(snapshot)}`,
  );
  return {
    removed: active.length,
    waited: true,
    initial: before.length,
    timedOut: true,
    snapshot,
  };
}

async function ensureProxyHealthy(proxyUrl) {
  await httpJson(`${proxyUrl}/monitor/status`);
}

async function createChannelOpenJob(proxyAUrl, peerId) {
  return await httpJson(`${proxyAUrl}/jobs/channel`, 'POST', {
    params: {
      action: 'open',
      openChannelParams: {
        peer_id: peerId,
        funding_amount: toHexShannons(CHANNEL_FUNDING_CKB),
      },
      waitForReady: true,
      pollIntervalMs: POLL_INTERVAL_MS,
    },
    options: {
      idempotencyKey: `e2e-job-open-${Date.now()}`,
    },
  });
}

async function createInvoiceJob(proxyBUrl) {
  return await httpJson(`${proxyBUrl}/jobs/invoice`, 'POST', {
    params: {
      action: 'create',
      newInvoiceParams: {
        amount: toHexShannons(INVOICE_AMOUNT_CKB),
        currency: INVOICE_CURRENCY,
        payment_preimage: randomHex32(),
      },
      waitForTerminal: false,
      pollIntervalMs: POLL_INTERVAL_MS,
    },
    options: {
      idempotencyKey: `e2e-job-invoice-${Date.now()}`,
    },
  });
}

async function createPaymentJob(proxyAUrl, invoice) {
  return await httpJson(`${proxyAUrl}/jobs/payment`, 'POST', {
    params: {
      invoice,
      sendPaymentParams: { invoice },
    },
    options: {
      idempotencyKey: `e2e-job-payment-${Date.now()}`,
    },
  });
}

async function createChannelShutdownJob(proxyAUrl, channelId) {
  return await httpJson(`${proxyAUrl}/jobs/channel`, 'POST', {
    params: {
      action: 'shutdown',
      channelId,
      shutdownChannelParams: {
        channel_id: channelId,
        force: false,
      },
      waitForClosed: true,
      pollIntervalMs: POLL_INTERVAL_MS,
    },
    options: {
      idempotencyKey: `e2e-job-close-${Date.now()}`,
    },
  });
}

async function main() {
  const proxyAUrl = PROXY_A_URL ?? discoverProxyUrl(PROFILE_A) ?? FALLBACK_PROXY_A_URL;
  const proxyBUrl = PROXY_B_URL ?? discoverProxyUrl(PROFILE_B) ?? FALLBACK_PROXY_B_URL;

  const summary = {
    profiles: { a: PROFILE_A, b: PROFILE_B },
    proxies: { a: proxyAUrl, b: proxyBUrl },
    jobs: {},
    assertions: {
      allTerminalSucceeded: false,
      paymentEventLifecycleOk: false,
    },
  };

  log('Preflight: checking runtime proxy health');
  await ensureProxyHealthy(proxyAUrl);
  await ensureProxyHealthy(proxyBUrl);

  log('Reading node status for peer identities');
  const statusA = runFiberPayJson(PROFILE_A, ['node', 'status']);
  const statusB = runFiberPayJson(PROFILE_B, ['node', 'status']);
  if (!statusA.running || !statusB.running) {
    throw new Error('Both nodes must be running before this script.');
  }
  if (!statusA.rpcResponsive || !statusB.rpcResponsive) {
    throw new Error('Both node RPC endpoints must be responsive before this script.');
  }

  const peerA = statusA.peerId;
  const peerB = statusB.peerId;
  const multiaddrA = statusA.multiaddr;
  const multiaddrB = statusB.multiaddr;

  if (!peerA || !peerB || !multiaddrA || !multiaddrB) {
    throw new Error('Unable to resolve peerId/multiaddr from node status.');
  }

  log('Connecting peers');
  runFiberPayJson(PROFILE_A, [
    'peer',
    'connect',
    multiaddrB,
    '--timeout',
    String(PEER_CONNECT_TIMEOUT_SEC),
  ]);
  runFiberPayJson(PROFILE_B, [
    'peer',
    'connect',
    multiaddrA,
    '--timeout',
    String(PEER_CONNECT_TIMEOUT_SEC),
  ]);

  log('Cleaning stale channels for deterministic run');
  const cleanupA = await cleanupPeerChannels(PROFILE_A, peerB, CHANNEL_CLEANUP_TIMEOUT_SEC);
  const cleanupB = await cleanupPeerChannels(PROFILE_B, peerA, CHANNEL_CLEANUP_TIMEOUT_SEC);
  summary.cleanup = {
    aToB: cleanupA,
    bToA: cleanupB,
  };

  log('Submitting channel open job via runtime proxy');
  const openJob = await createChannelOpenJob(proxyAUrl, peerB);
  const openFinal = await waitForJobTerminal(proxyAUrl, openJob.id, JOB_TIMEOUT_SEC);
  summary.jobs.open = {
    id: openJob.id,
    state: openFinal.state,
    result: openFinal.result,
    error: openFinal.error,
  };
  if (openFinal.state !== 'succeeded') {
    throw new Error(`Channel open job did not succeed: ${JSON.stringify(openFinal)}`);
  }

  log('Submitting invoice create job via runtime proxy');
  const invoiceJob = await createInvoiceJob(proxyBUrl);
  const invoiceFinal = await waitForJobTerminal(proxyBUrl, invoiceJob.id, JOB_TIMEOUT_SEC);
  summary.jobs.invoice = {
    id: invoiceJob.id,
    state: invoiceFinal.state,
    result: invoiceFinal.result,
    error: invoiceFinal.error,
  };
  if (invoiceFinal.state !== 'succeeded') {
    throw new Error(`Invoice create job did not succeed: ${JSON.stringify(invoiceFinal)}`);
  }

  const invoiceAddress = invoiceFinal?.result?.invoiceAddress;
  if (!invoiceAddress || typeof invoiceAddress !== 'string') {
    throw new Error(`Invoice job result missing invoiceAddress: ${JSON.stringify(invoiceFinal)}`);
  }

  log('Submitting payment send job via runtime proxy');
  const paymentJob = await createPaymentJob(proxyAUrl, invoiceAddress);
  const paymentFinal = await waitForJobTerminal(proxyAUrl, paymentJob.id, JOB_TIMEOUT_SEC);
  summary.jobs.payment = {
    id: paymentJob.id,
    state: paymentFinal.state,
    result: paymentFinal.result,
    error: paymentFinal.error,
  };
  if (paymentFinal.state !== 'succeeded') {
    throw new Error(`Payment job did not succeed: ${JSON.stringify(paymentFinal)}`);
  }

  const channelId = openFinal?.result?.channelId;
  if (!channelId || typeof channelId !== 'string') {
    throw new Error(`Open job result missing channelId: ${JSON.stringify(openFinal)}`);
  }

  log('Submitting channel shutdown job via runtime proxy');
  const closeJob = await createChannelShutdownJob(proxyAUrl, channelId);
  const closeFinal = await waitForJobTerminal(proxyAUrl, closeJob.id, JOB_TIMEOUT_SEC);
  summary.jobs.shutdown = {
    id: closeJob.id,
    state: closeFinal.state,
    result: closeFinal.result,
    error: closeFinal.error,
  };
  if (closeFinal.state !== 'succeeded') {
    throw new Error(`Channel shutdown job did not succeed: ${JSON.stringify(closeFinal)}`);
  }

  log('Collecting payment job events');
  const paymentEventsPayload = await httpJson(`${proxyAUrl}/jobs/${paymentJob.id}/events`);
  const paymentEvents = Array.isArray(paymentEventsPayload?.events)
    ? paymentEventsPayload.events
    : [];
  summary.jobs.paymentEvents = paymentEvents;

  const eventTypes = paymentEvents.map((event) => event.eventType);
  const hasExecuting = eventTypes.includes('executing');
  const hasTerminal = eventTypes.includes('succeeded');
  const hasInflightOrRetry =
    eventTypes.includes('inflight') || eventTypes.includes('retry_scheduled');

  summary.assertions.allTerminalSucceeded =
    openFinal.state === 'succeeded' &&
    invoiceFinal.state === 'succeeded' &&
    paymentFinal.state === 'succeeded' &&
    closeFinal.state === 'succeeded';
  summary.assertions.paymentEventLifecycleOk = hasExecuting && hasTerminal && hasInflightOrRetry;

  if (!summary.assertions.paymentEventLifecycleOk) {
    throw new Error(`Payment event lifecycle assertion failed: ${JSON.stringify(eventTypes)}`);
  }

  if (asJson) {
    console.log(JSON.stringify({ success: true, data: summary }, null, 2));
  } else {
    console.log('\n✅ Runtime job orchestration E2E passed');
    console.log(`- Open job:     ${openJob.id}`);
    console.log(`- Invoice job:  ${invoiceJob.id}`);
    console.log(`- Payment job:  ${paymentJob.id}`);
    console.log(`- Shutdown job: ${closeJob.id}`);
    console.log(`- Payment events: ${paymentEvents.length}`);
  }
}

function discoverProxyUrl(profile) {
  try {
    const runtime = runFiberPayJson(profile, ['runtime', 'status']);
    const metaProxy = runtime?.meta?.proxyListen;
    const statusProxy = runtime?.proxyStatus?.proxyListen;
    const listen =
      typeof metaProxy === 'string'
        ? metaProxy
        : typeof statusProxy === 'string'
          ? statusProxy
          : undefined;
    if (!listen) return undefined;
    return listen.startsWith('http://') || listen.startsWith('https://')
      ? listen
      : `http://${listen}`;
  } catch {
    return undefined;
  }
}

main().catch((error) => {
  const startupHint = [
    `Ensure both profiles are running before retry:`,
    `  fiber-pay --profile ${PROFILE_A} node start --runtime-proxy-listen ${stripHttp(PROXY_A_URL ?? FALLBACK_PROXY_A_URL)} --json`,
    `  fiber-pay --profile ${PROFILE_B} node start --runtime-proxy-listen ${stripHttp(PROXY_B_URL ?? FALLBACK_PROXY_B_URL)} --json`,
  ].join('\n');

  const baseMessage = error instanceof Error ? error.message : String(error);
  const message = `${baseMessage}\n${startupHint}`;

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          success: false,
          error: {
            code: 'E2E_RUNTIME_ORCHESTRATION_FAILED',
            message,
          },
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }

  console.error('\n❌ Runtime job orchestration E2E failed');
  console.error(message);
  process.exit(1);
});

function stripHttp(url) {
  return url.replace(/^https?:\/\//, '');
}
