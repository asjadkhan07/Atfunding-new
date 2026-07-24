export const DECIMAL_PLACES: Record<string, number> = {
  // Forex
  EURUSD: 5,
  GBPUSD: 5,
  USDJPY: 3,
  AUDUSD: 5,
  NZDUSD: 5,
  USDCAD: 5,
  USDCHF: 5,
  EURGBP: 5,
  EURJPY: 3,
  GBPJPY: 3,
  // Metals
  XAUUSD: 2,
  XAGUSD: 3,
  // Energy
  USOIL: 2,
  UKOIL: 2,
  // Indices
  NAS100: 2,
  US30: 2,
  SPX500: 2,
  // Crypto
  BTCUSD: 2,
  ETHUSD: 2,
};

export interface SymbolPrice {
  symbol: string;
  bid: number;
  ask: number;
  spread: number;
  last: number; // Mid price (Single Source of Truth)
  changePercent: number;
  timestamp: number;
}

export const STANDARD_SPREADS: Record<string, number> = {
  // Forex
  EURUSD: 0.00018,
  GBPUSD: 0.00022,
  USDJPY: 0.020,
  AUDUSD: 0.00018,
  NZDUSD: 0.00020,
  USDCAD: 0.00020,
  USDCHF: 0.00020,
  EURGBP: 0.00020,
  EURJPY: 0.022,
  GBPJPY: 0.025,
  // Metals
  XAUUSD: 0.35,
  XAGUSD: 0.025,
  // Energy
  USOIL: 0.04,
  UKOIL: 0.04,
  // Indices
  NAS100: 1.50,
  US30: 2.50,
  SPX500: 0.50,
  // Crypto
  BTCUSD: 18.00,
  ETHUSD: 1.80,
};

export const BASE_MID_PRICES: Record<string, number> = {
  // Forex
  EURUSD: 1.08500,
  GBPUSD: 1.27500,
  USDJPY: 155.200,
  AUDUSD: 0.66500,
  NZDUSD: 0.61200,
  USDCAD: 1.36800,
  USDCHF: 0.89500,
  EURGBP: 0.85100,
  EURJPY: 168.400,
  GBPJPY: 197.800,
  // Metals
  XAUUSD: 2380.50,
  XAGUSD: 30.500,
  // Energy
  USOIL: 81.50,
  UKOIL: 85.20,
  // Indices
  NAS100: 19850.00,
  US30: 40250.00,
  SPX500: 5580.00,
  // Crypto
  BTCUSD: 66500.00,
  ETHUSD: 3480.00,
};

export type MarketRegime = 'Range' | 'Trending Up' | 'Trending Down' | 'Breakout';

export interface SymbolTrend {
  state: MarketRegime;
  mainDirection: number; // 1 = up, -1 = down, 0 = neutral
  ticksRemaining: number;
  lastDirection: number;
  momentum: number; // [-1.0, 1.0]
  volatilityPhase: 'Low' | 'Normal' | 'Expansion';
  consecutiveSameTicks: number;
  lastTickDir: number;
  subPhase: 'TrendLeg' | 'Pullback' | 'Consolidation' | 'Breakout';
  subPhaseTicks: number;
  subPhaseDurationTicks: number;
  maxSameTicksLimit: number;
  legStartPrice: number;
  legExtremumPrice: number;
}

export const priceEngineState: Record<string, SymbolPrice> = {};
export const symbolTrendState: Record<string, SymbolTrend> = {};

// Persistence keys
const PRICE_STATE_KEY = 'atfunding_price_engine_state_v10';
const TREND_STATE_KEY = 'atfunding_trend_engine_state_v10';

