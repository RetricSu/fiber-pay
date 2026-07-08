import type { RouterHop, UdtAsset, UdtTypeScript } from '@fiber-pay/sdk';
import { type HexString, resolveUdtAsset, shannonsToCkb, toHex } from '@fiber-pay/sdk';
import { Command } from 'commander';
import { sleep } from '../lib/async.js';
import type { CliConfig } from '../lib/config.js';
import {
  formatPaymentResult,
  printJsonError,
  printJsonEvent,
  printJsonSuccess,
  printPaymentDetailHuman,
} from '../lib/format.js';
import { parseFundingAmount, parsePaymentAmount } from '../lib/parse-options.js';
import { createReadyRpcClient, resolveRpcEndpoint } from '../lib/rpc.js';
import {
  type RuntimeJobRecord,
  tryCreateRuntimePaymentJob,
  waitForRuntimeJobTerminal,
} from '../lib/runtime-jobs.js';
import { registerPaymentRebalanceCommand } from './rebalance.js';

export function createPaymentCommand(config: CliConfig): Command {
  const payment = new Command('payment').description('Payment lifecycle and status commands');

  payment
    .command('send')
    .argument('[invoice]')
    .option('--invoice <invoice>')
    .option('--to <nodeId>')
    .option('--amount <amount>')
    .option('--max-fee <ckb>')
    .option('--udt-type-script <json>', 'UDT type script for the payment')
    .option('--udt-name <name>', 'Name of a UDT from the node config for the payment')
    .option('--wait', 'Wait for runtime job terminal status when runtime proxy is active')
    .option('--timeout <seconds>', 'Wait timeout for --wait mode', '120')
    .option('--json')
    .action(async (invoiceArg, options) => {
      const rpc = await createReadyRpcClient(config);
      const json = Boolean(options.json);
      const invoice = options.invoice || invoiceArg;
      const recipientNodeId = options.to;

      let udtTypeScript: UdtTypeScript | undefined;
      let unit = 'CKB';
      let paymentAsset: UdtAsset = { kind: 'ckb' };
      try {
        paymentAsset = await resolveUdtAsset({
          rawScript: options.udtTypeScript as string | undefined,
          name: options.udtName as string | undefined,
          rpc,
        });
        udtTypeScript = paymentAsset.kind === 'udt' ? paymentAsset.script : undefined;
        unit = paymentAsset.kind === 'udt' ? (paymentAsset.name ?? 'UDT') : 'CKB';
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if (json) {
          printJsonError({
            code: 'PAYMENT_SEND_INPUT_INVALID',
            message: msg,
            recoverable: true,
            suggestion:
              'Provide a valid JSON script or UDT name, e.g. {"code_hash":"0x...","hash_type":"type","args":"0x..."} or --udt-name RUSD',
          });
        } else {
          console.error(`Error: ${msg}`);
        }
        process.exit(1);
      }

      const isUdt = udtTypeScript !== undefined;

      let amountRaw: bigint | undefined;
      if (options.amount) {
        try {
          amountRaw = parsePaymentAmount(options.amount, isUdt);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          if (json) {
            printJsonError({
              code: 'PAYMENT_SEND_INPUT_INVALID',
              message: msg,
              recoverable: true,
              suggestion: isUdt
                ? 'Provide a positive integer UDT amount, e.g. --amount 1000'
                : 'Provide a positive CKB amount, e.g. --amount 10',
            });
          } else {
            console.error(`Error: ${msg}`);
          }
          process.exit(1);
        }
      }

      let maxFeeRaw: bigint | undefined;
      if (options.maxFee) {
        try {
          maxFeeRaw = parseFundingAmount(options.maxFee, false);
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          if (json) {
            printJsonError({
              code: 'PAYMENT_SEND_INPUT_INVALID',
              message: msg,
              recoverable: true,
              suggestion: 'Provide the CKB max fee as a non-negative number.',
            });
          } else {
            console.error(`Error: ${msg}`);
          }
          process.exit(1);
        }
      }

      const shouldWait = Boolean(options.wait);
      const timeoutSeconds = parseInt(String(options.timeout ?? '120'), 10);

      if (!invoice && !recipientNodeId) {
        if (json) {
          printJsonError({
            code: 'PAYMENT_SEND_INPUT_INVALID',
            message: 'Either invoice or --to <nodeId> required',
            recoverable: true,
            suggestion: 'Provide a valid invoice, or provide both `--to` and `--amount`.',
          });
        } else {
          console.error('Error: Either invoice or --to <nodeId> required');
        }
        process.exit(1);
      }
      if (recipientNodeId && amountRaw === undefined) {
        if (json) {
          printJsonError({
            code: 'PAYMENT_SEND_INPUT_INVALID',
            message: '--amount required when using --to',
            recoverable: true,
            suggestion: 'Add `--amount <amount>` when using keysend mode (`--to`).',
          });
        } else {
          console.error('Error: --amount required when using --to');
        }
        process.exit(1);
      }

      const paymentParams = {
        invoice,
        target_pubkey: recipientNodeId as HexString | undefined,
        amount: amountRaw !== undefined ? toHex(amountRaw) : undefined,
        keysend: recipientNodeId ? true : undefined,
        max_fee_amount: maxFeeRaw !== undefined ? toHex(maxFeeRaw) : undefined,
        ...(udtTypeScript ? { udt_type_script: udtTypeScript } : {}),
      };

      const endpoint = resolveRpcEndpoint(config);

      if (endpoint.target === 'runtime-proxy') {
        const created = await tryCreateRuntimePaymentJob(endpoint.url, {
          params: {
            invoice,
            sendPaymentParams: paymentParams,
          },
          options: {
            idempotencyKey: invoice ? `payment:invoice:${invoice}` : undefined,
          },
        });

        if (created) {
          const job = shouldWait
            ? await waitForRuntimeJobTerminal(endpoint.url, created.id, timeoutSeconds)
            : created;

          const payload = {
            paymentHash: getJobPaymentHash(job) ?? 'unknown',
            status:
              job.state === 'succeeded'
                ? 'success'
                : job.state === 'failed' || job.state === 'cancelled'
                  ? 'failed'
                  : 'pending',
            feeCkb: getJobFeeCkb(job),
            failureReason: getJobFailure(job),
            jobId: job.id,
            jobState: job.state,
            unit,
            amount: amountRaw?.toString(),
            ...(udtTypeScript ? { udtTypeScript } : {}),
          };

          if (json) {
            printJsonSuccess(payload);
          } else {
            console.log('Payment job submitted');
            console.log(`  Job:    ${payload.jobId}`);
            console.log(`  Hash:   ${payload.paymentHash}`);
            console.log(`  Status: ${payload.status} (${payload.jobState})`);
            console.log(`  Fee:    ${payload.feeCkb} CKB`);
            if (payload.amount !== undefined) {
              console.log(`  Amount: ${payload.amount} ${unit}`);
            }
            if (udtTypeScript) {
              console.log(`  UDT Type Script: ${JSON.stringify(udtTypeScript)}`);
            }
            if (payload.failureReason) {
              console.log(`  Error:  ${payload.failureReason}`);
            }
          }
          return;
        }
      }

      // Fallback to direct RPC send_payment
      const result = await rpc.sendPayment(paymentParams);

      const payload = {
        paymentHash: result.payment_hash,
        status:
          result.status === 'Success'
            ? 'success'
            : result.status === 'Failed'
              ? 'failed'
              : 'pending',
        feeCkb: shannonsToCkb(result.fee),
        failureReason: result.failed_error,
        unit,
        amount: amountRaw?.toString(),
        ...(udtTypeScript ? { udtTypeScript } : {}),
      };

      if (json) {
        printJsonSuccess(payload);
      } else {
        console.log('Payment sent');
        console.log(`  Hash:   ${payload.paymentHash}`);
        console.log(`  Status: ${payload.status}`);
        console.log(`  Fee:    ${payload.feeCkb} CKB`);
        if (payload.amount !== undefined) {
          console.log(`  Amount: ${payload.amount} ${unit}`);
        }
        if (udtTypeScript) {
          console.log(`  UDT Type Script: ${JSON.stringify(udtTypeScript)}`);
        }
        if (payload.failureReason) {
          console.log(`  Error:  ${payload.failureReason}`);
        }
      }
    });

  registerPaymentRebalanceCommand(payment, config);

  payment
    .command('get')
    .argument('<paymentHash>')
    .option('--json')
    .action(async (paymentHash, options) => {
      const rpc = await createReadyRpcClient(config);
      const result = await rpc.getPayment({ payment_hash: paymentHash as HexString });
      if (options.json) {
        printJsonSuccess(formatPaymentResult(result));
      } else {
        printPaymentDetailHuman(result);
      }
    });

  payment
    .command('watch')
    .argument('<paymentHash>')
    .option('--interval <seconds>', 'Polling interval', '2')
    .option('--timeout <seconds>', 'Timeout', '120')
    .option('--until <target>', 'SUCCESS | FAILED | TERMINAL', 'TERMINAL')
    .option('--on-timeout <behavior>', 'fail | success', 'fail')
    .option('--json')
    .action(async (paymentHash, options) => {
      const json = Boolean(options.json);
      const intervalSeconds = parseInt(options.interval, 10);
      const timeoutSeconds = parseInt(options.timeout, 10);
      const until = String(options.until ?? 'TERMINAL')
        .trim()
        .toUpperCase();
      const onTimeout = String(options.onTimeout ?? 'fail')
        .trim()
        .toLowerCase();
      if (!['SUCCESS', 'FAILED', 'TERMINAL'].includes(until)) {
        if (json) {
          printJsonError({
            code: 'PAYMENT_WATCH_INPUT_INVALID',
            message: `Invalid --until value: ${options.until}. Expected SUCCESS, FAILED, or TERMINAL`,
            recoverable: true,
            suggestion: 'Use one of: SUCCESS, FAILED, TERMINAL.',
            details: { provided: options.until, expected: ['SUCCESS', 'FAILED', 'TERMINAL'] },
          });
        } else {
          console.error(
            `Error: Invalid --until value: ${options.until}. Expected SUCCESS, FAILED, or TERMINAL`,
          );
        }
        process.exit(1);
      }
      if (!['fail', 'success'].includes(onTimeout)) {
        if (json) {
          printJsonError({
            code: 'PAYMENT_WATCH_INPUT_INVALID',
            message: `Invalid --on-timeout value: ${options.onTimeout}. Expected fail or success`,
            recoverable: true,
            suggestion: 'Use `--on-timeout fail` or `--on-timeout success`.',
            details: { provided: options.onTimeout, expected: ['fail', 'success'] },
          });
        } else {
          console.error(
            `Error: Invalid --on-timeout value: ${options.onTimeout}. Expected fail or success`,
          );
        }
        process.exit(1);
      }
      const rpc = await createReadyRpcClient(config);
      const startedAt = Date.now();
      let lastStatus: string | undefined;

      while (Date.now() - startedAt < timeoutSeconds * 1000) {
        const paymentResult = await rpc.getPayment({ payment_hash: paymentHash as HexString });

        if (paymentResult.status !== lastStatus) {
          if (json) {
            printJsonEvent('status_transition', {
              statusTransition: {
                from: lastStatus ?? null,
                to: paymentResult.status,
              },
              payment: formatPaymentResult(paymentResult),
            });
          } else {
            console.log(`Status: ${lastStatus ?? '(initial)'} -> ${paymentResult.status}`);
            printPaymentDetailHuman(paymentResult);
            console.log('');
          }
          lastStatus = paymentResult.status;
        }

        const isSuccess = paymentResult.status === 'Success';
        const isFailed = paymentResult.status === 'Failed';
        const terminalReached =
          until === 'TERMINAL' ? isSuccess || isFailed : until === 'SUCCESS' ? isSuccess : isFailed;

        if (terminalReached) {
          if (json) {
            printJsonEvent('terminal', {
              paymentHash,
              terminalStatus: paymentResult.status,
              until,
            });
          }
          return;
        }

        if ((isSuccess || isFailed) && until !== 'TERMINAL') {
          if (json) {
            printJsonError({
              code: 'PAYMENT_WATCH_UNEXPECTED_TERMINAL',
              message: `Payment reached ${paymentResult.status} before requested --until ${until}`,
              recoverable: true,
              suggestion: 'Set `--until TERMINAL` or handle mismatched terminal state in caller.',
              details: { terminalStatus: paymentResult.status, until },
            });
          } else {
            console.error(
              `Error: Payment reached ${paymentResult.status} before requested --until ${until}`,
            );
          }
          process.exit(1);
        }

        await sleep(intervalSeconds * 1000);
      }

      if (onTimeout === 'success') {
        if (json) {
          printJsonEvent('terminal', {
            paymentHash,
            terminalStatus: 'Timeout',
            until,
            timeoutSeconds,
          });
        } else {
          console.log(
            `Timeout reached (${timeoutSeconds}s) and treated as success by --on-timeout=success.`,
          );
        }
        return;
      }

      if (json) {
        printJsonError({
          code: 'PAYMENT_WATCH_TIMEOUT',
          message: `Payment ${paymentHash} did not reach terminal state within ${timeoutSeconds}s`,
          recoverable: true,
          suggestion: 'Increase timeout, or continue polling using `payment get --json`.',
          details: { paymentHash, timeoutSeconds },
        });
      } else {
        console.error(
          `Error: Payment ${paymentHash} did not reach terminal state within ${timeoutSeconds}s`,
        );
      }
      process.exit(1);
    });

  payment
    .command('route')
    .description('Build a payment route through specified hops')
    .requiredOption('--hops <pubkeys>', 'Comma-separated list of node pubkeys forming the route')
    .option('--amount <amount>', 'Amount to route (CKB or UDT raw units)')
    .option('--udt-type-script <json>', 'UDT type script as JSON CKB Script')
    .option('--udt-name <name>', 'UDT name from node_info.udt_cfg_infos')
    .option('--json')
    .action(async (options) => {
      const rpc = await createReadyRpcClient(config);
      const json = Boolean(options.json);
      const pubkeys = (options.hops as string).split(',').map((s: string) => s.trim());

      if (pubkeys.length === 0 || pubkeys.some((pk: string) => !pk)) {
        const msg = '--hops must be a non-empty comma-separated list of pubkeys';
        if (json) {
          printJsonError({
            code: 'PAYMENT_ROUTE_INPUT_INVALID',
            message: msg,
            recoverable: true,
            suggestion: 'Provide pubkeys: --hops 0xabc...,0xdef...',
          });
        } else {
          console.error(`Error: ${msg}`);
        }
        process.exit(1);
      }

      let udtTypeScript: UdtTypeScript | undefined;
      let routeAsset: UdtAsset = { kind: 'ckb' };
      try {
        routeAsset = await resolveUdtAsset({
          rawScript: options.udtTypeScript as string | undefined,
          name: options.udtName as string | undefined,
          rpc,
        });
        udtTypeScript = routeAsset.kind === 'udt' ? routeAsset.script : undefined;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid UDT option';
        if (json) {
          printJsonError({
            code: 'PAYMENT_ROUTE_INPUT_INVALID',
            message,
            recoverable: true,
            suggestion:
              'Provide a valid JSON script or UDT name, e.g. {"code_hash":"0x...","hash_type":"type","args":"0x..."} or --udt-name RUSD',
          });
        } else {
          console.error(`Error: ${message}`);
        }
        process.exit(1);
      }

      const isUdt = udtTypeScript !== undefined;

      let amount: bigint | undefined;
      if (options.amount) {
        try {
          amount = parsePaymentAmount(options.amount, isUdt);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Invalid amount';
          if (json) {
            printJsonError({
              code: 'PAYMENT_ROUTE_INPUT_INVALID',
              message,
              recoverable: true,
              suggestion: isUdt
                ? 'Provide a positive integer UDT amount, e.g. --amount 1000'
                : 'Provide a positive CKB amount, e.g. --amount 10',
            });
          } else {
            console.error(`Error: ${message}`);
          }
          process.exit(1);
        }
      }

      const hopsInfo = pubkeys.map((pubkey: string) => ({ pubkey: pubkey as HexString }));

      const result = await rpc.buildRouter({
        hops_info: hopsInfo,
        amount: amount !== undefined ? toHex(amount) : undefined,
        ...(udtTypeScript ? { udt_type_script: udtTypeScript } : {}),
      });

      const unit = isUdt ? 'UDT' : 'CKB';

      if (json) {
        printJsonSuccess({
          routerHops: result.router_hops,
          unit,
          udtTypeScript,
        });
      } else {
        console.log(`Route built: ${result.router_hops.length} hop(s)`);
        for (let i = 0; i < result.router_hops.length; i++) {
          const hop = result.router_hops[i];
          console.log(`  #${i + 1}`);
          console.log(`    Target:     ${hop.target}`);
          console.log(
            `    Outpoint:   ${hop.channel_outpoint.tx_hash}:${hop.channel_outpoint.index}`,
          );
          console.log(
            `    Amount:     ${isUdt ? BigInt(hop.amount_received).toString() : shannonsToCkb(hop.amount_received)} ${unit}`,
          );
          console.log(`    Expiry:     ${hop.incoming_tlc_expiry}`);
        }
      }
    });

  payment
    .command('send-route')
    .description('Send a payment using a pre-built route from `payment route`')
    .requiredOption(
      '--router <json>',
      'JSON array of router hops (output of `payment route --json`)',
    )
    .option('--invoice <invoice>', 'Invoice to pay')
    .option('--payment-hash <hash>', 'Payment hash (for keysend)')
    .option('--keysend', 'Keysend mode')
    .option('--allow-self-payment', 'Allow self-payment for circular route rebalancing')
    .option('--dry-run', 'Simulate—do not actually send')
    .option('--udt-type-script <json>', 'UDT type script as JSON CKB Script')
    .option('--udt-name <name>', 'UDT name from node_info.udt_cfg_infos')
    .option('--json')
    .action(async (options) => {
      const rpc = await createReadyRpcClient(config);
      const json = Boolean(options.json);

      let router: RouterHop[];
      try {
        router = JSON.parse(options.router as string) as RouterHop[];
      } catch {
        const msg = '--router must be a valid JSON array of router hops';
        if (json) {
          printJsonError({
            code: 'PAYMENT_SEND_ROUTE_INPUT_INVALID',
            message: msg,
            recoverable: true,
            suggestion: 'Pipe --json output of `payment route` into this flag.',
          });
        } else {
          console.error(`Error: ${msg}`);
        }
        process.exit(1);
      }

      let udtTypeScript: UdtTypeScript | undefined;
      let sendRouteAsset: UdtAsset = { kind: 'ckb' };
      try {
        sendRouteAsset = await resolveUdtAsset({
          rawScript: options.udtTypeScript as string | undefined,
          name: options.udtName as string | undefined,
          rpc,
        });
        udtTypeScript = sendRouteAsset.kind === 'udt' ? sendRouteAsset.script : undefined;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid UDT option';
        if (json) {
          printJsonError({
            code: 'PAYMENT_SEND_ROUTE_INPUT_INVALID',
            message,
            recoverable: true,
            suggestion:
              'Provide a valid JSON script or UDT name, e.g. {"code_hash":"0x...","hash_type":"type","args":"0x..."} or --udt-name RUSD',
          });
        } else {
          console.error(`Error: ${message}`);
        }
        process.exit(1);
      }
      const isUdt = udtTypeScript !== undefined;
      const unit = isUdt ? 'UDT' : 'CKB';

      const result = await rpc.sendPaymentWithRouter({
        router,
        invoice: options.invoice as string | undefined,
        payment_hash: options.paymentHash as HexString | undefined,
        keysend: options.keysend ? true : undefined,
        allow_self_payment: options.allowSelfPayment ? true : undefined,
        dry_run: options.dryRun ? true : undefined,
        ...(udtTypeScript ? { udt_type_script: udtTypeScript } : {}),
      });

      const payload = {
        paymentHash: result.payment_hash,
        status:
          result.status === 'Success'
            ? 'success'
            : result.status === 'Failed'
              ? 'failed'
              : 'pending',
        feeCkb: shannonsToCkb(result.fee),
        unit,
        udtTypeScript,
        failureReason: result.failed_error,
        dryRun: Boolean(options.dryRun),
      };

      if (json) {
        printJsonSuccess(payload);
      } else {
        console.log(options.dryRun ? 'Payment dry-run complete' : 'Payment sent via route');
        console.log(`  Hash:   ${payload.paymentHash}`);
        console.log(`  Status: ${payload.status}`);
        console.log(`  Fee:    ${payload.feeCkb} CKB`);
        console.log(`  Unit:   ${payload.unit}`);
        if (payload.udtTypeScript) {
          console.log(`  UDT Type Script: ${JSON.stringify(payload.udtTypeScript)}`);
        }
        if (payload.failureReason) {
          console.log(`  Error:  ${payload.failureReason}`);
        }
      }
    });

  return payment;
}

function getJobPaymentHash(job: RuntimeJobRecord): string | undefined {
  const result = job.result as { paymentHash?: string } | undefined;
  return result?.paymentHash;
}

function getJobFeeCkb(job: RuntimeJobRecord): number {
  const result = job.result as { fee?: string } | undefined;
  return result?.fee ? shannonsToCkb(result.fee as HexString) : 0;
}

function getJobFailure(job: RuntimeJobRecord): string | undefined {
  const result = job.result as { failedError?: string } | undefined;
  return result?.failedError ?? job.error?.message;
}
