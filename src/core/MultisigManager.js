import { Logger } from './Logger.js';

/**
 * MultisigManager
 * Handles creation and management of multisig wallets for Nostr and Bittensor
 * Funds from inference rewards are directed to these multisigs
 * A weekly sweep moves funds to EVM multisig unless denied
 */
export class MultisigManager {
  constructor(config) {
    this.config = config;
    this.logger = new Logger('MultisigManager');
    this.multisigs = new Map();
    this.pendingSweeps = new Map(); // Track pending fund movements
    this.evmAddress = null;
  }

  async initialize() {
    this.logger.info('Initializing multisig manager...');
    
    // User only provides EVM address
    this.evmAddress = this.config.evmAddress || this.config.walletAddress;
    
    if (!this.evmAddress) {
      this.logger.warn('No EVM address configured - multisigs cannot be created');
      return;
    }

    // Generate deterministic multisig addresses from EVM address
    await this.createNostrMultisig();
    await this.createBittensorMultisig();
    await this.createEVMMultisig();

    this.logger.info('Multisig manager initialized');
  }

  /**
   * Create Nostr multisig (Cashu NIP-60 P2SH)
   * Uses the EVM address as derivation seed
   */
  async createNostrMultisig() {
    this.logger.info('Creating Nostr multisig from EVM address...');
    
    // Generate deterministic nostr multisig from EVM address
    // In production, this would create a Cashu NIP-60 P2SH multisig
    const nostrMultisigId = this.deriveAddress(this.evmAddress, 'nostr');
    const nostrPubkeys = this.derivePubkeys(this.evmAddress, 3); // 3 signers
    const nostrThreshold = 2; // 2-of-3 threshold

    this.multisigs.set('nostr', {
      type: 'nostr',
      network: 'nostr',
      protocol: 'cashu-nip60-p2sh',
      address: nostrMultisigId,
      pubkeys: nostrPubkeys,
      threshold: nostrThreshold,
      evmParent: this.evmAddress,
      status: 'active',
      createdAt: Date.now()
    });

    this.logger.info(`Nostr multisig created: ${this.maskAddress(nostrMultisigId)} (2-of-3)`);
  }

  /**
   * Create Bittensor multisig (Substrate native)
   * Uses the EVM address as derivation seed
   */
  async createBittensorMultisig() {
    this.logger.info('Creating Bittensor multisig from EVM address...');
    
    // Generate deterministic bittensor multisig from EVM address
    // In production, this would create a Substrate multisig
    const bittensorMultisigId = this.deriveAddress(this.evmAddress, 'bittensor');
    const bittensorSigners = this.derivePubkeys(this.evmAddress, 3); // 3 signers
    const bittensorThreshold = 2; // 2-of-3 threshold

    this.multisigs.set('bittensor', {
      type: 'bittensor',
      network: 'bittensor',
      protocol: 'substrate-multisig',
      address: bittensorMultisigId,
      signers: bittensorSigners,
      threshold: bittensorThreshold,
      evmParent: this.evmAddress,
      status: 'active',
      createdAt: Date.now()
    });

    this.logger.info(`Bittensor multisig created: ${this.maskAddress(bittensorMultisigId)} (2-of-3)`);
  }

  /**
   * Create EVM multisig (Gnosis Safe or similar)
   * This is the destination for weekly sweeps
   */
  async createEVMMultisig() {
    this.logger.info('Creating EVM multisig...');
    
    // In production, this would deploy a Gnosis Safe or similar
    // For now, we use the provided EVM address as the destination
    // (In real implementation, this would be a true multisig contract)
    const evmMultisig = this.evmAddress; // Placeholder for actual multisig contract

    this.multisigs.set('evm', {
      type: 'evm',
      network: 'evm',
      protocol: 'gnosis-safe',
      address: evmMultisig,
      threshold: 2, // 2-of-3
      evmParent: this.evmAddress,
      status: 'active',
      createdAt: Date.now()
    });

    this.logger.info(`EVM multisig configured: ${this.maskAddress(evmMultisig)}`);
  }

  /**
   * Derive a deterministic address from EVM address + network
   */
  deriveAddress(evmAddress, network) {
    // In production, use proper key derivation (e.g., BIP32/44)
    // This is a simplified deterministic derivation
    const seed = `${evmAddress}:${network}:multisig`;
    const hash = this.simpleHash(seed);
    
    if (network === 'nostr') {
      // Nostr npub format
      return `npub1${hash.substring(0, 58)}`;
    } else if (network === 'bittensor') {
      // Bittensor SS58 format (starts with 5)
      return `5${hash.substring(0, 46)}`;
    }
    return hash;
  }

  /**
   * Derive multiple pubkeys for multisig signers
   */
  derivePubkeys(evmAddress, count) {
    const pubkeys = [];
    for (let i = 0; i < count; i++) {
      const seed = `${evmAddress}:signer:${i}`;
      const hash = this.simpleHash(seed);
      pubkeys.push(`0x${hash.substring(0, 64)}`);
    }
    return pubkeys;
  }

  /**
   * Simple hash function for deterministic derivation
   * In production, use proper cryptographic hashing
   */
  simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    // Convert to hex string
    const hex = Math.abs(hash).toString(16).repeat(20); // Ensure 40 chars
    return hex.substring(0, 64); // Return 64 chars
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
   * Initiate a fund sweep from network multisig to EVM multisig
   * Triggers the 2-day denial window
   */
  async initiateSweep(network, amount) {
    this.logger.info(`Initiating sweep from ${network} to EVM...`);
    
    const sourceMultisig = this.multisigs.get(network);
    const targetMultisig = this.multisigs.get('evm');
    
    if (!sourceMultisig || !targetMultisig) {
      throw new Error('Multisig not found');
    }

    const sweepId = `sweep-${network}-${Date.now()}`;
    const scheduledTime = Date.now() + (2 * 24 * 60 * 60 * 1000); // 2 days from now

    this.pendingSweeps.set(sweepId, {
      id: sweepId,
      network,
      amount,
      source: sourceMultisig.address,
      target: targetMultisig.address,
      status: 'pending',
      createdAt: Date.now(),
      scheduledAt: scheduledTime,
      denied: false,
      executed: false
    });

    this.logger.info(`Sweep ${sweepId} scheduled for ${new Date(scheduledTime).toISOString()}`);
    this.logger.info(`Denial window: 2 days. Execute 'denySweep("${sweepId}")' to cancel.`);

    // Set timeout for automatic execution after 2 days
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

    this.logger.info(`Executing sweep ${sweepId}...`);
    
    // In production, this would:
    // 1. Build the transaction from source multisig
    // 2. Collect signatures (2-of-3)
    // 3. Broadcast to network
    
    sweep.executed = true;
    sweep.status = 'completed';
    sweep.executedAt = Date.now();

    this.logger.info(`Sweep ${sweepId} completed: ${sweep.amount} from ${sweep.network} → EVM`);
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
      evmAddress: this.evmAddress ? this.maskAddress(this.evmAddress) : null,
      multisigs: Object.fromEntries(
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
      pendingSweeps: this.getPendingSweeps().map(s => ({
        id: s.id,
        network: s.network,
        amount: s.amount,
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
