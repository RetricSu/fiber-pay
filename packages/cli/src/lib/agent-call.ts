/**
 * Agent Call — L402-aware CLI client for remote agent services
 *
 * Handles the full L402 payment flow:
 * 1. POST prompt → get 402 + macaroon + invoice
 * 2. Pay invoice via Fiber RPC
 * 3. Retry with L402 Authorization header → get agent response
 */

import { readFileSync } from 'node:fs';
import type { CliConfig } from './config.js';
import { printJsonError, printJsonSuccess } from './format.js';
import { createReadyRpcClient } from './rpc.js';

export interface AgentCallOptions {
  prompt?: string;
  file?: string;
  timeout: string;
  json?: boolean;
}

function formatDuration(durationMs: unknown): string {
  if (typeof durationMs !== 'number' || Number.isNaN(durationMs)) {
    return 'unknown';
  }
  return `${durationMs}ms`;
}

function printFriendlySuccess(
  result: Record<string, unknown>,
  options: { paymentRequired: boolean; paymentHash?: string },
): void {
  const agent = typeof result.agent === 'string' ? result.agent : 'unknown';
  const duration = formatDuration(result.durationMs);
  const response =
    typeof result.response === 'string'
      ? result.response
      : JSON.stringify(result.response, null, 2);

  console.log('Agent call succeeded');
  console.log(`  Agent:         ${agent}`);
  console.log(`  Duration:      ${duration}`);
  console.log(`  Payment:       ${options.paymentRequired ? 'required' : 'not required'}`);
  if (options.paymentHash) {
    console.log(`  Payment hash:  ${options.paymentHash}`);
  }
  console.log('');
  console.log('Agent response:');
  console.log(response ?? '');
}

