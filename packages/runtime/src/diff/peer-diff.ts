import type { PeerInfo } from '@fiber-pay/sdk';

export type PeerDiffEvent =
  | { type: 'peer_connected'; peer: PeerInfo }
  | { type: 'peer_disconnected'; peer: PeerInfo };

export function diffPeers(previous: PeerInfo[], current: PeerInfo[]): PeerDiffEvent[] {
  const events: PeerDiffEvent[] = [];
  const prevByPubkey = new Map(previous.map((peer) => [peer.pubkey, peer]));
  const currByPubkey = new Map(current.map((peer) => [peer.pubkey, peer]));

  for (const [pubkey, peer] of currByPubkey.entries()) {
    if (!prevByPubkey.has(pubkey)) {
      events.push({ type: 'peer_connected', peer });
    }
  }

  for (const [pubkey, peer] of prevByPubkey.entries()) {
    if (!currByPubkey.has(pubkey)) {
      events.push({ type: 'peer_disconnected', peer });
    }
  }

  return events;
}
