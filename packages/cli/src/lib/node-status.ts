import { existsSync } from 'node:fs';
import {
  buildMultiaddrFromNodeId,
  buildMultiaddrFromRpcUrl,
  ChannelState,
  nodeIdToPeerId,
  type Script,
  scriptToAddress,
} from '@fiber-pay/sdk';
import { getBinaryDetails } from './binary-path.js';
import type { CliConfig } from './config.js';
import { printJsonSuccess } from './format.js';
import {
  buildReadyRecommendation,
  buildStalePidRecommendation,
  buildStatusRecommendation,
  summarizeChannelLiquidity,
} from './node-recommendation.js';
import { getLockBalanceShannons } from './node-rpc.js';
import { isProcessRunning, readPidFile, removePidFile } from './pid.js';
import { createReadyRpcClient, resolveRpcEndpoint } from './rpc.js';

export interface NodeStatusOptions {
  json?: boolean;
}

export async function runNodeStatusCommand(
  config: CliConfig,
  options: NodeStatusOptions,
): Promise<void> {
  const json = Boolean(options.json);
  const pid = readPidFile(config.dataDir);
  const resolvedRpc = resolveRpcEndpoint(config);
  const { resolvedBinary, info: binaryInfo } = await getBinaryDetails(config);
  const configExists = existsSync(config.configPath);
  const nodeRunning = Boolean(pid && isProcessRunning(pid));

  let rpcResponsive = false;
  let nodeId: string | null = null;
  let peerId: string | null = null;
  let peerIdError: string | null = null;
  let multiaddr: string | null = null;
  let multiaddrError: string | null = null;
  let multiaddrInferred = false;
  let channelsTotal = 0;
  let channelsReady = 0;
  let canSend = false;
  let canReceive = false;
  let localCkb = 0;
  let remoteCkb = 0;
  let fundingAddress: string | null = null;
  let fundingCkb = 0;
  let fundingBalanceError: string | null = null;

  if (nodeRunning) {
    try {
      const rpc = await createReadyRpcClient(config);
      const nodeInfo = await rpc.nodeInfo();
      const channels = await rpc.listChannels({ include_closed: false });
      rpcResponsive = true;

      nodeId = nodeInfo.node_id;
      try {
        peerId = await nodeIdToPeerId(nodeInfo.node_id);
      } catch (error) {
        peerIdError = error instanceof Error ? error.message : String(error);
      }

      const baseAddress = nodeInfo.addresses[0];
      if (baseAddress) {
        try {
          multiaddr = await buildMultiaddrFromNodeId(baseAddress, nodeInfo.node_id);
        } catch (error) {
          multiaddrError = error instanceof Error ? error.message : String(error);
        }
      } else if (peerId) {
        try {
          multiaddr = buildMultiaddrFromRpcUrl(config.rpcUrl, peerId);
          multiaddrInferred = true;
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          multiaddrError = `no advertised addresses; infer failed: ${reason}`;
        }
      }

      channelsTotal = channels.channels.length;
      const readyChannels = channels.channels.filter(
        (channel) => channel.state?.state_name === ChannelState.ChannelReady,
      );
      channelsReady = readyChannels.length;
      const liquidity = summarizeChannelLiquidity(readyChannels);
      canSend = liquidity.canSend;
      canReceive = liquidity.canReceive;
      localCkb = liquidity.localCkb;
      remoteCkb = liquidity.remoteCkb;

      fundingAddress = scriptToAddress(nodeInfo.default_funding_lock_script, config.network);
      if (config.ckbRpcUrl) {
        try {
          const fundingBalance = await getLockBalanceShannons(
            config.ckbRpcUrl,
            nodeInfo.default_funding_lock_script as Script,
          );
          fundingCkb = Number(fundingBalance) / 1e8;
        } catch (error) {
          fundingBalanceError =
            error instanceof Error
              ? error.message
              : 'Failed to query CKB balance for funding address';
        }
      } else {
        fundingBalanceError =
          'CKB RPC URL not configured (set ckb.rpc_url in config.yml or FIBER_CKB_RPC_URL)';
      }
    } catch {
      rpcResponsive = false;
    }
  } else if (pid) {
    removePidFile(config.dataDir);
  }

  const { recommendation, reasons } = buildStatusRecommendation({
    binaryReady: binaryInfo.ready,
    configExists,
    nodeRunning,
    rpcResponsive,
    channelsReady,
    canSend,
    canReceive,
  });

  const output = {
    running: nodeRunning,
    pid: pid ?? null,
    rpcResponsive,
    rpcUrl: config.rpcUrl,
    rpcTarget: resolvedRpc.target,
    resolvedRpcUrl: resolvedRpc.url,
    nodeId,
    peerId,
    peerIdError,
    multiaddr,
    multiaddrError,
    multiaddrInferred,
    checks: {
      binary: {
        path: binaryInfo.path,
        ready: binaryInfo.ready,
        version: binaryInfo.version,
        source: resolvedBinary.source,
        managedPath: resolvedBinary.managedPath,
        resolvedPath: resolvedBinary.binaryPath,
      },
      config: {
        path: config.configPath,
        exists: configExists,
        network: config.network,
        rpcUrl: config.rpcUrl,
      },
      node: {
        running: nodeRunning,
        pid: pid ?? null,
        rpcReachable: rpcResponsive,
        rpcTarget: resolvedRpc.target,
        rpcClientUrl: resolvedRpc.url,
      },
      channels: {
        total: channelsTotal,
        ready: channelsReady,
        canSend,
        canReceive,
      },
    },
    balance: {
      totalCkb: localCkb + fundingCkb,
      channelLocalCkb: localCkb,
      availableToSend: localCkb,
      availableToReceive: remoteCkb,
      channelCount: channelsTotal,
      activeChannelCount: channelsReady,
      fundingAddress,
      fundingAddressTotalCkb: fundingCkb,
      fundingBalanceError,
    },
    recommendation,
    reasons,
  };

  if (json) {
    printJsonSuccess(output);
    return;
  }

  if (output.running) {
    console.log(`✅ Node is running (PID: ${output.pid})`);
    if (output.rpcResponsive) {
      console.log(`   Node ID: ${String(output.nodeId)}`);
      if (output.peerId) {
        console.log(`   Peer ID: ${String(output.peerId)}`);
      } else if (output.peerIdError) {
        console.log(`   Peer ID: unavailable (${String(output.peerIdError)})`);
      }
      console.log(`   RPC: ${String(output.rpcUrl)}`);
      console.log(`   RPC Client: ${String(output.rpcTarget)} (${String(output.resolvedRpcUrl)})`);
      if (output.multiaddr) {
        const inferredSuffix = output.multiaddrInferred
          ? ' (inferred from RPC + peerId; no advertised addresses)'
          : '';
        console.log(`   Multiaddr: ${String(output.multiaddr)}${inferredSuffix}`);
      } else if (output.multiaddrError) {
        console.log(`   Multiaddr: unavailable (${String(output.multiaddrError)})`);
      } else {
        console.log('   Multiaddr: unavailable');
      }
    } else {
      console.log('   ⚠️  RPC not responding');
    }
  } else if (output.pid) {
    console.log(`❌ Node is not running (stale PID file: ${output.pid})`);
  } else {
    console.log('❌ Node is not running');
  }

  console.log('');
  console.log('Diagnostics');
  console.log(`  Binary:        ${output.checks.binary.ready ? 'ready' : 'missing'}`);
  console.log(`  Binary Path:   ${output.checks.binary.resolvedPath}`);
  console.log(`  Config:        ${output.checks.config.exists ? 'present' : 'missing'}`);
  console.log(`  RPC:           ${output.checks.node.rpcReachable ? 'reachable' : 'unreachable'}`);
  console.log(
    `  Channels:      ${output.checks.channels.ready}/${output.checks.channels.total} ready/total`,
  );
  console.log(`  Can Send:      ${output.checks.channels.canSend ? 'yes' : 'no'}`);
  console.log(`  Can Receive:   ${output.checks.channels.canReceive ? 'yes' : 'no'}`);
  console.log(`  Recommendation:${output.recommendation}`);
  if (output.reasons.length > 0) {
    console.log('  Reasons:');
    for (const reason of output.reasons) {
      console.log(`    - ${reason}`);
    }
  }

  console.log('');
  console.log('Balance');
  console.log(`  Total CKB:     ${output.balance.totalCkb.toFixed(8)}`);
  console.log(`  Channel Local: ${output.balance.channelLocalCkb.toFixed(8)}`);
  console.log(`  To Send:       ${output.balance.availableToSend.toFixed(8)}`);
  console.log(`  To Receive:    ${output.balance.availableToReceive.toFixed(8)}`);
  console.log(
    `  Channels:      ${output.balance.activeChannelCount}/${output.balance.channelCount} active/total`,
  );
  if (output.balance.fundingAddress) {
    console.log(`  Funding Addr:  ${output.balance.fundingAddress}`);
  }
  console.log(`  Funding CKB:   ${output.balance.fundingAddressTotalCkb.toFixed(8)}`);
  if (output.balance.fundingBalanceError) {
    console.log(`  Funding Err:   ${output.balance.fundingBalanceError}`);
  }
}