// Calibrated step configs for per-symbol ATR-style volatility
export const TICK_STEP_MAP: Record<string, { baseStep: number; maxStep: number }> = {
  // Forex Majors & Crosses (Avg body: 3 to 15 pips = 0.00030 to 0.00150)
  EURUSD: { baseStep: 0.000055, maxStep: 0.00028 },
  GBPUSD: { baseStep: 0.000070, maxStep: 0.00035 },
  AUDUSD: { baseStep: 0.000050, maxStep: 0.00025 },
  NZDUSD: { baseStep: 0.000050, maxStep: 0.00025 },
  USDCAD: { baseStep: 0.000060, maxStep: 0.00030 },
  USDCHF: { baseStep: 0.000060, maxStep: 0.00030 },
  EURGBP: { baseStep: 0.000045, maxStep: 0.00022 },

  // JPY Crosses (Avg body: 5 to 35 pips / sen = 0.05 to 0.35 yen)
  USDJPY: { baseStep: 0.012,    maxStep: 0.060 },
  EURJPY: { baseStep: 0.015,    maxStep: 0.075 },
  GBPJPY: { baseStep: 0.018,    maxStep: 0.090 },

  // Metals (Gold avg body: $0.50 to $5.00, expansion moves: $5.00 to $30.00)
  XAUUSD: { baseStep: 0.38,     maxStep: 2.20 },
  XAGUSD: { baseStep: 0.028,    maxStep: 0.15 },

  // Energy (Avg body: $0.10 to $0.80)
  USOIL:  { baseStep: 0.045,    maxStep: 0.22 },
  UKOIL:  { baseStep: 0.045,    maxStep: 0.22 },

  // Indices (Avg body: 5 to 100 points)
  NAS100: { baseStep: 3.2,      maxStep: 18.0 },
  US30:   { baseStep: 4.5,      maxStep: 25.0 },
  SPX500: { baseStep: 0.70,     maxStep: 4.20 },

  // Crypto (BTC body: $20 to $200 avg, $200-$1200 expansion; ETH body: $2 to $25)
  BTCUSD: { baseStep: 14.5,     maxStep: 75.0 },
  ETHUSD: { baseStep: 1.4,      maxStep: 7.50 },
};

export function getMaxSameDirectionTicks(symbol: string): number {
  if (symbol === 'XAUUSD' || symbol === 'XAGUSD') {
    // Gold/Metals: 3-6 candles limit (~15-30 ticks)
    return 15 + Math.floor(Math.random() * 16);
  }
  if (symbol === 'BTCUSD' || symbol === 'ETHUSD') {
    // Crypto: 2-10 candles limit (~10-50 ticks)
    return 10 + Math.floor(Math.random() * 41);
  }
  if (symbol === 'NAS100' || symbol === 'US30' || symbol === 'SPX500') {
    // Indices: 3-8 candles limit (~15-40 ticks)
    return 15 + Math.floor(Math.random() * 26);
  }
  // Forex & Energy: 3-7 candles limit (~15-35 ticks)
  return 15 + Math.floor(Math.random() * 21);
}

function getRandomTrendState(symbol: string, prevTrend?: SymbolTrend): SymbolTrend {
  const rand = Math.random();
  let state: MarketRegime;
  let duration: number;
  let mainDir = 0;
  let volPhase: SymbolTrend['volatilityPhase'] = 'Normal';

  const lastDir = prevTrend?.lastDirection ?? (Math.random() < 0.5 ? 1 : -1);

  if (rand < 0.45) {
    if (prevTrend && prevTrend.lastDirection !== 0) {
      mainDir = Math.random() < 0.82 ? prevTrend.lastDirection : -prevTrend.lastDirection;
    } else {
      mainDir = Math.random() < 0.5 ? 1 : -1;
    }
    state = mainDir === 1 ? 'Trending Up' : 'Trending Down';
    duration = 30 + Math.floor(Math.random() * 60); // tick iterations
    volPhase = Math.random() < 0.3 ? 'Low' : 'Normal';
  } else if (rand < 0.80) {
    state = 'Range';
    duration = 30 + Math.floor(Math.random() * 50);
    mainDir = 0;
    volPhase = 'Low';
  } else {
    state = 'Breakout';
    duration = 20 + Math.floor(Math.random() * 30);
    mainDir = Math.random() < 0.5 ? 1 : -1;
    volPhase = 'Expansion';
  }

  const maxTicks = getMaxSameDirectionTicks(symbol);

  return {
    state,
    mainDirection: mainDir,
    ticksRemaining: duration,
    lastDirection: mainDir !== 0 ? mainDir : lastDir,
    momentum: mainDir * 0.5,
    volatilityPhase: volPhase,
    consecutiveSameTicks: 0,
    lastTickDir: 0,
    subPhase: 'TrendLeg',
    subPhaseTicks: 0,
    subPhaseDurationTicks: maxTicks,
    maxSameTicksLimit: maxTicks,
    legStartPrice: 0,
    legExtremumPrice: 0,
  };
}

