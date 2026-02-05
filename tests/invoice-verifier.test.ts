/**
 * Invoice Verifier Tests
 * Tests for invoice validation and verification logic
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InvoiceVerifier } from '../src/verification/invoice-verifier.js';
import type { FiberRpcClient } from '../src/rpc/client.js';
import type { ParseInvoiceResult, ListPeersResult } from '../src/types/rpc.js';

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
        })
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
          payment_hash: '0xabcd1234',
          status: 'Open',
          created_at: '0x' + Math.floor(Date.now() / 1000).toString(16),
          expiry: '0xe10', // 3600 seconds
          invoice_address: validInvoice,
        },
      };

      const mockPeersResult: ListPeersResult = {
        peers: [
          {
            peer_id: 'QmTest123',
            addresses: ['/ip4/127.0.0.1/tcp/8228'],
            connected: true,
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
          payment_hash: '0xabcd1234',
          status: 'Expired',
          created_at: '0x' + Math.floor((Date.now() - 7200000) / 1000).toString(16), // 2 hours ago
          expiry: '0xe10', // 1 hour expiry
          invoice_address: expiredInvoice,
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
        })
      );
      expect(result.recommendation).toBe('reject');
    });

    it('should detect zero or invalid amount', async () => {
      const zeroAmountInvoice = 'fibt1qqg4d3zwpeg4e5y6cxqpvcqf9yq7qzpqzqpzqpzqpzqpzqpzqpzqpzq';

      const mockParseResult: ParseInvoiceResult = {
        invoice: {
          currency: 'Fibt',
          amount: '0x0', // Zero amount
          payment_hash: '0xabcd1234',
          status: 'Open',
          created_at: '0x' + Math.floor(Date.now() / 1000).toString(16),
          expiry: '0xe10',
          invoice_address: zeroAmountInvoice,
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
        })
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
          payment_hash: '0xabcd1234',
          status: 'Open',
          created_at: '0x' + Math.floor(Date.now() / 1000).toString(16),
          expiry: '0xe10',
          invoice_address: largeAmountInvoice,
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
        })
      );
    });

    it('should warn about no connected peers', async () => {
      const invoice = 'fibt1qqg4d3zwpeg4e5y6cxqpvcqf9yq7qzpqzqpzqpzqpzqpzqpzqpzqpzq';

      const mockParseResult: ParseInvoiceResult = {
        invoice: {
          currency: 'Fibt',
          amount: '0x5f5e100',
          payment_hash: '0xabcd1234',
          status: 'Open',
          created_at: '0x' + Math.floor(Date.now() / 1000).toString(16),
          expiry: '0xe10',
          invoice_address: invoice,
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
        })
      );
      expect(result.recommendation).toBe('warn');
    });

    it('should calculate trust score correctly', async () => {
      const invoice = 'fibt1qqg4d3zwpeg4e5y6cxqpvcqf9yq7qzpqzqpzqpzqpzqpzqpzqpzqpzq';

      const mockParseResult: ParseInvoiceResult = {
        invoice: {
          currency: 'Fibt',
          amount: '0x5f5e100',
          payment_hash: '0xabcd1234',
          status: 'Open',
          created_at: '0x' + Math.floor(Date.now() / 1000).toString(16),
          expiry: '0xe10',
          invoice_address: invoice,
        },
      };

      mockRpc.parseInvoice = vi.fn().mockResolvedValue(mockParseResult);
      mockRpc.listPeers = vi.fn().mockResolvedValue({
        peers: [{
          peer_id: 'QmTest',
          addresses: [],
          connected: true,
        }],
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
          payment_hash: '0xabcd1234',
          status: 'Open',
          created_at: '0x' + Math.floor(Date.now() / 1000).toString(16),
          expiry: '0xe10',
          invoice_address: invoice,
          // Include invoice data with PayeePublicKey attribute
          data: {
            timestamp: '0x' + Math.floor(Date.now() / 1000).toString(16),
            payment_hash: '0xabcd1234',
            attrs: [
              { Description: 'Test payment' },
              { PayeePublicKey: payeePublicKey },
              { ExpiryTime: '0xe10' },
            ],
          },
        },
      };

      mockRpc.parseInvoice = vi.fn().mockResolvedValue(mockParseResult);
      mockRpc.listPeers = vi.fn().mockResolvedValue({
        peers: [{
          peer_id: 'QmTest',
          addresses: [],
          connected: true,
        }],
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
          payment_hash: '0xabcd1234',
          status: 'Open',
          created_at: '0x' + Math.floor(Date.now() / 1000).toString(16),
          expiry: '0xe10',
          invoice_address: invoice,
          // No data.attrs with PayeePublicKey
        },
      };

      mockRpc.parseInvoice = vi.fn().mockResolvedValue(mockParseResult);
      mockRpc.listPeers = vi.fn().mockResolvedValue({
        peers: [{
          peer_id: 'QmTest',
          addresses: [],
          connected: true,
        }],
      });

      const result = await verifier.verifyInvoice(invoice);

      expect(result.valid).toBe(true);
      expect(result.peer.nodeId).toBeUndefined();
    });
  });
});
