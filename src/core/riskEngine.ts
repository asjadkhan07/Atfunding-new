import { TradingAccount } from '../types';
import { AccountMetrics } from './accountEngine';

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

export interface AuditReportItem {
  accountId: string;
  login: string;
  userEmail: string;
  accountType: string;
  accountSize: number;
  startingBalance: number;
  currentStoredBalance: number;
  expectedBalance: number;
  currentStoredEquity: number;
  expectedEquity: number;
  totalClosedPnL: number;
  totalFloatingPnL: number;
  drawdownStatus: 'NORMAL' | 'DAILY_BREACH' | 'MAX_BREACH';
  isDailyBreached: boolean;
  isMaxBreached: boolean;
  isBreached: boolean;
  storedStatus: string;
  expectedStatus: string;
  isBalanceMismatch: boolean;
  isEquityMismatch: boolean;
  isStatusMismatch: boolean;
  errorsFound: string[];
  profitableTradingDays: number;
  totalTradingDays: number;
  riskScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  gamblingFlags: string[];
  canRequestPayout: boolean;
  payoutBlockedReason: string | null;
}

/**
 * Requirement: Maximum Position Size Rules
 * 10k Account = 0.20 lots max
 * 25k Account = 0.50 lots max
 * 50k Account = 1.00 lot max
 * 100k Account = 2.00 lots max
 */
export function getMaxLotSize(accountSize: number): number {
  if (accountSize <= 10000) return 0.20;
  if (accountSize <= 25000) return 0.50;
  if (accountSize <= 50000) return 1.00;
  if (accountSize <= 100000) return 2.00;
  return Number(((accountSize / 100000) * 2.00).toFixed(2));
}

/**
 * Calculates total trading days and profitable trading days (net profit > 0 for calendar day).
 */
export function getProfitableTradingDays(closedTrades: any[]): {
  count: number;
  days: string[];
  profitableCount: number;
  profitableDays: string[];
  dailyPnLMap: Record<string, number>;
} {
  const dailyPnLMap: Record<string, number> = {};

  closedTrades.forEach((t) => {
    if (t.status === 'closed' || t.closeTime || t.openTime) {
      const timeStr = t.closeTime || t.openTime || '';
      const day = timeStr ? timeStr.substring(0, 10) : new Date().toISOString().substring(0, 10);
      const profit = Number(t.profit || 0);
      dailyPnLMap[day] = (dailyPnLMap[day] || 0) + profit;
    }
  });

  const days = Object.keys(dailyPnLMap);
  const profitableDays = days.filter((day) => dailyPnLMap[day] > 0);

  return {
    count: days.length,
    days,
    profitableCount: profitableDays.length,
    profitableDays,
    dailyPnLMap,
  };
}

/**
 * Legacy Stub for Consistency Rule (Rule Removed Completely)
 */
export function calculateConsistencyScore(_closedTrades: any[]): {
  consistencyScore: number;
  isViolated: boolean;
  maxDayProfit: number;
  totalNetProfit: number;
  maxDayProfitPct: number;
  maxAllowedProfit: number;
} {
  return {
    consistencyScore: 100,
    isViolated: false,
    maxDayProfit: 0,
    totalNetProfit: 0,
    maxDayProfitPct: 0,
    maxAllowedProfit: 0,
  };
}

/**
 * Requirement: Gambling Detection
 * Flag account if:
 * 1. Profit generated within less than 5 minutes (< 300s).
 * 2. Oversized lots used.
 * 3. More than 50% of total profit comes from a single trade.
 */
