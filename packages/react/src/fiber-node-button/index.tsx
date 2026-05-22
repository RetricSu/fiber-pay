import { useCallback } from 'react';
import { ConnectButton, type ConnectButtonConnectedDropdownContext } from '../connect-button.js';
import { useFiberNode } from '../use-fiber-node.js';
import { FiberNodeButtonPanel } from './panel.js';
import type { FiberNodeButtonProps } from './types.js';

export type {
  FiberNodeButtonConnectorSectionContext,
  FiberNodeButtonExternalFundingConfig,
  FiberNodeButtonExternalFundingResolved,
  FiberNodeButtonExternalFundingResolverContext,
  FiberNodeButtonProps,
} from './types.js';

export function FiberNodeButton(props: FiberNodeButtonProps) {
  const {
    network = 'testnet',
    fiber: externalFiber,
    strategy = 'passkey',
    externalWallet = false,
    password,
    walletId,
    passkeyUsername = 'User',
    wasmFactory,
    nodeConfig,
    className,
    style,
    dropdownStyle,
    onConnect,
    onDisconnect,
    onError,
    onLog,
    initialPeerPubkey = '',
    initialPeerAddress = '',
    initialFundingAmountCkb = '1000',
    externalFunding,
    renderConnectorSection,
  } = props;

  const managedFiber = useFiberNode({
    network,
    walletId,
    wasmFactory,
    nodeConfig,
    externalWallet,
    enabled: !externalFiber,
  });

  const fiber = externalFiber ?? managedFiber;

  const handleConnectButtonError = useCallback(
    (error: string) => {
      onError?.(error);
    },
    [onError],
  );

  const renderDropdown = useCallback(
    (dropdownContext: ConnectButtonConnectedDropdownContext) => (
      <FiberNodeButtonPanel
        dropdownContext={dropdownContext}
        network={network}
        fiber={fiber}
        onLog={onLog}
        onError={onError}
        initialPeerPubkey={initialPeerPubkey}
        initialPeerAddress={initialPeerAddress}
        initialFundingAmountCkb={initialFundingAmountCkb}
        externalFunding={externalFunding}
        renderConnectorSection={renderConnectorSection}
      />
    ),
    [
      externalFunding,
      fiber,
      initialFundingAmountCkb,
      initialPeerAddress,
      initialPeerPubkey,
      network,
      onError,
      onLog,
      renderConnectorSection,
    ],
  );

  return (
    <ConnectButton
      fiber={fiber}
      strategy={strategy}
      password={password}
      passkeyUsername={passkeyUsername}
      onConnect={onConnect}
      onDisconnect={onDisconnect}
      onError={handleConnectButtonError}
      className={className}
      style={style}
      dropdownStyle={{ maxWidth: 460, width: 'calc(100vw - 1rem)', ...dropdownStyle }}
      renderConnectedDropdown={renderDropdown}
    />
  );
}
