import { existsSync } from 'node:fs';
import { Command } from 'commander';
import type { CliConfig } from '../lib/config.js';
import { printJsonError, printJsonSuccess } from '../lib/format.js';
import { readLastLines, resolvePersistedLogPaths } from '../lib/log-files.js';
import { resolveRpcEndpoint } from '../lib/rpc.js';
import type { RuntimeJobEventRecord, RuntimeJobRecord } from '../lib/runtime-jobs.js';
import { readRuntimeMeta } from '../lib/runtime-meta.js';

export function createJobCommand(config: CliConfig): Command {
  const job = new Command('job').description('Runtime job management commands');

  job
    .command('list')
    .option('--state <state>', 'Filter by job state')
    .option('--type <type>', 'Filter by job type (payment|invoice|channel)')
    .option('--limit <n>', 'Limit number of jobs')
    .option('--offset <n>', 'Offset for pagination')
    .option('--json')
    .action(async (options) => {
      const json = Boolean(options.json);
      const runtimeUrl = getRuntimeUrlOrExit(config, json);
      const query = new URLSearchParams();
      if (options.state) query.set('state', String(options.state));
      if (options.type) query.set('type', String(options.type));
      if (options.limit) query.set('limit', String(options.limit));
      if (options.offset) query.set('offset', String(options.offset));

      const response = await fetch(
        `${runtimeUrl}/jobs${query.toString() ? `?${query.toString()}` : ''}`,
      );
      if (!response.ok) {
        return handleHttpError(response, 'JOB_LIST_FAILED', json);
      }

      const payload = (await response.json()) as { jobs: RuntimeJobRecord[] };
      if (json) {
        printJsonSuccess(payload);
        return;
      }

      if (!payload.jobs.length) {
        console.log('No jobs found.');
        return;
      }

      console.log(`Jobs (${payload.jobs.length})`);
      for (const item of payload.jobs) {
        console.log(`- ${item.id}`);
        console.log(`  Type:   ${item.type}`);
        console.log(`  State:  ${item.state}`);
        if (item.idempotencyKey) console.log(`  Key:    ${item.idempotencyKey}`);
        if (typeof item.retryCount === 'number' && typeof item.maxRetries === 'number') {
          console.log(`  Retry:  ${item.retryCount}/${item.maxRetries}`);
        }
      }
    });

  job
    .command('get')
    .argument('<jobId>')
    .option('--json')
    .action(async (jobId, options) => {
      const json = Boolean(options.json);
      const runtimeUrl = getRuntimeUrlOrExit(config, json);
      const response = await fetch(`${runtimeUrl}/jobs/${jobId}`);
      if (!response.ok) {
        return handleHttpError(response, 'JOB_GET_FAILED', json);
      }

      const payload = (await response.json()) as RuntimeJobRecord;
      if (json) {
        printJsonSuccess(payload);
        return;
      }

      console.log('Job');
      console.log(`  ID:         ${payload.id}`);
      console.log(`  Type:       ${payload.type}`);
      console.log(`  State:      ${payload.state}`);
      if (payload.idempotencyKey) console.log(`  Key:        ${payload.idempotencyKey}`);
      if (typeof payload.retryCount === 'number' && typeof payload.maxRetries === 'number') {
        console.log(`  Retry:      ${payload.retryCount}/${payload.maxRetries}`);
      }
      if (payload.error?.message) {
        console.log(`  Error:      ${payload.error.message}`);
      }
      if (payload.result) {
        console.log('  Result:');
        console.log(`    ${JSON.stringify(payload.result)}`);
      }
    });

  job
    .command('trace')
    .argument('<jobId>')
    .option('--tail <n>', 'Max lines to inspect per log file', '400')
    .option('--date <YYYY-MM-DD>', 'Date of log directory to search (default: today UTC)')
    .option('--json')
    .action(async (jobId, options) => {
      const json = Boolean(options.json);
      const tailInput = Number.parseInt(String(options.tail ?? '400'), 10);
      const tail = Number.isFinite(tailInput) && tailInput > 0 ? tailInput : 400;
      const date = options.date ? String(options.date).trim() : undefined;

      const runtimeUrl = getRuntimeUrlOrExit(config, json);
      const jobResponse = await fetch(`${runtimeUrl}/jobs/${jobId}`);
      if (!jobResponse.ok) {
        return handleHttpError(jobResponse, 'JOB_TRACE_GET_FAILED', json);
      }

      const eventsResponse = await fetch(`${runtimeUrl}/jobs/${jobId}/events`);
      if (!eventsResponse.ok) {
        return handleHttpError(eventsResponse, 'JOB_TRACE_EVENTS_FAILED', json);
      }

      const jobRecord = (await jobResponse.json()) as RuntimeJobRecord;
      const eventsPayload = (await eventsResponse.json()) as { events: RuntimeJobEventRecord[] };
      const tokens = collectTraceTokens(jobRecord, eventsPayload.events);

      const meta = readRuntimeMeta(config.dataDir);
      let logPaths: ReturnType<typeof resolvePersistedLogPaths>;
      try {
        logPaths = resolvePersistedLogPaths(config.dataDir, meta, date);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid --date value.';
        if (json) {
          printJsonError({
            code: 'JOB_TRACE_DATE_INVALID',
            message,
            recoverable: true,
            suggestion: 'Retry with --date in YYYY-MM-DD format.',
            details: { date },
          });
        } else {
          console.error(`Error: ${message}`);
        }
        process.exit(1);
      }
      const runtimeAlertMatches = collectRelatedLines(logPaths.runtimeAlerts, tokens, tail);
      const fnnStdoutMatches = collectRelatedLines(logPaths.fnnStdout, tokens, tail);
      const fnnStderrMatches = collectRelatedLines(logPaths.fnnStderr, tokens, tail);

      const result = {
        job: jobRecord,
        events: eventsPayload.events,
        trace: {
          tokens,
          logPaths,
          matches: {
            runtimeAlerts: runtimeAlertMatches,
            fnnStdout: fnnStdoutMatches,
            fnnStderr: fnnStderrMatches,
          },
        },
      };

      if (json) {
        printJsonSuccess(result);
        return;
      }

      console.log('Job trace');
      console.log(`  Job ID:      ${jobRecord.id}`);
      console.log(`  Type:        ${jobRecord.type}`);
      console.log(`  State:       ${jobRecord.state}`);
      if (jobRecord.idempotencyKey) {
        console.log(`  Idempotency: ${jobRecord.idempotencyKey}`);
      }
      if (jobRecord.error?.message) {
        console.log(`  Error:       ${jobRecord.error.message}`);
      }
      console.log(`  Events:      ${eventsPayload.events.length}`);

      if (tokens.length > 0) {
        console.log('  Tokens:');
        for (const token of tokens) {
          console.log(`    - ${token}`);
        }
      }

      printTraceSection('runtime.alerts', logPaths.runtimeAlerts, runtimeAlertMatches);
      printTraceSection('fnn.stdout', logPaths.fnnStdout, fnnStdoutMatches);
      printTraceSection('fnn.stderr', logPaths.fnnStderr, fnnStderrMatches);
    });

  job
    .command('events')
    .argument('<jobId>')
    .option('--with-data', 'Include event data payload in human-readable output')
    .option('--json')
    .action(async (jobId, options) => {
      const json = Boolean(options.json);
      const runtimeUrl = getRuntimeUrlOrExit(config, json);
      const response = await fetch(`${runtimeUrl}/jobs/${jobId}/events`);
      if (!response.ok) {
        return handleHttpError(response, 'JOB_EVENTS_FAILED', json);
      }

      const payload = (await response.json()) as { events: RuntimeJobEventRecord[] };
      if (json) {
        printJsonSuccess(payload);
        return;
      }

      if (!payload.events.length) {
        console.log('No events found for job.');
        return;
      }

      console.log(`Job events (${payload.events.length})`);
      for (const event of payload.events) {
        const timestamp = new Date(event.createdAt).toISOString();
        const transition = event.toState
          ? `${event.fromState ?? '(none)'} -> ${event.toState}`
          : (event.fromState ?? '(none)');
        console.log(`- ${timestamp} ${event.eventType} (${transition})`);
        if (options.withData && event.data !== undefined) {
          console.log(`  data: ${JSON.stringify(event.data)}`);
        }
      }
    });

  job
    .command('cancel')
    .argument('<jobId>')
    .option('--json')
    .action(async (jobId, options) => {
      const json = Boolean(options.json);
      const runtimeUrl = getRuntimeUrlOrExit(config, json);
      const response = await fetch(`${runtimeUrl}/jobs/${jobId}`, { method: 'DELETE' });
      if (!response.ok) {
        return handleHttpError(response, 'JOB_CANCEL_FAILED', json);
      }

      const payload = { jobId, cancelled: true };
      if (json) {
        printJsonSuccess(payload);
      } else {
        console.log(`Job cancelled: ${jobId}`);
      }
    });

  return job;
}

