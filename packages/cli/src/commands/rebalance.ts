import { ckbToShannons, type HexString, shannonsToCkb } from '@fiber-pay/sdk';
import type { Command } from 'commander';
import type { CliConfig } from '../lib/config.js';
import { printJsonError, printJsonSuccess } from '../lib/format.js';
import { createReadyRpcClient } from '../lib/rpc.js';

interface RebalanceExecutionParams {
  amountInput: string;
  maxFeeInput?: string;
  hops?: string[];
  dryRun: boolean;
  json: boolean;
  errorCode: 'PAYMENT_REBALANCE_INPUT_INVALID' | 'CHANNEL_REBALANCE_INPUT_INVALID';
}

async function executeRebalance(
  config: CliConfig,
  params: RebalanceExecutionParams,
): Promise<void> {
  const rpc = await createReadyRpcClient(config);
  const amountCkb = parseFloat(params.amountInput);
  const maxFeeCkb = params.maxFeeInput !== undefined ? parseFloat(params.maxFeeInput) : undefined;
  const manualHops = params.hops ?? [];

  if (!Number.isFinite(amountCkb) || amountCkb <= 0) {
    const message = 'Invalid --amount value. Expected a positive CKB amount.';
    if (params.json) {
      printJsonError({
        code: params.errorCode,
        message,
        recoverable: true,
        suggestion: 'Provide a positive number, e.g. `--amount 10`.',
        details: { amount: params.amountInput },
      });
    } else {
      console.error(`Error: ${message}`);
    }
    process.exit(1);
  }

  if (
    maxFeeCkb !== undefined &&
    (!Number.isFinite(maxFeeCkb) || maxFeeCkb < 0 || manualHops.length > 0)
  ) {
    const message =
      manualHops.length > 0
        ? '--max-fee is only supported in auto rebalance mode (without manual hops).'
        : 'Invalid --max-fee value. Expected a non-negative CKB amount.';
    if (params.json) {
      printJsonError({
        code: params.errorCode,
        message,
        recoverable: true,
        suggestion:
          manualHops.length > 0
            ? 'Remove `--max-fee` or run auto mode without manual hops.'
            : 'Provide a non-negative number, e.g. `--max-fee 0.01`.',
        details: { maxFee: params.maxFeeInput, hasManualHops: manualHops.length > 0 },
      });
    } else {
      console.error(`Error: ${message}`);
    }
    process.exit(1);
  }

  const selfPubkey = (await rpc.nodeInfo()).node_id as HexString;
  const amount = ckbToShannons(amountCkb);
  const isManual = manualHops.length > 0;
  let routeHopCount: number | undefined;

  const result = isManual
    ? await (async () => {
        const hopsInfo = [
          ...manualHops.map((pubkey: string) => ({ pubkey: pubkey as HexString })),
          ...(manualHops[manualHops.length - 1] === selfPubkey
            ? []
            : [{ pubkey: selfPubkey as HexString }]),
        ];

        const route = await rpc.buildRouter({
          amount,
          hops_info: hopsInfo,
        });
        routeHopCount = route.router_hops.length;

        return rpc.sendPaymentWithRouter({
          router: route.router_hops,
          keysend: true,
          allow_self_payment: true,
          dry_run: params.dryRun ? true : undefined,
        });
      })()
    : await rpc.sendPayment({
        target_pubkey: selfPubkey,
        amount,
        keysend: true,
        allow_self_payment: true,
        max_fee_amount: maxFeeCkb !== undefined ? ckbToShannons(maxFeeCkb) : undefined,
        dry_run: params.dryRun ? true : undefined,
      });

  const payload = {
    mode: isManual ? 'manual' : 'auto',
    selfPubkey,
    amountCkb,
    maxFeeCkb: isManual ? undefined : maxFeeCkb,
    routeHopCount,
    paymentHash: result.payment_hash,
    status:
      result.status === 'Success' ? 'success' : result.status === 'Failed' ? 'failed' : 'pending',
    feeCkb: shannonsToCkb(result.fee),
    failureReason: result.failed_error,
    dryRun: params.dryRun,
  };

  if (params.json) {
    printJsonSuccess(payload);
  } else {
    console.log(
      payload.dryRun
        ? `Rebalance dry-run complete (${payload.mode} route)`
        : `Rebalance sent (${payload.mode} route)`,
    );
    console.log(`  Self:   ${payload.selfPubkey}`);
    console.log(`  Amount: ${payload.amountCkb} CKB`);
    if (payload.mode === 'manual' && payload.routeHopCount !== undefined) {
      console.log(`  Hops:   ${payload.routeHopCount}`);
    }
    console.log(`  Hash:   ${payload.paymentHash}`);
    console.log(`  Status: ${payload.status}`);
    console.log(`  Fee:    ${payload.feeCkb} CKB`);
    if (payload.mode === 'auto' && payload.maxFeeCkb !== undefined) {
      console.log(`  MaxFee: ${payload.maxFeeCkb} CKB`);
    }
    if (payload.failureReason) {
      console.log(`  Error:  ${payload.failureReason}`);
    }
  }
}

