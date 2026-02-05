/**
 * Fund Management & Liquidity Analyzer
 * Analyzes channel health, identifies liquidity gaps, and provides funding recommendations
 */

import type { FiberRpcClient } from '../rpc/client.js';
import type { ChannelInfo } from '../types/index.js';
import { shannonsToCkb, fromHex } from '../rpc/index.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Channel health score breakdown
 */
export interface ChannelHealthMetrics {
  channelId: string;
  peerId: string;
  localBalanceCkb: number;
  remoteBalanceCkb: number;
  totalCapacityCkb: number;
  utilizationPercent: number; // How much of capacity is used
  balanceRatioPercent: number; // % of capacity on local side (50% = perfectly balanced)
  isBalanced: boolean; // Within 40-60% = balanced
  pendingLocalCkb: number; // Pending offered payments
  pendingRemoteCkb: number; // Pending received payments
  availableToSendCkb: number; // Can actually send right now
  availableToReceiveCkb: number; // Can actually receive right now
  healthScore: number; // 0-100
  state: string;
}

export interface LiquidityGap {
  amount: number; // How much liquidity is missing
  reason: string; // Why it's needed
  severity: 'low' | 'medium' | 'high'; // Impact on operations
  affectedChannels: string[];
}

export interface RebalanceRecommendation {
  from: string; // Source channel ID
  to: string; // Destination channel ID
  amountCkb: number;
  reason: string;
  benefit: string; // What this achieves
  estimatedRoutingFeeCkb: number;
  priority: number; // 1 (low) to 10 (critical)
}

export interface FundingNeed {
  amount: number; // How much funding needed
  reason: string;
  optimalChannelPeerId?: string; // Recommended peer ID to fund
  urgency: 'low' | 'normal' | 'high';
  estimatedTimeToDepletion?: number; // Days until liquidity runs out
}

export interface LiquidityReport {
  timestamp: number;
  balance: {
    totalCkb: number;
    availableToSendCkb: number;
    availableToReceiveCkb: number;
    lockedInChannelsCkb: number;
  };
  channels: {
    count: number;
    health: ChannelHealthMetrics[];
    averageHealthScore: number;
    balancedCount: number;
    imbalancedCount: number;
  };
  liquidity: {
    gaps: LiquidityGap[];
    hasCriticalGaps: boolean;
    runway: {
      daysAtCurrentRate?: number;
      estimatedDailySpendCkb?: number;
    };
  };
  recommendations: {
    rebalances: RebalanceRecommendation[];
    funding: FundingNeed[];
  };
  summary: string; // Human-readable summary
}

// =============================================================================
// Liquidity Analyzer
// =============================================================================

export class LiquidityAnalyzer {
  constructor(private rpc: FiberRpcClient) {}

  /**
   * Comprehensive liquidity analysis
   */
  async analyzeLiquidity(): Promise<LiquidityReport> {
    const timestamp = Date.now();

    // Fetch data
    const channels = await this.rpc.listChannels({});
    const nodeInfo = await this.rpc.nodeInfo();

    // Analyze each channel
    const channelMetrics: ChannelHealthMetrics[] = channels.channels.map((ch) =>
      this.analyzeChannelHealth(ch)
    );

    // Calculate totals
    const totalCkb = channelMetrics.reduce((sum, ch) => sum + ch.localBalanceCkb + ch.remoteBalanceCkb, 0);
    const availableToSendCkb = channelMetrics.reduce((sum, ch) => sum + ch.availableToSendCkb, 0);
    const availableToReceiveCkb = channelMetrics.reduce((sum, ch) => sum + ch.availableToReceiveCkb, 0);

    // Identify gaps and issues
    const gaps = this.identifyLiquidityGaps(channelMetrics, availableToSendCkb);

    // Generate rebalance recommendations
    const rebalances = this.generateRebalanceRecommendations(channelMetrics);

    // Estimate funding needs
    const fundingNeeds = this.estimateFundingNeeds(channelMetrics, gaps);

    // Calculate runway
    const runway = this.estimateRunway(availableToSendCkb, channelMetrics);

    // Summary
    const summary = this.generateSummary(channelMetrics, gaps, fundingNeeds, runway);

    return {
      timestamp,
      balance: {
        totalCkb,
        availableToSendCkb,
        availableToReceiveCkb,
        lockedInChannelsCkb: totalCkb - availableToSendCkb - availableToReceiveCkb,
      },
      channels: {
        count: channels.channels.length,
        health: channelMetrics,
        averageHealthScore: channelMetrics.length > 0 ? channelMetrics.reduce((sum, ch) => sum + ch.healthScore, 0) / channelMetrics.length : 0,
        balancedCount: channelMetrics.filter((ch) => ch.isBalanced).length,
        imbalancedCount: channelMetrics.filter((ch) => !ch.isBalanced).length,
      },
      liquidity: {
        gaps,
        hasCriticalGaps: gaps.some((g) => g.severity === 'high'),
        runway,
      },
      recommendations: {
        rebalances,
        funding: fundingNeeds,
      },
      summary,
    };
  }