function getRuntimeUrlOrExit(config: CliConfig, json: boolean): string {
  const endpoint = resolveRpcEndpoint(config);
  if (endpoint.target !== 'runtime-proxy') {
    const message =
      'Runtime proxy is not active for the current profile/RPC URL. Start runtime first (fiber-pay runtime start --daemon).';
    if (json) {
      printJsonError({
        code: 'RUNTIME_PROXY_REQUIRED',
        message,
        recoverable: true,
        suggestion: 'Start runtime and retry the job command.',
      });
    } else {
      console.error(`Error: ${message}`);
    }
    process.exit(1);
  }
  return endpoint.url;
}

async function handleHttpError(response: Response, code: string, json: boolean): Promise<never> {
  const body = await safeJson(response);
  const message = extractErrorMessage(body) ?? `HTTP ${response.status}`;

  if (json) {
    printJsonError({
      code,
      message,
      recoverable: response.status >= 500 || response.status === 404,
      suggestion: 'Check runtime status and job id, then retry.',
      details: {
        status: response.status,
        body,
      },
    });
  } else {
    console.error(`Error: ${message}`);
  }
  process.exit(1);
}

function extractErrorMessage(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') {
    return undefined;
  }

  if ('error' in body) {
    const error = (body as { error?: unknown }).error;
    if (typeof error === 'string') {
      return error;
    }
    if (error && typeof error === 'object' && 'message' in error) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string') {
        return message;
      }
    }
  }

  if ('message' in body) {
    const message = (body as { message?: unknown }).message;
    if (typeof message === 'string') {
      return message;
    }
  }

  return undefined;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function collectTraceTokens(job: RuntimeJobRecord, events: RuntimeJobEventRecord[]): string[] {
  const result = new Set<string>();
  addTraceToken(result, job.id);
  addTraceToken(result, job.idempotencyKey);

  collectStructuredTokens(result, job.params);
  collectStructuredTokens(result, job.result);
  collectStructuredTokens(result, job.error);

  for (const event of events) {
    addTraceToken(result, event.id);
    collectStructuredTokens(result, event.data);
  }

  return Array.from(result).slice(0, 20);
}

