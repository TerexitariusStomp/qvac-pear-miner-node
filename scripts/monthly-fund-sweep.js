#!/usr/bin/env node

/**
 * Monthly Fund Sweep Script
 *
 * Runs monthly to move funds from protocol multisigs.
 * Funds are split between machine owner and app developer.
 * Includes a 2-day denial window.
 *
 * Usage:
 *   node scripts/monthly-fund-sweep.js
 *   node scripts/monthly-fund-sweep.js --dry-run
 *   node scripts/monthly-fund-sweep.js --deny <sweep-id>
 */

import { Logger } from '../src/core/Logger.js';
import { MultisigManager } from '../src/core/MultisigManager.js';

const logger = new Logger('MonthlyFundSweep');

// Parse CLI args
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const denyIndex = args.indexOf('--deny');
const denySweepId = denyIndex !== -1 ? args[denyIndex + 1] : null;

async function main() {
  logger.info('========================================');
  logger.info('Monthly Fund Sweep Starting');
  logger.info('========================================');

  // Load config
  let config;
  try {
    const configModule = await import('../config.json', { assert: { type: 'json' } });
    config = configModule.default;
  } catch (error) {
    logger.error('Failed to load config.json:', error.message);
    process.exit(1);
  }

  const msConfig = config.multisig;
  if (!msConfig || !msConfig.enabled) {
    logger.error('Multisig not enabled in config');
    process.exit(1);
  }

  // Initialize multisig manager with protocol addresses
  const multisigManager = new MultisigManager(msConfig);
  await multisigManager.initialize();

  // Handle denial request
  if (denySweepId) {
    logger.info(`Processing denial for sweep: ${denySweepId}`);
    try {
      await multisigManager.denySweep(denySweepId);
      logger.info(`Sweep ${denySweepId} has been denied successfully`);
    } catch (error) {
      logger.error(`Failed to deny sweep: ${error.message}`);
      process.exit(1);
    }
    process.exit(0);
  }

  // Display protocol multisig status
  const status = multisigManager.getStatus();
  logger.info('Protocol Multisig Status:');
  for (const [network, ms] of Object.entries(status.protocolMultisigs)) {
    logger.info(`  ${network}: ${ms.address} (${ms.threshold}-of-3)`);
  }
  logger.info(`Revenue Split: ${(status.revenueSplit.machineOwner * 100).toFixed(0)}% machine owner / ${(status.revenueSplit.appDeveloper * 100).toFixed(0)}% app developer`);

  if (isDryRun) {
    logger.info('');
    logger.info('DRY RUN MODE - No transactions will be executed');
    logger.info('');
  }

  // Collect balances from each protocol multisig
  const networks = ['nostr', 'bittensor'];
  const balances = await collectBalances(networks, multisigManager, isDryRun);

  // Initiate monthly sweeps
  logger.info('');
  logger.info('Initiating monthly sweeps (2-day denial window active)...');
  logger.info('');

  for (const [network, balance] of Object.entries(balances)) {
    if (balance > 0) {
      await initiateSweep(network, balance, msConfig, multisigManager, isDryRun);
    }
  }

  // Display pending sweeps
  const pendingSweeps = multisigManager.getPendingSweeps();
  if (pendingSweeps.length > 0) {
    logger.info('');
    logger.info('Pending Sweeps (2-day denial window):');
    for (const sweep of pendingSweeps) {
      const scheduledDate = new Date(sweep.scheduledAt);
      logger.info(`  ${sweep.id}:`);
      logger.info(`    Network: ${sweep.network}`);
      logger.info(`    Total: ${sweep.amount}`);
      logger.info(`    Machine Owner (${sweep.machineOwner}): ${sweep.machineOwnerShare}`);
      logger.info(`    App Developer (${sweep.appId}): ${sweep.appDeveloperShare}`);
      logger.info(`    Scheduled: ${scheduledDate.toISOString()}`);
      logger.info(`    Deny command: node scripts/monthly-fund-sweep.js --deny ${sweep.id}`);
    }
  }

  logger.info('');
  logger.info('Monthly Fund Sweep Complete');
  logger.info('========================================');
}

/**
 * Collect balances from protocol multisigs
 */
async function collectBalances(networks, multisigManager, isDryRun) {
  const balances = {};

  for (const network of networks) {
    const multisig = multisigManager.getMultisig(network);
    if (!multisig) {
      logger.warn(`No protocol multisig found for ${network}`);
      continue;
    }

    const simulatedBalance = isDryRun ? 0.001 : await queryBalance(network, multisig.address);
    balances[network] = simulatedBalance;

    if (simulatedBalance > 0) {
      logger.info(`${network}: Balance detected (${simulatedBalance})`);
    } else {
      logger.info(`${network}: No balance to sweep`);
    }
  }

  return balances;
}

/**
 * Query balance from network (simulated)
 */
async function queryBalance(network, address) {
  await new Promise(resolve => setTimeout(resolve, 500));
  const randomBalance = Math.random() > 0.5 ? parseFloat((Math.random() * 0.01).toFixed(6)) : 0;
  return randomBalance;
}

/**
 * Initiate a sweep from protocol multisig with revenue split
 */
async function initiateSweep(network, amount, msConfig, multisigManager, isDryRun) {
  if (isDryRun) {
    logger.info(`[DRY RUN] Would sweep ${amount} from ${network} (protocol multisig)`);
    return;
  }

  try {
    const machineOwner = msConfig.machineOwnerAddress || 'unknown';
    const appId = 'protocol-default';
    const sweepId = await multisigManager.initiateSweep(network, amount, machineOwner, appId);
    logger.info(`Sweep initiated: ${sweepId}`);
    logger.info(`  Amount: ${amount} ${getNetworkToken(network)}`);
    logger.info(`  Deny window: 2 days`);
  } catch (error) {
    logger.error(`Failed to initiate sweep for ${network}: ${error.message}`);
  }
}

function getNetworkToken(network) {
  const tokens = {
    nostr: 'sats',
    bittensor: 'TAO'
  };
  return tokens[network] || 'tokens';
}

main().catch(error => {
  logger.error('Unhandled error:', error);
  process.exit(1);
});
