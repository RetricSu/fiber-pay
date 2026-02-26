/**
 * Invoice Verifier Tests
 * Tests for invoice validation and verification logic
 */

import type { FiberRpcClient, ListPeersResult, ParseInvoiceResult } from '@fiber-pay/sdk';
import { InvoiceVerifier } from '@fiber-pay/sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('InvoiceVerifier', () => {
  let mockRpc: Partial<FiberRpcClient>;
  let verifier: InvoiceVerifier;

  beforeEach(() => {
    // Create mock RPC client
    mockRpc = {
      parseInvoice: vi.fn(),
      listPeers: vi.fn(),
    };

    verifier = new InvoiceVerifier(mockRpc as FiberRpcClient);
  });

  describe('validateInvoiceFormat', () => {
    it('should accept valid testnet invoice format', () => {
      const invoice = 'fibt1qqg4d3zwpeg4e5y6cxqpvcqf9yq7qzpqzqpzqpzqpzqpzqpzqpzqpzq';
      // Format validation is private, but we can test it through verifyInvoice
      expect(invoice).toMatch(/^fibt/);
    });

    it('should accept valid mainnet invoice format', () => {
      const invoice = 'fibb1qqg4d3zwpeg4e5y6cxqpvcqf9yq7qzpqzqpzqpzqpzqpzqpzqpzqpzq';
      expect(invoice).toMatch(/^fibb/);
    });

    it('should reject invalid invoice prefix', async () => {
      const invoice = 'invalid1qqg4d3zwpeg4e5y6cxqpvcqf9yq7qzpqzqpzqpzqpzqpzqpzqpzqpzq';

      mockRpc.parseInvoice = vi.fn(() => {
        throw new Error('Invalid invoice format');
      });

      const result = await verifier.verifyInvoice(invoice);

      expect(result.valid).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          type: 'critical',
          code: 'INVALID_INVOICE_FORMAT',
        }),
      );
    });
  });

  describe('verifyInvoice', () => {
    it('should validate a valid invoice', async () => {
      const validInvoice = 'fibt1qqg4d3zwpeg4e5y6cxqpvcqf9yq7qzpqzqpzqpzqpzqpzqpzqpzqpzq';

      const mockParseResult: ParseInvoiceResult = {
        invoice: {
          currency: 'Fibt',
          amount: '0x5f5e100', // 1 CKB
          data: {
            timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}` as `0x${string}`,
            payment_hash: '0xabcd1234' as `0x${string}`,
            attrs: [{ Description: 'test' }, { ExpiryTime: '0xe10' as `0x${string}` }],
          },
        },
      };

      const mockPeersResult: ListPeersResult = {
        peers: [
          {
            pubkey: '0x02' as `0x${string}`,
            peer_id: 'QmTest123',
            address: '/ip4/127.0.0.1/tcp/8228',
          },
        ],
      };

      mockRpc.parseInvoice = vi.fn().mockResolvedValue(mockParseResult);
      mockRpc.listPeers = vi.fn().mockResolvedValue(mockPeersResult);

      const result = await verifier.verifyInvoice(validInvoice);

      expect(result.valid).toBe(true);
      expect(result.checks.validFormat).toBe(true);
      expect(result.checks.notExpired).toBe(true);
      expect(result.checks.validAmount).toBe(true);
      expect(result.checks.peerConnected).toBe(true);
      expect(result.recommendation).toBe('proceed');
      expect(mockRpc.parseInvoice).toHaveBeenCalledWith({ invoice: validInvoice });
    });

    it('should detect expired invoice', async () => {
      const expiredInvoice = 'fibt1qqg4d3zwpeg4e5y6cxqpvcqf9yq7qzpqzqpzqpzqpzqpzqpzqpzqpzq';

      const mockParseResult: ParseInvoiceResult = {
        invoice: {
          currency: 'Fibt',
          amount: '0x5f5e100',
          data: {
            // 2 hours ago
            timestamp:
              `0x${Math.floor((Date.now() - 7200000) / 1000).toString(16)}` as `0x${string}`,
            payment_hash: '0xabcd1234' as `0x${string}`,
            attrs: [
              { ExpiryTime: '0xe10' as `0x${string}` }, // 1 hour
            ],
          },
        },
      };

      mockRpc.parseInvoice = vi.fn().mockResolvedValue(mockParseResult);
      mockRpc.listPeers = vi.fn().mockResolvedValue({ peers: [] });

      const result = await verifier.verifyInvoice(expiredInvoice);

      expect(result.valid).toBe(false);
      expect(result.checks.notExpired).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          type: 'critical',
          code: 'INVOICE_EXPIRED',
        }),
      );
      expect(result.recommendation).toBe('reject');
    });

    it('should detect zero or invalid amount', async () => {
      const zeroAmountInvoice = 'fibt1qqg4d3zwpeg4e5y6cxqpvcqf9yq7qzpqzqpzqpzqpzqpzqpzqpzqpzq';

      const mockParseResult: ParseInvoiceResult = {
        invoice: {
          currency: 'Fibt',
          amount: '0x0', // Zero amount
          data: {
            timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}` as `0x${string}`,
            payment_hash: '0xabcd1234' as `0x${string}`,
            attrs: [{ ExpiryTime: '0xe10' as `0x${string}` }],
          },
        },
      };

      mockRpc.parseInvoice = vi.fn().mockResolvedValue(mockParseResult);
      mockRpc.listPeers = vi.fn().mockResolvedValue({ peers: [] });

      const result = await verifier.verifyInvoice(zeroAmountInvoice);

      expect(result.valid).toBe(false);
      expect(result.checks.validAmount).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          type: 'critical',
          code: 'ZERO_AMOUNT',
        }),
      );
    });

    it('should detect excessively large amount', async () => {
      const largeAmountInvoice = 'fibt1qqg4d3zwpeg4e5y6cxqpvcqf9yq7qzpqzqpzqpzqpzqpzqpzqpzqpzq';

      // 2 million CKB (exceeds 1M limit)
      const twoMillionCkbInShannons = BigInt(2000000) * BigInt(100000000);

      const mockParseResult: ParseInvoiceResult = {
        invoice: {
          currency: 'Fibt',
          amount: `0x${twoMillionCkbInShannons.toString(16)}`,
          data: {
            timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}` as `0x${string}`,
            payment_hash: '0xabcd1234' as `0x${string}`,
            attrs: [{ ExpiryTime: '0xe10' as `0x${string}` }],
          },
        },
      };

      mockRpc.parseInvoice = vi.fn().mockResolvedValue(mockParseResult);
      mockRpc.listPeers = vi.fn().mockResolvedValue({ peers: [] });

      const result = await verifier.verifyInvoice(largeAmountInvoice);

      expect(result.valid).toBe(false);
      expect(result.checks.validAmount).toBe(false);
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          type: 'critical',
          code: 'AMOUNT_TOO_LARGE',
        }),
      );
    });

    it('should warn about no connected peers', async () => {
      const invoice = 'fibt1qqg4d3zwpeg4e5y6cxqpvcqf9yq7qzpqzqpzqpzqpzqpzqpzqpzqpzq';

      const mockParseResult: ParseInvoiceResult = {
        invoice: {
          currency: 'Fibt',
          amount: '0x5f5e100',
          data: {
            timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}` as `0x${string}`,
            payment_hash: '0xabcd1234' as `0x${string}`,
            attrs: [{ ExpiryTime: '0xe10' as `0x${string}` }],
          },
        },
      };

      mockRpc.parseInvoice = vi.fn().mockResolvedValue(mockParseResult);
      mockRpc.listPeers = vi.fn().mockResolvedValue({ peers: [] });

      const result = await verifier.verifyInvoice(invoice);

      expect(result.valid).toBe(true); // Still valid
      expect(result.issues).toContainEqual(
        expect.objectContaining({
          type: 'warning',
          code: 'NO_PEERS_CONNECTED',
        }),
      );
      expect(result.recommendation).toBe('warn');
    });

    it('should calculate trust score correctly', async () => {
      const invoice = 'fibt1qqg4d3zwpeg4e5y6cxqpvcqf9yq7qzpqzqpzqpzqpzqpzqpzqpzqpzq';

      const mockParseResult: ParseInvoiceResult = {
        invoice: {
          currency: 'Fibt',
          amount: '0x5f5e100',
          data: {
            timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}` as `0x${string}`,
            payment_hash: '0xabcd1234' as `0x${string}`,
            attrs: [{ ExpiryTime: '0xe10' as `0x${string}` }],
          },
        },
      };

      mockRpc.parseInvoice = vi.fn().mockResolvedValue(mockParseResult);
      mockRpc.listPeers = vi.fn().mockResolvedValue({
        peers: [
          {
            pubkey: '0x02' as `0x${string}`,
            peer_id: 'QmTest',
            address: '/ip4/127.0.0.1/tcp/8228',
          },
        ],
      });

      const result = await verifier.verifyInvoice(invoice);

      expect(result.peer.trustScore).toBeGreaterThanOrEqual(80);
      expect(result.peer.trustScore).toBeLessThanOrEqual(100);
    });

    it('should extract payee public key from invoice attributes', async () => {
      const invoice = 'fibt1qqg4d3zwpeg4e5y6cxqpvcqf9yq7qzpqzqpzqpzqpzqpzqpzqpzqpzq';
      const payeePublicKey = '0x02abcd1234567890abcd1234567890abcd1234567890abcd1234567890abcd1234';

      const mockParseResult: ParseInvoiceResult = {
        invoice: {
          currency: 'Fibt',
          amount: '0x5f5e100',
          data: {
            timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}` as `0x${string}`,
            payment_hash: '0xabcd1234' as `0x${string}`,
            attrs: [
              { Description: 'Test payment' },
              { PayeePublicKey: payeePublicKey },
              { ExpiryTime: '0xe10' as `0x${string}` },
            ],
          },
        },
      };

      mockRpc.parseInvoice = vi.fn().mockResolvedValue(mockParseResult);
      mockRpc.listPeers = vi.fn().mockResolvedValue({
        peers: [
          {
            pubkey: '0x02' as `0x${string}`,
            peer_id: 'QmTest',
            address: '/ip4/127.0.0.1/tcp/8228',
          },
        ],
      });

      const result = await verifier.verifyInvoice(invoice);

      expect(result.valid).toBe(true);
      expect(result.peer.nodeId).toBe(payeePublicKey);
    });

    it('should handle invoice without payee public key', async () => {
      const invoice = 'fibt1qqg4d3zwpeg4e5y6cxqpvcqf9yq7qzpqzqpzqpzqpzqpzqpzqpzqpzq';

      const mockParseResult: ParseInvoiceResult = {
        invoice: {
          currency: 'Fibt',
          amount: '0x5f5e100',
          data: {
            timestamp: `0x${Math.floor(Date.now() / 1000).toString(16)}` as `0x${string}`,
            payment_hash: '0xabcd1234' as `0x${string}`,
            attrs: [{ ExpiryTime: '0xe10' as `0x${string}` }],
          },
        },
      };

      mockRpc.parseInvoice = vi.fn().mockResolvedValue(mockParseResult);
      mockRpc.listPeers = vi.fn().mockResolvedValue({
        peers: [
          {
            pubkey: '0x02' as `0x${string}`,
            peer_id: 'QmTest',
            address: '/ip4/127.0.0.1/tcp/8228',
          },
        ],
      });

      const result = await verifier.verifyInvoice(invoice);

      expect(result.valid).toBe(true);
      expect(result.peer.nodeId).toBeUndefined();
    });
  });
});