// Restore or initialize state
function initializeState() {
  if (typeof window !== 'undefined') {
    try {
      const p = localStorage.getItem(PRICE_STATE_KEY);
      const t = localStorage.getItem(TREND_STATE_KEY);
      if (p && t) {
        const parsedP = JSON.parse(p);
        const parsedT = JSON.parse(t);
        Object.assign(priceEngineState, parsedP);
        Object.assign(symbolTrendState, parsedT);
      }
    } catch (e) {
      console.warn('Failed to load price engine state from localStorage:', e);
    }
  }

  // Guarantee every symbol in BASE_MID_PRICES is initialized
  Object.entries(BASE_MID_PRICES).forEach(([symbol, mid]) => {
    if (!priceEngineState[symbol]) {
      const spread = STANDARD_SPREADS[symbol] || 0.0001;
      const decimals = DECIMAL_PLACES[symbol] || 4;
      const bid = Number((mid - spread / 2).toFixed(decimals));
      const ask = Number((mid + spread / 2).toFixed(decimals));

      priceEngineState[symbol] = {
        symbol,
        bid,
        ask,
        spread,
        last: mid,
        changePercent: 0.0,
        timestamp: Date.now(),
      };
    }

    if (!symbolTrendState[symbol]) {
      symbolTrendState[symbol] = getRandomTrendState(symbol);
    }
  });
}

initializeState();

type PriceListener = (prices: Record<string, SymbolPrice>) => void;
const listeners = new Set<PriceListener>();

export function subscribeToPrices(callback: PriceListener): () => void {
  listeners.add(callback);
  callback({ ...priceEngineState });
  return () => {
    listeners.delete(callback);
  };
}

function notifyListeners() {
  const cloned = { ...priceEngineState };
  listeners.forEach((listener) => {
    try {
      listener(cloned);
    } catch (e) {
      console.error("Error in price listener:", e);
    }
  });
}

function getSessionMultiplier(): number {
  const hour = new Date().getUTCHours();
  if (hour >= 12 && hour < 15) return 1.8; // Peak London + NY Overlap Session
  if (hour >= 7 && hour < 12)  return 1.4; // London Session
  if (hour >= 15 && hour < 21) return 1.5; // New York Session
  return 0.8;                             // Asian / Off-peak Session
}

let tickCounter = 0;

function saveStateToStorage() {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PRICE_STATE_KEY, JSON.stringify(priceEngineState));
    localStorage.setItem(TREND_STATE_KEY, JSON.stringify(symbolTrendState));
  } catch (e) {}
}

/**
 * Trigger intra-candle tick fluctuation.
 * Enforces real market dynamics:
 * - 70% tick continuation along trend direction
 * - 30% temporary counter move / micro pullback / noise / retracement
 * - Dynamic step size with micro noise & random fake breakouts
 */
