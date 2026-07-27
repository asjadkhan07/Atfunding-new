import { db } from '../firebase';
import { collection, addDoc, doc, setDoc, onSnapshot, query, orderBy, limit } from 'firebase/firestore';

export interface SpikeConfig {
  enabled: boolean;
  symbol: string;
  pipSize: number;
  direction: 'Up' | 'Down';
  applyTo: 'Next Candle Only' | 'Current Candle';
  autoReset: boolean;
  statusMessage: string;
  adminEmail?: string;
  updatedAt?: string;
}

export interface MarketEventLog {
  id?: string;
  eventType: 'SPIKE';
  symbol: string;
  pipSize: number;
  direction: 'Up' | 'Down';
  applyTo: 'Next Candle Only' | 'Current Candle';
  autoReset: boolean;
  adminEmail: string;
  timestamp: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
}

export const DEFAULT_SPIKE_CONFIG: SpikeConfig = {
  enabled: false,
  symbol: 'EURUSD',
  pipSize: 100,
  direction: 'Up',
  applyTo: 'Next Candle Only',
  autoReset: true,
  statusMessage: 'Market Control: Idle (Standard Simulation)',
  adminEmail: 'ATgrowfund@gmail.com',
};

let localSpikeConfig: SpikeConfig = { ...DEFAULT_SPIKE_CONFIG };
let stabilizationCandlesRemaining: Record<string, number> = {};
let spikeProgressMap: Record<string, { startPrice: number; targetDelta: number; currentDelta: number; stepCount: number }> = {};

// Convert pips to exact price movement for any symbol
export function pipToPriceDelta(symbol: string, pips: number): number {
  const sym = (symbol || 'EURUSD').toUpperCase();
  if (sym.includes('JPY')) return pips * 0.01;                           // 1 pip = 0.01 Yen
  if (sym === 'XAUUSD') return pips * 0.10;                              // 1 pip = $0.10 Gold
  if (sym === 'XAGUSD') return pips * 0.01;                              // 1 pip = $0.01 Silver
  if (sym === 'BTCUSD') return pips * 1.00;                              // 1 pip = $1.00 Bitcoin
  if (sym === 'ETHUSD') return pips * 0.10;                              // 1 pip = $0.10 Ethereum
  if (['NAS100', 'US30', 'SPX500'].includes(sym)) return pips * 0.10;    // Indices
  return pips * 0.0001;                                                 // Standard Forex Majors
}

/**
  Listen to Firestore settings/marketControl for real-time synchronization across all tabs and services
*/
if (typeof window !== 'undefined') {
  onSnapshot(doc(db, 'settings', 'marketControl'), (snapshot) => {
    if (snapshot.exists()) {
      const data = snapshot.data() as SpikeConfig;
      localSpikeConfig = { ...DEFAULT_SPIKE_CONFIG, ...data };
    }
  }, (err) => {
    console.warn("Market Control Snapshot Error (using local state fallback):", err);
  });
}

export function getSpikeConfig(): SpikeConfig {
  return { ...localSpikeConfig };
}

/**
 * Trigger or update Market Spike configuration from Admin Panel
 */
export async function setSpikeConfig(config: SpikeConfig, adminEmail: string = 'ATgrowfund@gmail.com'): Promise<void> {
  const statusMsg = config.enabled
    ? `Current Market Event: ${config.pipSize} Pip ${config.direction} Spike on ${config.symbol}`
    : 'Market Control: Idle (Standard Simulation)';

  const updated: SpikeConfig = {
    ...config,
    statusMessage: statusMsg,
    adminEmail,
    updatedAt: new Date().toISOString(),
  };

  localSpikeConfig = updated;

  // Sync to Firestore
  try {
    await setDoc(doc(db, 'settings', 'marketControl'), updated);

    // Log event if enabled
    if (config.enabled) {
      await addDoc(collection(db, 'marketEvents'), {
        eventType: 'SPIKE',
        symbol: config.symbol,
        pipSize: config.pipSize,
        direction: config.direction,
        applyTo: config.applyTo,
        autoReset: config.autoReset,
        adminEmail,
        timestamp: new Date().toISOString(),
        status: 'ACTIVE',
      });
    }
  } catch (e) {
    console.warn("Could not save marketControl to Firestore:", e);
  }
}

/**
 * Reset Spike status back to idle
 */
