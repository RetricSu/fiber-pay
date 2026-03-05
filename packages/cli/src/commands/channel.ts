import { randomUUID } from 'node:crypto';
import { type ChannelState, ckbToShannons, type HexString } from '@fiber-pay/sdk';
import { Command } from 'commander';
import { sleep } from '../lib/async.js';
import type { CliConfig } from '../lib/config.js';
import {
  formatChannel,
  getChannelSummary,
  parseChannelState,
  printChannelDetailHuman,
  printChannelListHuman,
  printJsonError,
  printJsonEvent,
  printJsonSuccess,
  truncateMiddle,
} from '../lib/format.js';
import { createReadyRpcClient, resolveRpcEndpoint } from '../lib/rpc.js';
import { tryCreateRuntimeChannelJob } from '../lib/runtime-jobs.js';
import { registerChannelRebalanceCommand } from './rebalance.js';

export function createChannelCommand(config: CliConfig): Command {
  const channel = new Command('channel').description('Channel lifecycle and status commands');

  channel
    .command('list')
    .option('--state <state>')
    .option('--peer <peerId>')
    .option('--include-closed')
    .option('--json')
    .action(async (options) => {
      const rpc = await createReadyRpcClient(config);
      const stateFilter = parseChannelState(options.state);
      const response = await rpc.listChannels(
        options.peer
          ? { peer_id: options.peer, include_closed: Boolean(options.includeClosed) }
          : { include_closed: Boolean(options.includeClosed) },
      );
      const channels = stateFilter
        ? response.channels.filter((item) => item.state.state_name === stateFilter)
        : response.channels;

      if (options.json) {
        printJsonSuccess({ channels, count: channels.length });
      } else {
        printChannelListHuman(channels);
      }
    });

  channel
    .command('get')
    .argument('<channelId>')
    .option('--json')
    .action(async (channelId, options) => {
      const rpc = await createReadyRpcClient(config);
      const response = await rpc.listChannels({ include_closed: true });
      const found = response.channels.find((item) => item.channel_id === channelId);
      if (!found) {
        if (options.json) {
          printJsonError({
            code: 'CHANNEL_NOT_FOUND',
            message: `Channel not found: ${channelId}`,
            recoverable: true,
            suggestion: 'List channels first and retry with a valid channel id.',
            details: { channelId },
          });
        } else {
          console.error(`Error: Channel not found: ${channelId}`);
        }
        process.exit(1);
      }

      if (options.json) {
        printJsonSuccess(found);
      } else {
        printChannelDetailHuman(found);
      }
    });

  channel
    .command('watch')
    .option('--interval <seconds>', 'Refresh interval', '5')
    .option('--timeout <seconds>')
    .option('--on-timeout <behavior>', 'fail | success', 'fail')
    .option('--channel <channelId>')
    .option('--peer <peerId>')
    .option('--state <state>')
    .option('--until <state>')
    .option('--include-closed')
    .option('--no-clear')
    .option('--json')
    .action(async (options) => {
      const intervalSeconds = parseInt(options.interval, 10);
      const timeoutSeconds = options.timeout ? parseInt(options.timeout, 10) : undefined;
      const onTimeout = String(options.onTimeout ?? 'fail')
        .trim()
        .toLowerCase();
      const stateFilter = parseChannelState(options.state);
      const untilState = parseChannelState(options.until);
      const noClear = Boolean(options.noClear);
      const json = Boolean(options.json);
      if (!['fail', 'success'].includes(onTimeout)) {
        if (json) {
          printJsonError({
            code: 'CHANNEL_WATCH_INPUT_INVALID',
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
      const previousStates = new Map<string, ChannelState>();

      while (true) {
        const response = await rpc.listChannels(
          options.peer
            ? { peer_id: options.peer, include_closed: Boolean(options.includeClosed) }
            : { include_closed: Boolean(options.includeClosed) },
        );
        let channels = response.channels;

        if (options.channel) {
          channels = channels.filter((item) => item.channel_id === options.channel);
        }
        if (stateFilter) {
          channels = channels.filter((item) => item.state.state_name === stateFilter);
        }

        const stateChanges: Array<{ channelId: string; from: ChannelState; to: ChannelState }> = [];
        for (const ch of channels) {
          const prev = previousStates.get(ch.channel_id);
          if (prev && prev !== ch.state.state_name) {
            stateChanges.push({ channelId: ch.channel_id, from: prev, to: ch.state.state_name });
          }
          previousStates.set(ch.channel_id, ch.state.state_name);
        }

        if (json) {
          printJsonEvent('snapshot', {
            channels: channels.map(formatChannel),
            summary: getChannelSummary(channels),
          });

          for (const change of stateChanges) {
            printJsonEvent('state_change', {
              channelId: change.channelId,
              from: change.from,
              to: change.to,
            });
          }
        } else {
          if (!noClear) {
            console.clear();
          }

          console.log(`⏱️  Channel monitor - ${new Date().toISOString()}`);
          console.log(
            `   Refresh: ${intervalSeconds}s${timeoutSeconds ? ` | Timeout: ${timeoutSeconds}s` : ''}${untilState ? ` | Until: ${untilState}` : ''}`,
          );

          if (stateChanges.length > 0) {
            console.log('\n🔔 State changes:');
            for (const change of stateChanges) {
              console.log(`   ${truncateMiddle(change.channelId)}: ${change.from} -> ${change.to}`);
            }
          }

          printChannelListHuman(channels);
        }

        if (untilState && channels.some((item) => item.state.state_name === untilState)) {
          if (json) {
            printJsonEvent('terminal', { reason: 'target_state_reached', untilState });
          } else {
            console.log(`\n✅ Target state reached: ${untilState}`);
          }
          return;
        }

        if (timeoutSeconds !== undefined && Date.now() - startedAt >= timeoutSeconds * 1000) {
          if (onTimeout === 'success') {
            if (json) {
              printJsonEvent('terminal', {
                reason: 'timeout',
                timeoutSeconds,
              });
            } else {
              console.log('\n⏰ Monitor timeout reached (treated as success).');
            }
            return;
          }

          if (json) {
            printJsonError({
              code: 'CHANNEL_WATCH_TIMEOUT',
              message: `Channel monitor timed out after ${timeoutSeconds}s`,
              recoverable: true,
              suggestion: 'Increase timeout or continue monitoring with another watch run.',
              details: { timeoutSeconds },
            });
            process.exit(1);
          }
          console.log('\n⏰ Monitor timeout reached.');
          return;
        }

        await sleep(intervalSeconds * 1000);
      }
    });

  channel
    .command('open')
    .requiredOption('--peer <peerIdOrMultiaddr>')
    .requiredOption('--funding <ckb>')
    .option('--private')
    .option(
      '--idempotency-key <key>',
      'Reuse this key only when retrying the exact same open intent',
    )
    .option('--json')
    .action(async (options) => {
      const rpc = await createReadyRpcClient(config);
      const json = Boolean(options.json);
      const peerInput = options.peer as string;
      const fundingCkb = parseFloat(options.funding);

      let peerId = peerInput;
      if (peerInput.includes('/')) {
        await rpc.connectPeer({ address: peerInput });
        const peerIdMatch = peerInput.match(/\/p2p\/([^/]+)/);
        if (peerIdMatch) peerId = peerIdMatch[1];
      }

      const idempotencyKey =
        typeof options.idempotencyKey === 'string' && options.idempotencyKey.trim().length > 0
          ? options.idempotencyKey.trim()
          : `open:${peerId}:${randomUUID()}`;

      const endpoint = resolveRpcEndpoint(config);
      if (endpoint.target === 'runtime-proxy') {
        const created = await tryCreateRuntimeChannelJob(endpoint.url, {
          params: {
            action: 'open',
            peerId,
            openChannelParams: {
              peer_id: peerId,
              funding_amount: ckbToShannons(fundingCkb),
              public: !options.private,
            },
            waitForReady: false,
          },
          options: {
            idempotencyKey,
            reuseTerminal: false,
          },
        });

        if (created) {
          const payload = {
            jobId: created.id,
            jobState: created.state,
            peer: peerId,
            fundingCkb,
            idempotencyKey,
          };

          if (json) {
            printJsonSuccess(payload);
          } else {
            console.log('Channel open job submitted');
            console.log(`  Job:                  ${payload.jobId}`);
            console.log(`  Job State:            ${payload.jobState}`);
            console.log(`  Peer:                 ${payload.peer}`);
            console.log(`  Funding:              ${payload.fundingCkb} CKB`);
            console.log(`  Idempotency Key:      ${payload.idempotencyKey}`);
          }
          return;
        }
      }

      const result = await rpc.openChannel({
        peer_id: peerId,
        funding_amount: ckbToShannons(fundingCkb),
        public: !options.private,
      });

      const payload = { temporaryChannelId: result.temporary_channel_id, peer: peerId, fundingCkb };
      if (json) {
        printJsonSuccess(payload);
      } else {
        console.log('Channel open initiated');
        console.log(`  Temporary Channel ID: ${payload.temporaryChannelId}`);
        console.log(`  Peer:                 ${payload.peer}`);
        console.log(`  Funding:              ${payload.fundingCkb} CKB`);
      }
    });

  channel
    .command('accept')
    .argument('<temporaryChannelId>')
    .requiredOption('--funding <ckb>')
    .option('--json')
    .action(async (temporaryChannelId, options) => {
      const rpc = await createReadyRpcClient(config);
      const json = Boolean(options.json);
      const fundingCkb = parseFloat(options.funding);

      const endpoint = resolveRpcEndpoint(config);
      if (endpoint.target === 'runtime-proxy') {
        const created = await tryCreateRuntimeChannelJob(endpoint.url, {
          params: {
            action: 'accept',
            acceptChannelParams: {
              temporary_channel_id: temporaryChannelId as HexString,
              funding_amount: ckbToShannons(fundingCkb),
            },
          },
          options: {
            idempotencyKey: `accept:temporary:${temporaryChannelId}`,
          },
        });

        if (created) {
          const payload = {
            jobId: created.id,
            jobState: created.state,
            temporaryChannelId,
            fundingCkb,
          };

          if (json) {
            printJsonSuccess(payload);
          } else {
            console.log('Channel accept job submitted');
            console.log(`  Job:                  ${payload.jobId}`);
            console.log(`  Job State:            ${payload.jobState}`);
            console.log(`  Temporary Channel ID: ${payload.temporaryChannelId}`);
            console.log(`  Funding:              ${payload.fundingCkb} CKB`);
          }
          return;
        }
      }

      const result = await rpc.acceptChannel({
        temporary_channel_id: temporaryChannelId as HexString,
        funding_amount: ckbToShannons(fundingCkb),
      });

      const payload = { channelId: result.channel_id, temporaryChannelId, fundingCkb };
      if (json) {
        printJsonSuccess(payload);
      } else {
        console.log('Channel accepted');
        console.log(`  Channel ID:           ${payload.channelId}`);
        console.log(`  Temporary Channel ID: ${payload.temporaryChannelId}`);
        console.log(`  Funding:              ${payload.fundingCkb} CKB`);
      }
    });

  channel
    .command('close')
    .argument('<channelId>')
    .option('--force')
    .option('--json')
    .action(async (channelId, options) => {
      const rpc = await createReadyRpcClient(config);
      const json = Boolean(options.json);

      const endpoint = resolveRpcEndpoint(config);
      if (endpoint.target === 'runtime-proxy') {
        const created = await tryCreateRuntimeChannelJob(endpoint.url, {
          params: {
            action: 'shutdown',
            channelId: channelId as HexString,
            shutdownChannelParams: {
              channel_id: channelId as HexString,
              force: Boolean(options.force),
            },
            waitForClosed: Boolean(options.force),
          },
          options: {
            idempotencyKey: `shutdown:channel:${channelId}`,
          },
        });

        if (created) {
          const payload = {
            jobId: created.id,
            jobState: created.state,
            channelId,
            force: Boolean(options.force),
            message: options.force
              ? 'Channel force close job submitted'
              : 'Channel close job submitted',
          };

          if (json) {
            printJsonSuccess(payload);
          } else {
            console.log(payload.message);
            console.log(`  Job:        ${payload.jobId}`);
            console.log(`  Job State:  ${payload.jobState}`);
            console.log(`  Channel ID: ${payload.channelId}`);
          }
          return;
        }
      }

      await rpc.shutdownChannel({
        channel_id: channelId as HexString,
        force: Boolean(options.force),
      });
      const payload = {
        channelId,
        force: Boolean(options.force),
        message: options.force ? 'Channel force close initiated' : 'Channel close initiated',
      };
      if (json) {
        printJsonSuccess(payload);
      } else {
        console.log(payload.message);
        console.log(`  Channel ID: ${payload.channelId}`);
      }
    });

  channel
    .command('abandon')
    .argument('<channelId>')
    .option('--json')
    .action(async (channelId, options) => {
      const rpc = await createReadyRpcClient(config);
      const json = Boolean(options.json);

      const endpoint = resolveRpcEndpoint(config);
      if (endpoint.target === 'runtime-proxy') {
        const created = await tryCreateRuntimeChannelJob(endpoint.url, {
          params: {
            action: 'abandon',
            channelId: channelId as HexString,
            abandonChannelParams: {
              channel_id: channelId as HexString,
            },
          },
          options: {
            idempotencyKey: `abandon:channel:${channelId}`,
          },
        });

        if (created) {
          const payload = {
            jobId: created.id,
            jobState: created.state,
            channelId,
            message: 'Channel abandon job submitted.',
          };
          if (json) {
            printJsonSuccess(payload);
          } else {
            console.log(payload.message);
            console.log(`  Job:        ${payload.jobId}`);
            console.log(`  Job State:  ${payload.jobState}`);
            console.log(`  Channel ID: ${payload.channelId}`);
          }
          return;
        }
      }

      await rpc.abandonChannel({ channel_id: channelId as HexString });
      const payload = { channelId, message: 'Channel abandoned.' };
      if (json) {
        printJsonSuccess(payload);
      } else {
        console.log(payload.message);
        console.log(`  Channel ID: ${payload.channelId}`);
      }
    });

  registerChannelRebalanceCommand(channel, config);

  channel
    .command('update')
    .argument('<channelId>')
    .option('--enabled <enabled>')
    .option('--tlc-expiry-delta <ms>')
    .option('--tlc-minimum-value <shannonsHex>')
    .option('--tlc-fee-proportional-millionths <value>')
    .option('--json')
    .action(async (channelId, options) => {
      const rpc = await createReadyRpcClient(config);
      const json = Boolean(options.json);
      const updateParams = {
        channel_id: channelId as HexString,
        enabled: options.enabled !== undefined ? options.enabled === 'true' : undefined,
        tlc_expiry_delta: options.tlcExpiryDelta,
        tlc_minimum_value: options.tlcMinimumValue,
        tlc_fee_proportional_millionths: options.tlcFeeProportionalMillionths,
      };

      const endpoint = resolveRpcEndpoint(config);
      if (endpoint.target === 'runtime-proxy') {
        const created = await tryCreateRuntimeChannelJob(endpoint.url, {
          params: {
            action: 'update',
            channelId: channelId as HexString,
            updateChannelParams: updateParams,
          },
          options: {
            reuseTerminal: false,
          },
        });

        if (created) {
          const payload = {
            jobId: created.id,
            jobState: created.state,
            channelId,
            message: 'Channel update job submitted.',
          };
          if (json) {
            printJsonSuccess(payload);
          } else {
            console.log(payload.message);
            console.log(`  Job:        ${payload.jobId}`);
            console.log(`  Job State:  ${payload.jobState}`);
            console.log(`  Channel ID: ${payload.channelId}`);
          }
          return;
        }
      }

      await rpc.updateChannel(updateParams);
      const payload = { channelId, message: 'Channel updated.' };
      if (json) {
        printJsonSuccess(payload);
      } else {
        console.log(payload.message);
        console.log(`  Channel ID: ${payload.channelId}`);
      }
    });

  return channel;
}
