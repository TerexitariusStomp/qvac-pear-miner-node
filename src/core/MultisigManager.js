import { Logger } from './Logger.js';

/**
 * MultisigManager
 * Manages protocol-level multisig wallets for Nostr and Bittensor
 * All applications share the same protocol multisigs
 * Funds accumulate monthly and are split between machine owner and app developer
 */
export class MultisigManager {
  constructor(config) {
    this.config = config;
    this.logger = new Logger('MultisigManager');
    this.multisigs = new Map();
    this.pendingSweeps = new Map();
    this.machineOwnerAddress = config.machineOwnerAddress || null;
    this.revenueSplit = config.revenueSplit || { machineOwner: 0.70, appDeveloper: 0.30 };
  }

  async initialize() {
    this.logger.info('Initializing protocol multisig manager...');

    // Protocol multisigs are shared across all applications
    // They are configured, not generated per-user
    await this.loadProtocolMultisigs();

    this.logger.info('Protocol multisig manager initialized');
  }

  /**
   * Load protocol-level multisigs from config
   * These are shared across all applications
   */
  async loadProtocolMultisigs() {
    const networks = this.config.protocolMultisigs || {};

    for (const [network, msConfig] of Object.entries(networks)) {
      this.multisigs.set(network, {
        type: network,
        network: network,
        protocol: msConfig.protocol,
        address: msConfig.address,
        threshold: msConfig.threshold || 2,
        signers: msConfig.signers || 3,
        status: 'active',
        createdAt: Date.now()
      });
      this.logger.info(`Protocol ${network} multisig loaded: ${this.maskAddress(msConfig.address)} (${msConfig.threshold || 2}-of-${msConfig.signers || 3})`);
    }
  }

  /**
   * Calculate monthly payout split
   * Returns how much goes to machine owner vs app developer
   */
  calculatePayoutSplit(totalAmount) {
    const machineOwnerShare = totalAmount * this.revenueSplit.machineOwner;
    const appDeveloperShare = totalAmount * this.revenueSplit.appDeveloper;
    return {
      machineOwner: machineOwnerShare,
      appDeveloper: appDeveloperShare,
      total: totalAmount
    };
  }

  /**
   * Get a multisig address for a network
   */
  getMultisig(network) {
    return this.multisigs.get(network);
  }

  /**
   * Get all multisigs
   */
  getAllMultisigs() {
    return Object.fromEntries(this.multisigs);
  }

  /**
   * Initiate a monthly fund sweep from protocol multisig
   * Funds are split between machine owner and app developer
   * Triggers the 2-day denial window
   */
  async initiateSweep(network, amount, machineOwnerAddress, appId) {
    this.logger.info(`Initiating monthly sweep from ${network}...`);

    const sourceMultisig = this.multisigs.get(network);
    if (!sourceMultisig) {
      throw new Error('Protocol multisig not found');
    }

    const split = this.calculatePayoutSplit(amount);
    const sweepId = `monthly-${network}-${Date.now()}`;
    const scheduledTime = Date.now() + (2 * 24 * 60 * 60 * 1000); // 2 days from now

    this.pendingSweeps.set(sweepId, {
      id: sweepId,
      network,
      amount,
      source: sourceMultisig.address,
      machineOwner: machineOwnerAddress,
      machineOwnerShare: split.machineOwner,
      appDeveloperShare: split.appDeveloper,
      appId,
      status: 'pending',
      createdAt: Date.now(),
      scheduledAt: scheduledTime,
      denied: false,
      executed: false
    });

    this.logger.info(`Monthly sweep ${sweepId} scheduled for ${new Date(scheduledTime).toISOString()}`);
    this.logger.info(`  Machine owner (${machineOwnerAddress}): ${split.machineOwner}`);
    this.logger.info(`  App developer (${appId}): ${split.appDeveloper}`);
    this.logger.info(`Denial window: 2 days. Execute 'denySweep("${sweepId}")' to cancel.`);

    setTimeout(() => {
      this.executeSweep(sweepId);
    }, 2 * 24 * 60 * 60 * 1000);

    return sweepId;
  }

  /**
   * Deny a pending sweep
   */
  async denySweep(sweepId) {
    const sweep = this.pendingSweeps.get(sweepId);
    if (!sweep) {
      throw new Error('Sweep not found');
    }

    if (sweep.status !== 'pending') {
      throw new Error(`Cannot deny sweep with status: ${sweep.status}`);
    }

    sweep.denied = true;
    sweep.status = 'denied';
    this.logger.info(`Sweep ${sweepId} has been DENIED by multisig`);
    return sweep;
  }

  /**
   * Execute a sweep (called after 2-day window)
   * Distributes to machine owner and app developer
   */
  async executeSweep(sweepId) {
    const sweep = this.pendingSweeps.get(sweepId);
    if (!sweep) {
      this.logger.error(`Sweep ${sweepId} not found`);
      return;
    }

    if (sweep.denied) {
      this.logger.info(`Sweep ${sweepId} was denied - skipping execution`);
      return;
    }

    if (sweep.executed) {
      this.logger.warn(`Sweep ${sweepId} already executed`);
      return;
    }

    this.logger.info(`Executing monthly sweep ${sweepId}...`);

    // In production, this would:
    // 1. Build the transaction from protocol multisig
    // 2. Collect signatures (2-of-3)
    // 3. Distribute split to machine owner and app developer addresses

    sweep.executed = true;
    sweep.status = 'completed';
    sweep.executedAt = Date.now();

    this.logger.info(`Sweep ${sweepId} completed:`);
    this.logger.info(`  Machine owner (${sweep.machineOwner}): ${sweep.machineOwnerShare}`);
    this.logger.info(`  App developer (${sweep.appId}): ${sweep.appDeveloperShare}`);
  }

  /**
   * Get status of all pending sweeps
   */
  getPendingSweeps() {
    return Array.from(this.pendingSweeps.values());
  }

  /**
   * Get status of multisig system
   */
  getStatus() {
    return {
      protocolMultisigs: Object.fromEntries(
        Array.from(this.multisigs.entries()).map(([name, ms]) => [
          name,
          {
            type: ms.type,
            network: ms.network,
            address: this.maskAddress(ms.address),
            threshold: ms.threshold,
            status: ms.status
          }
        ])
      ),
      revenueSplit: this.revenueSplit,
      pendingSweeps: this.getPendingSweeps().map(s => ({
        id: s.id,
        network: s.network,
        amount: s.amount,
        machineOwnerShare: s.machineOwnerShare,
        appDeveloperShare: s.appDeveloperShare,
        status: s.status,
        scheduledAt: s.scheduledAt
      }))
    };
  }

  maskAddress(address) {
    if (!address || address.length < 10) return '***';
    return `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
  }
}
