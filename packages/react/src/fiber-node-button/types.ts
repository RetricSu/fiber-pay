import type {
  CellDep,
  FiberBrowserNode,
  FiberWasmFactory,
  GraphChannelsResult,
  GraphNodesResult,
  HexString,
  ListPeersResult,
  NodeInfoResult,
  Script,
} from '@fiber-pay/sdk/browser';
import type { CSSProperties, ReactNode } from 'react';
import type { ConnectButtonConnectedDropdownContext, ConnectStrategy } from '../connect-button.js';
import type { UseFiberNodeOptions, UseFiberNodeResult } from '../use-fiber-node.js';

export const ONE_CKB_SHANNONS = '0x5f5e100';

export type ChannelFilter = 'active' | 'pending' | 'closed' | 'all';
export type PanelTab = 'workbench' | 'channels' | 'diagnostics';
export type GraphChannelInfo = GraphChannelsResult['channels'][number];
export type GraphNodeInfo = GraphNodesResult['nodes'][number];
export type PeerInfo = ListPeersResult['peers'][number];

export interface FiberNodeButtonExternalFundingResolved {
  signFundingTx: (txForSigner: unknown) => Promise<unknown>;
  shutdownScript?: Script;
  fundingLockScript?: Script;
  fundingLockScriptCellDeps?: CellDep[];
  ckbRpcUrl?: string;
}

export interface FiberNodeButtonExternalFundingResolverContext {
  node: FiberBrowserNode;
  pubkey: HexString;
  fundingAmountCkb: string;
}

export interface FiberNodeButtonExternalFundingConfig {
  enabled: boolean;
  resolve: (
    context: FiberNodeButtonExternalFundingResolverContext,
  ) => Promise<FiberNodeButtonExternalFundingResolved>;
}

export interface FiberNodeButtonConnectorSectionContext {
  fiber: UseFiberNodeResult;
  externalFundingEnabled: boolean;
  isOpeningChannel: boolean;
}

export interface FiberNodeButtonProps {
  network?: 'testnet' | 'mainnet';
  fiber?: UseFiberNodeResult;
  strategy?: ConnectStrategy;
  externalWallet?: boolean;
  password?: string;
  walletId?: string;
  passkeyUsername?: string;
  wasmFactory?: FiberWasmFactory;
  nodeConfig?: UseFiberNodeOptions['nodeConfig'];
  className?: string;
  style?: CSSProperties;
  dropdownStyle?: CSSProperties;
  onConnect?: (node: FiberBrowserNode, nodeInfo: NodeInfoResult) => void;
  onDisconnect?: () => void;
  onError?: (error: string) => void;
  onLog?: (message: string) => void;
  initialPeerPubkey?: string;
  initialPeerAddress?: string;
  initialFundingAmountCkb?: string;
  externalFunding?: FiberNodeButtonExternalFundingConfig;
  renderConnectorSection?: (context: FiberNodeButtonConnectorSectionContext) => ReactNode;
}

export interface FiberNodeButtonPanelProps {
  dropdownContext: ConnectButtonConnectedDropdownContext;
  network: 'testnet' | 'mainnet';
  fiber: UseFiberNodeResult;
  onLog?: (message: string) => void;
  onError?: (error: string) => void;
  initialPeerPubkey: string;
  initialPeerAddress: string;
  initialFundingAmountCkb: string;
  externalFunding?: FiberNodeButtonExternalFundingConfig;
  renderConnectorSection?: (context: FiberNodeButtonConnectorSectionContext) => ReactNode;
}

export const TAB_ITEMS: ReadonlyArray<{ id: PanelTab; label: string }> = [
  { id: 'workbench', label: 'Workbench' },
  { id: 'channels', label: 'Channels' },
  { id: 'diagnostics', label: 'Diagnostics' },
];

export const FILTER_ITEMS: ReadonlyArray<ChannelFilter> = ['active', 'pending', 'closed', 'all'];
