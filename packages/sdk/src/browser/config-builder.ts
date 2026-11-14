/**
 * ConfigBuilder — Generates YAML config strings for Fiber WASM nodes
 *
 * Encapsulates the complex YAML configuration that @nervosnetwork/fiber-js
 * requires, providing a TypeScript-friendly API with sensible defaults
 * for testnet and mainnet.
 */

import { FIBER_SCRIPTS_BY_NETWORK } from '../config/fiber-deployments.js';
import type { Script } from '../types/rpc.js';
import { stringify } from './yaml.js';

// =============================================================================
// Types
// =============================================================================

export interface UdtWhitelistEntry {
  name: string;
  script: Script;
  cellDeps: Array<{
    typeId?: Script;
    cellDep?: {
      outPoint: { txHash: string; index: string };
      depType: 'code' | 'dep_group';
    };
  }>;
  autoAcceptAmount?: string;
}

export interface BrowserNodeConfig {
  /** Network to connect to */
  network: 'testnet' | 'mainnet';
  /** Custom bootnode addresses (optional, defaults to built-in list) */
  bootnodes?: string[];
  /** CKB RPC URL (optional, defaults to public endpoint) */
  ckbRpcUrl?: string;
  /** UDT whitelist entries */
  udtWhitelist?: UdtWhitelistEntry[];
  /** Log level for WASM node */
  logLevel?: 'trace' | 'debug' | 'info' | 'error';
  /** IndexedDB storage prefix (defaults to credential identifier) */
  databasePrefix?: string;
  /** Whether to announce the listening address (usually false for browser) */
  announceListeningAddr?: boolean;
  /** Custom P2P listening address (optional, defaults to /ip4/127.0.0.1/tcp/8228) */
  p2pListeningAddr?: string;
  /** Additional P2P listening addresses appended to p2pListeningAddr (fnn v0.10.0+) */
  p2pListeningAddrs?: string[];
  /** Custom RPC listening address (optional, defaults to 127.0.0.1:8227) */
  rpcListeningAddr?: string;
}

// =============================================================================
// Network Defaults
// =============================================================================

const TESTNET_BOOTNODES = [
  '/dns4/thrall.fiber.channel/tcp/443/wss/p2p/Qmes1EBD4yNo9Ywkfe6eRw9tG1nVNGLDmMud1xJMsoYFKy',
  '/dns4/onyxia.fiber.channel/tcp/443/wss/p2p/QmdyQWjPtbK4NWWsvy8s69NGJaQULwgeQDT5ZpNDrTNaeV',
];

const MAINNET_BOOTNODES = [
  '/dns4/garrosh.fiber.channel/tcp/443/wss/p2p/QmZ2gCTfEF6vKsiYFF2STPeA2rRLRim9nMtzfwiE7uMQ4v',
  '/dns4/sylvanas.fiber.channel/tcp/443/wss/p2p/QmcMLnWraRyxd7PFRgvn1QeYRQS2DGsP6fPFCQjtfMs5b2',
];

const TESTNET_CKB_RPC = 'https://testnet.ckbapp.dev/';
const MAINNET_CKB_RPC = 'https://mainnet.ckbapp.dev/';

const TESTNET_RUSD_UDT = {
  name: 'RUSD',
  script: {
    code_hash: '0x1142755a044bf2ee358cba9f2da187ce928c91cd4dc8692ded0337efa677d21a',
    hash_type: 'type',
    args: '0x878fcc6f1f08d48e87bb1c3b3d5083f23f8a39c5d5c764f253b55b998526439b',
  },
  cell_deps: [
    {
      type_id: {
        code_hash: '0x00000000000000000000000000000000000000000000000000545950455f4944',
        hash_type: 'type',
        args: '0x97d30b723c0b2c66e9cb8d4d0df4ab5d7222cbb00d4a9a2055ce2e5d7f0d8b0f',
      },
    },
  ],
  auto_accept_amount: 1000000000,
} as const;

// =============================================================================
// Config Builder
// =============================================================================

// biome-ignore lint/complexity/noStaticOnlyClass: Used as a namespace
export class ConfigBuilder {
  /**
   * Build a complete YAML config string for Fiber WASM node.
   *
   * @example
   * ```ts
   * const yaml = ConfigBuilder.build({ network: 'testnet' });
   * ```
   */
  static build(config: BrowserNodeConfig): string {
    const isTestnet = config.network === 'testnet';
    const bootnodes = config.bootnodes ?? (isTestnet ? TESTNET_BOOTNODES : MAINNET_BOOTNODES);
    const ckbRpcUrl = config.ckbRpcUrl ?? (isTestnet ? TESTNET_CKB_RPC : MAINNET_CKB_RPC);

    const configObj: Record<string, unknown> = {
      fiber: {
        listening_addr: config.p2pListeningAddr ?? '/ip4/127.0.0.1/tcp/8228',
        ...(config.p2pListeningAddrs ? { listening_addrs: config.p2pListeningAddrs } : {}),
        bootnode_addrs: bootnodes,
        announce_listening_addr: config.announceListeningAddr ?? false,
        chain: config.network,
        scripts: [...FIBER_SCRIPTS_BY_NETWORK[config.network]],
      },
      rpc: {
        listening_addr: config.rpcListeningAddr ?? '127.0.0.1:8227',
      },
      ckb: {
        rpc_url: ckbRpcUrl,
        ...(config.udtWhitelist || isTestnet
          ? {
              udt_whitelist: config.udtWhitelist
                ? config.udtWhitelist.map((entry) => ConfigBuilder.serializeUdtEntry(entry))
                : isTestnet
                  ? [TESTNET_RUSD_UDT]
                  : [],
            }
          : {}),
      },
      services: ['fiber', 'rpc', 'ckb'],
    };

    return stringify(configObj);
  }

  /**
   * Get the default config for a network (useful for inspection/debugging).
   */
  static getDefaults(network: 'testnet' | 'mainnet') {
    return {
      bootnodes: network === 'testnet' ? TESTNET_BOOTNODES : MAINNET_BOOTNODES,
      ckbRpcUrl: network === 'testnet' ? TESTNET_CKB_RPC : MAINNET_CKB_RPC,
      scripts: FIBER_SCRIPTS_BY_NETWORK[network],
    };
  }

  private static serializeUdtEntry(entry: UdtWhitelistEntry): Record<string, unknown> {
    const result: Record<string, unknown> = {
      name: entry.name,
      script: entry.script,
      cell_deps: entry.cellDeps.map((dep) => {
        if (dep.typeId) {
          return { type_id: dep.typeId };
        }
        if (dep.cellDep) {
          return {
            cell_dep: {
              out_point: {
                tx_hash: dep.cellDep.outPoint.txHash,
                index: dep.cellDep.outPoint.index,
              },
              dep_type: dep.cellDep.depType,
            },
          };
        }
        return {};
      }),
    };

    if (entry.autoAcceptAmount) {
      result.auto_accept_amount = BigInt(entry.autoAcceptAmount);
    }

    return result;
  }
}
