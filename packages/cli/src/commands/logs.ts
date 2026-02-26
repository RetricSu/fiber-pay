import { existsSync, statSync } from 'node:fs';
import { type Alert, formatRuntimeAlert } from '@fiber-pay/runtime';
import { Command } from 'commander';
import type { CliConfig } from '../lib/config.js';
import { printJsonError, printJsonSuccess } from '../lib/format.js';
import {
  type PersistedLogSourceOption,
  readAppendedLines,
  readLastLines,
  resolvePersistedLogPaths,
  resolvePersistedLogTargets,
} from '../lib/log-files.js';
import { readRuntimeMeta } from '../lib/runtime-meta.js';

const ALLOWED_SOURCES = new Set<PersistedLogSourceOption>([
  'all',
  'runtime',
  'fnn-stdout',
  'fnn-stderr',
]);

function parseRuntimeAlertLine(line: string): Alert | null {
  try {
    const parsed = JSON.parse(line) as Alert;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function formatRuntimeAlertHuman(line: string): string {
  const parsed = parseRuntimeAlertLine(line);
  if (!parsed) {
    return line;
  }

  return formatRuntimeAlert(parsed);
}

function coerceJsonLineForOutput(source: PersistedLogSourceOption, line: string): unknown {
  if (source !== 'runtime') {
    return line;
  }
  return parseRuntimeAlertLine(line) ?? line;
}

export function createLogsCommand(config: CliConfig): Command {
  return new Command('logs')
    .alias('log')
    .description('View persisted runtime/fnn logs')
    .option('--source <source>', 'Log source: all|runtime|fnn-stdout|fnn-stderr', 'all')
    .option('--tail <n>', 'Number of recent lines per source', '80')
    .option('--follow', 'Keep streaming appended log lines (human output mode only)')
    .option('--interval-ms <ms>', 'Polling interval for --follow mode', '1000')
    .option('--json')
    .action(async (options) => {
      const json = Boolean(options.json);
      const follow = Boolean(options.follow);
      const sourceInput = String(options.source ?? 'all')
        .trim()
        .toLowerCase();

      if (json && follow) {
        const message = '--follow is not supported with --json. Use human mode for streaming logs.';
        printJsonError({
          code: 'LOG_FOLLOW_JSON_UNSUPPORTED',
          message,
          recoverable: true,
          suggestion: 'Remove --json or remove --follow and retry.',
        });
        process.exit(1);
      }

      if (!ALLOWED_SOURCES.has(sourceInput as PersistedLogSourceOption)) {
        const message =
          'Invalid --source value. Expected one of: all, runtime, fnn-stdout, fnn-stderr.';
        if (json) {
          printJsonError({
            code: 'LOG_SOURCE_INVALID',
            message,
            recoverable: true,
            suggestion: 'Retry with --source all|runtime|fnn-stdout|fnn-stderr.',
            details: { source: sourceInput },
          });
        } else {
          console.error(`Error: ${message}`);
        }
        process.exit(1);
      }

      const source = sourceInput as PersistedLogSourceOption;
      const tailInput = Number.parseInt(String(options.tail ?? '80'), 10);
      const tail = Number.isFinite(tailInput) && tailInput > 0 ? tailInput : 80;
      const intervalInput = Number.parseInt(String(options.intervalMs ?? '1000'), 10);
      const intervalMs = Number.isFinite(intervalInput) && intervalInput > 0 ? intervalInput : 1000;

      const meta = readRuntimeMeta(config.dataDir);
      const paths = resolvePersistedLogPaths(config.dataDir, meta);
      const targets = resolvePersistedLogTargets(paths, source);

      if (source !== 'all' && targets.length === 1 && !existsSync(targets[0].path)) {
        const message = `Log file not found for source ${source}: ${targets[0].path}`;
        if (json) {
          printJsonError({
            code: 'LOG_FILE_NOT_FOUND',
            message,
            recoverable: true,
            suggestion: 'Start node/runtime or generate activity, then retry logs command.',
            details: { source, path: targets[0].path },
          });
        } else {
          console.error(`Error: ${message}`);
        }
        process.exit(1);
      }

      const entries = [] as Array<{
        source: (typeof targets)[number]['source'];
        title: (typeof targets)[number]['title'];
        path: string;
        exists: boolean;
        lineCount: number;
        lines: string[];
        jsonLines: unknown[];
      }>;

      for (const target of targets) {
        const exists = existsSync(target.path);
        let lines: string[] = [];
        if (exists) {
          try {
            lines = readLastLines(target.path, tail);
          } catch (error) {
            const message =
              error instanceof Error ? error.message : `Failed to read log file: ${target.path}`;
            if (json) {
              printJsonError({
                code: 'LOG_READ_FAILED',
                message,
                recoverable: true,
                suggestion: 'Check log file permissions and retry.',
                details: { source: target.source, path: target.path },
              });
            } else {
              console.error(`Error: ${message}`);
            }
            process.exit(1);
          }
        }

        entries.push({
          source: target.source,
          title: target.title,
          path: target.path,
          exists,
          lineCount: lines.length,
          lines,
          jsonLines: lines.map((line) => coerceJsonLineForOutput(target.source, line)),
        });
      }

      if (json) {
        printJsonSuccess({
          source,
          tail,
          entries: entries.map((entry) => ({
            source: entry.source,
            title: entry.title,
            path: entry.path,
            exists: entry.exists,
            lineCount: entry.lineCount,
            lines: entry.jsonLines,
          })),
        });
        return;
      }

      console.log(`Logs (source: ${source}, tail: ${tail})`);
      for (const entry of entries) {
        console.log(`\n${entry.title}: ${entry.path}`);
        if (!entry.exists) {
          console.log('  (file not found)');
          continue;
        }
        if (entry.lines.length === 0) {
          console.log('  (no lines)');
          continue;
        }
        for (const line of entry.lines) {
          const output = entry.source === 'runtime' ? formatRuntimeAlertHuman(line) : line;
          console.log(`  ${output}`);
        }
      }

      if (!follow) {
        return;
      }

      console.log(`\nFollowing logs (interval: ${intervalMs}ms). Press Ctrl+C to stop.`);

      const states = new Map(
        entries.map((entry) => [
          entry.source,
          {
            title: entry.title,
            path: entry.path,
            offset: entry.exists ? statSync(entry.path).size : 0,
            remainder: '',
          },
        ]),
      );

      // Keep process alive for follow mode.
      await new Promise<void>((resolve) => {
        let stopped = false;
        const stop = () => {
          if (stopped) return;
          stopped = true;
          clearInterval(timer);
          process.off('SIGINT', stop);
          process.off('SIGTERM', stop);
          console.log('\nStopped following logs.');
          resolve();
        };

        let polling = false;
        const timer = setInterval(() => {
          if (polling) {
            return;
          }
          polling = true;

          void (async () => {
            for (const target of targets) {
              const state = states.get(target.source);
              if (!state) continue;

              if (!existsSync(state.path)) {
                state.offset = 0;
                state.remainder = '';
                continue;
              }

              const result = await readAppendedLines(state.path, state.offset, state.remainder);
              const newLines = result.lines;
              if (newLines.length === 0) {
                state.offset = result.nextOffset;
                state.remainder = result.remainder;
                continue;
              }

              for (const line of newLines) {
                const output = target.source === 'runtime' ? formatRuntimeAlertHuman(line) : line;
                console.log(`[${state.title}] ${output}`);
              }
              state.offset = result.nextOffset;
              state.remainder = result.remainder;
            }
          })()
            .catch((error) => {
              const message =
                error instanceof Error ? error.message : 'Failed to read appended logs';
              console.error(`Error: ${message}`);
            })
            .finally(() => {
              polling = false;
            });
        }, intervalMs);

        process.on('SIGINT', stop);
        process.on('SIGTERM', stop);
      });
    });
}
