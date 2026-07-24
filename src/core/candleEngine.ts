import { subscribeToPrices, SymbolPrice, DECIMAL_PLACES, priceEngineState, BASE_MID_PRICES, TICK_STEP_MAP } from './priceEngine';

export interface Candle {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export const TIMEFRAMES = ['1m', '5m', '15m', '30m', '1H', '4H', '1D'] as const;
export type Timeframe = typeof TIMEFRAMES[number];

export const TIMEFRAME_SECS: Record<Timeframe, number> = {
  '1m': 60,
  '5m': 300,
  '15m': 900,
  '30m': 1800,
  '1H': 3600,
  '4H': 14400,
  '1D': 86400,
};

export function normalizeTimeframe(tf: string): Timeframe {
  if (tf === '1' || tf === '1m') return '1m';
  if (tf === '5' || tf === '5m') return '5m';
  if (tf === '15' || tf === '15m') return '15m';
  if (tf === '30' || tf === '30m') return '30m';
  if (tf === '60' || tf === '1H' || tf === '1h') return '1H';
  if (tf === '240' || tf === '4H' || tf === '4h') return '4H';
  if (tf === 'D' || tf === '1D' || tf === '1d' || tf === 'D1') return '1D';
  return '1m';
}

// Single Source of Truth Base Cache: 1m candles for each symbol
const m1CandleCache: Record<string, Candle[]> = {};

// Derived Candle Cache for all timeframes
const candleCache: Record<string, Record<string, Candle[]>> = {};

// Engine tracking for gap catch-up & validation metrics
const missingCandlesGeneratedMap: Record<string, number> = {};
const lastSavedCandleTimeMap: Record<string, number> = {};

// Subscriber management
type CandleListener = (candles: Candle[]) => void;
const listeners: Record<string, Record<string, Set<CandleListener>>> = {};

// Database setup for 1m base candles
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB not supported'));
      return;
    }
    const request = indexedDB.open('ATFundingTerminalDB_v9', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('candles_1m')) {
        db.createObjectStore('candles_1m');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function purgeAllIndexedDB(): Promise<void> {
  if (typeof window === 'undefined' || !window.indexedDB) return;
  const dbs = [
    'ATFundingTerminalDB_v9',
    'ATFundingTerminalDB_v8',
    'ATFundingTerminalDB_v7',
    'ATFundingTerminalDB_v6',
    'ATFundingTerminalDB_v5',
    'ATFundingTerminalDB_v4',
    'ATFundingTerminalDB_v3',
    'ATFundingTerminalDB_v2',
    'ATFundingTerminalDB',
  ];
  for (const dbName of dbs) {
    try {
      indexedDB.deleteDatabase(dbName);
    } catch (e) {
      // ignore
    }
  }
}

function loadM1CandlesFromDB(db: IDBDatabase, symbol: string): Promise<Candle[] | null> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('candles_1m', 'readonly');
      const store = tx.objectStore('candles_1m');
      const req = store.get(symbol);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function saveM1CandlesToDB(db: IDBDatabase, symbol: string, candles: Candle[]): Promise<void> {
  return new Promise((resolve) => {
    try {
      const tx = db.transaction('candles_1m', 'readwrite');
      const store = tx.objectStore('candles_1m');
      store.put(candles, symbol);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

const LS_M1_PREFIX = 'atfunding_m1_candles_V6_';
const LS_TREND_MGR_PREFIX = 'atfunding_trend_mgr_v5_';

export function loadTrendEngineManager(symbol: string): TrendEngineManager | null {
  try {
    const raw = localStorage.getItem(LS_TREND_MGR_PREFIX + symbol);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.state && typeof parsed.candlesInState === 'number') {
        return parsed;
      }
    }
  } catch (e) {}
  return null;
}

export function saveTrendEngineManager(symbol: string, mgr: TrendEngineManager): void {
  try {
    localStorage.setItem(LS_TREND_MGR_PREFIX + symbol, JSON.stringify(mgr));
  } catch (e) {}
}

const activeTrendManagers: Record<string, TrendEngineManager> = {};

async function loadM1CandlesFromStorage(db: IDBDatabase | null, symbol: string): Promise<Candle[] | null> {
  if (db) {
    const dbCandles = await loadM1CandlesFromDB(db, symbol);
    if (dbCandles && dbCandles.length > 0) return dbCandles;
  }
  // LocalStorage Fallback
  try {
    const raw = localStorage.getItem(LS_M1_PREFIX + symbol);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {}
  return null;
}

async function saveM1CandlesToStorage(db: IDBDatabase | null, symbol: string, candles: Candle[]): Promise<void> {
  if (db) {
    await saveM1CandlesToDB(db, symbol, candles);
  }
  try {
    const slice = candles.slice(-14400);
    localStorage.setItem(LS_M1_PREFIX + symbol, JSON.stringify(slice));
  } catch (e) {}
}

function getSessionVolatilityMultiplier(timestampSecs: number): number {
  const date = new Date(timestampSecs * 1000);
  const hour = date.getUTCHours();
  if (hour >= 12 && hour < 15) return 1.8; // Peak London + NY Overlap
  if (hour >= 7 && hour < 12)  return 1.4; // London Session
  if (hour >= 15 && hour < 21) return 1.5; // New York Session
  return 0.8;                             // Asian / Off-peak Session
}

/**
 * Aggregates base 1m candles into higher timeframe candles.
 * Guarantees open = first 1m open, close = last 1m close, high = max high, low = min low.
 */
export function buildCandlesForTimeframe(m1Candles: Candle[], timeframe: Timeframe, decimals: number): Candle[] {
  const interval = TIMEFRAME_SECS[timeframe];
  if (interval === 60) return m1Candles;
  if (!m1Candles || m1Candles.length === 0) return [];

  const result: Candle[] = [];
  let currentGroup: Candle | null = null;

  for (let i = 0; i < m1Candles.length; i++) {
    const c = m1Candles[i];
    const blockTime = Math.floor(c.time / interval) * interval;

    if (!currentGroup || currentGroup.time !== blockTime) {
      if (currentGroup) {
        result.push(currentGroup);
      }
      currentGroup = {
        time: blockTime,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      };
    } else {
      if (c.high > currentGroup.high) currentGroup.high = Number(c.high.toFixed(decimals));
      if (c.low < currentGroup.low) currentGroup.low = Number(c.low.toFixed(decimals));
      currentGroup.close = Number(c.close.toFixed(decimals));
    }
  }

  if (currentGroup) {
    result.push(currentGroup);
  }

  return result;
}

export type MarketRegime = 'Range' | 'Trending Up' | 'Trending Down' | 'Breakout';

export type SubPhase = 'TrendLeg' | 'Pullback' | 'Continuation' | 'Consolidation' | 'Breakout' | 'Retest';

export type PatternType = 'NORMAL' | 'PIN_BAR' | 'ENGULFING' | 'INDECISION' | 'LIQUIDITY_SWEEP';

export function getMaxConsecutiveCandles(symbol: string): number {
  if (symbol === 'XAUUSD' || symbol === 'XAGUSD') {
    // Gold/Metals: 3-6 candles maximum before pullback
    return 3 + Math.floor(Math.random() * 4);
  }
  if (symbol === 'BTCUSD' || symbol === 'ETHUSD') {
    // Crypto: 2-10 candles maximum before pullback
    return 2 + Math.floor(Math.random() * 9);
  }
  if (symbol === 'NAS100' || symbol === 'US30' || symbol === 'SPX500') {
    // Indices: 3-8 candles maximum before pullback
    return 3 + Math.floor(Math.random() * 6);
  }
  // Forex & Energy: 3-7 candles maximum before pullback
  return 3 + Math.floor(Math.random() * 5);
}

interface TrendEngineManager {
  state: MarketRegime;
  mainDirection: number; // 1 = up, -1 = down, 0 = neutral
  candlesInState: number;
  stateDuration: number;
  
  // Sub-phase engine
  subPhase: SubPhase;
  subPhaseCandles: number;
  subPhaseDuration: number;
  
  // Range boundaries tracking
  rangeMidPrice: number;
  
  // Consecutive same color & pullback limit tracking
  consecutiveSameColorCount: number;
  lastCandleColor: number; // 1 = green, -1 = red
  maxSameColorLimit: number;
  
  // Retracement calculation
  trendLegStartPrice: number;
  trendLegExtremumPrice: number;
  retraceTargetPrice: number | null;
  
  // Liquidity sweeps
  candlesSinceSweep: number;
  sweepTrigger: number;
}

function selectNextMarketState(prevState?: MarketRegime, lastDirection: number = 1): { state: MarketRegime; duration: number; mainDir: number } {
  const rand = Math.random();
  let state: MarketRegime;
  let duration: number;
  let mainDir = 0;

  if (rand < 0.45) {
    if (lastDirection !== 0) {
      mainDir = Math.random() < 0.82 ? lastDirection : -lastDirection;
    } else {
      mainDir = Math.random() < 0.5 ? 1 : -1;
    }
    state = mainDir === 1 ? 'Trending Up' : 'Trending Down';
    duration = 15 + Math.floor(Math.random() * 26);
  } else if (rand < 0.80) {
    state = 'Range';
    duration = 15 + Math.floor(Math.random() * 26);
    mainDir = 0;
  } else {
    state = 'Breakout';
    duration = 15 + Math.floor(Math.random() * 21);
    mainDir = Math.random() < 0.5 ? 1 : -1;
  }

  return { state, duration, mainDir };
}

function createTrendEngineManager(initialDir?: number, symbol: string = 'EURUSD'): TrendEngineManager {
  const initial = selectNextMarketState();
  if (initialDir !== undefined && initialDir !== 0) {
    initial.mainDir = initialDir;
    initial.state = initialDir === 1 ? 'Trending Up' : 'Trending Down';
  }

  let initialSub: SubPhase = 'TrendLeg';
  let initialSubDur = 3 + Math.floor(Math.random() * 5);
  if (initial.state === 'Range') {
    initialSub = 'Consolidation';
    initialSubDur = initial.duration;
  } else if (initial.state === 'Breakout') {
    initialSub = 'Consolidation';
    initialSubDur = 3 + Math.floor(Math.random() * 6);
  }

  const maxLimit = getMaxConsecutiveCandles(symbol);

  return {
    state: initial.state,
    mainDirection: initial.mainDir,
    candlesInState: 0,
    stateDuration: initial.duration,
    subPhase: initialSub,
    subPhaseCandles: 0,
    subPhaseDuration: initialSubDur,
    rangeMidPrice: 0,
    consecutiveSameColorCount: 0,
    lastCandleColor: 0,
    maxSameColorLimit: maxLimit,
    trendLegStartPrice: 0,
    trendLegExtremumPrice: 0,
    retraceTargetPrice: null,
    candlesSinceSweep: 0,
    sweepTrigger: 12 + Math.floor(Math.random() * 18),
  };
}

function getNextCandleConfig(
  mgr: TrendEngineManager,
  currentPrice: number,
  symbol: string
): {
  candleBias: number;
  driftMultiplier: number;
  patternType: PatternType;
  isLiquiditySweep: boolean;
} {
  mgr.candlesInState++;
  mgr.subPhaseCandles++;
  mgr.candlesSinceSweep++;

  if (!mgr.maxSameColorLimit) {
    mgr.maxSameColorLimit = getMaxConsecutiveCandles(symbol);
  }

  if (!mgr.trendLegStartPrice) {
    mgr.trendLegStartPrice = currentPrice;
    mgr.trendLegExtremumPrice = currentPrice;
  }

  // Track move extremum
  if (mgr.mainDirection === 1) {
    if (currentPrice > mgr.trendLegExtremumPrice) mgr.trendLegExtremumPrice = currentPrice;
  } else if (mgr.mainDirection === -1) {
    if (currentPrice < mgr.trendLegExtremumPrice || mgr.trendLegExtremumPrice === 0) mgr.trendLegExtremumPrice = currentPrice;
  }

  // 1. Regime transition
  if (mgr.candlesInState >= mgr.stateDuration) {
    const next = selectNextMarketState(mgr.state, mgr.mainDirection !== 0 ? mgr.mainDirection : 1);
    mgr.state = next.state;
    mgr.mainDirection = next.mainDir;
    mgr.candlesInState = 0;
    mgr.stateDuration = next.duration;
    mgr.subPhaseCandles = 0;
    mgr.consecutiveSameColorCount = 0;
    mgr.maxSameColorLimit = getMaxConsecutiveCandles(symbol);
    mgr.trendLegStartPrice = currentPrice;
    mgr.trendLegExtremumPrice = currentPrice;
    mgr.retraceTargetPrice = null;

    if (mgr.state === 'Trending Up' || mgr.state === 'Trending Down') {
      mgr.subPhase = 'TrendLeg';
      mgr.subPhaseDuration = 3 + Math.floor(Math.random() * 5); // 3 to 7 candles
    } else if (mgr.state === 'Range') {
      mgr.subPhase = 'Consolidation';
      mgr.subPhaseDuration = mgr.stateDuration;
      mgr.rangeMidPrice = currentPrice;
    } else {
      mgr.subPhase = 'Consolidation';
      mgr.subPhaseDuration = 3 + Math.floor(Math.random() * 6);
    }
  }

  // 2. FORCE PULLBACK IF MAX SAME COLOR CANDLE LIMIT REACHED (3-7 Forex, 3-6 Gold, 2-10 Crypto, 3-8 Indices)
  let forcePullback = false;
  if (mgr.consecutiveSameColorCount >= mgr.maxSameColorLimit && (mgr.state === 'Trending Up' || mgr.state === 'Trending Down' || mgr.state === 'Breakout')) {
    forcePullback = true;
    mgr.subPhase = 'Pullback';
    mgr.subPhaseCandles = 0;
    mgr.subPhaseDuration = 1 + Math.floor(Math.random() * 3); // 1 to 3 pullback candles
    mgr.consecutiveSameColorCount = 0;
    mgr.maxSameColorLimit = getMaxConsecutiveCandles(symbol);

    const legMagnitude = Math.abs(mgr.trendLegExtremumPrice - mgr.trendLegStartPrice);
    if (legMagnitude > 0) {
      const retraceRatio = 0.20 + Math.random() * 0.40; // 20% to 60% retrace
      const retraceDist = legMagnitude * retraceRatio;
      mgr.retraceTargetPrice = mgr.mainDirection === 1
        ? mgr.trendLegExtremumPrice - retraceDist
        : mgr.trendLegExtremumPrice + retraceDist;
    }
  }

  // 3. Sub-phase transitions
  if (!forcePullback && (mgr.state === 'Trending Up' || mgr.state === 'Trending Down')) {
    if (mgr.subPhaseCandles >= mgr.subPhaseDuration) {
      mgr.subPhaseCandles = 0;
      if (mgr.subPhase === 'TrendLeg' || mgr.subPhase === 'Continuation') {
        mgr.subPhase = 'Pullback';
        mgr.subPhaseDuration = 1 + Math.floor(Math.random() * 4); // 1 to 4 candles
        mgr.consecutiveSameColorCount = 0;
        mgr.maxSameColorLimit = getMaxConsecutiveCandles(symbol);

        const legMagnitude = Math.abs(mgr.trendLegExtremumPrice - mgr.trendLegStartPrice);
        if (legMagnitude > 0) {
          const retraceRatio = 0.20 + Math.random() * 0.40;
          const retraceDist = legMagnitude * retraceRatio;
          mgr.retraceTargetPrice = mgr.mainDirection === 1
            ? mgr.trendLegExtremumPrice - retraceDist
            : mgr.trendLegExtremumPrice + retraceDist;
        }
      } else if (mgr.subPhase === 'Pullback') {
        mgr.subPhase = 'Continuation';
        mgr.subPhaseDuration = 3 + Math.floor(Math.random() * 5); // 3 to 7 candles
        mgr.consecutiveSameColorCount = 0;
        mgr.maxSameColorLimit = getMaxConsecutiveCandles(symbol);
        mgr.trendLegStartPrice = currentPrice;
        mgr.trendLegExtremumPrice = currentPrice;
        mgr.retraceTargetPrice = null;
      }
    }
  } else if (!forcePullback && mgr.state === 'Breakout') {
    if (mgr.subPhaseCandles >= mgr.subPhaseDuration) {
      mgr.subPhaseCandles = 0;
      if (mgr.subPhase === 'Consolidation') {
        mgr.subPhase = 'Breakout';
        mgr.subPhaseDuration = 1 + Math.floor(Math.random() * 3);
      } else if (mgr.subPhase === 'Breakout') {
        mgr.subPhase = 'Retest';
        mgr.subPhaseDuration = 1 + Math.floor(Math.random() * 2);
      } else if (mgr.subPhase === 'Retest') {
        mgr.subPhase = 'Continuation';
        mgr.subPhaseDuration = 3 + Math.floor(Math.random() * 5);
      }
    }
  }

  // 4. Check Liquidity Sweep
  let isLiquiditySweep = false;
  if (mgr.candlesSinceSweep >= mgr.sweepTrigger) {
    isLiquiditySweep = true;
    mgr.candlesSinceSweep = 0;
    mgr.sweepTrigger = 12 + Math.floor(Math.random() * 18);
  }

  let candleBias = 0;
  let driftMultiplier = 1.0;
  let patternType: PatternType = 'NORMAL';

  const mainDir = mgr.state === 'Trending Up' ? 1 : mgr.state === 'Trending Down' ? -1 : (mgr.mainDirection !== 0 ? mgr.mainDirection : 1);

  if (mgr.subPhase === 'Pullback') {
    candleBias = -mainDir;
    driftMultiplier = 1.0 + Math.random() * 0.5;

    const randPattern = Math.random();
    if (randPattern < 0.22) patternType = 'PIN_BAR';
    else if (randPattern < 0.38) patternType = 'INDECISION';
    else if (randPattern < 0.52) patternType = 'ENGULFING';
  } else if (mgr.state === 'Trending Up' || mgr.state === 'Trending Down') {
    candleBias = Math.random() < 0.82 ? mainDir : -mainDir;
    driftMultiplier = 1.4 + Math.random() * 0.8;

    const randPattern = Math.random();
    if (randPattern < 0.16) patternType = 'ENGULFING';
    else if (randPattern < 0.28) patternType = 'PIN_BAR';
    else if (randPattern < 0.38) patternType = 'INDECISION';
    else if (isLiquiditySweep) patternType = 'LIQUIDITY_SWEEP';
  } else if (mgr.state === 'Range') {
    const baseMid = BASE_MID_PRICES[symbol] || currentPrice;
    const rangeBound = baseMid * 0.0018;

    if (currentPrice >= (mgr.rangeMidPrice || baseMid) + rangeBound) {
      candleBias = Math.random() < 0.80 ? -1 : 1;
    } else if (currentPrice <= (mgr.rangeMidPrice || baseMid) - rangeBound) {
      candleBias = Math.random() < 0.80 ? 1 : -1;
    } else {
      candleBias = Math.random() < 0.50 ? 1 : -1;
    }
    driftMultiplier = 0.5 + Math.random() * 0.4;

    const randPattern = Math.random();
    if (randPattern < 0.25) patternType = 'INDECISION';
    else if (randPattern < 0.45) patternType = 'PIN_BAR';
    else if (isLiquiditySweep) patternType = 'LIQUIDITY_SWEEP';
  } else if (mgr.state === 'Breakout') {
    const bDir = mgr.mainDirection !== 0 ? mgr.mainDirection : 1;
    if (mgr.subPhase === 'Consolidation') {
      candleBias = Math.random() < 0.50 ? 1 : -1;
      driftMultiplier = 0.4 + Math.random() * 0.3;
      patternType = Math.random() < 0.30 ? 'INDECISION' : 'NORMAL';
    } else if (mgr.subPhase === 'Breakout') {
      candleBias = bDir;
      driftMultiplier = 2.5 + Math.random() * 1.5;
      patternType = 'ENGULFING';
    } else if (mgr.subPhase === 'Retest') {
      candleBias = -bDir;
      driftMultiplier = 0.8 + Math.random() * 0.4;
      patternType = 'PIN_BAR';
    } else {
      candleBias = Math.random() < 0.80 ? bDir : -bDir;
      driftMultiplier = 1.6 + Math.random() * 0.8;
    }
  }

  return {
    candleBias,
    driftMultiplier,
    patternType,
    isLiquiditySweep,
  };
}

/**
  * Simulates a single 1m candle by running a full internal micro-tick simulation path (60-100 ticks).
  * Guarantees intracandle price oscillation, path randomization (Open->High->Low->Close or Open->Low->High->Close),
  * 40% reduced wicks, medium body structure, and clean price action.
  */
function simulate1mCandleViaTicks(
  symbol: string,
  candleTime: number,
  openPrice: number,
  targetPrice: number | null,
  decimals: number,
  candleBias: number,
  driftMultiplier: number = 1.0,
  isLiquiditySweep: boolean = false,
  patternType: PatternType = 'NORMAL'
): Candle {
  const stepConfig = TICK_STEP_MAP[symbol] || { baseStep: 0.000012, maxStep: 0.00008 };
  const baseMid = BASE_MID_PRICES[symbol] || openPrice;
  const minAllowed = Number((baseMid * 0.90).toFixed(decimals));
  const maxAllowed = Number((baseMid * 1.10).toFixed(decimals));

  const tickCount = 60 + Math.floor(Math.random() * 41);

  let currentPrice = openPrice;
  let highPrice = openPrice;
  let lowPrice = openPrice;

  for (let t = 0; t < tickCount; t++) {
    const progress = t / tickCount;
    let tickDir = 0;

    if (patternType === 'PIN_BAR') {
      if (candleBias > 0) {
        // Bullish Pin Bar / Hammer: push down in first 65%, then recover strongly
        if (progress < 0.65) {
          tickDir = Math.random() < 0.80 ? -1 : 1;
        } else {
          tickDir = Math.random() < 0.88 ? 1 : -1;
        }
      } else {
        // Bearish Pin Bar / Shooting Star: push up in first 65%, then reject strongly
        if (progress < 0.65) {
          tickDir = Math.random() < 0.80 ? 1 : -1;
        } else {
          tickDir = Math.random() < 0.88 ? -1 : 1;
        }
      }
    } else if (patternType === 'INDECISION') {
      // Doji / Spinning top: oscillation returning near open
      if (progress < 0.40) {
        tickDir = Math.random() < 0.75 ? 1 : -1;
      } else if (progress < 0.80) {
        tickDir = Math.random() < 0.75 ? -1 : 1;
      } else {
        tickDir = currentPrice > openPrice ? -1 : 1;
      }
    } else if (patternType === 'ENGULFING') {
      // Strong directional body
      tickDir = Math.random() < 0.85 ? candleBias : -candleBias;
    } else if (isLiquiditySweep || patternType === 'LIQUIDITY_SWEEP') {
      if (progress < 0.35) {
        tickDir = Math.random() < 0.85 ? -candleBias : candleBias;
      } else {
        tickDir = Math.random() < 0.88 ? candleBias : -candleBias;
      }
    } else {
      // Normal candle path
      if (progress < 0.35) {
        tickDir = Math.random() < 0.70 ? -candleBias : candleBias;
      } else if (progress < 0.80) {
        tickDir = Math.random() < 0.80 ? candleBias : -candleBias;
      } else {
        tickDir = Math.random() < 0.70 ? candleBias : -candleBias;
      }
    }

    if (targetPrice !== null) {
      const remainingProgress = (t + 1) / tickCount;
      const targetStep = openPrice + (targetPrice - openPrice) * remainingProgress;
      if (currentPrice < targetStep && Math.random() < 0.5) {
        tickDir = 1;
      } else if (currentPrice > targetStep && Math.random() < 0.5) {
        tickDir = -1;
      }
    }

    const sessMult = getSessionVolatilityMultiplier(candleTime);
    const noise = 0.7 + Math.random() * 0.8;

    let patternMult = 1.0;
    if (patternType === 'ENGULFING') patternMult = 1.8;
    if (patternType === 'PIN_BAR' && progress < 0.65) patternMult = 1.5;
    if (patternType === 'LIQUIDITY_SWEEP') patternMult = 2.0;

    const isWickPhase = (progress < 0.08 || progress > 0.92) && !isLiquiditySweep && patternType !== 'PIN_BAR';
    const wickScale = isWickPhase ? 0.40 : 1.0;

    let step = stepConfig.baseStep * driftMultiplier * sessMult * noise * wickScale * patternMult;
    currentPrice += tickDir * step;
    currentPrice = Math.max(minAllowed, Math.min(maxAllowed, currentPrice));

    if (currentPrice > highPrice) highPrice = currentPrice;
    if (currentPrice < lowPrice) lowPrice = currentPrice;
  }

  const open = Number(openPrice.toFixed(decimals));
  const close = Number(currentPrice.toFixed(decimals));
  const high = Number(Math.max(highPrice, open, close).toFixed(decimals));
  const low = Number(Math.min(lowPrice, open, close).toFixed(decimals));

  const priceRange = Math.abs(close - open) + (high - low);
  const volBase = symbol === 'BTCUSD' ? 50 : symbol === 'XAUUSD' ? 300 : 500;
  const volume = Math.round(volBase + priceRange * (volBase * 10) * (0.8 + Math.random() * 0.4));

  return {
    time: candleTime,
    open,
    high,
    low,
    close,
    volume,
  };
}

/**
 * Generate historical 1m candles using full internal tick path simulation.
 * Guarantees candles have realistic bodies, wicks, volatility, and trend shifts.
 */
function generateHistorical1mCandles(
  symbol: string,
  targetPrice: number,
  decimals: number,
  existingMgr?: TrendEngineManager
): Candle[] {
  const interval = 60; // 1m interval
  const totalSecs = 10 * 86400; // 10 days of history
  const count = Math.ceil(totalSecs / interval);

  const basePrice = BASE_MID_PRICES[symbol] || targetPrice;
  const nowSecs = Math.floor(Date.now() / 1000);
  const currentBlockTime = Math.floor(nowSecs / interval) * interval;
  const startTime = currentBlockTime - (count - 1) * interval;

  const candles: Candle[] = [];
  let prevClose = basePrice;
  const trendMgr = existingMgr || loadTrendEngineManager(symbol) || createTrendEngineManager(0, symbol);
  activeTrendManagers[symbol] = trendMgr;

  for (let i = 0; i < count; i++) {
    const time = startTime + i * interval;
    const cfg = getNextCandleConfig(trendMgr, prevClose, symbol);

    const candle = simulate1mCandleViaTicks(
      symbol,
      time,
      prevClose,
      null,
      decimals,
      cfg.candleBias,
      cfg.driftMultiplier,
      cfg.isLiquiditySweep,
      cfg.patternType
    );

    const candleColor = candle.close >= candle.open ? 1 : -1;
    if (candleColor === trendMgr.lastCandleColor) {
      trendMgr.consecutiveSameColorCount++;
    } else {
      trendMgr.lastCandleColor = candleColor;
      trendMgr.consecutiveSameColorCount = 1;
    }

    candles.push(candle);
    prevClose = candle.close;
  }

  saveTrendEngineManager(symbol, trendMgr);
  return candles;
}

function isHistoryValid(candles: Candle[], symbol: string): boolean {
  if (!candles || candles.length === 0) return false;

  const basePrice = BASE_MID_PRICES[symbol] || candles[candles.length - 1].close;
  const minAllowed = basePrice * 0.90;
  const maxAllowed = basePrice * 1.10;

  for (const c of candles) {
    if (c.close < minAllowed || c.close > maxAllowed || c.open < minAllowed || c.open > maxAllowed) {
      return false;
    }
  }

  return true;
}

let activeDB: IDBDatabase | null = null;

export async function purgeAndRebuildAllCandles() {
  await purgeAllIndexedDB();

  try {
    activeDB = await openDB();
  } catch (e) {
    console.warn('Using in-memory candle storage');
  }

  const symbols = Object.keys(priceEngineState);

  for (const symbol of symbols) {
    candleCache[symbol] = {};
    if (!listeners[symbol]) listeners[symbol] = {};

    const decimals = DECIMAL_PLACES[symbol] || 4;
    const currentPrice = priceEngineState[symbol]?.last || BASE_MID_PRICES[symbol] || 1.14000;

    const fresh1mHistory = generateHistorical1mCandles(symbol, currentPrice, decimals);
    m1CandleCache[symbol] = fresh1mHistory;
    missingCandlesGeneratedMap[symbol] = 0;
    if (fresh1mHistory.length > 0) {
      const finalCandle = fresh1mHistory[fresh1mHistory.length - 1];
      lastSavedCandleTimeMap[symbol] = finalCandle.time;
      if (priceEngineState[symbol]) {
        const halfSpread = symbol === 'BTCUSD' ? 2.5 : symbol === 'XAUUSD' ? 0.10 : symbol === 'USDJPY' ? 0.008 : 0.00008;
        priceEngineState[symbol].last = finalCandle.close;
        priceEngineState[symbol].bid = Number((finalCandle.close - halfSpread).toFixed(decimals));
        priceEngineState[symbol].ask = Number((finalCandle.close + halfSpread).toFixed(decimals));
      }
    }

    if (activeDB) {
      await saveM1CandlesToDB(activeDB, symbol, fresh1mHistory);
    }

    // Populate higher timeframes via 1m aggregation
    for (const tf of TIMEFRAMES) {
      if (!listeners[symbol][tf]) {
        listeners[symbol][tf] = new Set<CandleListener>();
      }
      candleCache[symbol][tf] = buildCandlesForTimeframe(fresh1mHistory, tf, decimals);
      notifySubscribers(symbol, tf);
    }
  }
}

function notifySubscribers(symbol: string, tf: Timeframe) {
  const tfListeners = listeners[symbol]?.[tf];
  const candles = candleCache[symbol]?.[tf];
  if (tfListeners && tfListeners.size > 0 && candles) {
    const cloned = [...candles];
    tfListeners.forEach((listener) => {
      try {
        listener(cloned);
      } catch (e) {
        console.error('Error in candle listener:', e);
      }
    });
  }
}

// Main initialization with Gap Catch-Up Logic using Micro-Tick Simulation
export async function initializeCandleEngine() {
  try {
    activeDB = await openDB();
  } catch (e) {
    console.warn('Could not open IndexedDB, using transient memory storage:', e);
  }

  const symbols = Object.keys(priceEngineState);
  const nowSecs = Math.floor(Date.now() / 1000);
  const current1mBlockTime = Math.floor(nowSecs / 60) * 60;

  for (const symbol of symbols) {
    if (!candleCache[symbol]) candleCache[symbol] = {};
    if (!listeners[symbol]) listeners[symbol] = {};

    const decimals = DECIMAL_PLACES[symbol] || 4;
    const currentPrice = priceEngineState[symbol]?.last || BASE_MID_PRICES[symbol] || 1.14000;

    let loaded1m: Candle[] | null = await loadM1CandlesFromStorage(activeDB, symbol);

    if (loaded1m && loaded1m.length > 0 && isHistoryValid(loaded1m, symbol)) {
      const lastCandle = loaded1m[loaded1m.length - 1];
      const timeGapSecs = current1mBlockTime - lastCandle.time;
      const gapMinutes = Math.floor(timeGapSecs / 60);

      if (gapMinutes > 0) {
        // Gap detected! Generate missing 1m candles using full micro-tick simulation & natural trend persistence
        let prevClose = lastCandle.close;
        let trendMgr = loadTrendEngineManager(symbol) || createTrendEngineManager(currentPrice >= prevClose ? 1 : -1);
        activeTrendManagers[symbol] = trendMgr;

        for (let i = 1; i <= gapMinutes; i++) {
          const missingTime = lastCandle.time + i * 60;
          const cfg = getNextCandleConfig(trendMgr, prevClose, symbol);

          const new1mCandle = simulate1mCandleViaTicks(
            symbol,
            missingTime,
            prevClose,
            null, // Natural movement without artificial lerping
            decimals,
            cfg.candleBias,
            cfg.driftMultiplier,
            cfg.isLiquiditySweep,
            cfg.patternType
          );

          const candleColor = new1mCandle.close >= new1mCandle.open ? 1 : -1;
          if (candleColor === trendMgr.lastCandleColor) {
            trendMgr.consecutiveSameColorCount++;
          } else {
            trendMgr.lastCandleColor = candleColor;
            trendMgr.consecutiveSameColorCount = 1;
          }

          loaded1m.push(new1mCandle);
          prevClose = new1mCandle.close;
        }

        const finalCandle = loaded1m[loaded1m.length - 1];

        // Sync live price engine state to final backfilled candle price
        if (priceEngineState[symbol]) {
          const halfSpread = symbol === 'BTCUSD' ? 2.5 : symbol === 'XAUUSD' ? 0.10 : symbol === 'USDJPY' ? 0.008 : 0.00008;
          priceEngineState[symbol].last = finalCandle.close;
          priceEngineState[symbol].bid = Number((finalCandle.close - halfSpread).toFixed(decimals));
          priceEngineState[symbol].ask = Number((finalCandle.close + halfSpread).toFixed(decimals));
        }

        // Limit array to 14,400 candles (10 days)
        if (loaded1m.length > 14400) {
          loaded1m.splice(0, loaded1m.length - 14400);
        }

        missingCandlesGeneratedMap[symbol] = gapMinutes;
        lastSavedCandleTimeMap[symbol] = finalCandle.time;

        await saveM1CandlesToStorage(activeDB, symbol, loaded1m);
        saveTrendEngineManager(symbol, trendMgr);
      } else {
        // Up to date
        const finalCandle = loaded1m[loaded1m.length - 1];
        if (priceEngineState[symbol]) {
          const halfSpread = symbol === 'BTCUSD' ? 2.5 : symbol === 'XAUUSD' ? 0.10 : symbol === 'USDJPY' ? 0.008 : 0.00008;
          priceEngineState[symbol].last = finalCandle.close;
          priceEngineState[symbol].bid = Number((finalCandle.close - halfSpread).toFixed(decimals));
          priceEngineState[symbol].ask = Number((finalCandle.close + halfSpread).toFixed(decimals));
        }

        missingCandlesGeneratedMap[symbol] = 0;
        lastSavedCandleTimeMap[symbol] = finalCandle.time;
      }

      m1CandleCache[symbol] = loaded1m;
    } else {
      // First boot or invalid history -> generate full 10-day 1m candles
      const fresh1m = generateHistorical1mCandles(symbol, currentPrice, decimals);
      m1CandleCache[symbol] = fresh1m;
      missingCandlesGeneratedMap[symbol] = 0;
      if (fresh1m.length > 0) {
        const finalCandle = fresh1m[fresh1m.length - 1];
        lastSavedCandleTimeMap[symbol] = finalCandle.time;
        if (priceEngineState[symbol]) {
          const halfSpread = symbol === 'BTCUSD' ? 2.5 : symbol === 'XAUUSD' ? 0.10 : symbol === 'USDJPY' ? 0.008 : 0.00008;
          priceEngineState[symbol].last = finalCandle.close;
          priceEngineState[symbol].bid = Number((finalCandle.close - halfSpread).toFixed(decimals));
          priceEngineState[symbol].ask = Number((finalCandle.close + halfSpread).toFixed(decimals));
        }
      }
      await saveM1CandlesToStorage(activeDB, symbol, fresh1m);
    }

    // Build all timeframes from the 1m base candles
    const m1Candles = m1CandleCache[symbol];
    for (const tf of TIMEFRAMES) {
      if (!listeners[symbol][tf]) {
        listeners[symbol][tf] = new Set<CandleListener>();
      }
      candleCache[symbol][tf] = buildCandlesForTimeframe(m1Candles, tf, decimals);
    }
  }

  // Subscribe to real-time price tick updates
  subscribeToPrices((prices) => {
    const currentNowSecs = Math.floor(Date.now() / 1000);

    Object.entries(prices).forEach(([symbol, item]) => {
      const decimals = DECIMAL_PLACES[symbol] || 4;
      const mid = item.last;

      let m1Candles = m1CandleCache[symbol];
      if (!m1Candles || m1Candles.length === 0) {
        m1Candles = generateHistorical1mCandles(symbol, mid, decimals);
        m1CandleCache[symbol] = m1Candles;
      }

      const active1mBlockTime = Math.floor(currentNowSecs / 60) * 60;
      const last1m = m1Candles[m1Candles.length - 1];

      let m1Changed = false;

      if (active1mBlockTime > last1m.time) {
        // 1m timeframe duration (60s) crossed -> close previous 1m candle, open new 1m candle
        const maxAllowed = 14400; // 10 days of 1m candles
        if (m1Candles.length >= maxAllowed) {
          m1Candles.shift();
        }

        const newOpen = last1m.close; // open = previous candle close
        const new1mCandle: Candle = {
          time: active1mBlockTime,
          open: newOpen,
          high: Number(Math.max(newOpen, mid).toFixed(decimals)),
          low: Number(Math.min(newOpen, mid).toFixed(decimals)),
          close: mid,
        };

        m1Candles.push(new1mCandle);
        m1Changed = true;
        lastSavedCandleTimeMap[symbol] = active1mBlockTime;

        saveM1CandlesToStorage(activeDB, symbol, m1Candles);
      } else {
        // Update active 1m candle
        last1m.high = Number(Math.max(last1m.high, mid).toFixed(decimals));
        last1m.low = Number(Math.min(last1m.low, mid).toFixed(decimals));
        last1m.close = mid; // Close = exact live price!
        m1Changed = true;
        lastSavedCandleTimeMap[symbol] = last1m.time;
      }

      if (m1Changed) {
        // Re-aggregate all timeframes from updated 1m base candles
        if (!candleCache[symbol]) candleCache[symbol] = {};
        
        TIMEFRAMES.forEach((tf) => {
          candleCache[symbol][tf] = buildCandlesForTimeframe(m1Candles, tf, decimals);
          notifySubscribers(symbol, tf);
        });
      }
    });
  });
}

// Auto-trigger initialization
initializeCandleEngine();

// Public Accessors
export function getCandles(symbol: string, timeframe: string): Candle[] {
  const tf = normalizeTimeframe(timeframe);
  return candleCache[symbol]?.[tf] || [];
}

export function subscribeToCandles(symbol: string, timeframe: string, callback: CandleListener): () => void {
  const tf = normalizeTimeframe(timeframe);
  if (!listeners[symbol]) {
    listeners[symbol] = {};
  }
  if (!listeners[symbol][tf]) {
    listeners[symbol][tf] = new Set<CandleListener>();
  }

  listeners[symbol][tf].add(callback);
  callback(getCandles(symbol, timeframe));

  return () => {
    listeners[symbol]?.[tf]?.delete(callback);
  };
}

/**
 * Helper function for UI Validation Panel:
 * Returns server time, candle start/end timestamps, and remaining seconds for a given timeframe.
 */
export function getTimeframeStatus(timeframe: string) {
  const tf = normalizeTimeframe(timeframe);
  const interval = TIMEFRAME_SECS[tf];
  const nowMs = Date.now();
  const nowSecs = Math.floor(nowMs / 1000);
  const candleStart = Math.floor(nowSecs / interval) * interval;
  const candleEnd = candleStart + interval;
  const secondsRemaining = Math.max(0, candleEnd - nowSecs);

  return {
    timeframe: tf,
    serverTime: new Date(nowMs).toUTCString().split(' ')[4] + ' UTC',
    candleStartFormatted: new Date(candleStart * 1000).toUTCString().split(' ')[4],
    candleEndFormatted: new Date(candleEnd * 1000).toUTCString().split(' ')[4],
    secondsRemaining,
  };
}

/**
 * Validation Panel Metrics Accessor for Admin Panel & Trading Terminal:
 */
export function getCandleEngineMetrics(selectedSymbol?: string) {
  const sym = selectedSymbol || 'EURUSD';
  const nowMs = Date.now();
  
  const lastSavedTimeSecs = lastSavedCandleTimeMap[sym] || (m1CandleCache[sym]?.slice(-1)[0]?.time) || Math.floor(nowMs / 1000);
  const lastSavedDate = new Date(lastSavedTimeSecs * 1000);
  const lastSavedCandleTime = lastSavedDate.toUTCString().replace('GMT', 'UTC');

  const currentUTCDate = new Date(nowMs);
  const currentUTCTime = currentUTCDate.toUTCString().replace('GMT', 'UTC');

  const missingCount = missingCandlesGeneratedMap[sym] ?? 0;
  
  const allMissingSummary = Object.keys(missingCandlesGeneratedMap).length > 0
    ? Object.entries(missingCandlesGeneratedMap)
        .map(([s, count]) => `${s}: +${count}`)
        .join(' | ')
    : '0 (All Synced)';

  return {
    lastSavedCandleTime,
    currentUTCTime,
    missingCandlesGenerated: missingCount,
    missingCandlesSummary: allMissingSummary,
    missingCandlesMap: { ...missingCandlesGeneratedMap },
    engineRunningStatus: 'Active / Independent Source (500ms Ticks)',
  };
}
