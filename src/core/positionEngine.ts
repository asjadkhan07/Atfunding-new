import { collection, query, where, doc, updateDoc, deleteDoc, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { Trade } from '../types';
import { subscribeToPrices } from './priceEngine';
import { calculateTradePnL, getContractSize } from './pnlEngine';
import { getDocsCached } from '../lib/firestoreCache';

export interface RichTrade extends Trade {
  direction: 'buy' | 'sell';
  entryPrice: number;
  volume: number;
  tp: string;
  sl: string;
  statusUpper: 'OPEN' | 'CLOSED';
}

// Memory stores for open and closed positions
let openPositions: RichTrade[] = [];
let closedPositions: RichTrade[] = [];

// Reactive listener arrays
type PositionListener = (open: RichTrade[], closed: RichTrade[]) => void;
const listeners = new Set<PositionListener>();

let firestoreUnsubscribe: (() => void) | null = null;
let priceUnsubscribe: (() => void) | null = null;

// Convert firestore doc or standard Trade model to RichTrade that satisfies BOTH standard and user-requested shapes
export function mapToRichTrade(t: any): RichTrade {
  const direction = t.direction || t.type || 'buy';
  const rawEntry = t.entryPrice !== undefined ? t.entryPrice : t.openPrice;
  const entryPrice = rawEntry !== undefined && rawEntry !== null && rawEntry !== '' ? Number(rawEntry) : 0;
  const rawVolume = t.volume !== undefined ? t.volume : t.lots;
  const volume = rawVolume !== undefined && rawVolume !== null && rawVolume !== '' ? Number(rawVolume) : 0.1;
  const statusUpper = (t.status === 'open' || t.status === 'OPEN') ? 'OPEN' : 'CLOSED';
  const closePrice = t.closePrice !== undefined && t.closePrice !== null && t.closePrice !== '' ? Number(t.closePrice) : undefined;
  const profit = t.profit !== undefined && t.profit !== null && t.profit !== '' ? Number(t.profit) : 0;
  
  return {
    ...t,
    id: t.id,
    accountId: t.accountId || '',
    userId: t.userId || '',
    symbol: t.symbol || '',
    type: direction,
    direction,
    lots: volume,
    volume,
    openPrice: entryPrice,
    entryPrice,
    tp: String(t.tp || ''),
    sl: String(t.sl || ''),
    status: statusUpper === 'OPEN' ? 'open' : 'closed',
    statusUpper,
    profit,
    openTime: t.openTime || new Date().toISOString(),
    closeTime: t.closeTime,
    closePrice,
  };
}

function notifySubscribers() {
  listeners.forEach((listener) => {
    try {
      listener([...openPositions], [...closedPositions]);
    } catch (e) {
      console.error("Error in position listener:", e);
    }
  });
}

let currentSubAccountId: string | null = null;
let currentSubUserId: string | null = null;

let pollIntervalId: any = null;

// Initialize position subscription for selected account
export function subscribeToPositions(
  accountId: string,
  userId: string,
  callback: PositionListener
): () => void {
  listeners.add(callback);
  
  const fetchPositions = async () => {
    try {
      const dbTrades = await getDocsCached<RichTrade>(`positions_${accountId}_${userId}`, async () => {
        const q = query(
          collection(db, 'trades'),
          where('accountId', '==', accountId),
          where('userId', '==', userId)
        );
        const snapshot = await getDocs(q);
        return snapshot.docs.map(docSnap => mapToRichTrade({ id: docSnap.id, ...docSnap.data() }));
      }, 10000, false, 'positionEngine');

      openPositions = dbTrades.filter((t) => t.statusUpper === 'OPEN');
      closedPositions = dbTrades
        .filter((t) => t.statusUpper === 'CLOSED')
        .sort((a, b) => new Date(b.closeTime || '').getTime() - new Date(a.closeTime || '').getTime());

      syncFloatingPnL();
      notifySubscribers();
    } catch (err: any) {
      console.warn("Position fetch error:", err);
    }
  };

  if (currentSubAccountId !== accountId || currentSubUserId !== userId || !pollIntervalId) {
    if (pollIntervalId) clearInterval(pollIntervalId);
    currentSubAccountId = accountId;
    currentSubUserId = userId;

    fetchPositions();
    pollIntervalId = setInterval(fetchPositions, 15000);
  } else {
    callback([...openPositions], [...closedPositions]);
  }

  return () => {
    listeners.delete(callback);
    if (listeners.size === 0) {
      if (pollIntervalId) {
        clearInterval(pollIntervalId);
        pollIntervalId = null;
      }
      if (priceUnsubscribe) {
        priceUnsubscribe();
        priceUnsubscribe = null;
      }
      openPositions = [];
      closedPositions = [];
      currentSubAccountId = null;
      currentSubUserId = null;
    }
  };
}

// Live calculation of PnL whenever prices tick
function syncFloatingPnL() {
  if (priceUnsubscribe) return; // Already syncing
  
  priceUnsubscribe = subscribeToPrices((prices) => {
    let hasChanged = false;
    
    openPositions = openPositions.map((pos) => {
      const livePrice = prices[pos.symbol];
      if (!livePrice) return pos;
      
      const newPnL = calculateTradePnL(
        pos.symbol,
        pos.direction,
        pos.entryPrice,
        pos.volume,
        livePrice.bid,
        livePrice.ask
      );
      
      console.log("[POSITION TICK]", {
        symbol: pos.symbol,
        entryPrice: pos.entryPrice,
        currentPrice: pos.direction === 'buy' ? livePrice.bid : livePrice.ask,
        volume: pos.volume,
        contractSize: getContractSize(pos.symbol),
        pnl: newPnL
      });
      
      if (pos.profit !== newPnL) {
        hasChanged = true;
        return { ...pos, profit: newPnL };
      }
      
      return pos;
    });
    
    if (hasChanged) {
      notifySubscribers();
    }
  });
}

// Explicit accessors
export function getOpenPositions(): RichTrade[] {
  return [...openPositions];
}

export function getClosedPositions(): RichTrade[] {
  return [...closedPositions];
}

/**
 * Instantly inject newly executed trade into positionEngine local memory store
 * so UI subscribers update instantly (0ms latency) without waiting for Firestore snapshot roundtrip.
 */
export function addLocalOpenPosition(tradeData: any) {
  const rich = mapToRichTrade(tradeData);
  if (!openPositions.some((p) => p.id === rich.id)) {
    openPositions = [rich, ...openPositions];
    syncFloatingPnL();
    notifySubscribers();
  }
}

/**
 * Execute direct position closure (Market Close)
 */
export async function executeClosePosition(tradeId: string, exitPrice: number, closeReason = 'Manual Close'): Promise<void> {
  const target = openPositions.find(p => p.id === tradeId);
  if (!target) {
    throw new Error(`Position ${tradeId} not found in active open trades`);
  }
  
  const closeTime = new Date().toISOString();
  
  // Force update doc in DB to 'closed' status
  const docRef = doc(db, 'trades', tradeId);
  await updateDoc(docRef, {
    status: 'closed',
    closePrice: exitPrice,
    closeTime: closeTime,
    profit: target.profit, // Persist final calculated profit
    closeReason: closeReason
  });
}
