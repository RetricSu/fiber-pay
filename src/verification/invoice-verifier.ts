/**
 * Invoice Verification Engine
 * Validates invoice legitimacy, format, cryptographic correctness, and peer connectivity
 * This ensures the agent only pays valid invoices
 */

import { createHash } from 'crypto';
import type { FiberRpcClient } from '../rpc/client.js';
import { fromHex, shannonsToCkb } from '../rpc/index.js';
import type { InvoiceInfo, HexString, InvoiceAttribute } from '../types/index.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Invoice verification result
 */
export interface InvoiceVerificationResult {
  /** Overall validity (true = safe to pay) */
  valid: boolean;
  /** Invoice parsed details */
  details: {
    paymentHash: string;
    amountCkb: number;
    expiresAt: number; // Unix timestamp
    description?: string;
    isExpired: boolean;
  };
  /** Peer information */
  peer: {
    nodeId?: string;
    isConnected: boolean;
    trustScore: number; // 0-100
  };
  /** Validation checks performed */
  checks: {
    validFormat: boolean;
    notExpired: boolean;
    validAmount: boolean;
    peerConnected: boolean;
    preimageValid?: boolean; // Only if preimage present
  };
  /** Issues found */
  issues: VerificationIssue[];
  /** Recommendation for agent */
  recommendation: 'proceed' | 'warn' | 'reject';
  /** Human-readable reason for recommendation */
  reason: string;
}

export interface VerificationIssue {
  type: 'warning' | 'critical';
  code: string;
  message: string;
}

// =============================================================================
// Invoice Verifier
// =============================================================================

export class InvoiceVerifier {
  constructor(private rpc: FiberRpcClient) {}

