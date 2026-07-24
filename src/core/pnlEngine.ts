export const CONTRACT_SIZES: Record<string, number> = {
  // Forex
  EURUSD: 100000,
  GBPUSD: 100000,
  USDJPY: 100000,
  AUDUSD: 100000,
  NZDUSD: 100000,
  USDCAD: 100000,
  USDCHF: 100000,
  EURGBP: 100000,
  EURJPY: 100000,
  GBPJPY: 100000,
  // Metals
  XAUUSD: 100,   // Gold: 100 oz per 1 standard lot
  XAGUSD: 5000,  // Silver: 5000 oz per 1 standard lot
  // Energy
  USOIL: 1000,   // Oil: 1000 barrels per 1 standard lot
  UKOIL: 1000,   // Oil: 1000 barrels per 1 standard lot
  // Indices
  NAS100: 1,     // Indices: 1 point = $1 per 1 lot
  US30: 1,       // Indices: 1 point = $1 per 1 lot
  SPX500: 1,     // Indices: 1 point = $1 per 1 lot
  // Crypto
  BTCUSD: 1,     // BTC: 1 BTC per 1 lot
  ETHUSD: 1,     // ETH: 1 ETH per 1 lot
};

export function getContractSize(symbol: string): number {
  return CONTRACT_SIZES[symbol] ?? 100000;
}

/**
 * Standard PnL calculation engine.
 * BUY:  (CurrentBid - EntryPrice) * ContractSize * Lots * ConversionRate
 * SELL: (EntryPrice - CurrentAsk) * ContractSize * Lots * ConversionRate
 */
export function calculateTradePnL(
  symbol: string,
  type: 'buy' | 'sell',
  entryPrice: number,
  lots: number,
  currentBid: number,
  currentAsk: number,
  quotePrice?: number
): number {
  const contractSize = getContractSize(symbol);
  
  // BUY exits at BID, SELL exits at ASK
  const diff = type === 'buy' ? (currentBid - entryPrice) : (entryPrice - currentAsk);

  // Conversion rate for non-USD quote currencies to convert PnL to USD
  let conversionRate = 1.0;

  if (symbol === 'USDJPY' || symbol === 'EURJPY' || symbol === 'GBPJPY') {
    const jpyPrice = quotePrice || (symbol === 'USDJPY' ? currentBid : 155.20);
    conversionRate = jpyPrice > 0 ? (1 / jpyPrice) : (1 / 155.20);
  } else if (symbol === 'USDCAD') {
    const cadPrice = quotePrice || currentBid;
    conversionRate = cadPrice > 0 ? (1 / cadPrice) : (1 / 1.368);
  } else if (symbol === 'USDCHF') {
    const chfPrice = quotePrice || currentBid;
    conversionRate = chfPrice > 0 ? (1 / chfPrice) : (1 / 0.895);
  } else if (symbol === 'EURGBP') {
    const gbpPrice = quotePrice || 1.275;
    conversionRate = gbpPrice;
  }

  const pnl = diff * contractSize * lots * conversionRate;
  
  return Number(pnl.toFixed(2));
}

