/**
 * ConfigBuilder — Generates YAML config strings for Fiber WASM nodes
 *
 * Encapsulates the complex YAML configuration that @nervosnetwork/fiber-js
 * requires, providing a TypeScript-friendly API with sensible defaults
 * for testnet and mainnet.
 */

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

/**
 * Testnet Fiber on-chain scripts from fnn v0.10.0 config/testnet/config.yml.
 */
const TESTNET_FIBER_SCRIPTS = [
  {
    name: 'FundingLock',
    script: {
      code_hash: '0x6c67887fe201ee0c7853f1682c0b77c0e6214044c156c7558269390a8afa6d7c',
      hash_type: 'type',
      args: '0x',
    },
    cell_deps: [
      {
        type_id: {
          code_hash: '0x00000000000000000000000000000000000000000000000000545950455f4944',
          hash_type: 'type',
          args: '0x3cb7c0304fe53f75bb5727e2484d0beae4bd99d979813c6fc97c3cca569f10f6',
        },
      },
      {
        cell_dep: {
          out_point: {
            tx_hash: '0x12c569a258dd9c5bd99f632bb8314b1263b90921ba31496467580d6b79dd14a7',
            index: '0x0',
          },
          dep_type: 'code',
        },
      },
    ],
  },
  {
    name: 'CommitmentLock',
    script: {
      code_hash: '0x740dee83f87c6f309824d8fd3fbdd3c8380ee6fc9acc90b1a748438afcdf81d8',
      hash_type: 'type',
      args: '0x',
    },
    cell_deps: [
      {
        type_id: {
          code_hash: '0x00000000000000000000000000000000000000000000000000545950455f4944',
          hash_type: 'type',
          args: '0xf7e458887495cf70dd30d1543cad47dc1dfe9d874177bf19291e4db478d5751b',
        },
      },
      {
        cell_dep: {
          out_point: {
            tx_hash: '0x12c569a258dd9c5bd99f632bb8314b1263b90921ba31496467580d6b79dd14a7',
            index: '0x0',
          },
          dep_type: 'code',
        },
      },
    ],
  },
] as const;

const MAINNET_FIBER_SCRIPTS = [
  {
    name: 'FundingLock',
    script: {
      code_hash: '0xe45b1f8f21bff23137035a3ab751d75b36a981deec3e7820194b9c042967f4f1',
      hash_type: 'type',
      args: '0x',
    },
    cell_deps: [
      {
        type_id: {
          code_hash: '0x00000000000000000000000000000000000000000000000000545950455f4944',
          hash_type: 'type',
          args: '0x64818d82a372312fb007c480391e1b9759d21b2c7f7959b9c177d72cdc243394',
        },
      },
      {
        cell_dep: {
          out_point: {
            tx_hash: '0x95006eee7b4c0c8ad66e0514c88ed0ae43fc8db27793427de86a348ec720b9d6',
            index: '0x0',
          },
          dep_type: 'code',
        },
      },
    ],
  },
  {
    name: 'CommitmentLock',
    script: {
      code_hash: '0x2d45c4d3ed3e942f1945386ee82a5d1b7e4bb16d7fe1ab015421174ab747406c',
      hash_type: 'type',
      args: '0x',
    },
    cell_deps: [
      {
        type_id: {
          code_hash: '0x00000000000000000000000000000000000000000000000000545950455f4944',
          hash_type: 'type',
          args: '0xdb16e6dcb17f670e5fb7c556d81e522ec5edb069ad2fa3e898e7ccea6c26a39f',
        },
      },
      {
        cell_dep: {
          out_point: {
            tx_hash: '0x95006eee7b4c0c8ad66e0514c88ed0ae43fc8db27793427de86a348ec720b9d6',
            index: '0x0',
          },
          dep_type: 'code',
        },
      },
    ],
  },
] as const;

/** Network-specific contracts mirrored from fnn v0.10.0 config/{network}/config.yml. */
const FIBER_SCRIPTS_BY_NETWORK = {
  testnet: TESTNET_FIBER_SCRIPTS,
  mainnet: MAINNET_FIBER_SCRIPTS,
} as const;

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
