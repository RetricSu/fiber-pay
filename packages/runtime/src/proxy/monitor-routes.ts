import type { IncomingMessage, ServerResponse } from 'node:http';
import { isAlertPriority, isAlertType } from '../alerts/types.js';
import type { JobFilter } from '../jobs/types.js';
import { parseOptionalPositiveInteger, writeJson } from './http-utils.js';
import type { RpcMonitorProxyDeps } from './types.js';

export function handleMonitorEndpoint(
  req: IncomingMessage,
  res: ServerResponse,
  deps: RpcMonitorProxyDeps,
): void {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');

  if (url.pathname === '/jobs') {
    if (!deps.listJobs) {
      writeJson(res, 404, { error: 'Jobs are not enabled in runtime config' });
      return;
    }
    const state = url.searchParams.get('state') ?? undefined;
    const type = url.searchParams.get('type') as JobFilter['type'] | null;
    const limit = parseOptionalPositiveInteger(url.searchParams.get('limit'));
    const offset = parseOptionalPositiveInteger(url.searchParams.get('offset'));
    writeJson(res, 200, {
      jobs: deps.listJobs({
        state: state as JobFilter['state'],
        type: type ?? undefined,
        limit,
        offset,
      }),
    });
    return;
  }

  if (url.pathname.startsWith('/jobs/')) {
    if (!deps.getJob) {
      writeJson(res, 404, { error: 'Jobs are not enabled in runtime config' });
      return;
    }

    const segments = url.pathname.split('/').filter(Boolean);
    const [, id, sub] = segments;
    if (!id) {
      writeJson(res, 400, { error: 'Missing job id' });
      return;
    }

    if (sub === 'events') {
      if (!deps.listJobEvents) {
        writeJson(res, 404, { error: 'Job events not available' });
        return;
      }
      writeJson(res, 200, { events: deps.listJobEvents(id) });
      return;
    }

    const job = deps.getJob(id);
    if (!job) {
      writeJson(res, 404, { error: 'Job not found' });
      return;
    }
    writeJson(res, 200, job);
    return;
  }

  if (url.pathname === '/monitor/list_tracked_invoices') {
    writeJson(res, 200, { invoices: deps.listTrackedInvoices() });
    return;
  }

  if (url.pathname === '/monitor/list_tracked_payments') {
    writeJson(res, 200, { payments: deps.listTrackedPayments() });
    return;
  }

  if (url.pathname === '/monitor/list_alerts') {
    const limitRaw = url.searchParams.get('limit');
    const minPriorityRaw = url.searchParams.get('min_priority');
    const typeRaw = url.searchParams.get('type');
    const sourceRaw = url.searchParams.get('source');

    const limit = parseOptionalPositiveInteger(limitRaw);
    if (limitRaw !== null && limit === undefined) {
      writeJson(res, 400, {
        error: 'Invalid query parameter: limit must be a positive integer',
      });
      return;
    }

    if (minPriorityRaw && !isAlertPriority(minPriorityRaw)) {
      writeJson(res, 400, {
        error: 'Invalid query parameter: min_priority must be one of critical|high|medium|low',
      });
      return;
    }

    if (typeRaw && !isAlertType(typeRaw)) {
      writeJson(res, 400, {
        error: 'Invalid query parameter: type is not a known alert type',
      });
      return;
    }

    const minPriority =
      minPriorityRaw && isAlertPriority(minPriorityRaw) ? minPriorityRaw : undefined;
    const type = typeRaw && isAlertType(typeRaw) ? typeRaw : undefined;

    writeJson(res, 200, {
      alerts: deps.listAlerts({
        limit,
        minPriority,
        type,
        source: sourceRaw ?? undefined,
      }),
    });
    return;
  }

  if (url.pathname === '/monitor/status') {
    writeJson(res, 200, deps.getStatus());
    return;
  }

  writeJson(res, 404, { error: 'Not found' });
}