function triggerTickFluctuation() {
  tickCounter++;
  const sessMult = getSessionMultiplier();

  Object.keys(priceEngineState).forEach((symbol) => {
    const state = priceEngineState[symbol];
    const trend = symbolTrendState[symbol];
    if (!trend) {
      symbolTrendState[symbol] = getRandomTrendState(symbol);
      return;
    }

    trend.ticksRemaining--;
    if (trend.ticksRemaining <= 0) {
      symbolTrendState[symbol] = getRandomTrendState(symbol, trend);
    }

    const currentTrend = symbolTrendState[symbol];
    const decimals = DECIMAL_PLACES[symbol] || 4;
    const spread = state.spread;
    const stepConfig = TICK_STEP_MAP[symbol] || { baseStep: 0.0001, maxStep: 0.0005 };

    if (!currentTrend.legStartPrice) {
      currentTrend.legStartPrice = state.last;
      currentTrend.legExtremumPrice = state.last;
    }

    // Track move extremum
    if (currentTrend.mainDirection === 1) {
      if (state.last > currentTrend.legExtremumPrice) currentTrend.legExtremumPrice = state.last;
    } else if (currentTrend.mainDirection === -1) {
      if (state.last < currentTrend.legExtremumPrice || currentTrend.legExtremumPrice === 0) currentTrend.legExtremumPrice = state.last;
    }

    currentTrend.subPhaseTicks++;

    // Force Pullback transition if tick persistence limit reached
    if (currentTrend.subPhaseTicks >= currentTrend.subPhaseDurationTicks || currentTrend.consecutiveSameTicks >= currentTrend.maxSameTicksLimit) {
      currentTrend.subPhaseTicks = 0;
      currentTrend.consecutiveSameTicks = 0;
      currentTrend.maxSameTicksLimit = getMaxSameDirectionTicks(symbol);

      if (currentTrend.subPhase === 'TrendLeg') {
        currentTrend.subPhase = 'Pullback';
        // Pullback duration: 6 to 14 ticks (20% to 60% retracement)
        currentTrend.subPhaseDurationTicks = 6 + Math.floor(Math.random() * 9);
      } else {
        currentTrend.subPhase = 'TrendLeg';
        currentTrend.subPhaseDurationTicks = currentTrend.maxSameTicksLimit;
        currentTrend.legStartPrice = state.last;
        currentTrend.legExtremumPrice = state.last;
      }
    }

    let tickDirection = 0;
    let driftMultiplier = 1.0;

    const mainDir = currentTrend.mainDirection !== 0 ? currentTrend.mainDirection : 1;

    if (currentTrend.subPhase === 'Pullback') {
      // Pullback direction: counter to main trend to retrace 20%-60%
      tickDirection = Math.random() < 0.78 ? -mainDir : mainDir;
      driftMultiplier = 1.2;
    } else if (currentTrend.state === 'Trending Up') {
      tickDirection = Math.random() < 0.75 ? 1 : -1;
      driftMultiplier = 1.6;
    } else if (currentTrend.state === 'Trending Down') {
      tickDirection = Math.random() < 0.75 ? -1 : 1;
      driftMultiplier = 1.6;
    } else if (currentTrend.state === 'Breakout') {
      const bDir = currentTrend.mainDirection !== 0 ? currentTrend.mainDirection : 1;
      tickDirection = Math.random() < 0.82 ? bDir : -bDir;
      driftMultiplier = 2.5;
    } else {
      // Range: 50% up / 50% down
      tickDirection = Math.random() < 0.50 ? 1 : -1;
      driftMultiplier = 0.6;
    }

    // Track consecutive same direction ticks
    if (tickDirection === currentTrend.lastTickDir) {
      currentTrend.consecutiveSameTicks++;
    } else {
      currentTrend.lastTickDir = tickDirection;
      currentTrend.consecutiveSameTicks = 1;
    }

    // Step size magnitude
    const randomNoiseFactor = 0.4 + Math.random() * 1.2;
    const volFactor = sessMult * driftMultiplier;

    let stepMagnitude = stepConfig.baseStep * randomNoiseFactor * volFactor;

    // Boundary check around base mid price
    const baseMid = BASE_MID_PRICES[symbol] || state.last;
    const deviationPips = (state.last - baseMid) / baseMid;
    if (Math.abs(deviationPips) > 0.03) {
      if (deviationPips > 0 && tickDirection === 1 && Math.random() < 0.6) {
        tickDirection = -1;
      } else if (deviationPips < 0 && tickDirection === -1 && Math.random() < 0.6) {
        tickDirection = 1;
      }
    }

    const tickDelta = tickDirection * stepMagnitude;
    const clampedDelta = Math.max(-stepConfig.maxStep, Math.min(stepConfig.maxStep, tickDelta));

    let newMid = Number((state.last + clampedDelta).toFixed(decimals));

    const minAllowed = Number((baseMid * 0.95).toFixed(decimals));
    const maxAllowed = Number((baseMid * 1.05).toFixed(decimals));
    newMid = Math.max(minAllowed, Math.min(maxAllowed, newMid));

    const changePct = Number((((newMid - baseMid) / baseMid) * 100).toFixed(2));

    state.last = newMid;
    state.bid = Number((newMid - spread / 2).toFixed(decimals));
    state.ask = Number((newMid + spread / 2).toFixed(decimals));
    state.changePercent = changePct;
    state.timestamp = Date.now();
  });

  if (tickCounter % 10 === 0) {
    saveStateToStorage();
  }

  notifyListeners();
}

let isRunning = false;
let tickTimeoutId: any = null;

function scheduleNextTick() {
  if (!isRunning) return;
  // Generate ticks every 250ms–1000ms random interval
  const nextInterval = Math.floor(250 + Math.random() * 750);
  tickTimeoutId = setTimeout(() => {
    triggerTickFluctuation();
    scheduleNextTick();
  }, nextInterval);
}

export function startPriceEngine() {
  if (isRunning) return;
  isRunning = true;
  scheduleNextTick();
}

export function stopPriceEngine() {
  if (!isRunning) return;
  isRunning = false;
  if (tickTimeoutId) clearTimeout(tickTimeoutId);
}

startPriceEngine();
