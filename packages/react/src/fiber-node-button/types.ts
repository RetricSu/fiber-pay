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
import type { FiberNodeButtonPanelState } from './use-panel-state.js';

export const ONE_CKB_SHANNONS = '0x5f5e100';

export type ChannelFilter = 'active' | 'pending' | 'closed' | 'all';
export type PanelTab = string;
export type DefaultPanelTab = 'workbench' | 'channels' | 'diagnostics';
export type FiberNodeButtonTabId = PanelTab;
export type GraphChannelInfo = GraphChannelsResult['channels'][number];
export type GraphNodeInfo = GraphNodesResult['nodes'][number];
export type PeerInfo = ListPeersResult['peers'][number];
export type FiberNodeButtonI18n = (
  key: string,
  fallback: string,
  vars?: Record<string, string | number>,
) => string;

export type FiberNodeButtonActionId =
  | 'open-channel'
  | 'create-invoice'
  | 'pay-invoice'
  | 'close-channel'
  | 'force-close-channel';

export interface FiberNodeButtonActionDefaultPropsBase {
  label: string;
  loadingLabel?: string;
  disabled: boolean;
  loading?: boolean;
  onTrigger: () => void | Promise<void>;
}

export interface FiberNodeButtonOpenChannelActionDefaultProps
  extends FiberNodeButtonActionDefaultPropsBase {
  id: 'open-channel';
}

export interface FiberNodeButtonCreateInvoiceActionDefaultProps
  extends FiberNodeButtonActionDefaultPropsBase {
  id: 'create-invoice';
}

export interface FiberNodeButtonPayInvoiceActionDefaultProps
  extends FiberNodeButtonActionDefaultPropsBase {
  id: 'pay-invoice';
}

export interface FiberNodeButtonCloseChannelActionDefaultProps
  extends FiberNodeButtonActionDefaultPropsBase {
  id: 'close-channel';
  channelId?: string;
}

export interface FiberNodeButtonForceCloseChannelActionDefaultProps
  extends FiberNodeButtonActionDefaultPropsBase {
  id: 'force-close-channel';
  channelId?: string;
}

export type FiberNodeButtonActionDefaultProps =
  | FiberNodeButtonOpenChannelActionDefaultProps
  | FiberNodeButtonCreateInvoiceActionDefaultProps
  | FiberNodeButtonPayInvoiceActionDefaultProps
  | FiberNodeButtonCloseChannelActionDefaultProps
  | FiberNodeButtonForceCloseChannelActionDefaultProps;

export interface FiberNodeButtonTabActions {
  openChannel: () => Promise<void>;
  createInvoice: () => Promise<void>;
  payInvoice: () => Promise<void>;
  closeChannel: (channelId: string) => Promise<void>;
  forceCloseChannel: (channelId: string) => Promise<void>;
}

export interface FiberNodeButtonTabContext {
  fiber: UseFiberNodeResult;
  state: FiberNodeButtonPanelState;
  externalFundingEnabled: boolean;
  t: FiberNodeButtonI18n;
  actions: FiberNodeButtonTabActions;
}

export interface FiberNodeButtonTabConfig {
  id: FiberNodeButtonTabId;
  label?: string | ((t: FiberNodeButtonI18n) => string);
  hidden?: boolean;
  render?: (context: FiberNodeButtonTabContext) => ReactNode;
}

export interface FiberNodeButtonRenderActionContext {
  id: FiberNodeButtonActionId;
  defaultProps: FiberNodeButtonActionDefaultProps;
  fiber: UseFiberNodeResult;
  t: FiberNodeButtonI18n;
}

export type FiberNodeButtonRenderAction = (
  context: FiberNodeButtonRenderActionContext,
) => ReactNode | undefined;

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
  tabs?: ReadonlyArray<FiberNodeButtonTabConfig>;
  renderTabContent?: (
    tabId: FiberNodeButtonTabId,
    context: FiberNodeButtonTabContext,
  ) => ReactNode | undefined;
  renderAction?: FiberNodeButtonRenderAction;
  t?: FiberNodeButtonI18n;
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
  tabs?: ReadonlyArray<FiberNodeButtonTabConfig>;
  renderTabContent?: (
    tabId: FiberNodeButtonTabId,
    context: FiberNodeButtonTabContext,
  ) => ReactNode | undefined;
  renderAction?: FiberNodeButtonRenderAction;
  t?: FiberNodeButtonI18n;
}

export const TAB_ITEMS: ReadonlyArray<{ id: DefaultPanelTab; label: string }> = [
  { id: 'workbench', label: 'Workbench' },
  { id: 'channels', label: 'Channels' },
  { id: 'diagnostics', label: 'Diagnostics' },
];

export const DEFAULT_TAB_IDS: ReadonlyArray<DefaultPanelTab> = [
  'workbench',
  'channels',
  'diagnostics',
];

export const FILTER_ITEMS: ReadonlyArray<ChannelFilter> = ['active', 'pending', 'closed', 'all'];
