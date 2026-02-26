import { describe, expect, it } from 'vitest';
import {
  buildMultiaddr,
  buildMultiaddrFromNodeId,
  buildMultiaddrFromRpcUrl,
  ckbToShannons,
  fromHex,
  nodeIdToPeerId,
  randomBytes32,
  shannonsToCkb,
  toHex,
} from '../src/utils.js';

describe('RPC Utilities', () => {
  describe('toHex', () => {
    it('should convert number to hex', () => {
      expect(toHex(255)).toBe('0xff');
      expect(toHex(0)).toBe('0x0');
      expect(toHex(100000000)).toBe('0x5f5e100');
    });

    it('should convert bigint to hex', () => {
      expect(toHex(BigInt('100000000000'))).toBe('0x174876e800');
    });
  });

  describe('fromHex', () => {
    it('should convert hex to bigint', () => {
      expect(fromHex('0xff')).toBe(255n);
      expect(fromHex('0x0')).toBe(0n);
      expect(fromHex('0x5f5e100')).toBe(100000000n);
    });
  });

  describe('ckbToShannons', () => {
    it('should convert CKB to shannons hex', () => {
      expect(ckbToShannons(1)).toBe('0x5f5e100'); // 1 CKB = 100,000,000 shannons
      expect(ckbToShannons(10)).toBe('0x3b9aca00');
      expect(ckbToShannons(0.5)).toBe('0x2faf080');
    });

    it('should handle string input', () => {
      expect(ckbToShannons('1')).toBe('0x5f5e100');
      expect(ckbToShannons('100.5')).toBe('0x25706d480'); // 100.5 CKB = 10,050,000,000 shannons
    });
  });

  describe('shannonsToCkb', () => {
    it('should convert shannons hex to CKB', () => {
      expect(shannonsToCkb('0x5f5e100')).toBe(1);
      expect(shannonsToCkb('0x3b9aca00')).toBe(10);
    });
  });

  describe('randomBytes32', () => {
    it('should generate valid 32-byte hex string', () => {
      const result = randomBytes32();

      expect(result).toMatch(/^0x[0-9a-f]{64}$/);
    });

    it('should generate unique values', () => {
      const values = new Set<string>();
      for (let i = 0; i < 100; i++) {
        values.add(randomBytes32());
      }
      expect(values.size).toBe(100);
    });
  });

  describe('nodeIdToPeerId', () => {
    it('should convert compressed pubkey hex to libp2p peer id', async () => {
      const nodeId = '0x03f56f0e6f2aa14f04f3b8e4b6e8028f8e4668fe24d6aeb67d9387f6a92f1a0f9a';
      const peerIdA = await nodeIdToPeerId(nodeId);
      const peerIdB = await nodeIdToPeerId(nodeId);

      expect(peerIdA).toBe(peerIdB);
      expect(peerIdA).toMatch(/^Qm[1-9A-HJ-NP-Za-km-z]{44}$/);
    });

    it('should reject invalid node id format', async () => {
      await expect(nodeIdToPeerId('not-hex')).rejects.toThrow('Invalid node id');
      await expect(nodeIdToPeerId('0x1234')).rejects.toThrow('expected 33-byte compressed pubkey');
    });
  });

  describe('buildMultiaddr helpers', () => {
    it('should build canonical multiaddr from address + peer id', () => {
      const addr = '/ip4/127.0.0.1/tcp/8228';
      const peerId = 'QmNT9LSP5TBkD7Zbazg3gHby495awqeMeEqUgvdz4tNU9M';
      expect(buildMultiaddr(addr, peerId)).toBe(
        '/ip4/127.0.0.1/tcp/8228/p2p/QmNT9LSP5TBkD7Zbazg3gHby495awqeMeEqUgvdz4tNU9M',
      );
    });

    it('should replace existing p2p suffix', () => {
      const addr = '/ip4/127.0.0.1/tcp/8228/p2p/QmOldPeer';
      const peerId = 'QmNewPeer';
      expect(buildMultiaddr(addr, peerId)).toBe('/ip4/127.0.0.1/tcp/8228/p2p/QmNewPeer');
    });

    it('should build multiaddr directly from node id', async () => {
      const nodeId = '0x03f56f0e6f2aa14f04f3b8e4b6e8028f8e4668fe24d6aeb67d9387f6a92f1a0f9a';
      const addr = '/ip4/127.0.0.1/tcp/8228';
      const multiaddr = await buildMultiaddrFromNodeId(addr, nodeId);

      expect(multiaddr).toMatch(
        /^\/ip4\/127\.0\.0\.1\/tcp\/8228\/p2p\/Qm[1-9A-HJ-NP-Za-km-z]{44}$/,
      );
    });

    it('should infer multiaddr from rpc url + peer id', () => {
      const peerId = 'QmNT9LSP5TBkD7Zbazg3gHby495awqeMeEqUgvdz4tNU9M';
      const multiaddr = buildMultiaddrFromRpcUrl('http://127.0.0.1:8227', peerId);
      expect(multiaddr).toBe(
        '/ip4/127.0.0.1/tcp/8228/p2p/QmNT9LSP5TBkD7Zbazg3gHby495awqeMeEqUgvdz4tNU9M',
      );
    });
  });
});