  /**
   * Fully validate an invoice before payment
   */
  async verifyInvoice(invoiceString: string): Promise<InvoiceVerificationResult> {
    const issues: VerificationIssue[] = [];
    const checks = {
      validFormat: false,
      notExpired: false,
      validAmount: false,
      peerConnected: false,
      preimageValid: undefined as boolean | undefined,
    };

    // 1. Validate format
    const formatCheck = this.validateInvoiceFormat(invoiceString);
    checks.validFormat = formatCheck.valid;
    if (!formatCheck.valid) {
      issues.push({
        type: 'critical',
        code: 'INVALID_INVOICE_FORMAT',
        message: formatCheck.error || 'Invoice format is invalid',
      });
    }

    let invoice: InvoiceInfo | null = null;

    // 2. Parse invoice
    if (checks.validFormat) {
      try {
        const result = await this.rpc.parseInvoice({ invoice: invoiceString });
        invoice = result.invoice;
      } catch (error) {
        issues.push({
          type: 'critical',
          code: 'PARSE_INVOICE_FAILED',
          message: `Failed to parse invoice: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
      }
    }

    // Default details if parsing failed
    const details = {
      paymentHash: invoice?.payment_hash || 'unknown',
      amountCkb: invoice && invoice.amount ? shannonsToCkb(invoice.amount) : 0,
      expiresAt: this.getExpiryTimestamp(invoice),
      description: invoice?.description,
      isExpired: invoice ? this.isInvoiceExpired(invoice) : true,
    };

    // 3. Validate not expired
    if (invoice) {
      if (!details.isExpired) {
        checks.notExpired = true;
      } else {
        issues.push({
          type: 'critical',
          code: 'INVOICE_EXPIRED',
          message: `Invoice expired at ${new Date(details.expiresAt).toISOString()}`,
        });
      }
    }

    // 4. Validate amount
    if (invoice && invoice.amount) {
      const validAmount = this.validateAmount(invoice.amount);
      checks.validAmount = validAmount.valid;
      if (!validAmount.valid) {
        issues.push({
          type: 'critical',
          code: validAmount.code || 'INVALID_AMOUNT',
          message: validAmount.message || 'Amount validation failed',
        });
      }
    }

    // 5. Check peer connectivity - verify payee is reachable
    const payeePublicKey = this.extractNodeIdFromInvoice(invoice);
    try {
      const peers = await this.rpc.listPeers();
      if (payeePublicKey) {
        // We have the payee's public key - check if they're connected or reachable
        // Note: peer_id in Fiber is derived from public key, but format may differ
        // For now, we check if we have any path to peers (routing will find the payee)
        if (peers.peers && peers.peers.length > 0) {
          checks.peerConnected = true;
        } else {
          issues.push({
            type: 'warning',
            code: 'NO_PEERS_CONNECTED',
            message: `No peers connected. Cannot route payment to payee ${payeePublicKey.slice(0, 16)}...`,
          });
        }
      } else {
        // No payee public key in invoice - just check basic connectivity
        if (peers.peers && peers.peers.length > 0) {
          checks.peerConnected = true;
        } else {
          issues.push({
            type: 'warning',
            code: 'NO_PEERS_CONNECTED',
            message: 'No peers currently connected. Payment may fail.',
          });
        }
      }
    } catch {
      issues.push({
        type: 'warning',
        code: 'PEER_CHECK_FAILED',
        message: 'Could not verify peer connectivity',
      });
    }

    // 6. Validate preimage if present
    if (invoice && invoice.payment_preimage && invoice.payment_hash) {
      const preimageValid = this.validatePreimage(invoice.payment_preimage, invoice.payment_hash);
      checks.preimageValid = preimageValid;
      if (!preimageValid) {
        issues.push({
          type: 'critical',
          code: 'PREIMAGE_MISMATCH',
          message: 'Payment preimage does not hash to the payment hash. This is a fraudulent invoice.',
        });
      }
    }

    // Determine overall validity and recommendation
    const criticalIssues = issues.filter((i) => i.type === 'critical');
    const valid = criticalIssues.length === 0;

    let recommendation: 'proceed' | 'warn' | 'reject';
    let reason: string;

    if (!valid) {
      recommendation = 'reject';
      reason = `Invoice has ${criticalIssues.length} critical issue(s): ${criticalIssues.map((i) => i.code).join(', ')}`;
    } else if (issues.length > 0) {
      recommendation = 'warn';
      reason = `Invoice is valid but has warnings: ${issues.map((i) => i.code).join(', ')}`;
    } else {
      recommendation = 'proceed';
      reason = 'Invoice is valid and safe to pay';
    }

    return {
      valid,
      details,
      peer: {
        nodeId: payeePublicKey, // Use the already-extracted payee public key
        isConnected: checks.peerConnected || issues.filter((i) => i.code === 'NO_PEERS_CONNECTED').length === 0,
        trustScore: this.calculateTrustScore(checks, issues),
      },
      checks: {
        ...checks,
        preimageValid: checks.preimageValid,
      },
      issues,
      recommendation,
      reason,
    };
  }

  /**
   * Quick format validation (regex-based, before RPC call)
   */
  private validateInvoiceFormat(invoice: string): { valid: boolean; error?: string } {
    // Invoice should be bech32-encoded and start with fibt (testnet) or fibb (mainnet)
    const invoiceRegex = /^fib[tb]{1}[a-z0-9]{50,}$/i;

    if (!invoiceRegex.test(invoice)) {
      return {
        valid: false,
        error: 'Invoice must be bech32-encoded (fibt... for testnet or fibb... for mainnet)',
      };
    }

    return { valid: true };
  }

  /**
   * Validate amount is positive and reasonable
   */
  private validateAmount(amountHex: HexString): {
    valid: boolean;
    code?: string;
    message?: string;
  } {
    try {
      const amount = fromHex(amountHex);

      if (amount <= 0n) {
        return {
          valid: false,
          code: 'ZERO_AMOUNT',
          message: 'Invoice amount must be greater than zero',
        };
      }

      // Sanity check: prevent obviously spoofed invoices
      // Max 1 million CKB (would be ~$XXX at current rates)
      const maxShannons = BigInt(1000000) * BigInt(100000000); // 1M CKB in shannons
      if (amount > maxShannons) {
        const amountCkb = Number(amount) / 1e8;
        return {
          valid: false,
          code: 'AMOUNT_TOO_LARGE',
          message: `Invoice amount (${amountCkb.toFixed(2)} CKB) exceeds reasonable maximum`,
        };
      }

      return { valid: true };
    } catch {
      return {
        valid: false,
        code: 'INVALID_AMOUNT_FORMAT',
        message: 'Could not parse invoice amount',
      };
    }
  }

  /**
   * Check if invoice has expired
   */
  private isInvoiceExpired(invoice: InvoiceInfo): boolean {
    const expiryTimestamp = this.getExpiryTimestamp(invoice);
    return Date.now() > expiryTimestamp;
  }

  /**
   * Get expiry timestamp in milliseconds
   */
  private getExpiryTimestamp(invoice: InvoiceInfo | null): number {
    if (!invoice) return 0;

    // Expiry is a duration in seconds(hex), need to add to created_at
    if (invoice.expiry && invoice.created_at) {
      try {
        const createdSeconds = fromHex(invoice.created_at as HexString);
        const expiryDeltaSeconds = fromHex(invoice.expiry as HexString);
        return Number(createdSeconds + expiryDeltaSeconds) * 1000;
      } catch {
        // Fall through to default
      }
    }

    // If only created_at is available, add reasonable default (60 minutes)
    if (invoice.created_at) {
      try {
        const createdSeconds = fromHex(invoice.created_at as HexString);
        return Number(createdSeconds) * 1000 + 60 * 60 * 1000;
      } catch {
        // Fall through to default
      }
    }

    // Default: assume 1 hour from now
    return Date.now() + 60 * 60 * 1000;
  }

  /**
   * Validate preimage hashes to payment_hash correctly
   * In Lightning: payment_hash = SHA256(payment_preimage)
   */
  private validatePreimage(preimage: HexString, paymentHash: HexString): boolean {
    try {
      // Remove 0x prefix if present
      const preimageHex = preimage.startsWith('0x') ? preimage.slice(2) : preimage;
      const paymentHashHex = paymentHash.startsWith('0x') ? paymentHash.slice(2) : paymentHash;

      // Convert hex to buffer
      const preimageBuffer = Buffer.from(preimageHex, 'hex');
      const paymentHashBuffer = Buffer.from(paymentHashHex, 'hex');

      // SHA256 hash the preimage
      const hash = createHash('sha256').update(preimageBuffer).digest();

      // Compare
      return hash.equals(paymentHashBuffer);
    } catch {
      return false;
    }
  }

  /**
   * Try to extract payee node public key from invoice attributes
   * The payee public key is embedded in the invoice as a PayeePublicKey attribute
   */
  private extractNodeIdFromInvoice(invoice: InvoiceInfo | null): string | undefined {
    if (!invoice?.data?.attrs) {
      return undefined;
    }

    // Search for PayeePublicKey attribute in the invoice data
    for (const attr of invoice.data.attrs) {
      if ('PayeePublicKey' in attr) {
        return attr.PayeePublicKey;
      }
    }

    return undefined;
  }

  /**
   * Calculate trust score (0-100) based on various factors
   */
  private calculateTrustScore(
    checks: {
      validFormat: boolean;
      notExpired: boolean;
      validAmount: boolean;
      peerConnected: boolean;
      preimageValid?: boolean | undefined;
    },
    issues: VerificationIssue[]
  ): number {
    let score = 100;

    // Deduct for failed checks
    if (!checks.validFormat) score -= 25;
    if (!checks.notExpired) score -= 20;
    if (!checks.validAmount) score -= 15;
    if (!checks.peerConnected) score -= 10;
    if (checks.preimageValid === false) score -= 20; // Critical issue

    // Deduct for warnings
    const warnings = issues.filter((i) => i.type === 'warning').length;
    score -= warnings * 5;

    return Math.max(0, score);
  }
}