export function registerPaymentRebalanceCommand(parent: Command, config: CliConfig): void {
  parent
    .command('rebalance')
    .description('Technical rebalance command mapped to payment-layer circular self-payment')
    .requiredOption('--amount <ckb>', 'Amount in CKB to rebalance')
    .option('--max-fee <ckb>', 'Maximum fee in CKB (auto mode only)')
    .option(
      '--hops <pubkeys>',
      'Comma-separated peer pubkeys for manual route mode (self pubkey appended automatically)',
    )
    .option('--dry-run', 'Simulate route/payment and return estimated result')
    .option('--json')
    .action(async (options) => {
      const hasHopsOption = typeof options.hops === 'string';
      const manualHops = hasHopsOption
        ? options.hops
            .split(',')
            .map((item: string) => item.trim())
            .filter(Boolean)
        : [];

      if (hasHopsOption && manualHops.length === 0) {
        const message =
          'Invalid --hops value. Expected a non-empty comma-separated list of pubkeys.';
        if (options.json) {
          printJsonError({
            code: 'PAYMENT_REBALANCE_INPUT_INVALID',
            message,
            recoverable: true,
            suggestion: 'Provide pubkeys like `--hops 0xabc...,0xdef...`.',
            details: { hops: options.hops },
          });
        } else {
          console.error(`Error: ${message}`);
        }
        process.exit(1);
      }

      await executeRebalance(config, {
        amountInput: options.amount,
        maxFeeInput: options.maxFee,
        hops: manualHops,
        dryRun: Boolean(options.dryRun),
        json: Boolean(options.json),
        errorCode: 'PAYMENT_REBALANCE_INPUT_INVALID',
      });
    });
}

export function registerChannelRebalanceCommand(parent: Command, config: CliConfig): void {
  parent
    .command('rebalance')
    .description('High-level channel rebalance wrapper using payment-layer orchestration')
    .requiredOption('--amount <ckb>', 'Amount in CKB to rebalance')
    .option('--from-channel <channelId>', 'Source-biased channel id (optional)')
    .option('--to-channel <channelId>', 'Destination-biased channel id (optional)')
    .option('--max-fee <ckb>', 'Maximum fee in CKB (auto mode only)')
    .option('--dry-run', 'Simulate route/payment and return estimated result')
    .option('--json')
    .action(async (options) => {
      const json = Boolean(options.json);
      const fromChannelId = options.fromChannel as string | undefined;
      const toChannelId = options.toChannel as string | undefined;

      if ((fromChannelId && !toChannelId) || (!fromChannelId && toChannelId)) {
        const message =
          'Both --from-channel and --to-channel must be provided together for guided channel rebalance.';
        if (json) {
          printJsonError({
            code: 'CHANNEL_REBALANCE_INPUT_INVALID',
            message,
            recoverable: true,
            suggestion: 'Provide both channel ids, or provide neither to run auto mode.',
            details: { fromChannel: fromChannelId, toChannel: toChannelId },
          });
        } else {
          console.error(`Error: ${message}`);
        }
        process.exit(1);
      }

      let guidedHops: string[] | undefined;
      if (fromChannelId && toChannelId) {
        const rpc = await createReadyRpcClient(config);
        const channels = (await rpc.listChannels({ include_closed: true })).channels;
        const fromChannel = channels.find((item) => item.channel_id === fromChannelId);
        const toChannel = channels.find((item) => item.channel_id === toChannelId);

        if (!fromChannel || !toChannel) {
          const message = 'Invalid channel selection: source/target channel id not found.';
          if (json) {
            printJsonError({
              code: 'CHANNEL_REBALANCE_INPUT_INVALID',
              message,
              recoverable: true,
              suggestion: 'Run `channel list --json` and retry with valid channel ids.',
              details: { fromChannel: fromChannelId, toChannel: toChannelId },
            });
          } else {
            console.error(`Error: ${message}`);
          }
          process.exit(1);
        }

        if (fromChannel.peer_id === toChannel.peer_id) {
          const message =
            'Source and target channels point to the same peer; choose two different channel peers.';
          if (json) {
            printJsonError({
              code: 'CHANNEL_REBALANCE_INPUT_INVALID',
              message,
              recoverable: true,
              suggestion: 'Select channels with different peer ids for guided rebalance.',
              details: {
                fromChannel: fromChannelId,
                toChannel: toChannelId,
                peerId: fromChannel.peer_id,
              },
            });
          } else {
            console.error(`Error: ${message}`);
          }
          process.exit(1);
        }

        const peers = (await rpc.listPeers()).peers;
        const pubkeyByPeerId = new Map(peers.map((peer) => [peer.peer_id, peer.pubkey]));
        const fromPubkey = pubkeyByPeerId.get(fromChannel.peer_id);
        const toPubkey = pubkeyByPeerId.get(toChannel.peer_id);

        if (!fromPubkey || !toPubkey) {
          const message =
            'Unable to resolve selected channel peer_id to pubkey for guided rebalance route.';
          if (json) {
            printJsonError({
              code: 'CHANNEL_REBALANCE_INPUT_INVALID',
              message,
              recoverable: true,
              suggestion:
                'Ensure both peers are connected (`peer list --json`) and retry guided mode, or use `payment rebalance --hops`.',
              details: {
                fromChannel: fromChannelId,
                toChannel: toChannelId,
                fromPeerId: fromChannel.peer_id,
                toPeerId: toChannel.peer_id,
                resolvedPeers: peers.length,
              },
            });
          } else {
            console.error(`Error: ${message}`);
          }
          process.exit(1);
        }

        guidedHops = [fromPubkey, toPubkey];
      }

      await executeRebalance(config, {
        amountInput: options.amount,
        maxFeeInput: options.maxFee,
        hops: guidedHops,
        dryRun: Boolean(options.dryRun),
        json,
        errorCode: 'CHANNEL_REBALANCE_INPUT_INVALID',
      });
    });
}