function addTraceToken(set: Set<string>, value: unknown): void {
  if (typeof value !== 'string') {
    return;
  }
  const normalized = value.trim();
  if (!normalized || normalized.length < 6) {
    return;
  }
  if (normalized.includes(' ')) {
    return;
  }
  if (normalized.length <= 128) {
    set.add(normalized);
  }
}

function collectStructuredTokens(set: Set<string>, input: unknown, depth = 0): void {
  if (depth > 3 || input === null || input === undefined) {
    return;
  }
  if (typeof input === 'string') {
    if (input.startsWith('0x') || input.includes('peer') || input.includes('channel')) {
      addTraceToken(set, input);
    }
    return;
  }
  if (Array.isArray(input)) {
    for (const item of input) {
      collectStructuredTokens(set, item, depth + 1);
    }
    return;
  }
  if (typeof input === 'object') {
    for (const value of Object.values(input as Record<string, unknown>)) {
      collectStructuredTokens(set, value, depth + 1);
    }
  }
}

function collectRelatedLines(filePath: string, tokens: string[], tail: number): string[] {
  if (!existsSync(filePath)) {
    return [];
  }
  const lines = readLastLines(filePath, tail);
  if (tokens.length === 0) {
    return lines.slice(-Math.min(30, lines.length));
  }

  const related = lines.filter((line) => tokens.some((token) => line.includes(token)));
  if (related.length > 0) {
    return related.slice(-Math.min(80, related.length));
  }

  return lines.slice(-Math.min(20, lines.length));
}

function printTraceSection(title: string, filePath: string, lines: string[]): void {
  console.log(`\n${title}: ${filePath}`);
  if (!existsSync(filePath)) {
    console.log('  (file not found)');
    return;
  }
  if (lines.length === 0) {
    console.log('  (no related lines)');
    return;
  }
  for (const line of lines.slice(-20)) {
    console.log(`  ${line}`);
  }
}