  /**
   * Analyze individual channel health
   */
  private analyzeChannelHealth(channel: ChannelInfo): ChannelHealthMetrics {
    const localBalance = shannonsToCkb(channel.local_balance);
    const remoteBalance = shannonsToCkb(channel.remote_balance);
    const totalCapacity = localBalance + remoteBalance;

    const pendingLocal = shannonsToCkb(channel.offered_tlc_balance);
    const pendingRemote = shannonsToCkb(channel.received_tlc_balance);

    const availableToSend = Math.max(0, localBalance - pendingLocal);
    const availableToReceive = Math.max(0, remoteBalance - pendingRemote);

    const utilizationPercent = totalCapacity > 0 ? ((pendingLocal + pendingRemote) / totalCapacity) * 100 : 0;
    const balanceRatioPercent = totalCapacity > 0 ? (localBalance / totalCapacity) * 100 : 50;

    // Channel is balanced if local balance is 40-60% of total
    const isBalanced = balanceRatioPercent >= 40 && balanceRatioPercent <= 60;

    // Health score (0-100)
    let healthScore = 100;

    // Deduct for high utilization (pending payments)
    if (utilizationPercent > 80) healthScore -= 20;
    else if (utilizationPercent > 50) healthScore -= 10;

    // Deduct for imbalance
    const imbalance = Math.abs(50 - balanceRatioPercent);
    healthScore -= (imbalance / 50) * 20; // Up to 20 points for extreme imbalance

    // Bonus for healthy balance
    if (isBalanced && utilizationPercent < 50) healthScore += 10;

    healthScore = Math.max(0, Math.min(100, healthScore));

    return {
      channelId: channel.channel_id,
      peerId: channel.peer_id,
      localBalanceCkb: localBalance,
      remoteBalanceCkb: remoteBalance,
      totalCapacityCkb: totalCapacity,
      utilizationPercent,
      balanceRatioPercent,
      isBalanced,
      pendingLocalCkb: pendingLocal,
      pendingRemoteCkb: pendingRemote,
      availableToSendCkb: availableToSend,
      availableToReceiveCkb: availableToReceive,
      healthScore,
      state: channel.state.state_name,
    };
  }

