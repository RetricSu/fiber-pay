import { type HexString, randomBytes32, shannonsToCkb, toHex } from '@fiber-pay/sdk';
import { Command } from 'commander';
import type { CliConfig } from '../lib/config.js';
import {
  extractInvoiceMetadata,
  parseHexTimestampMs,
  printInvoiceDetailHuman,
  printJsonError,
  printJsonSuccess,
} from '../lib/format.js';
import { parsePaymentAmount, type UdtTypeScript } from '../lib/parse-options.js';
import { createReadyRpcClient, resolveRpcEndpoint } from '../lib/rpc.js';
import { tryCreateRuntimeInvoiceJob, waitForRuntimeJobTerminal } from '../lib/runtime-jobs.js';
import { resolveUdtTypeScript } from '../lib/udt.js';

export function createInvoiceCommand(config: CliConfig): Command {
  const invoice = new Command('invoice').description('Invoice lifecycle and status commands');

  invoice
    .command('create')
    .argument('[amount]')
    .option('--amount <amount>')
    .option('--udt-type-script <json>', 'UDT type script as JSON CKB Script')
    .option('--udt-name <name>', 'UDT name from node_info.udt_cfg_infos')
    .option('--description <text>')
    .option('--expiry <minutes>')
    .option('--json')
    .action(async (amountArg, options) => {
      const rpc = await createReadyRpcClient(config);
      const json = Boolean(options.json);

      let udtTypeScript: UdtTypeScript | undefined;
      try {
        const resolved = await resolveUdtTypeScript({
          rawScript: options.udtTypeScript as string | undefined,
          name: options.udtName as string | undefined,
          rpc,
        });
        udtTypeScript = resolved.script;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid UDT option';
        if (json) {
          printJsonError({
            code: 'INVOICE_CREATE_INPUT_INVALID',
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
      const amountInput = options.amount ?? amountArg;
      if (!amountInput) {
        if (json) {
          printJsonError({
            code: 'INVOICE_CREATE_INPUT_INVALID',
            message: 'Amount required. Usage: invoice create --amount <amount>',
            recoverable: true,
            suggestion: 'Provide a valid positive amount via `--amount <amount>`.',
          });
        } else {
          console.error('Error: Amount required. Usage: invoice create --amount <amount>');
        }
        process.exit(1);
      }

      let amount: bigint;
      try {
        amount = parsePaymentAmount(amountInput, isUdt);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid amount';
        if (json) {
          printJsonError({
            code: 'INVOICE_CREATE_INPUT_INVALID',
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

      const amountCkb = isUdt ? undefined : parseFloat(amountInput);
      const expirySeconds = (options.expiry ? parseInt(options.expiry, 10) : 60) * 60;
      const currency = config.network === 'mainnet' ? 'Fibb' : 'Fibt';
      const unit = isUdt ? 'UDT' : 'CKB';

      const endpoint = resolveRpcEndpoint(config);
      if (endpoint.target === 'runtime-proxy') {
        const created = await tryCreateRuntimeInvoiceJob(endpoint.url, {
          params: {
            action: 'create',
            newInvoiceParams: {
              amount: toHex(amount),
              currency,
              description: options.description,
              expiry: toHex(expirySeconds),
              payment_preimage: randomBytes32(),
              ...(udtTypeScript ? { udt_type_script: udtTypeScript } : {}),
            },
            waitForTerminal: false,
          },
        });

        if (created) {
          const job = await waitForRuntimeJobTerminal(endpoint.url, created.id, 60);
          if (job.state !== 'succeeded') {
            throw new Error(job.error?.message ?? `Invoice create job ${job.state}`);
          }

          const result = (job.result ?? {}) as {
            invoiceAddress?: string;
            paymentHash?: string;
            status?: string;
          };

          const payload = {
            jobId: job.id,
            invoice: result.invoiceAddress,
            paymentHash: result.paymentHash,
            amount: isUdt ? amount.toString() : amountCkb,
            unit,
            udtTypeScript,
            expiresAt: new Date(Date.now() + expirySeconds * 1000).toISOString(),
            status: (result.status ?? 'Open').toLowerCase(),
          };

          if (json) {
            printJsonSuccess(payload);
          } else {
            console.log('Invoice created');
            console.log(`  Job:          ${payload.jobId}`);
            console.log(`  Payment Hash: ${payload.paymentHash ?? 'n/a'}`);
            console.log(`  Amount:       ${payload.amount} ${payload.unit}`);
            if (udtTypeScript) {
              console.log(`  UDT Type Script: ${JSON.stringify(udtTypeScript)}`);
            }
            console.log(`  Expires At:   ${payload.expiresAt}`);
            console.log(`  Invoice:      ${payload.invoice ?? 'n/a'}`);
          }
          return;
        }
      }

      const result = await rpc.newInvoice({
        amount: toHex(amount),
        currency,
        description: options.description,
        expiry: toHex(expirySeconds),
        payment_preimage: randomBytes32(),
        ...(udtTypeScript ? { udt_type_script: udtTypeScript } : {}),
      });

      const payload = {
        invoice: result.invoice_address,
        paymentHash: result.invoice.data.payment_hash,
        amount: isUdt ? amount.toString() : amountCkb,
        unit,
        udtTypeScript,
        expiresAt: new Date(Date.now() + expirySeconds * 1000).toISOString(),
        status: 'open',
      };

      if (json) {
        printJsonSuccess(payload);
      } else {
        console.log('Invoice created');
        console.log(`  Payment Hash: ${payload.paymentHash}`);
        console.log(`  Amount:       ${payload.amount} ${payload.unit}`);
        if (udtTypeScript) {
          console.log(`  UDT Type Script: ${JSON.stringify(udtTypeScript)}`);
        }
        console.log(`  Expires At:   ${payload.expiresAt}`);
        console.log(`  Invoice:      ${payload.invoice}`);
      }
    });

  invoice
    .command('get')
    .argument('<paymentHash>')
    .option('--json')
    .action(async (paymentHash, options) => {
      const rpc = await createReadyRpcClient(config);
      const result = await rpc.getInvoice({ payment_hash: paymentHash as HexString });
      const metadata = extractInvoiceMetadata(result.invoice);
      const createdAtMs = parseHexTimestampMs(result.invoice.data.timestamp);
      const output = {
        paymentHash,
        status: result.status,
        invoice: result.invoice_address,
        amountCkb: result.invoice.amount ? shannonsToCkb(result.invoice.amount) : undefined,
        currency: result.invoice.currency,
        description: metadata.description,
        createdAt: createdAtMs
          ? new Date(createdAtMs).toISOString()
          : result.invoice.data.timestamp,
        expiresAt: metadata.expiresAt,
        age: metadata.age,
      };

      if (options.json) {
        printJsonSuccess(output);
      } else {
        printInvoiceDetailHuman(output);
      }
    });

  invoice
    .command('parse')
    .argument('<invoiceString>')
    .option('--json')
    .action(async (invoiceString, options) => {
      const rpc = await createReadyRpcClient(config);
      const result = await rpc.parseInvoice({ invoice: invoiceString });
      if (options.json) {
        printJsonSuccess(result);
      } else {
        console.log('Invoice parsed');
        console.log(JSON.stringify(result, null, 2));
      }
    });

  invoice
    .command('cancel')
    .argument('<paymentHash>')
    .option('--json')
    .action(async (paymentHash, options) => {
      const rpc = await createReadyRpcClient(config);
      const json = Boolean(options.json);

      const endpoint = resolveRpcEndpoint(config);
      if (endpoint.target === 'runtime-proxy') {
        const created = await tryCreateRuntimeInvoiceJob(endpoint.url, {
          params: {
            action: 'cancel',
            cancelInvoiceParams: { payment_hash: paymentHash as HexString },
          },
          options: {
            idempotencyKey: `invoice:cancel:${paymentHash}`,
          },
        });

        if (created) {
          const job = await waitForRuntimeJobTerminal(endpoint.url, created.id, 60);
          if (job.state !== 'succeeded') {
            throw new Error(job.error?.message ?? `Invoice cancel job ${job.state}`);
          }

          const result = (job.result ?? {}) as {
            status?: string;
            invoiceAddress?: string;
          };

          const output = {
            jobId: job.id,
            paymentHash,
            status: result.status ?? 'Cancelled',
            invoice: result.invoiceAddress,
          };

          if (json) {
            printJsonSuccess(output);
          } else {
            console.log('Invoice cancelled');
            console.log(`  Job:          ${output.jobId}`);
            console.log(`  Payment Hash: ${output.paymentHash}`);
            console.log(`  Status:       ${output.status}`);
            console.log(`  Invoice:      ${output.invoice ?? 'n/a'}`);
          }
          return;
        }
      }

      const result = await rpc.cancelInvoice({ payment_hash: paymentHash as HexString });
      const output = { paymentHash, status: result.status, invoice: result.invoice_address };
      if (json) {
        printJsonSuccess(output);
      } else {
        console.log('Invoice cancelled');
        console.log(`  Payment Hash:  ${output.paymentHash}`);
        console.log(`  Status:        ${output.status}`);
        console.log(`  Invoice:       ${output.invoice}`);
      }
    });

  invoice
    .command('settle')
    .argument('<paymentHash>')
    .requiredOption('--preimage <preimage>')
    .option('--json')
    .action(async (paymentHash, options) => {
      const rpc = await createReadyRpcClient(config);
      const json = Boolean(options.json);

      const endpoint = resolveRpcEndpoint(config);
      if (endpoint.target === 'runtime-proxy') {
        const created = await tryCreateRuntimeInvoiceJob(endpoint.url, {
          params: {
            action: 'settle',
            settleInvoiceParams: {
              payment_hash: paymentHash as HexString,
              payment_preimage: options.preimage as HexString,
            },
          },
          options: {
            idempotencyKey: `invoice:settle:${paymentHash}`,
          },
        });

        if (created) {
          const job = await waitForRuntimeJobTerminal(endpoint.url, created.id, 60);
          if (job.state !== 'succeeded') {
            throw new Error(job.error?.message ?? `Invoice settle job ${job.state}`);
          }

          const output = { jobId: job.id, paymentHash, message: 'Invoice settled.' };
          if (json) {
            printJsonSuccess(output);
          } else {
            console.log(output.message);
            console.log(`  Job:          ${output.jobId}`);
            console.log(`  Payment Hash: ${output.paymentHash}`);
          }
          return;
        }
      }

      await rpc.settleInvoice({
        payment_hash: paymentHash as HexString,
        payment_preimage: options.preimage as HexString,
      });

      if (json) {
        printJsonSuccess({ paymentHash, message: 'Invoice settled.' });
      } else {
        console.log('Invoice settled');
        console.log(`  Payment Hash:  ${paymentHash}`);
      }
    });

  return invoice;
}