export async function resetSpikeConfig(adminEmail: string = 'ATgrowfund@gmail.com'): Promise<void> {
  await setSpikeConfig({
    ...DEFAULT_SPIKE_CONFIG,
    enabled: false,
    statusMessage: 'Market Control: Idle (Standard Simulation)',
  }, adminEmail);
}

/**
 * Complete an active spike event and log completion to Firestore
 */
export async function completeSpikeEvent(symbol: string): Promise<void> {
  if (!localSpikeConfig.enabled || localSpikeConfig.symbol !== symbol) return;

  const adminEmail = localSpikeConfig.adminEmail || 'ATgrowfund@gmail.com';
  
  // Set stabilization candles for smooth decay
  stabilizationCandlesRemaining[symbol] = 4;
  delete spikeProgressMap[symbol];

  if (localSpikeConfig.autoReset) {
    localSpikeConfig = {
      ...localSpikeConfig,
      enabled: false,
      statusMessage: 'Market Control: Idle (Standard Simulation)',
      updatedAt: new Date().toISOString(),
    };

    try {
      await setDoc(doc(db, 'settings', 'marketControl'), localSpikeConfig);

      await addDoc(collection(db, 'marketEvents'), {
        eventType: 'SPIKE',
        symbol: localSpikeConfig.symbol,
        pipSize: localSpikeConfig.pipSize,
        direction: localSpikeConfig.direction,
        applyTo: localSpikeConfig.applyTo,
        autoReset: localSpikeConfig.autoReset,
        adminEmail,
        timestamp: new Date().toISOString(),
        status: 'COMPLETED',
      });
    } catch (e) {
      console.warn("Error recording completed market event:", e);
    }
  }
}

/**
 * Helper called by priceEngine during tick updates to check if active spike applies
 */
export function processSpikeTickDelta(symbol: string, currentPrice: number): number | null {
  if (localSpikeConfig.enabled && localSpikeConfig.symbol === symbol) {
    const dirMult = localSpikeConfig.direction === 'Up' ? 1 : -1;
    const fullTargetDelta = dirMult * pipToPriceDelta(symbol, localSpikeConfig.pipSize);

    if (!spikeProgressMap[symbol]) {
      spikeProgressMap[symbol] = {
        startPrice: currentPrice,
        targetDelta: fullTargetDelta,
        currentDelta: 0,
        stepCount: 0,
      };
    }

    const progress = spikeProgressMap[symbol];
    const totalStepsNeeded = 8; // Smoothly step over ~8 ticks (~2-3 seconds)
    
    if (progress.stepCount < totalStepsNeeded) {
      progress.stepCount++;
      const stepDelta = fullTargetDelta / totalStepsNeeded;
      progress.currentDelta += stepDelta;
      return currentPrice + stepDelta;
    } else {
      // Reached target price!
      if (localSpikeConfig.applyTo === 'Current Candle') {
        completeSpikeEvent(symbol);
      }
      return currentPrice;
    }
  }

  return null;
}

/**
 * Handle stabilization decay candle count after a spike
 */
export function notifyCandleCloseForSpike(symbol: string) {
  if (localSpikeConfig.enabled && localSpikeConfig.symbol === symbol && localSpikeConfig.applyTo === 'Next Candle Only') {
    completeSpikeEvent(symbol);
  } else if (stabilizationCandlesRemaining[symbol] && stabilizationCandlesRemaining[symbol] > 0) {
    stabilizationCandlesRemaining[symbol]--;
  }
}

export function getStabilizationFactor(symbol: string): number {
  const rem = stabilizationCandlesRemaining[symbol] || 0;
  if (rem > 0) {
    return 1.0 + (rem * 0.15); // Smooth decay 1.6x -> 1.45x -> 1.30x -> 1.15x -> 1.0x
  }
  return 1.0;
}

/**
 * Realtime subscription to marketEvents log in Firestore
 */
export function subscribeToMarketEvents(callback: (events: MarketEventLog[]) => void): () => void {
  const q = query(collection(db, 'marketEvents'), orderBy('timestamp', 'desc'), limit(50));
  return onSnapshot(q, (snapshot) => {
    const list: MarketEventLog[] = [];
    snapshot.forEach((doc) => {
      list.push({ id: doc.id, ...doc.data() as any });
    });
    callback(list);
  }, (err) => {
    console.warn("Market Events Subscription Error:", err);
    callback([]);
  });
}