  /**
   * Identify liquidity shortfalls and gaps
   */
  private identifyLiquidityGaps(metrics: ChannelHealthMetrics[], totalSendable: number): LiquidityGap[] {
    const gaps: LiquidityGap[] = [];

    // Gap 1: No send-capable channels
    const sendCapableCount = metrics.filter((ch) => ch.availableToSendCkb > 0).length;
    if (sendCapableCount === 0 && metrics.length > 0) {
      gaps.push({
        amount: 100, // Arbitrary amount - need to rebalance
        reason: 'No channels currently capable of sending. All liquidity on remote side.',
        severity: 'high',
        affectedChannels: metrics.map((ch) => ch.channelId),
      });
    }

    // Gap 2: All channels imbalanced (all local-heavy or all remote-heavy)
    const allLocalHeavy = metrics.every((ch) => ch.balanceRatioPercent > 70);
    const allRemoteHeavy = metrics.every((ch) => ch.balanceRatioPercent < 30);

    if (allLocalHeavy) {
      gaps.push({
        amount: 0, // Rebalance doesn't require funding
        reason: 'All channels are local-heavy. Cannot receive payments. Need inbound liquidity.',
        severity: 'high',
        affectedChannels: metrics.map((ch) => ch.channelId),
      });
    }

    if (allRemoteHeavy) {
      gaps.push({
        amount: 0, // Need to open new channels or rebalance
        reason: 'All channels are remote-heavy. Cannot send without rebalancing or new channels.',
        severity: 'high',
        affectedChannels: metrics.map((ch) => ch.channelId),
      });
    }

    // Gap 3: High utilization in all channels
    const allHighUtilization = metrics.every((ch) => ch.utilizationPercent > 70);
    if (allHighUtilization) {
      gaps.push({
        amount: 0,
        reason: 'High utilization in all channels. Many pending payments. Risk of payment failures.',
        severity: 'medium',
        affectedChannels: metrics.map((ch) => ch.channelId),
      });
    }

    return gaps;
  }