export async function runNodeReadyCommand(
  config: CliConfig,
  options: NodeStatusOptions,
): Promise<void> {
  const json = Boolean(options.json);
  const pid = readPidFile(config.dataDir);
  const output: Record<string, unknown> = {
    nodeRunning: false,
    rpcReachable: false,
    channelsTotal: 0,
    channelsReady: 0,
    canSend: false,
    canReceive: false,
    recommendation: 'NODE_STOPPED',
    reasons: ['Node process is not running.'],
    pid: pid ?? null,
    rpcUrl: config.rpcUrl,
  };

  if (pid && isProcessRunning(pid)) {
    output.nodeRunning = true;
    output.reasons = [];

    try {
      const rpc = await createReadyRpcClient(config);
      output.rpcReachable = true;
      const channels = await rpc.listChannels({ include_closed: false });
      output.channelsTotal = channels.channels.length;

      const readyChannels = channels.channels.filter(
        (channel) => channel.state?.state_name === ChannelState.ChannelReady,
      );
      output.channelsReady = readyChannels.length;

      const liquidity = summarizeChannelLiquidity(readyChannels);
      output.canSend = liquidity.canSend;
      output.canReceive = liquidity.canReceive;

      const readyRecommendation = buildReadyRecommendation({
        nodeRunning: true,
        rpcReachable: true,
        channelsReady: readyChannels.length,
        canSend: liquidity.canSend,
        canReceive: liquidity.canReceive,
      });
      output.recommendation = readyRecommendation.recommendation;
      output.reasons = readyRecommendation.reasons;
    } catch {
      output.rpcReachable = false;
      const readyRecommendation = buildReadyRecommendation({
        nodeRunning: true,
        rpcReachable: false,
        channelsReady: 0,
        canSend: false,
        canReceive: false,
      });
      output.recommendation = readyRecommendation.recommendation;
      output.reasons = readyRecommendation.reasons;
    }
  } else if (pid) {
    const staleRecommendation = buildStalePidRecommendation();
    output.recommendation = staleRecommendation.recommendation;
    output.reasons = staleRecommendation.reasons;
    removePidFile(config.dataDir);
  }

  if (json) {
    printJsonSuccess(output);
  } else {
    console.log('Node Readiness');
    console.log(`  Node Running:   ${output.nodeRunning ? 'yes' : 'no'}`);
    console.log(`  RPC Reachable:  ${output.rpcReachable ? 'yes' : 'no'}`);
    console.log(`  Channels:       ${output.channelsReady}/${output.channelsTotal} ready/total`);
    console.log(`  Can Send:       ${output.canSend ? 'yes' : 'no'}`);
    console.log(`  Can Receive:    ${output.canReceive ? 'yes' : 'no'}`);
    console.log(`  Recommendation: ${String(output.recommendation)}`);
    const reasons = Array.isArray(output.reasons) ? output.reasons : [];
    if (reasons.length > 0) {
      console.log('  Reasons:');
      for (const reason of reasons) {
        console.log(`    - ${String(reason)}`);
      }
    }
  }
}
