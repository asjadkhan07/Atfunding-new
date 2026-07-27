import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { priceEngineState } from './priceEngine';
import { addLocalOpenPosition } from './positionEngine';

export interface OrderInput {
  accountId: string;
  userId: string;
  symbol: string;
  direction: 'buy' | 'sell';
  volume: number; // lots
  tp: string;
  sl: string;
}

export interface OrderExecutionResult {
  success: boolean;
  message: string;
  tradeId?: string;
  entryPrice?: number;
}

/**
 * Handles professional Order Execution.
 * BUY executes at Ask.
 * SELL executes at Bid.
 * Validates Sl / Tp logical boundaries.
 * Writes standard & required UPPERCASE fields to Firestore.
 */
export async function executeOrder(input: OrderInput): Promise<OrderExecutionResult> {
  const { accountId, userId, symbol, direction, volume, tp, sl } = input;
  
  if (volume <= 0) {
    return { success: false, message: "Position volume (lots) must be greater than zero." };
  }

  const livePrice = priceEngineState[symbol];
  if (!livePrice) {
    return { success: false, message: `No active market feed for symbol ${symbol}.` };
  }

  // BUY executes at Ask. SELL executes at Bid.
  const entryPrice = direction === 'buy' ? livePrice.ask : livePrice.bid;
  
  // Reject trades if entry price is > 5% away from current market price
  const priceDev = Math.abs(entryPrice - livePrice.last) / livePrice.last;
  if (priceDev > 0.05) {
    return {
      success: false,
      message: `Execution rejected: Entry price ($${entryPrice}) is more than 5% away from current market price ($${livePrice.last}).`
    };
  }
  
  const parsedTp = tp ? parseFloat(tp) : null;
  const parsedSl = sl ? parseFloat(sl) : null;

  // Validate Take Profit and Stop Loss logical constraints
  if (parsedTp && parsedTp > 0) {
    if (Math.abs(parsedTp - livePrice.last) / livePrice.last > 0.15) {
      return {
        success: false,
        message: `Take Profit ($${parsedTp}) is more than 15% away from current market price ($${livePrice.last}).`
      };
    }
    if (direction === 'buy' && parsedTp <= entryPrice) {
      return { success: false, message: "Take Profit must be higher than entry price for BUY orders." };
    }
    if (direction === 'sell' && parsedTp >= entryPrice) {
      return { success: false, message: "Take Profit must be lower than entry price for SELL orders." };
    }
  }

  if (parsedSl && parsedSl > 0) {
    if (Math.abs(parsedSl - livePrice.last) / livePrice.last > 0.15) {
      return {
        success: false,
        message: `Stop Loss ($${parsedSl}) is more than 15% away from current market price ($${livePrice.last}).`
      };
    }
    if (direction === 'buy' && parsedSl >= entryPrice) {
      return { success: false, message: "Stop Loss must be lower than entry price for BUY orders." };
    }
    if (direction === 'sell' && parsedSl <= entryPrice) {
      return { success: false, message: "Stop Loss must be higher than entry price for SELL orders." };
    }
  }

  const tradeId = 'TR-' + Math.floor(100000 + Math.random() * 900000);
  const openTime = new Date().toISOString();

  // Create combined compatible model to guarantee zero component crashes
  const newTradePayload = {
    // Required fields by prompt
    id: tradeId,
    symbol,
    direction,
    entryPrice,
    volume,
    tp: parsedTp ? String(parsedTp) : '',
    sl: parsedSl ? String(parsedSl) : '',
    openTime,
    status: 'open', // compatible with lowercase systems
    statusUpper: 'OPEN', // core UPPERCASE status

    // Standard compatible legacy fields
    accountId,
    userId,
    type: direction,
    lots: volume,
    openPrice: entryPrice,
    profit: 0,
    closePrice: null,
    closeTime: null,
  };

  try {
    const docRef = doc(db, 'trades', tradeId);
    await setDoc(docRef, newTradePayload);
    
    // Instantly update position engine local memory so UI displays open trade immediately
    addLocalOpenPosition(newTradePayload);

    return {
      success: true,
      message: `Order Executed! Entered ${direction.toUpperCase()} ${symbol} at $${entryPrice}`,
      tradeId,
      entryPrice,
    };
  } catch (e: any) {
    console.error("Order Engine Execution Failure:", e);
    return {
      success: false,
      message: `Failed to execute order: ${e.message || String(e)}`,
    };
  }
}
