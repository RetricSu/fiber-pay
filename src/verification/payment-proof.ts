/**
 * Payment Proof & Tracking System
 * Records, stores, and verifies payment evidence for audit trail and reconciliation
 * 
 * IMPORTANT LIMITATION:
 * Fiber Network RPC currently does NOT return the payment preimage to the sender
 * after a successful payment. In standard Lightning protocol, the preimage serves
 * as cryptographic proof of payment (SHA256(preimage) === payment_hash).
 * 
 * Until Fiber exposes the preimage in send_payment/get_payment responses:
 * - Payment proofs are based on RPC status (Success/Failed) rather than preimage
 * - For invoices YOU create (as receiver), preimage IS available
 * - This limitation affects sender-side proof verification only
 * 
 * Tracking issue: Preimage not exposed in Fiber RPC send_payment result
 */

import { readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { createHash } from 'crypto';
import type { PaymentStatus, HexString } from '../types/index.js';
import { shannonsToCkb, fromHex } from '../rpc/index.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Complete payment proof record
 */
export interface PaymentProof {
  /** Unique identifier (payment hash) */
  id: string;
  /** Status at time of recording */
  status: PaymentStatus;
  /** Original invoice string */
  invoice: string;
  /** Invoice details extracted */
  invoiceDetails: {
    paymentHash: string;
    amountCkb: number;
    description?: string;
  };
  /** Payment execution details */
  execution: {
    amountCkb: number;
    feeCkb: number;
    actualTimestamp: number; // When payment settled (if succeeded)
    requestTimestamp: number; // When payment was initiated
  };
  /** Proof of payment */
  proof: {
    preimage?: HexString; // Secret revealed on successful payment
    peerAddress?: string; // Peer that received payment
    channelUsed?: string; // Channel ID used
    routePath?: string[]; // Peers involved in routing
  };
  /** Verification status */
  verified: boolean;
  verifiedAt?: number;
  verificationMethod?: 'preimage_hash' | 'rpc_status' | 'manual';
  /** Metadata for audit trail */
  metadata: {
    createdAt: number;
    updatedAt: number;
    notes?: string;
  };
}

export interface PaymentProofSummary {
  totalProofs: number;
  verifiedCount: number;
  pendingCount: number;
  failedCount: number;
  totalAmountCkb: number;
  totalFeesCkb: number;
  timeRange: {
    earliest?: number;
    latest?: number;
  };
}

// =============================================================================
// Payment Proof Manager
// =============================================================================

export class PaymentProofManager {
  private proofs: Map<string, PaymentProof> = new Map();
  private proofFilePath: string;
  private maxStoredProofs = 10000; // Prevent unbounded growth

  constructor(dataDir: string) {
    this.proofFilePath = `${dataDir}/payment-proofs.json`;
  }

  /**
   * Load proofs from disk
   */
  async load(): Promise<void> {
    try {
      const data = await readFile(this.proofFilePath, 'utf-8');
      const proofs = JSON.parse(data) as PaymentProof[];
      this.proofs.clear();
      proofs.forEach((proof) => {
        this.proofs.set(proof.id, proof);
      });
    } catch {
      // File doesn't exist yet or is empty
      this.proofs.clear();
    }
  }

  /**
   * Save proofs to disk
   */
  async save(): Promise<void> {
    const proofs = Array.from(this.proofs.values());
    const data = JSON.stringify(proofs, null, 2);

    try {
      await writeFile(this.proofFilePath, data, 'utf-8');
    } catch (error) {
      if (error instanceof Error && error.message.includes('ENOENT')) {
        // Directory doesn't exist, create it first
        await this.ensureDirectory();
        await writeFile(this.proofFilePath, data, 'utf-8');
      } else {
        throw error;
      }
    }
  }

  /**
   * Record a payment proof after successful execution
   */
  recordPaymentProof(
    paymentHash: string,
    invoice: string,
    invoiceDetails: {
      paymentHash: string;
      amountCkb: number;
      description?: string;
    },
    execution: {
      amountCkb: number;
      feeCkb: number;
      actualTimestamp: number;
      requestTimestamp: number;
    },
    status: PaymentStatus,
    proof?: {
      preimage?: HexString;
      peerAddress?: string;
      channelUsed?: string;
      routePath?: string[];
    }
  ): PaymentProof {
    const now = Date.now();
    const fullProof: PaymentProof = {
      id: paymentHash,
      status,
      invoice,
      invoiceDetails,
      execution,
      proof: proof || {},
      verified: false,
      metadata: {
        createdAt: now,
        updatedAt: now,
      },
    };

    this.proofs.set(paymentHash, fullProof);

    // Verify if we have preimage
    if (proof?.preimage) {
      const isValid = this.verifyPreimageHash(proof.preimage, invoiceDetails.paymentHash);
      if (isValid) {
        fullProof.verified = true;
        fullProof.verifiedAt = now;
        fullProof.verificationMethod = 'preimage_hash';
      }
    }

    // Cleanup if we exceed max proofs (keep newest)
    if (this.proofs.size > this.maxStoredProofs) {
      this.pruneOldestProofs(this.maxStoredProofs * 0.8); // Keep 80% after pruning
    }

    return fullProof;
  }

  /**
   * Get proof by payment hash
   */
  getProof(paymentHash: string): PaymentProof | undefined {
    return this.proofs.get(paymentHash);
  }

  /**
   * Verify a proof's authenticity
   */
  verifyProof(proof: PaymentProof): {
    valid: boolean;
    reason: string;
  } {
    // If already verified with preimage, trust it
    if (proof.verified && proof.verificationMethod === 'preimage_hash') {
      return {
        valid: true,
        reason: 'Verified via preimage hash match',
      };
    }

    // Try to verify preimage now
    if (proof.proof?.preimage) {
      const hashValid = this.verifyPreimageHash(proof.proof.preimage, proof.invoiceDetails.paymentHash);
      if (!hashValid) {
        return {
          valid: false,
          reason: 'Preimage does not hash to payment hash',
        };
      }
      proof.verified = true;
      proof.verifiedAt = Date.now();
      proof.verificationMethod = 'preimage_hash';
      return {
        valid: true,
        reason: 'Preimage verified via hash',
      };
    }

    // If status is Success without preimage, it was verified by RPC
    if (proof.status === 'Success') {
      return {
        valid: true,
        reason: 'Payment succeeded according to RPC (preimage not available)',
      };
    }

    return {
      valid: false,
      reason: 'No verification method available',
    };
  }

  /**
   * Get payment timeline between two timestamps
   */
  getPaymentChain(startTime: number, endTime: number): PaymentProof[] {
    return Array.from(this.proofs.values())
      .filter((p) => p.metadata.createdAt >= startTime && p.metadata.createdAt <= endTime)
      .sort((a, b) => a.metadata.createdAt - b.metadata.createdAt);
  }

  /**
   * Get summary statistics
   */
  getSummary(): PaymentProofSummary {
    const proofs = Array.from(this.proofs.values());

    let verifiedCount = 0;
    let pendingCount = 0;
    let failedCount = 0;
    let totalAmountCkb = 0;
    let totalFeesCkb = 0;
    let earliest: number | undefined;
    let latest: number | undefined;

    proofs.forEach((proof) => {
      if (proof.verified) verifiedCount++;
      else if (proof.status === 'Inflight' || proof.status === 'Created') pendingCount++;
      else if (proof.status === 'Failed') failedCount++;

      totalAmountCkb += proof.execution.amountCkb;
      totalFeesCkb += proof.execution.feeCkb;

      const createdAt = proof.metadata.createdAt;
      if (!earliest || createdAt < earliest) earliest = createdAt;
      if (!latest || createdAt > latest) latest = createdAt;
    });

    return {
      totalProofs: proofs.length,
      verifiedCount,
      pendingCount,
      failedCount,
      totalAmountCkb,
      totalFeesCkb,
      timeRange: {
        earliest,
        latest,
      },
    };
  }

  /**
   * Export proofs as audit report
   */
  exportAuditReport(startTime?: number, endTime?: number): string {
    const proofs = Array.from(this.proofs.values())
      .filter((p) => {
        if (!startTime && !endTime) return true;
        const created = p.metadata.createdAt;
        if (startTime && created < startTime) return false;
        if (endTime && created > endTime) return false;
        return true;
      })
      .sort((a, b) => a.metadata.createdAt - b.metadata.createdAt);

    const lines: string[] = [
      'Payment Audit Report',
      `Generated: ${new Date().toISOString()}`,
      `Time Range: ${startTime ? new Date(startTime).toISOString() : 'All'} - ${endTime ? new Date(endTime).toISOString() : 'All'}`,
      `Total Payments: ${proofs.length}`,
      '',
      'Payment ID | Status | Amount CKB | Fee CKB | Verified | Created At',
      '-'.repeat(80),
    ];

    proofs.forEach((p) => {
      lines.push(
        `${p.id.slice(0, 16)}... | ${p.status} | ${p.execution.amountCkb.toFixed(4)} | ${p.execution.feeCkb.toFixed(8)} | ${p.verified ? 'Yes' : 'No'} | ${new Date(p.metadata.createdAt).toISOString()}`
      );
    });

    return lines.join('\n');
  }

  /**
   * Verify preimage hash (SHA256 of preimage = payment_hash)
   */
  private verifyPreimageHash(preimage: HexString, paymentHash: string): boolean {
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
   * Remove oldest proofs to keep storage bounded
   */
  private pruneOldestProofs(count: number): void {
    const sorted = Array.from(this.proofs.values()).sort((a, b) => a.metadata.createdAt - b.metadata.createdAt);

    const toRemove = sorted.slice(0, Math.floor(sorted.length - count));
    toRemove.forEach((p) => {
      this.proofs.delete(p.id);
    });
  }

  /**
   * Ensure directory exists
   */
  private async ensureDirectory(): Promise<void> {
    const dir = dirname(this.proofFilePath);
    try {
      // Use Node.js 18+ mkdir with recursive option
      const fs = await import('fs');
      fs.mkdirSync(dir, { recursive: true });
    } catch {
      // Ignore if fails
    }
  }
}
