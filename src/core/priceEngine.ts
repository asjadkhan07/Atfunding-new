import { processSpikeTickDelta, getStabilizationFactor } from './spikeEngine';

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

// Calibrated step configs for per-symbol realistic forex market tick steps
export const TICK_STEP_MAP: Record<string, { baseStep: number; maxStep: number }> = {
  // Forex Majors & Crosses (Avg pip step: 0.1 to 0.3 pips per tick, max 0.6 pips)
  EURUSD: { baseStep: 0.000015, maxStep: 0.00006 },
  GBPUSD: { baseStep: 0.000020, maxStep: 0.00008 },
  AUDUSD: { baseStep: 0.000015, maxStep: 0.00006 },
  NZDUSD: { baseStep: 0.000015, maxStep: 0.00006 },
  USDCAD: { baseStep: 0.000015, maxStep: 0.00006 },
  USDCHF: { baseStep: 0.000015, maxStep: 0.00006 },
  EURGBP: { baseStep: 0.000012, maxStep: 0.00005 },

  // JPY Crosses (Avg sen step: 0.3 to 0.5 sen, max 1.8 sen)
  USDJPY: { baseStep: 0.003,    maxStep: 0.015 },
  EURJPY: { baseStep: 0.004,    maxStep: 0.018 },
  GBPJPY: { baseStep: 0.005,    maxStep: 0.022 },

  // Metals (Gold avg per-tick move: $0.08 to $0.35/oz)
  XAUUSD: { baseStep: 0.08,     maxStep: 0.35 },
  XAGUSD: { baseStep: 0.005,    maxStep: 0.025 },

  // Energy (Avg per-tick move: $0.01 to $0.05)
  USOIL:  { baseStep: 0.012,    maxStep: 0.05 },
  UKOIL:  { baseStep: 0.012,    maxStep: 0.05 },

  // Indices (Avg per-tick move: 0.15 to 0.90 points)
  NAS100: { baseStep: 0.65,     maxStep: 3.20 },
  US30:   { baseStep: 0.90,     maxStep: 4.50 },
  SPX500: { baseStep: 0.15,     maxStep: 0.80 },

  // Crypto (BTC avg per-tick move: $3.5 to $22.0; ETH: $0.35 to $2.2)
  BTCUSD: { baseStep: 3.50,     maxStep: 22.0 },
  ETHUSD: { baseStep: 0.35,     maxStep: 2.20 },
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
      driftMultiplier = 0.9;
    } else if (currentTrend.state === 'Trending Up') {
      tickDirection = Math.random() < 0.75 ? 1 : -1;
      driftMultiplier = 1.1;
    } else if (currentTrend.state === 'Trending Down') {
      tickDirection = Math.random() < 0.75 ? -1 : 1;
      driftMultiplier = 1.1;
    } else if (currentTrend.state === 'Breakout') {
      const bDir = currentTrend.mainDirection !== 0 ? currentTrend.mainDirection : 1;
      tickDirection = Math.random() < 0.82 ? bDir : -bDir;
      driftMultiplier = 1.4;
    } else {
      // Range: 50% up / 50% down
      tickDirection = Math.random() < 0.50 ? 1 : -1;
      driftMultiplier = 0.7;
    }

    // Track consecutive same direction ticks
    if (tickDirection === currentTrend.lastTickDir) {
      currentTrend.consecutiveSameTicks++;
    } else {
      currentTrend.lastTickDir = tickDirection;
      currentTrend.consecutiveSameTicks = 1;
    }

    // Step size magnitude: smooth realistic noise factor
    const randomNoiseFactor = 0.6 + Math.random() * 0.6;
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

    const tickDelta = tickDirection * stepMagnitude * getStabilizationFactor(symbol);
    const clampedDelta = Math.max(-stepConfig.maxStep * 2, Math.min(stepConfig.maxStep * 2, tickDelta));

    let newMid = Number((state.last + clampedDelta).toFixed(decimals));

    // Check for active Admin Candle Spike
    const spikeOverride = processSpikeTickDelta(symbol, state.last);
    if (spikeOverride !== null && !isNaN(spikeOverride)) {
      newMid = Number(spikeOverride.toFixed(decimals));
    } else {
      const minAllowed = Number((baseMid * 0.90).toFixed(decimals));
      const maxAllowed = Number((baseMid * 1.10).toFixed(decimals));
      newMid = Math.max(minAllowed, Math.min(maxAllowed, newMid));
    }

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
  // Generate realistic forex ticks every 1200ms–2800ms random interval (~2 seconds)
  const nextInterval = Math.floor(1200 + Math.random() * 1600);
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
