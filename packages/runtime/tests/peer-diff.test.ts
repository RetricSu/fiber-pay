import type { PeerInfo } from '@fiber-pay/sdk';
import { describe, expect, it } from 'vitest';
import { diffPeers } from '../src/diff/peer-diff.js';

describe('diffPeers', () => {
  it('detects connect and disconnect events', () => {
    const previous: PeerInfo[] = [
      { peer_id: 'peer-1', pubkey: '0x1', address: '/ip4/127.0.0.1/tcp/1000' },
      { peer_id: 'peer-2', pubkey: '0x2', address: '/ip4/127.0.0.1/tcp/2000' },
    ];

    const current: PeerInfo[] = [
      { peer_id: 'peer-2', pubkey: '0x2', address: '/ip4/127.0.0.1/tcp/2000' },
      { peer_id: 'peer-3', pubkey: '0x3', address: '/ip4/127.0.0.1/tcp/3000' },
    ];

    const changes = diffPeers(previous, current);

    expect(changes.find((event) => event.type === 'peer_disconnected')?.peer.peer_id).toBe(
      'peer-1',
    );
    expect(changes.find((event) => event.type === 'peer_connected')?.peer.peer_id).toBe('peer-3');
  });
});