  /**
   * Generate rebalance recommendations between channels
   */
  private generateRebalanceRecommendations(metrics: ChannelHealthMetrics[]): RebalanceRecommendation[] {
    const recommendations: RebalanceRecommendation[] = [];

    // Look for pairs: one local-heavy, one remote-heavy
    const localHeavy = metrics.filter((ch) => ch.balanceRatioPercent > 65);
    const remoteHeavy = metrics.filter((ch) => ch.balanceRatioPercent < 35);

    // Sort by how imbalanced they are
    localHeavy.sort((a, b) => b.balanceRatioPercent - a.balanceRatioPercent);
    remoteHeavy.sort((a, b) => a.balanceRatioPercent - b.balanceRatioPercent);

    // Pair them up
    for (let i = 0; i < Math.min(localHeavy.length, remoteHeavy.length); i++) {
      const source = localHeavy[i];
      const dest = remoteHeavy[i];

      // Calculate how much to move to balance both closer to 50%
      const sourceExcess = source.localBalanceCkb - source.totalCapacityCkb * 0.5;
      const destDeficit = dest.totalCapacityCkb * 0.5 - dest.localBalanceCkb;

      const amountToMove = Math.min(sourceExcess, destDeficit) * 0.8; // Move 80% to be conservative

      if (amountToMove > 0.1) {
        // Only if meaningful amount
        recommendations.push({
          from: source.channelId,
          to: dest.channelId,
          amountCkb: amountToMove,
          reason: `Rebalance liquidity: source is ${source.balanceRatioPercent.toFixed(0)}% local, destination is ${dest.balanceRatioPercent.toFixed(0)}% local`,
          benefit: `Improves payment success rate by balancing channel liquidity`,
          estimatedRoutingFeeCkb: amountToMove * 0.001, // 0.1% estimated fee
          priority: Math.round((Math.abs(50 - source.balanceRatioPercent) + Math.abs(50 - dest.balanceRatioPercent)) / 20), // 1-10
        });
      }
    }

    return recommendations.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Estimate funding needs for future operations
   */
  private estimateFundingNeeds(metrics: ChannelHealthMetrics[], gaps: LiquidityGap[]): FundingNeed[] {
    const needs: FundingNeed[] = [];

    // If there are critical gaps, funding is needed
    const criticalGaps = gaps.filter((g) => g.severity === 'high');
    if (criticalGaps.length > 0) {
      // Find the best channel to fund (most balanced, highest capacity)
      const bestChannel = [...metrics]
        .filter((ch) => ch.state === 'ChannelReady')
        .sort((a, b) => {
          const scoreA = a.healthScore + (a.totalCapacityCkb / 1000); // Higher score + capacity = better
          const scoreB = b.healthScore + (b.totalCapacityCkb / 1000);
          return scoreB - scoreA;
        })[0];

      const fundingAmount = Math.ceil(bestChannel?.totalCapacityCkb || 100);

      needs.push({
        amount: fundingAmount,
        reason: 'Critical liquidity gaps detected in current channels',
        optimalChannelPeerId: bestChannel?.peerId,
        urgency: 'high',
      });
    }

    // If all channels are small, recommend growth
    const avgCapacity = metrics.length > 0 ? metrics.reduce((sum, ch) => sum + ch.totalCapacityCkb, 0) / metrics.length : 0;

    if (avgCapacity < 100) {
      needs.push({
        amount: 500, // Reasonable growth target
        reason: 'Average channel capacity is small. Consider larger channels for reliability.',
        urgency: 'low',
      });
    }

    return needs;
  }

  /**
   * Estimate runway (days until liquidity depleted at current spending rate)
   */
  private estimateRunway(
    availableToSend: number,
    metrics: ChannelHealthMetrics[]
  ): {
    daysAtCurrentRate?: number;
    estimatedDailySpendCkb?: number;
  } {
    // This is a simplified estimate
    // In real implementation, would track historical spending
    const estimatedDailySpend = 0.1; // Default: assume 0.1 CKB per day

    if (availableToSend > 0 && estimatedDailySpend > 0) {
      const days = availableToSend / estimatedDailySpend;
      return {
        daysAtCurrentRate: Math.floor(days),
        estimatedDailySpendCkb: estimatedDailySpend,
      };
    }

    return {};
  }

  /**
   * Generate human-readable summary
   */
  private generateSummary(
    metrics: ChannelHealthMetrics[],
    gaps: LiquidityGap[],
    fundingNeeds: FundingNeed[],
    runway: {
      daysAtCurrentRate?: number;
      estimatedDailySpendCkb?: number;
    }
  ): string {
    const parts: string[] = [];

    if (metrics.length === 0) {
      return 'No channels available. Open a channel to start making payments.';
    }

    parts.push(`Channel Health: ${metrics.filter((ch) => ch.healthScore >= 70).length}/${metrics.length} channels healthy`);

    const avgScore = metrics.reduce((sum, ch) => sum + ch.healthScore, 0) / metrics.length;
    if (avgScore >= 80) {
      parts.push('Overall liquidity is good ✓');
    } else if (avgScore >= 60) {
      parts.push('Overall liquidity is fair. Some rebalancing recommended.');
    } else {
      parts.push('Overall liquidity is poor. Rebalancing needed urgently.');
    }

    if (gaps.length > 0) {
      parts.push(`${gaps.length} liquidity gap(s) detected.`);
    }

    if (fundingNeeds.length > 0) {
      parts.push(`Need to fund ${fundingNeeds.map((n) => n.amount).join(', ')} CKB to resolve issues.`);
    }

    if (runway.daysAtCurrentRate) {
      parts.push(`Estimated runway: ${runway.daysAtCurrentRate} days at current spending rate.`);
    }

    return parts.join(' ');
  }

  /**
   * Get missing liquidity for a specific amount
   */
  async getMissingLiquidityForAmount(targetCkb: number): Promise<{
    canSend: boolean;
    shortfallCkb: number;
    recommendation: string;
  }> {
    const report = await this.analyzeLiquidity();

    const shortfallCkb = Math.max(0, targetCkb - report.balance.availableToSendCkb);
    const canSend = shortfallCkb === 0;

    let recommendation = '';
    if (canSend) {
      recommendation = `You have enough liquidity to send ${targetCkb} CKB.`;
    } else {
      recommendation = `You need ${shortfallCkb.toFixed(4)} more CKB in send capacity. Consider rebalancing or opening larger channels.`;
    }

    return { canSend, shortfallCkb, recommendation };
  }
}
