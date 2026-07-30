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
 * Calculates Margin Used for a given position based on its asset leverage rules and actual instrument price.
 * Formula: Required Margin (USD) = (Volume in Lots * Contract Size * Asset Price in USD) / Leverage
 */
export function calculatePositionMargin(
  symbol: string,
  lots: number,
  currentPrice: number,
  accountType: string
): number {
  if (lots <= 0 || currentPrice <= 0) return 0;

  const contractSize = getContractSize(symbol);
  const upperSymbol = symbol.toUpperCase();

  // Leverage definitions: payout_later is 1:50, instant_bolt is 1:30, standard/others default to 1:100
  let leverage = accountType === 'payout_later' ? 50 : accountType === 'instant_bolt' ? 30 : 100;

  // Crypto pairs cap leverage at 1:5
  if (['BTCUSD', 'ETHUSD', 'SOLUSD'].includes(upperSymbol)) {
    leverage = 5;
  }

  let notionalValueUSD = 0;

  if (upperSymbol.startsWith('USD') && upperSymbol.length === 6 && !['USOIL', 'USDX'].includes(upperSymbol)) {
    // USD base forex pairs (USDJPY, USDCAD, USDCHF) -> 1 standard lot = 100,000 USD base
    notionalValueUSD = lots * contractSize;
  } else if (upperSymbol === 'EURGBP' || upperSymbol === 'EURJPY') {
    // Base currency EUR (~1.085 EURUSD)
    notionalValueUSD = lots * contractSize * 1.085;
  } else if (upperSymbol === 'GBPJPY') {
    // Base currency GBP (~1.275 GBPUSD)
    notionalValueUSD = lots * contractSize * 1.275;
  } else {
    // EURUSD, GBPUSD, AUDUSD, NZDUSD, XAUUSD, XAGUSD, USOIL, UKOIL, NAS100, US30, SPX500, Crypto, etc.
    // Quote is USD, so (contractSize * currentPrice) represents the USD notional value per lot
    notionalValueUSD = lots * contractSize * currentPrice;
  }

  const requiredMargin = notionalValueUSD / leverage;
  return Number(requiredMargin.toFixed(2));
}

/**
 * Centralized Account Evaluation Engine
 * Merges account state, open positions, optional closed positions, and current tick prices
 */
export function recalculateAccountMetrics(
  account: TradingAccount,
  openTrades: RichTrade[],
  prices: Record<string, SymbolPrice>,
  closedTrades?: any[]
): AccountMetrics {
  let balance = account.balance;

  // Requirement: Recalculate account balance directly from trade history: Current Balance = Initial Balance + Total Closed PnL
  if (closedTrades && Array.isArray(closedTrades)) {
    const startingBal = Number(account.startingBalance || account.size || 10000);
    const closedPnL = closedTrades.reduce((sum, trade) => sum + (Number(trade.profit) || 0), 0);
    balance = Number((startingBal + closedPnL).toFixed(2));
  }

  // 1. Calculate Floating PnL
  const floatingPnL = openTrades.reduce((sum, trade) => sum + (trade.profit || 0), 0);

  // 2. Calculate Equity
  const equity = Number((balance + floatingPnL).toFixed(2));

  // 3. Calculate Margin Used across all open positions
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
