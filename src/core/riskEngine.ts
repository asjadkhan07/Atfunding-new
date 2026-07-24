import { TradingAccount } from '../types';
import { AccountMetrics } from './accountEngine';
import { RichTrade } from './positionEngine';

export interface RiskStatus {
  isDailyBreached: boolean;
  isMaxBreached: boolean;
  isProfitTargetMet: boolean;
  dailyLoss: number;
  overallLoss: number;
  profitEarned: number;
  tradingDaysCount: number;
  breachReason: string;
}

/**
 * Evaluates standard Prop-Firm Risk Parameters.
 * Track: Daily Drawdown, Max Drawdown, Profit Target, Trading Days
 */
export function evaluateAccountRisk(
  account: TradingAccount,
  metrics: AccountMetrics,
  closedTrades: RichTrade[]
): RiskStatus {
  const dailyLimit = account.dailyDrawdownLimit;
  const maxLimit = account.maxDrawdownLimit;
  const targetProfit = account.profitTarget || 0;

  // 1. Calculate Daily Loss
  // (dailyStartingBalance - currentEquity)
  const dailyLoss = Number((account.dailyStartingBalance - metrics.equity).toFixed(2));

  // 2. Calculate Overall Max Loss
  // (startingBalance - currentEquity)
  const overallLoss = Number((account.startingBalance - metrics.equity).toFixed(2));

  // 3. Calculate Profit Earned
  const profitEarned = Number((metrics.equity - account.startingBalance).toFixed(2));

  // 4. Calculate Unique Trading Days from Closed Trades
  const uniqueDays = new Set<string>();
  closedTrades.forEach((trade) => {
    if (trade.openTime) {
      const day = trade.openTime.substring(0, 10); // Extract 'YYYY-MM-DD'
      uniqueDays.add(day);
    }
  });
  const tradingDaysCount = uniqueDays.size;

  // 5. Check Drawdown Breaches
  let isDailyBreached = false;
  let isMaxBreached = false;
  let breachReason = '';

  if (dailyLoss >= dailyLimit) {
    isDailyBreached = true;
    breachReason = `Daily drawdown threshold of $${dailyLimit.toLocaleString()} breached. Starting day balance: $${account.dailyStartingBalance.toLocaleString()}, Live equity: $${metrics.equity.toLocaleString()} (Daily Loss: $${dailyLoss.toLocaleString()}).`;
  } else if (overallLoss >= maxLimit) {
    isMaxBreached = true;
    breachReason = `Overall maximum drawdown limit of $${maxLimit.toLocaleString()} breached. Starting account balance: $${account.startingBalance.toLocaleString()}, Live equity: $${metrics.equity.toLocaleString()} (Max Loss: $${overallLoss.toLocaleString()}).`;
  }

  // 6. Check Profit Target Met (Must not be breached, must be higher than target profit)
  const isProfitTargetMet = 
    !isDailyBreached && 
    !isMaxBreached && 
    targetProfit > 0 && 
    profitEarned >= targetProfit;

  return {
    isDailyBreached,
    isMaxBreached,
    isProfitTargetMet,
    dailyLoss,
    overallLoss,
    profitEarned,
    tradingDaysCount,
    breachReason,
  };
}