export async function runAgentCallCommand(
  config: CliConfig,
  url: string,
  options: AgentCallOptions,
): Promise<void> {
  const asJson = Boolean(options.json);
  const timeoutMs = parseInt(options.timeout, 10) * 1000;

  // Resolve prompt from --prompt, --file, or stdin
  let prompt: string | undefined = options.prompt;

  if (!prompt && options.file) {
    try {
      prompt = readFileSync(options.file, 'utf-8').trim();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (asJson) {
        printJsonError({
          code: 'AGENT_CALL_FILE_READ_ERROR',
          message: `Failed to read prompt file: ${message}`,
          recoverable: true,
          suggestion: 'Check the file path and try again.',
        });
      } else {
        console.error(`Error: Failed to read prompt file: ${message}`);
      }
      process.exit(1);
    }
  }

  if (!prompt) {
    // Try reading from stdin if piped
    if (!process.stdin.isTTY) {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer);
      }
      prompt = Buffer.concat(chunks).toString('utf-8').trim();
    }
  }

  if (!prompt) {
    if (asJson) {
      printJsonError({
        code: 'AGENT_CALL_NO_PROMPT',
        message: 'No prompt provided.',
        recoverable: true,
        suggestion: 'Use --prompt <text>, --file <path>, or pipe via stdin.',
      });
    } else {
      console.error('Error: No prompt provided.');
      console.error('  Use --prompt <text>, --file <path>, or pipe via stdin.');
    }
    process.exit(1);
  }

  // Normalize URL
  const targetUrl = url.endsWith('/') ? url : `${url}/`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    // Step 1: Send initial request (expect 402)
    if (!asJson) {
      console.log(`Calling agent at ${targetUrl}...`);
    }

    const initialResponse = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal: controller.signal,
    });

    // If we got a 200 directly (no payment required), return the response
    if (initialResponse.ok) {
      const body = (await initialResponse.json()) as Record<string, unknown>;
      clearTimeout(timer);
      if (asJson) {
        printJsonSuccess(body);
      } else {
        printFriendlySuccess(body, { paymentRequired: false });
      }
      return;
    }

    // If not 402, it's an unexpected error
    if (initialResponse.status !== 402 && initialResponse.status !== 401) {
      const body = await initialResponse.text();
      clearTimeout(timer);
      if (asJson) {
        printJsonError({
          code: 'AGENT_CALL_UNEXPECTED_STATUS',
          message: `Unexpected status ${initialResponse.status} from agent.`,
          recoverable: false,
          details: { body: body.slice(0, 500) },
        });
      } else {
        console.error(`Error: Unexpected status ${initialResponse.status}`);
        console.error(body.slice(0, 500));
      }
      process.exit(1);
    }

    // Step 2: Extract macaroon + invoice from 402 response
    const challengeBody = (await initialResponse.json()) as {
      macaroon?: string;
      invoice?: string;
      error?: string;
    };

    const macaroon = challengeBody.macaroon;
    const invoiceAddress = challengeBody.invoice;

    if (!macaroon || !invoiceAddress) {
      clearTimeout(timer);
      if (asJson) {
        printJsonError({
          code: 'AGENT_CALL_INVALID_CHALLENGE',
          message: 'Invalid L402 challenge: missing macaroon or invoice.',
          recoverable: false,
        });
      } else {
        console.error('Error: Invalid L402 challenge response (missing macaroon or invoice).');
      }
      process.exit(1);
    }

    if (!asJson) {
      console.log('Payment required. Paying invoice via Fiber...');
    }

    // Step 3: Pay the invoice via Fiber (use runtime proxy when available)
    const rpcClient = await createReadyRpcClient(config);

    const paymentResult = await rpcClient.sendPayment({
      invoice: invoiceAddress,
    });

    // Step 4: Wait for payment to complete
    if (!asJson) {
      console.log(
        `Payment sent (hash: ${paymentResult.payment_hash}). Waiting for confirmation...`,
      );
    }

    const finalPayment = await rpcClient.waitForPayment(paymentResult.payment_hash, {
      timeout: timeoutMs,
      interval: 2000,
    });

    if (finalPayment.status !== 'Success') {
      clearTimeout(timer);
      if (asJson) {
        printJsonError({
          code: 'AGENT_CALL_PAYMENT_FAILED',
          message: `Payment failed: ${finalPayment.failed_error ?? finalPayment.status}`,
          recoverable: false,
        });
      } else {
        console.error(`Error: Payment failed: ${finalPayment.failed_error ?? finalPayment.status}`);
      }
      process.exit(1);
    }

    if (!asJson) {
      console.log('Payment confirmed. Retrying request with L402 token...');
    }

    // Step 5: Retry with L402 token (macaroon only, connected-node flow)
    const retryResponse = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `L402 ${macaroon}`,
        'X-L402-Payment-Hash': paymentResult.payment_hash,
      },
      body: JSON.stringify({ prompt }),
      signal: controller.signal,
    });

    clearTimeout(timer);

    if (!retryResponse.ok) {
      const errBody = await retryResponse.text();
      if (asJson) {
        printJsonError({
          code: 'AGENT_CALL_RETRY_FAILED',
          message: `Agent returned ${retryResponse.status} after payment.`,
          recoverable: false,
          details: { body: errBody.slice(0, 500) },
        });
      } else {
        console.error(`Error: Agent returned ${retryResponse.status} after payment.`);
        console.error(errBody.slice(0, 500));
      }
      process.exit(1);
    }

    const result = (await retryResponse.json()) as Record<string, unknown>;

    if (asJson) {
      printJsonSuccess({
        ...result,
        paymentHash: paymentResult.payment_hash,
      });
    } else {
      printFriendlySuccess(result, {
        paymentRequired: true,
        paymentHash: paymentResult.payment_hash,
      });
    }
  } catch (error) {
    clearTimeout(timer);
    const message = error instanceof Error ? error.message : String(error);
    const isTimeout = error instanceof Error && error.name === 'AbortError';

    if (asJson) {
      printJsonError({
        code: isTimeout ? 'AGENT_CALL_TIMEOUT' : 'AGENT_CALL_ERROR',
        message: isTimeout ? 'Request timed out.' : message,
        recoverable: !isTimeout,
      });
    } else {
      console.error(`Error: ${isTimeout ? 'Request timed out.' : message}`);
    }
    process.exit(1);
  }
}