export function detectGamblingBehavior(
  accountSize: number,
  closedTrades: any[],
  openTrades: any[] = []
): { isGamblingDetected: boolean; flags: string[] } {
  const flags: string[] = [];
  const maxLot = getMaxLotSize(accountSize);

  let totalClosedProfit = 0;
  closedTrades.forEach((t) => {
    if (Number(t.profit || 0) > 0) {
      totalClosedProfit += Number(t.profit);
    }
  });

  // Check all trades for oversized lots
  const allTrades = [...closedTrades, ...openTrades];
  allTrades.forEach((t) => {
    const lot = Number(t.lots || t.amount || 0);
    if (lot > maxLot + 0.001) {
      flags.push(`Oversized lot used (${lot} Lots exceeds max ${maxLot} Lot limit for $${accountSize.toLocaleString()} account)`);
    }
  });

  // Check closed trades for duration < 5 mins (300 seconds) with positive profit
  closedTrades.forEach((t) => {
    if (Number(t.profit || 0) > 0 && t.openTime && t.closeTime) {
      const openTs = new Date(t.openTime).getTime();
      const closeTs = new Date(t.closeTime).getTime();
      const durationSec = (closeTs - openTs) / 1000;

      if (durationSec > 0 && durationSec < 300) {
        flags.push(
          `Scalp/Gambling trade detected (${Math.round(durationSec)}s hold duration on ${t.symbol} with +$${Number(t.profit).toFixed(2)} profit)`
        );
      }
    }

    // Check single trade > 50% of total profit
    if (totalClosedProfit > 100 && Number(t.profit || 0) > 0) {
      const tradeProfitPct = (Number(t.profit) / totalClosedProfit) * 100;
      if (tradeProfitPct > 50.01) {
        flags.push(
          `Single trade profit concentration (${tradeProfitPct.toFixed(1)}% of total profit generated in single trade #${t.id || 'N/A'})`
        );
      }
    }
  });

  // Remove duplicate flag messages
  const uniqueFlags = Array.from(new Set(flags));

  return {
    isGamblingDetected: uniqueFlags.length > 0,
    flags: uniqueFlags,
  };
}

/**
 * Requirement: Risk Score
 * Score 0-100 where 100 is safest/best.
 */
