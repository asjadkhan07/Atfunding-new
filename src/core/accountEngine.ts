import { TradingAccount } from '../types';
import { RichTrade } from './positionEngine';
import { SymbolPrice } from './priceEngine';
import { getContractSize } from './pnlEngine';

export interface AccountMetrics {
  balance: number;
  floatingPnL: number;
  equity: number;
  marginUsed: number;
  freeMargin: number;
}

/**
 * Calculates Margin Used for a given position based on its asset leverage rules.
 */
export function calculatePositionMargin(
  symbol: string,
  lots: number,
  currentPrice: number,
  accountType: string
): number {
  const contractSize = getContractSize(symbol);
  
  // Leverage definitions: payout_later is 1:50, instant_bolt is 1:30, others are 1:100
  const leverage = accountType === 'payout_later' ? 50 : accountType === 'instant_bolt' ? 30 : 100;
  
  if (symbol === 'XAUUSD') {
    return (lots * contractSize * currentPrice) / leverage;
  } else if (['BTCUSD', 'ETHUSD', 'SOLUSD'].includes(symbol)) {
    return (lots * currentPrice) / 5; // Crypto leverage 1:5
  } else {
    // Forex pairs
    return (lots * contractSize) / leverage;
  }
}

/**
 * Centralized Account Evaluation Engine
 * Merges account state, open positions, and current tick prices
 */
export function recalculateAccountMetrics(
  account: TradingAccount,
  openTrades: RichTrade[],
  prices: Record<string, SymbolPrice>
): AccountMetrics {
  const balance = account.balance;
  
  // 1. Calculate Floating PnL
  const floatingPnL = openTrades.reduce((sum, trade) => sum + (trade.profit || 0), 0);
  
  // 2. Calculate Equity
  const equity = Number((balance + floatingPnL).toFixed(2));
  
  // 3. Calculate Margin Used
  const marginUsed = openTrades.reduce((sum, trade) => {
    const livePrice = prices[trade.symbol];
    const currentPrice = livePrice ? (trade.direction === 'buy' ? livePrice.bid : livePrice.ask) : trade.entryPrice;
    return sum + calculatePositionMargin(trade.symbol, trade.volume, currentPrice, account.accountType);
  }, 0);
  
  const roundedMarginUsed = Number(marginUsed.toFixed(2));
  
  // 4. Calculate Free Margin
  const freeMargin = Number((equity - roundedMarginUsed).toFixed(2));
  
  return {
    balance,
    floatingPnL: Number(floatingPnL.toFixed(2)),
    equity,
    marginUsed: roundedMarginUsed,
    freeMargin,
  };
}
