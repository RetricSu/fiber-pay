import { resolve } from 'node:path';
import { type GrantStatus, type PermissionGrant, PermissionManager } from '@fiber-pay/runtime';
import { confirm, input } from '@inquirer/prompts';
import { Command } from 'commander';
import type { CliConfig } from '../lib/config.js';
import {
  formatShannonsAsCkb,
  printJsonError,
  printJsonSuccess,
  truncateMiddle,
} from '../lib/format.js';
import { runPermissionsReviewCommand } from '../lib/permissions-review.js';

export function createPermissionsCommand(config: CliConfig): Command {
  const permissions = new Command('permissions').description('Permission management');

  permissions
    .command('review')
    .description('Review a permission request URL')
    .argument('<url>', 'Permission URL to review (fiber://perm/<base64url>)')
    .option('--json', 'Output as JSON')
    .action(async (url: string, options: { json?: boolean }) => {
      await runPermissionsReviewCommand(url, options);
    });

  permissions
    .command('reject')
    .description('Reject a pending permission grant')
    .argument('<grantId>', 'ID of the grant to reject')
    .option('--reason <reason>', 'Reason for rejection')
    .option('--json')
    .action(async (grantId: string, options: { json?: boolean; reason?: string }) => {
      const asJson = Boolean(options.json);
      const reason = options.reason;

      const dbPath = resolve(config.dataDir, 'permissions.db');
      const nodeId = 'cli-node';

      const manager = new PermissionManager({
        dbPath,
        nodeId,
        keyPair: {
          privateKey: new Uint8Array(32),
          publicKey: new Uint8Array(32),
        },
      });

      try {
        await manager.reject(grantId, reason);

        if (asJson) {
          printJsonSuccess({
            grantId,
            rejected: true,
            reason: reason ?? null,
          });
        } else {
          console.log(`Grant ${grantId} rejected${reason ? `: ${reason}` : ''}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (asJson) {
          printJsonError({
            code: 'PERMISSION_REJECT_FAILED',
            message,
            recoverable: true,
            suggestion: 'Verify the grant ID exists and is in pending status.',
          });
        } else {
          console.error(`Error: ${message}`);
        }
        process.exit(1);
      } finally {
        manager.close();
      }
    });

  permissions
    .command('list')
    .description('List permission grants')
    .option('--pending', 'Show only pending grants')
    .option('--active', 'Show only active grants')
    .option('--revoked', 'Show only revoked grants')
    .option('--json', 'Output in JSON format')
    .action(async (options) => {
      try {
        // Determine status filter
        let statusFilter: GrantStatus | undefined;
        if (options.pending) {
          statusFilter = 'pending';
        } else if (options.active) {
          statusFilter = 'active';
        } else if (options.revoked) {
          statusFilter = 'revoked';
        }

        const dbPath = resolve(config.dataDir, 'permissions.db');
        const nodeId = 'cli-node';

        const manager = new PermissionManager({
          dbPath,
          nodeId,
          keyPair: {
            privateKey: new Uint8Array(32),
            publicKey: new Uint8Array(32),
          },
        });

        try {
          const grants = await manager.listGrants(
            statusFilter ? { status: statusFilter } : undefined,
          );

          if (options.json) {
            printJsonSuccess({
              grants: grants.map(formatGrantForJson),
              count: grants.length,
            });
          } else {
            printGrantListHuman(grants);
          }
        } finally {
          manager.close();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (options.json) {
          printJsonError({
            code: 'PERMISSIONS_LIST_ERROR',
            message,
            recoverable: true,
            suggestion: 'Check permissions database path and permissions.',
          });
          process.exit(1);
        } else {
          console.error(`Error: ${message}`);
          process.exit(1);
        }
      }
    });

  permissions
    .command('approve')
    .description('Approve a pending permission request')
    .argument('<requestId>', 'Permission request ID to approve')
    .option('--daily-limit <shannons>', 'Daily payment limit in shannons')
    .option('--per-payment-limit <shannons>', 'Per-payment limit in shannons')
    .option('--allow-channel-open', 'Allow channel opening')
    .option('--expires <duration>', 'Token expiration (e.g., 7d, 24h, 60m)')
    .option('--yes', 'Skip confirmation prompts')
    .option('--json', 'Output as JSON')
    .action(
      async (
        requestId: string,
        options: {
          json?: boolean;
          yes?: boolean;
          dailyLimit?: string;
          perPaymentLimit?: string;
          allowChannelOpen?: boolean;
          expires?: string;
        },
      ) => {
        const asJson = Boolean(options.json);

        try {
          // Determine if we're in interactive mode (no flags provided)
          const hasAnyFlag =
            options.dailyLimit !== undefined ||
            options.perPaymentLimit !== undefined ||
            options.allowChannelOpen !== undefined ||
            options.expires !== undefined;

          const grantLimits: {
            dailyLimit?: bigint;
            perPaymentLimit?: bigint;
            channelOpeningAllowed?: boolean;
          } = {};
          let confirmApproval = options.yes;

          if (!hasAnyFlag && !options.yes) {
            // Interactive mode - prompt for limits
            if (!asJson) {
              console.log(`\nApproving permission request: ${requestId}\n`);
              console.log('Configure permission limits (press Enter to skip):\n');
            }

            // Daily limit
            const dailyLimitInput = await input({
              message: 'Daily payment limit (shannons):',
              default: '',
            });
            if (dailyLimitInput) {
              const value = BigInt(dailyLimitInput);
              if (value >= 0) {
                grantLimits.dailyLimit = value;
              }
            }

            // Per-payment limit
            const perPaymentLimitInput = await input({
              message: 'Per-payment limit (shannons):',
              default: '',
            });
            if (perPaymentLimitInput) {
              const value = BigInt(perPaymentLimitInput);
              if (value >= 0) {
                grantLimits.perPaymentLimit = value;
              }
            }

            // Channel opening permission
            grantLimits.channelOpeningAllowed = await confirm({
              message: 'Allow channel opening?',
              default: false,
            });

            // Summary and confirmation
            if (!asJson) {
              console.log('\n📋 Approval Summary:');
              console.log(`   Request ID:           ${requestId}`);
              console.log(
                `   Daily limit:          ${grantLimits.dailyLimit !== undefined ? grantLimits.dailyLimit.toString() : 'Not set'}`,
              );
              console.log(
                `   Per-payment limit:    ${grantLimits.perPaymentLimit !== undefined ? grantLimits.perPaymentLimit.toString() : 'Not set'}`,
              );
              console.log(
                `   Allow channel open:   ${grantLimits.channelOpeningAllowed ? 'Yes' : 'No'}`,
              );
              console.log();
            }

            confirmApproval = await confirm({
              message: 'Approve this permission request?',
              default: true,
            });
          } else {
            // Non-interactive mode - use flags
            if (options.dailyLimit !== undefined) {
              grantLimits.dailyLimit = BigInt(options.dailyLimit);
            }
            if (options.perPaymentLimit !== undefined) {
              grantLimits.perPaymentLimit = BigInt(options.perPaymentLimit);
            }
            if (options.allowChannelOpen) {
              grantLimits.channelOpeningAllowed = true;
            }

            // Summary for non-interactive mode without --yes
            if (!confirmApproval && !asJson) {
              console.log('\n📋 Approval Summary:');
              console.log(`   Request ID:           ${requestId}`);
              console.log(
                `   Daily limit:          ${grantLimits.dailyLimit !== undefined ? grantLimits.dailyLimit.toString() : 'Not set'}`,
              );
              console.log(
                `   Per-payment limit:    ${grantLimits.perPaymentLimit !== undefined ? grantLimits.perPaymentLimit.toString() : 'Not set'}`,
              );
              console.log(
                `   Allow channel open:   ${grantLimits.channelOpeningAllowed ? 'Yes' : 'No'}`,
              );
              console.log();

              confirmApproval = await confirm({
                message: 'Approve this permission request?',
                default: true,
              });
            }
          }

          if (!confirmApproval) {
            if (asJson) {
              printJsonError({
                code: 'PERMISSION_APPROVAL_CANCELLED',
                message: 'Permission approval cancelled by user',
                recoverable: true,
              });
            } else {
              console.log('❌ Approval cancelled.');
            }
            process.exit(0);
          }

          // Initialize PermissionManager
          const dbPath = resolve(config.dataDir, 'permissions.db');
          const nodeId = 'cli-node';

          const manager = new PermissionManager({
            dbPath,
            nodeId,
            keyPair: {
              privateKey: new Uint8Array(32),
              publicKey: new Uint8Array(32),
            },
          });

          try {
            // Approve the permission request
            const approvedGrant = await manager.approve(requestId, grantLimits);

            // Extract the token from the grant
            const token = new TextDecoder().decode(approvedGrant.token_ciphertext);

            if (asJson) {
              printJsonSuccess({
                grantId: approvedGrant.id,
                appId: approvedGrant.app_id,
                appName: approvedGrant.app_name,
                status: approvedGrant.status,
                expiresAt: approvedGrant.expires_at?.toISOString(),
                dailyPaymentLimit: approvedGrant.daily_payment_limit?.toString(),
                perPaymentLimit: approvedGrant.per_payment_limit?.toString(),
                channelOpeningAllowed: approvedGrant.channel_opening_allowed,
                token: token,
              });
            } else {
              console.log('\n✅ Permission request approved!\n');
              console.log('📋 Grant Details:');
              console.log(`   Grant ID:             ${approvedGrant.id}`);
              console.log(`   App ID:               ${approvedGrant.app_id}`);
              console.log(`   App Name:             ${approvedGrant.app_name}`);
              console.log(`   Status:               ${approvedGrant.status}`);
              if (approvedGrant.expires_at) {
                console.log(`   Expires At:           ${approvedGrant.expires_at.toISOString()}`);
              }
              console.log(
                `   Daily Limit:          ${approvedGrant.daily_payment_limit?.toString() || 'Not set'}`,
              );
              console.log(
                `   Per-Payment Limit:    ${approvedGrant.per_payment_limit?.toString() || 'Not set'}`,
              );
              console.log(
                `   Channel Opening:      ${approvedGrant.channel_opening_allowed ? 'Allowed' : 'Not allowed'}`,
              );
              console.log('\n🔑 Generated Token:');
              console.log(`   ${token}`);
              console.log('\n⚠️  Store this token securely. It will not be shown again.\n');
            }
          } finally {
            manager.close();
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);

          if (asJson) {
            printJsonError({
              code: 'PERMISSION_APPROVE_FAILED',
              message: `Failed to approve permission: ${message}`,
              recoverable: true,
              suggestion: 'Check the request ID and try again.',
              details: { requestId },
            });
          } else {
            console.error(`Error: Failed to approve permission: ${message}`);
          }
          process.exit(1);
        }
      },
    );

  permissions
    .command('usage')
    .description('Show usage statistics for a permission grant')
    .argument('<grantId>', 'ID of the grant to check')
    .option('--json', 'Output as JSON')
    .action(async (grantId: string, options: { json?: boolean }) => {
      const asJson = Boolean(options.json);

      let manager: PermissionManager | undefined;

      try {
        const dbPath = resolve(config.dataDir, 'permissions.db');
        const nodeId = 'cli-node';

        manager = new PermissionManager({
          dbPath,
          nodeId,
          keyPair: {
            privateKey: new Uint8Array(32),
            publicKey: new Uint8Array(32),
          },
        });

        try {
          const grant = await manager.getGrant(grantId);
          if (!grant) {
            throw new Error(`Grant not found: ${grantId}`);
          }

          const limitTracker = manager.getLimitTracker();
          const today = new Date();
          const _dateStr = formatDate(today);
          const dailyUsage = limitTracker.checkDailyLimit(grant, 0n);
          const dailyCount = limitTracker.checkDailyCount(grant);

          if (asJson) {
            printJsonSuccess({
              grantId: grant.id,
              appId: grant.app_id,
              appName: grant.app_name,
              status: grant.status,
              dailyLimit: grant.daily_payment_limit?.toString() ?? null,
              dailyUsed:
                grant.daily_payment_limit && dailyUsage.remaining !== undefined
                  ? (grant.daily_payment_limit - dailyUsage.remaining).toString()
                  : '0',
              dailyRemaining: dailyUsage.remaining?.toString() ?? null,
              dailyCountLimit: grant.daily_count_limit ?? null,
              dailyCountUsed: dailyCount.count,
              totalPayments: grant.total_payments_made,
              totalAmountPaid: grant.total_amount_paid.toString(),
              expiresAt: grant.expires_at?.toISOString() ?? null,
            });
          } else {
            console.log(`Usage Statistics for Grant ${truncateMiddle(grantId, 8, 8)}`);
            console.log('');
            console.log(`  App:        ${grant.app_name ?? grant.app_id}`);
            console.log(`  Status:     ${grant.status}`);
            console.log('');
            console.log('  Daily Payment Limit:');
            if (grant.daily_payment_limit) {
              const used = grant.daily_payment_limit - (dailyUsage.remaining ?? 0n);
              const usedBigInt = BigInt(used.toString());
              const percentage = Number((usedBigInt * 100n) / grant.daily_payment_limit);
              console.log(`    Limit:  ${formatShannonsAsCkb(grant.daily_payment_limit)} CKB`);
              console.log(`    Used:   ${formatShannonsAsCkb(usedBigInt)} CKB`);
              console.log(`    Remain: ${formatShannonsAsCkb(dailyUsage.remaining ?? 0n)} CKB`);
              console.log(`    ${renderProgressBar(percentage)} ${percentage}%`);
            } else {
              console.log('    No daily limit set');
            }
            console.log('');
            console.log('  Daily Count Limit:');
            if (grant.daily_count_limit) {
              const countPercentage = Math.round(
                (dailyCount.count / grant.daily_count_limit) * 100,
              );
              console.log(`    Limit:  ${grant.daily_count_limit} payments`);
              console.log(`    Used:   ${dailyCount.count} payments`);
              console.log(`    Remain: ${grant.daily_count_limit - dailyCount.count} payments`);
              console.log(`    ${renderProgressBar(countPercentage)} ${countPercentage}%`);
            } else {
              console.log('    No daily count limit set');
            }
            console.log('');
            console.log('  Totals:');
            console.log(`    Payments: ${grant.total_payments_made}`);
            console.log(`    Amount:   ${formatShannonsAsCkb(grant.total_amount_paid)} CKB`);
            console.log('');
            console.log('  Expiration:');
            if (grant.expires_at) {
              const now = new Date();
              const exp = grant.expires_at;
              const diff = exp.getTime() - now.getTime();
              if (diff > 0) {
                const days = Math.floor(diff / (24 * 60 * 60 * 1000));
                const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
                console.log(`    Expires: ${exp.toISOString()}`);
                console.log(`    In:      ${days}d ${hours}h`);
              } else {
                console.log('    Expired');
              }
            } else {
              console.log('    No expiration');
            }
          }
        } finally {
          manager.close();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (asJson) {
          printJsonError({
            code: 'PERMISSION_USAGE_FAILED',
            message,
            recoverable: true,
            suggestion: 'Verify the grant ID exists.',
          });
        } else {
          console.error(`Error: ${message}`);
        }
        process.exit(1);
      }
    });

  return permissions;
}

function formatGrantForJson(grant: PermissionGrant): Record<string, unknown> {
  return {
    id: grant.id,
    appId: grant.app_id,
    appName: grant.app_name,
    nodeId: grant.node_id,
    status: grant.status,
    createdAt: grant.created_at.toISOString(),
    expiresAt: grant.expires_at?.toISOString(),
    revokedAt: grant.revoked_at?.toISOString(),
    dailyPaymentLimit: grant.daily_payment_limit?.toString(),
    perPaymentLimit: grant.per_payment_limit?.toString(),
    dailyCountLimit: grant.daily_count_limit,
    hourlyCountLimit: grant.hourly_count_limit,
    minIntervalSeconds: grant.min_interval_seconds,
    channelOpeningAllowed: grant.channel_opening_allowed,
    channelFundingLimit: grant.channel_funding_limit?.toString(),
    canCloseChannels: grant.can_close_channels,
    canForceClose: grant.can_force_close,
    totalPaymentsMade: grant.total_payments_made,
    totalAmountPaid: grant.total_amount_paid.toString(),
    lastUsedAt: grant.last_used_at?.toISOString(),
    scopes: grant.scopes,
  };
}

function formatExpires(grant: PermissionGrant): string {
  if (grant.revoked_at) {
    return `Revoked ${formatDate(grant.revoked_at)}`;
  }
  if (grant.expires_at) {
    const now = new Date();
    if (grant.expires_at < now) {
      return `Expired ${formatDate(grant.expires_at)}`;
    }
    return formatDate(grant.expires_at);
  }
  return 'Never';
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

function formatDailyLimit(grant: PermissionGrant): string {
  if (grant.daily_payment_limit) {
    return `${formatShannonsAsCkb(grant.daily_payment_limit, 2)} CKB`;
  }
  return 'Unlimited';
}

function formatUsage(grant: PermissionGrant): string {
  if (grant.total_payments_made === 0) {
    return '-';
  }
  const amount = formatShannonsAsCkb(grant.total_amount_paid, 2);
  return `${grant.total_payments_made} / ${amount} CKB`;
}

function getStatusLabel(status: GrantStatus): string {
  switch (status) {
    case 'pending':
      return '⏳ Pending';
    case 'active':
      return '✅ Active';
    case 'expired':
      return '⌛ Expired';
    case 'revoked':
      return '❌ Revoked';
    default:
      return status;
  }
}

function printGrantListHuman(grants: PermissionGrant[]): void {
  if (grants.length === 0) {
    console.log('No permission grants found.');
    return;
  }

  console.log(`Permission Grants: ${grants.length}`);
  console.log('');
  console.log(
    'ID                      APP NAME            STATUS      EXPIRES      DAILY LIMIT     USAGE',
  );
  console.log(
    '---------------------------------------------------------------------------------------------------',
  );

  for (const grant of grants) {
    const id = truncateMiddle(grant.id, 10, 8).padEnd(22, ' ');
    const appName = (grant.app_name || grant.app_id || 'Unknown').slice(0, 18).padEnd(18, ' ');
    const status = getStatusLabel(grant.status).padEnd(11, ' ');
    const expires = formatExpires(grant).padEnd(12, ' ');
    const dailyLimit = formatDailyLimit(grant).padEnd(15, ' ');
    const usage = formatUsage(grant);
    console.log(`${id} ${appName} ${status} ${expires} ${dailyLimit} ${usage}`);
  }
}

function renderProgressBar(percentage: number, width = 20): string {
  const clamped = Math.max(0, Math.min(100, percentage));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  const filledBar = '█'.repeat(filled);
  const emptyBar = '░'.repeat(empty);
  return `${filledBar}${emptyBar}`;
}