export function calculateAccountRiskScore(
  account: TradingAccount,
  metrics: { dailyLoss: number; overallLoss: number },
  closedTrades: any[],
  openTrades: any[] = []
): {
  riskScore: number;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  deductions: string[];
} {
  let score = 100;
  const deductions: string[] = [];

  const dailyLimit = account.dailyDrawdownLimit || account.size * 0.05;
  const maxLimit = account.maxDrawdownLimit || account.size * 0.10;

  if (metrics.dailyLoss > dailyLimit * 0.5) {
    score -= 25;
    deductions.push('Daily drawdown exceeds 50% of limit');
  }

  if (metrics.overallLoss > maxLimit * 0.5) {
    score -= 25;
    deductions.push('Max drawdown exceeds 50% of limit');
  }

  const { isGamblingDetected, flags } = detectGamblingBehavior(account.size || account.startingBalance, closedTrades, openTrades);
  if (isGamblingDetected) {
    score -= 25;
    deductions.push(`Gambling behavior flagged (${flags.length} issue${flags.length > 1 ? 's' : ''})`);
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  const riskLevel = finalScore >= 80 ? 'LOW' : finalScore >= 50 ? 'MEDIUM' : 'HIGH';

  return {
    riskScore: finalScore,
    riskLevel,
    deductions,
  };
}

/**
 * Requirement: Dynamic Account Calculations
 * Formula:
 * Current Balance = Initial Balance + Total Closed PnL
 * Equity = Balance + Floating PnL
 * Max Loss Remaining = Allowed Max Loss - Current Loss
 */
export function calculateDynamicAccountMetrics(
  account: TradingAccount,
  closedTrades: any[],
  openTrades: any[] = []
) {
  const startingBalance = Number(account.startingBalance || account.size || 10000);

  // 1. Total Closed PnL
  let totalClosedPnL = 0;
  closedTrades.forEach((t) => {
    totalClosedPnL += Number(t.profit || 0);
  });
  totalClosedPnL = Number(totalClosedPnL.toFixed(2));

  // 2. Expected Balance
  const expectedBalance = Number((startingBalance + totalClosedPnL).toFixed(2));

  // 3. Floating PnL from Open Trades
  let totalFloatingPnL = 0;
  openTrades.forEach((t) => {
    totalFloatingPnL += Number(t.profit || 0);
  });
  totalFloatingPnL = Number(totalFloatingPnL.toFixed(2));

  // 4. Expected Equity
  const expectedEquity = Number((expectedBalance + totalFloatingPnL).toFixed(2));

  // 5. Daily Drawdown
  const dailyStarting = Number(account.dailyStartingBalance || startingBalance);
  const dailyLoss = Math.max(0, Number((dailyStarting - expectedEquity).toFixed(2)));
  const dailyLossAllowed = Number(account.dailyDrawdownLimit || startingBalance * 0.05);
  const dailyLossRemaining = Math.max(0, Number((dailyLossAllowed - dailyLoss).toFixed(2)));
  const isDailyBreached = dailyLoss >= dailyLossAllowed;

  // 6. Max Drawdown
  const overallLoss = Math.max(0, Number((startingBalance - expectedEquity).toFixed(2)));
  const maxLossAllowed = Number(account.maxDrawdownLimit || startingBalance * 0.10);
  const maxLossRemaining = Math.max(0, Number((maxLossAllowed - overallLoss).toFixed(2)));
  const isMaxBreached = overallLoss >= maxLossAllowed;

  const isBreached = isDailyBreached || isMaxBreached;
  const breachReason = isDailyBreached
    ? 'Daily Loss Limit Reached'
    : isMaxBreached
    ? 'Maximum Drawdown Limit Reached'
    : '';

  return {
    startingBalance,
    totalClosedPnL,
    expectedBalance,
    totalFloatingPnL,
    expectedEquity,
    dailyStartingBalance: dailyStarting,
    dailyLoss,
    dailyLossAllowed,
    dailyLossRemaining,
    overallLoss,
    maxLossAllowed,
    maxLossRemaining,
    isDailyBreached,
    isMaxBreached,
    isBreached,
    breachReason,
  };
}

/**
 * Performs a comprehensive audit of a single account against its trades.
 */
export function auditAccount(
  account: TradingAccount,
  closedTrades: any[],
  openTrades: any[] = []
): AuditReportItem {
  const accountClosedTrades = closedTrades.filter(
    (t) => String(t.accountId) === String(account.id) || String(t.accountId) === String(account.login)
  );
  const accountOpenTrades = openTrades.filter(
    (t) => String(t.accountId) === String(account.id) || String(t.accountId) === String(account.login)
  );

  const dynamic = calculateDynamicAccountMetrics(account, accountClosedTrades, accountOpenTrades);
  const daysInfo = getProfitableTradingDays(accountClosedTrades);
  const gambling = detectGamblingBehavior(account.size || account.startingBalance, accountClosedTrades, accountOpenTrades);
  const risk = calculateAccountRiskScore(
    account,
    { dailyLoss: dynamic.dailyLoss, overallLoss: dynamic.overallLoss },
    accountClosedTrades,
    accountOpenTrades
  );

  const currentStoredBalance = Number((account.balance || 0).toFixed(2));
  const currentStoredEquity = Number((account.equity || 0).toFixed(2));

  const isBalanceMismatch = Math.abs(currentStoredBalance - dynamic.expectedBalance) > 0.01;
  const isEquityMismatch = Math.abs(currentStoredEquity - dynamic.expectedEquity) > 0.01;

  let expectedStatus = account.status;
  if (dynamic.isBreached && account.status !== 'breached') {
    expectedStatus = 'breached';
  } else if (!dynamic.isBreached && account.status === 'breached') {
    expectedStatus = 'active';
  }

  const isStatusMismatch = expectedStatus !== account.status;

  const errorsFound: string[] = [];
  if (isBalanceMismatch) {
    errorsFound.push(`Balance mismatch: stored $${currentStoredBalance.toFixed(2)} vs calculated $${dynamic.expectedBalance.toFixed(2)}`);
  }
  if (isEquityMismatch) {
    errorsFound.push(`Equity mismatch: stored $${currentStoredEquity.toFixed(2)} vs calculated $${dynamic.expectedEquity.toFixed(2)}`);
  }
  if (isStatusMismatch) {
    errorsFound.push(`Status mismatch: stored '${account.status}' vs expected '${expectedStatus}'`);
  }
  if (gambling.isGamblingDetected) {
    errorsFound.push(`Gambling behavior flagged (${gambling.flags.length} violations)`);
  }

  // Payout Eligibility Check
  let canRequestPayout = true;
  let payoutBlockedReason: string | null = null;

  if (account.status === 'breached' || dynamic.isBreached) {
    canRequestPayout = false;
    payoutBlockedReason = 'Account is breached due to drawdown limits.';
  } else if (dynamic.expectedBalance <= dynamic.startingBalance) {
    canRequestPayout = false;
    payoutBlockedReason = `No net profit available for payout. (Current Balance: $${dynamic.expectedBalance.toLocaleString()} <= Initial: $${dynamic.startingBalance.toLocaleString()})`;
  }

  const drawdownStatus = dynamic.isDailyBreached
    ? 'DAILY_BREACH'
    : dynamic.isMaxBreached
    ? 'MAX_BREACH'
    : 'NORMAL';

  return {
    accountId: account.id,
    login: account.login || account.id,
    userEmail: account.userEmail || 'Unknown Trader',
    accountType: account.accountType,
    accountSize: account.size || account.startingBalance,
    startingBalance: dynamic.startingBalance,
    currentStoredBalance,
    expectedBalance: dynamic.expectedBalance,
    currentStoredEquity,
    expectedEquity: dynamic.expectedEquity,
    totalClosedPnL: dynamic.totalClosedPnL,
    totalFloatingPnL: dynamic.totalFloatingPnL,
    drawdownStatus,
    isDailyBreached: dynamic.isDailyBreached,
    isMaxBreached: dynamic.isMaxBreached,
    isBreached: dynamic.isBreached,
    storedStatus: account.status,
    expectedStatus,
    isBalanceMismatch,
    isEquityMismatch,
    isStatusMismatch,
    errorsFound,
    profitableTradingDays: daysInfo.profitableCount,
    totalTradingDays: daysInfo.count,
    riskScore: risk.riskScore,
    riskLevel: risk.riskLevel,
    gamblingFlags: gambling.flags,
    canRequestPayout,
    payoutBlockedReason,
  };
}

/**
 * Evaluates standard Prop-Firm Risk Parameters (backward compatibility).
 */
export function evaluateAccountRisk(
  account: TradingAccount,
  metrics: AccountMetrics,
  closedTrades: any[]
): RiskStatus {
  const dailyLimit = account.dailyDrawdownLimit;
  const maxLimit = account.maxDrawdownLimit;
  const targetProfit = account.profitTarget || 0;

  const dailyLoss = Number((account.dailyStartingBalance - metrics.equity).toFixed(2));
  const overallLoss = Number((account.startingBalance - metrics.equity).toFixed(2));
  const profitEarned = Number((metrics.equity - account.startingBalance).toFixed(2));

  const uniqueDays = new Set<string>();
  closedTrades.forEach((trade) => {
    if (trade.openTime) {
      const day = trade.openTime.substring(0, 10);
      uniqueDays.add(day);
    }
  });

  let isDailyBreached = false;
  let isMaxBreached = false;
  let breachReason = '';

  if (dailyLoss >= dailyLimit) {
    isDailyBreached = true;
    breachReason = 'Daily Loss Reached';
  } else if (overallLoss >= maxLimit) {
    isMaxBreached = true;
    breachReason = 'Overall Loss Reached';
  }

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
    tradingDaysCount: uniqueDays.size,
    breachReason,
  };
}
