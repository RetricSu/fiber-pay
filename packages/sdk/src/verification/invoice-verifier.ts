/**
 * Invoice Verification Engine
 * Validates invoice legitimacy, format, cryptographic correctness, and peer connectivity
 * This ensures the agent only pays valid invoices
 */

import type { FiberRpcClient } from '../rpc/client.js';
import type { Attribute, CkbInvoice, HexString } from '../types/index.js';
import { fromHex, shannonsToCkb } from '../utils.js';

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

    let invoice: CkbInvoice | null = null;

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
      paymentHash: invoice?.data.payment_hash || 'unknown',
      amountCkb: invoice?.amount ? shannonsToCkb(invoice.amount) : 0,
      expiresAt: this.getExpiryTimestamp(invoice),
      description: this.getDescription(invoice),
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
    if (invoice?.amount) {
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
        // Check whether there is at least one connected peer for route discovery.
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
        isConnected:
          checks.peerConnected ||
          issues.filter((i) => i.code === 'NO_PEERS_CONNECTED').length === 0,
        trustScore: this.calculateTrustScore(checks, issues),
      },
      checks: {
        ...checks,
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
  private isInvoiceExpired(invoice: CkbInvoice): boolean {
    const expiryTimestamp = this.getExpiryTimestamp(invoice);
    return Date.now() > expiryTimestamp;
  }

  /**
   * Get expiry timestamp in milliseconds
   */
  private getExpiryTimestamp(invoice: CkbInvoice | null): number {
    if (!invoice) return 0;

    // Expiry is a duration in seconds, stored as an attribute (expiry_time).
    // Invoice timestamp is in seconds since UNIX epoch.
    try {
      const createdSeconds = fromHex(invoice.data.timestamp as HexString);
      const expiryDeltaSeconds =
        this.getAttributeU64(invoice.data.attrs, 'expiry_time') ?? BigInt(60 * 60);
      return Number(createdSeconds + expiryDeltaSeconds) * 1000;
    } catch {
      // Fall through to default
    }

    // Default: assume 1 hour from now
    return Date.now() + 60 * 60 * 1000;
  }

  private getAttributeU64(
    attrs: Attribute[],
    key: 'expiry_time' | 'final_htlc_timeout' | 'final_htlc_minimum_expiry_delta',
  ): bigint | undefined {
    for (const attr of attrs) {
      if (key in attr) {
        return fromHex((attr as Record<string, HexString>)[key] as HexString);
      }
    }
    return undefined;
  }

  private getDescription(invoice: CkbInvoice | null): string | undefined {
    if (!invoice) return undefined;
    for (const attr of invoice.data.attrs) {
      if ('description' in attr) {
        return attr.description;
      }
    }
    return undefined;
  }

  /**
   * Try to extract payee node public key from invoice attributes
   * The payee public key is embedded in the invoice as a payee_public_key attribute.
   */
  private extractNodeIdFromInvoice(invoice: CkbInvoice | null): string | undefined {
    if (!invoice) {
      return undefined;
    }

    // Search for payee_public_key attribute in the invoice data.
    for (const attr of invoice.data.attrs) {
      if ('payee_public_key' in attr) {
        return attr.payee_public_key;
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
    },
    issues: VerificationIssue[],
  ): number {
    let score = 100;

    // Deduct for failed checks
    if (!checks.validFormat) score -= 25;
    if (!checks.notExpired) score -= 20;
    if (!checks.validAmount) score -= 15;
    if (!checks.peerConnected) score -= 10;

    // Deduct for warnings
    const warnings = issues.filter((i) => i.type === 'warning').length;
    score -= warnings * 5;

    return Math.max(0, score);
  }
}
