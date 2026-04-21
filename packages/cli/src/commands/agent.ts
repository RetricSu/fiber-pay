import { Command } from 'commander';
import { runAgentCallCommand } from '../lib/agent-call.js';
import { runAgentServeCommand } from '../lib/agent-serve.js';
import type { CliConfig } from '../lib/config.js';

export function createAgentCommand(config: CliConfig): Command {
  const agent = new Command('agent').description('AI agent service with L402 payment');

  agent
    .command('serve')
    .description('Start an L402-gated AI agent HTTP service')
    .requiredOption(
      '--agent <name>',
      'Agent to use (common values: codex, claude, opencode, gemini, pi; see acpx docs for full list)',
    )
    .option('--port <port>', 'Listen port', '8402')
    .option('--host <host>', 'Listen host', '127.0.0.1')
    .option('--price <ckb>', 'Price per request in CKB', '0.1')
    .option('--root-key <hex>', 'Macaroon root key (32-byte hex, or set L402_ROOT_KEY env)')
    .option('--expiry <seconds>', 'Token expiry in seconds', '3600')
    .option('--cwd <path>', 'Working directory for agent execution')
    .option('--approve-all', 'Auto-approve all agent tool calls')
    .option('--timeout <seconds>', 'Max agent execution time per request', '3600')
    .option(
      '--no-isolation',
      'Disable Linux namespace isolation (use only for debugging; isolation is on by default)',
    )
    .option('--format <fmt>', 'Agent output format passed to acpx (text, json, quiet)', 'quiet')
    .option(
      '--workspace-ttl <hours>',
      'Hours to keep a named session workspace before auto-cleanup',
      '24',
    )
    .option(
      '--workspace-min-free-mb <mb>',
      'Minimum free MB on /workspace required to accept a new session',
      '100',
    )
    .option(
      '--boxlite-url <url>',
      'BoxLite API URL',
      process.env.BOXLITE_URL || 'http://localhost:8100',
    )
    .option(
      '--boxlite-box-id <id>',
      'BoxLite box ID',
      process.env.BOXLITE_BOX_ID || 'fiber-pay-agent',
    )
    .option('--json')
    .addHelpText(
      'after',
      [
        '',
        'Examples:',
        '  fiber-pay agent serve --agent codex --price 0.1 --root-key <hex>',
        '  fiber-pay agent serve --agent claude --price 0.2 --port 8402',
      ].join('\n'),
    )
    .action(async (options) => {
      await runAgentServeCommand(config, options);
    });

  agent
    .command('call')
    .description('Call a remote L402-gated agent service (auto-pay via Fiber)')
    .argument('<url>', 'Agent service URL (e.g. http://host:8402)')
    .option('--prompt <text>', 'Prompt text to send')
    .option('--file <path>', 'Read prompt from file')
    .option('--timeout <seconds>', 'Request timeout in seconds', '3600')
    .option('--json')
    .action(async (url, options) => {
      await runAgentCallCommand(config, url, options);
    });

  return agent;
}
