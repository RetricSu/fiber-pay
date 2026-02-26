import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RuntimeJob } from '../src/jobs/types.js';
import { RpcMonitorProxy, type RpcMonitorProxyDeps } from '../src/proxy/rpc-proxy.js';

function makeJob(overrides: Partial<RuntimeJob> = {}): RuntimeJob {
  return {
    id: 'job-1',
    type: 'payment',
    state: 'queued',
    params: { sendPaymentParams: { invoice: 'fibt1...' } },
    retryCount: 0,
    maxRetries: 3,
    idempotencyKey: 'key-1',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  } as RuntimeJob;
}

async function makeProxy(overrides: Partial<RpcMonitorProxyDeps>) {
  const deps: RpcMonitorProxyDeps = {
    onInvoiceTracked: vi.fn(),
    onPaymentTracked: vi.fn(),
    listTrackedInvoices: vi.fn(() => []),
    listTrackedPayments: vi.fn(() => []),
    listAlerts: vi.fn(() => []),
    getStatus: vi.fn(() => ({
      startedAt: new Date().toISOString(),
      proxyListen: '127.0.0.1:18339',
      targetUrl: 'http://127.0.0.1:8227',
      running: true,
    })),
    ...overrides,
  };

  const listen = `127.0.0.1:${18339 + Math.floor(Math.random() * 300)}`;
  const proxy = new RpcMonitorProxy(
    {
      listen,
      targetUrl: 'http://127.0.0.1:8227',
    },
    deps,
  );
  await proxy.start();

  return {
    proxy,
    baseUrl: `http://${listen}`,
  };
}

describe('RpcMonitorProxy jobs endpoints', () => {
  const running: RpcMonitorProxy[] = [];

  afterEach(async () => {
    while (running.length) {
      const item = running.pop();
      if (item) await item.stop();
    }
  });

  it('lists jobs via GET /jobs', async () => {
    const expected = [makeJob({ id: 'job-list-1' })];
    const { proxy, baseUrl } = await makeProxy({
      listJobs: vi.fn(() => expected),
    });
    running.push(proxy);

    const response = await fetch(`${baseUrl}/jobs`);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { jobs: RuntimeJob[] };
    expect(payload.jobs).toHaveLength(1);
    expect(payload.jobs[0].id).toBe('job-list-1');
  });

  it('creates payment job via POST /jobs/payment', async () => {
    const created = makeJob({ id: 'job-create-1' });
    const createPaymentJob = vi.fn(async () => created);

    const { proxy, baseUrl } = await makeProxy({
      createPaymentJob,
    });
    running.push(proxy);

    const response = await fetch(`${baseUrl}/jobs/payment`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        params: {
          sendPaymentParams: { invoice: 'fibt1...' },
        },
      }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as RuntimeJob;
    expect(payload.id).toBe('job-create-1');
    expect(createPaymentJob).toHaveBeenCalledTimes(1);
  });

  it('returns job events via GET /jobs/:id/events', async () => {
    const { proxy, baseUrl } = await makeProxy({
      getJob: vi.fn(() => makeJob({ id: 'job-events-1' })),
      listJobEvents: vi.fn(() => [{ id: 'evt-1', eventType: 'created', createdAt: Date.now() }]),
    });
    running.push(proxy);

    const response = await fetch(`${baseUrl}/jobs/job-events-1/events`);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { events: Array<{ id: string }> };
    expect(payload.events[0].id).toBe('evt-1');
  });

  it('cancels job via DELETE /jobs/:id', async () => {
    const cancelJob = vi.fn();
    const { proxy, baseUrl } = await makeProxy({ cancelJob });
    running.push(proxy);

    const response = await fetch(`${baseUrl}/jobs/job-cancel-1`, {
      method: 'DELETE',
    });

    expect(response.status).toBe(204);
    expect(cancelJob).toHaveBeenCalledWith('job-cancel-1');
  });

  it('passes reuseTerminal option to createChannelJob', async () => {
    const created = makeJob({ id: 'job-reuse-1', type: 'channel' });
    const createChannelJob = vi.fn(async () => created);

    const { proxy, baseUrl } = await makeProxy({
      createChannelJob,
    });
    running.push(proxy);

    const response = await fetch(`${baseUrl}/jobs/channel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        params: {
          action: 'open',
          openChannelParams: { peer_id: 'peer-1', funding_amount: '0x64' },
        },
        options: {
          idempotencyKey: 'open:peer:peer-1',
          reuseTerminal: false,
        },
      }),
    });

    expect(response.status).toBe(200);
    const payload = (await response.json()) as RuntimeJob;
    expect(payload.id).toBe('job-reuse-1');
    expect(createChannelJob).toHaveBeenCalledWith(
      { action: 'open', openChannelParams: { peer_id: 'peer-1', funding_amount: '0x64' } },
      { idempotencyKey: 'open:peer:peer-1', reuseTerminal: false },
    );
  });

  it('rejects startup when targetUrl points to proxy listen address', async () => {
    const deps: RpcMonitorProxyDeps = {
      onInvoiceTracked: vi.fn(),
      onPaymentTracked: vi.fn(),
      listTrackedInvoices: vi.fn(() => []),
      listTrackedPayments: vi.fn(() => []),
      listAlerts: vi.fn(() => []),
      getStatus: vi.fn(() => ({
        startedAt: new Date().toISOString(),
        proxyListen: '127.0.0.1:18390',
        targetUrl: 'http://127.0.0.1:18390',
        running: false,
      })),
    };

    const proxy = new RpcMonitorProxy(
      {
        listen: '127.0.0.1:18390',
        targetUrl: 'http://127.0.0.1:18390',
      },
      deps,
    );

    await expect(proxy.start()).rejects.toThrow(/targetUrl .*points to proxy listen address/i);
  });
});
