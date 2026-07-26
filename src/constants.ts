import { AccountType } from './types';

export interface ChallengePackage {
  id: string;
  type: AccountType;
  name: string;
  size: number;
  price: number;
  dailyDrawdownPercent: number; // e.g. 5 for 5%
  maxDrawdownPercent: number; // e.g. 10 for 10%
  profitTargetPercent: number; // e.g. 8 for 8%, 0 for none
  leverage: string;
  minimumDays: number;
  payoutSplit: number; // e.g. 80 for 80%
}

export const CHALLENGE_PACKAGES: ChallengePackage[] = [
  // ONE STEP CHALLENGES
  {
    id: 'one_step_5k',
    type: 'one_step',
    name: '$5K Account',
    size: 5000,
    price: 49,
    dailyDrawdownPercent: 5,
    maxDrawdownPercent: 10,
    profitTargetPercent: 10,
    leverage: '1:100',
    minimumDays: 4,
    payoutSplit: 80,
  },
  {
    id: 'one_step_10k',
    type: 'one_step',
    name: '$10K Account',
    size: 10000,
    price: 89,
    dailyDrawdownPercent: 5,
    maxDrawdownPercent: 10,
    profitTargetPercent: 10,
    leverage: '1:100',
    minimumDays: 4,
    payoutSplit: 80,
  },
  {
    id: 'one_step_25k',
    type: 'one_step',
    name: '$25K Account',
    size: 25000,
    price: 149,
    dailyDrawdownPercent: 5,
    maxDrawdownPercent: 10,
    profitTargetPercent: 10,
    leverage: '1:100',
    minimumDays: 4,
    payoutSplit: 80,
  },
  {
    id: 'one_step_50k',
    type: 'one_step',
    name: '$50K Account',
    size: 50000,
    price: 249,
    dailyDrawdownPercent: 5,
    maxDrawdownPercent: 10,
    profitTargetPercent: 10,
    leverage: '1:100',
    minimumDays: 4,
    payoutSplit: 80,
  },
  {
    id: 'one_step_100k',
    type: 'one_step',
    name: '$100K Account',
    size: 100000,
    price: 449,
    dailyDrawdownPercent: 5,
    maxDrawdownPercent: 10,
    profitTargetPercent: 10,
    leverage: '1:100',
    minimumDays: 4,
    payoutSplit: 80,
  },

  // TWO STEP CHALLENGES
  {
    id: 'two_step_5k',
    type: 'two_step',
    name: '$5K Account',
    size: 5000,
    price: 39,
    dailyDrawdownPercent: 5,
    maxDrawdownPercent: 10,
    profitTargetPercent: 8, // Phase 1: 8%, Phase 2: 5%
    leverage: '1:100',
    minimumDays: 4,
    payoutSplit: 80,
  },
  {
    id: 'two_step_10k',
    type: 'two_step',
    name: '$10K Account',
    size: 10000,
    price: 69,
    dailyDrawdownPercent: 5,
    maxDrawdownPercent: 10,
    profitTargetPercent: 8,
    leverage: '1:100',
    minimumDays: 4,
    payoutSplit: 80,
  },
  {
    id: 'two_step_25k',
    type: 'two_step',
    name: '$25K Account',
    size: 25000,
    price: 129,
    dailyDrawdownPercent: 5,
    maxDrawdownPercent: 10,
    profitTargetPercent: 8,
    leverage: '1:100',
    minimumDays: 4,
    payoutSplit: 80,
  },
  {
    id: 'two_step_50k',
    type: 'two_step',
    name: '$50K Account',
    size: 50000,
    price: 199,
    dailyDrawdownPercent: 5,
    maxDrawdownPercent: 10,
    profitTargetPercent: 8,
    leverage: '1:100',
    minimumDays: 4,
    payoutSplit: 80,
  },
  {
    id: 'two_step_100k',
    type: 'two_step',
    name: '$100K Account',
    size: 100000,
    price: 349,
    dailyDrawdownPercent: 5,
    maxDrawdownPercent: 10,
    profitTargetPercent: 8,
    leverage: '1:100',
    minimumDays: 4,
    payoutSplit: 80,
  },

  // PAYOUT LATER CHALLENGE (Pricing strictly as defined: $9, $18, $27, $36, $45)
  {
    id: 'payout_later_5k',
    type: 'payout_later',
    name: '$5K Account',
    size: 5000,
    price: 9,
    dailyDrawdownPercent: 5,
    maxDrawdownPercent: 10,
    profitTargetPercent: 8,
    leverage: '1:50',
    minimumDays: 4,
    payoutSplit: 80,
  },
  {
    id: 'payout_later_10k',
    type: 'payout_later',
    name: '$10K Account',
    size: 10000,
    price: 18,
    dailyDrawdownPercent: 5,
    maxDrawdownPercent: 10,
    profitTargetPercent: 8,
    leverage: '1:50',
    minimumDays: 4,
    payoutSplit: 80,
  },
  {
    id: 'payout_later_25k',
    type: 'payout_later',
    name: '$25K Account',
    size: 25000,
    price: 27,
    dailyDrawdownPercent: 5,
    maxDrawdownPercent: 10,
    profitTargetPercent: 8,
    leverage: '1:50',
    minimumDays: 4,
    payoutSplit: 80,
  },
  {
    id: 'payout_later_50k',
    type: 'payout_later',
    name: '$50K Account',
    size: 50000,
    price: 36,
    dailyDrawdownPercent: 5,
    maxDrawdownPercent: 10,
    profitTargetPercent: 8,
    leverage: '1:50',
    minimumDays: 4,
    payoutSplit: 80,
  },
  {
    id: 'payout_later_100k',
    type: 'payout_later',
    name: '$100K Account',
    size: 100000,
    price: 45,
    dailyDrawdownPercent: 5,
    maxDrawdownPercent: 10,
    profitTargetPercent: 8,
    leverage: '1:50',
    minimumDays: 4,
    payoutSplit: 80,
  },

  // ATF INSTANT ACCOUNT
  {
    id: 'instant_bolt_2k',
    type: 'instant_bolt',
    name: '$2K ATF Instant',
    size: 2000,
    price: 99,
    dailyDrawdownPercent: 0.5,
    maxDrawdownPercent: 1,
    profitTargetPercent: 0, // No target, immediate funding payout eligibility
    leverage: '1:30',
    minimumDays: 0,
    payoutSplit: 80,
  },
  {
    id: 'instant_bolt_3k',
    type: 'instant_bolt',
    name: '$3K ATF Instant',
    size: 3000,
    price: 189,
    dailyDrawdownPercent: 0.5,
    maxDrawdownPercent: 1,
    profitTargetPercent: 0,
    leverage: '1:30',
    minimumDays: 0,
    payoutSplit: 80,
  },
  {
    id: 'instant_bolt_6k',
    type: 'instant_bolt',
    name: '$6K ATF Instant',
    size: 6000,
    price: 349,
    dailyDrawdownPercent: 1,
    maxDrawdownPercent: 2,
    profitTargetPercent: 0,
    leverage: '1:30',
    minimumDays: 0,
    payoutSplit: 80,
  },
  {
    id: 'instant_bolt_9k',
    type: 'instant_bolt',
    name: '$9K ATF Instant',
    size: 9000,
    price: 499,
    dailyDrawdownPercent: 1,
    maxDrawdownPercent: 2,
    profitTargetPercent: 0,
    leverage: '1:30',
    minimumDays: 0,
    payoutSplit: 80,
  },

  // AT TRIAL ACCOUNT
  {
    id: 'trial_1k',
    type: 'trial',
    name: 'AT Trial Account',
    size: 1000,
    price: 1, // $1
    dailyDrawdownPercent: 5,
    maxDrawdownPercent: 10,
    profitTargetPercent: 0,
    leverage: '1:100',
    minimumDays: 0,
    payoutSplit: 30,
  }
];

export const MOCK_TRADING_SYMBOLS = [
  // Forex
  { symbol: 'EURUSD', name: 'Euro / US Dollar', price: 1.0850, spread: 0.00018 },
  { symbol: 'GBPUSD', name: 'Great Britain Pound / US Dollar', price: 1.2750, spread: 0.00022 },
  { symbol: 'USDJPY', name: 'US Dollar / Japanese Yen', price: 155.20, spread: 0.020 },
  { symbol: 'AUDUSD', name: 'Australian Dollar / US Dollar', price: 0.6650, spread: 0.00018 },
  { symbol: 'NZDUSD', name: 'New Zealand Dollar / US Dollar', price: 0.6120, spread: 0.00020 },
  { symbol: 'USDCAD', name: 'US Dollar / Canadian Dollar', price: 1.3680, spread: 0.00020 },
  { symbol: 'USDCHF', name: 'US Dollar / Swiss Franc', price: 0.8950, spread: 0.00020 },
  { symbol: 'EURGBP', name: 'Euro / Great Britain Pound', price: 0.8510, spread: 0.00020 },
  { symbol: 'EURJPY', name: 'Euro / Japanese Yen', price: 168.40, spread: 0.022 },
  { symbol: 'GBPJPY', name: 'Great Britain Pound / Japanese Yen', price: 197.80, spread: 0.025 },
  // Metals
  { symbol: 'XAUUSD', name: 'Gold / US Dollar', price: 2380.50, spread: 0.35 },
  { symbol: 'XAGUSD', name: 'Silver / US Dollar', price: 30.50, spread: 0.025 },
  // Energy
  { symbol: 'USOIL', name: 'US Crude Oil', price: 81.50, spread: 0.04 },
  { symbol: 'UKOIL', name: 'Brent Crude Oil', price: 85.20, spread: 0.04 },
  // Indices
  { symbol: 'NAS100', name: 'NASDAQ 100 Index', price: 19850.00, spread: 1.50 },
  { symbol: 'US30', name: 'Dow Jones Industrial Average', price: 40250.00, spread: 2.50 },
  { symbol: 'SPX500', name: 'S&P 500 Index', price: 5580.00, spread: 0.50 },
  // Crypto
  { symbol: 'BTCUSD', name: 'Bitcoin / US Dollar', price: 66500.00, spread: 18.0 },
  { symbol: 'ETHUSD', name: 'Ethereum / US Dollar', price: 3480.00, spread: 1.80 }
];

export function getAccountDrawdownLimits(accountType: string, size: number) {
  if (accountType === 'instant_bolt') {
    if (size <= 3000) {
      return {
        dailyDrawdownLimit: size * 0.005, // 0.5%
        maxDrawdownLimit: size * 0.01     // 1%
      };
    } else {
      return {
        dailyDrawdownLimit: size * 0.01,  // 1%
        maxDrawdownLimit: size * 0.02     // 2%
      };
    }
  } else if (accountType === 'two_step') {
    return {
      dailyDrawdownLimit: size * 0.05,
      maxDrawdownLimit: size * 0.10
    };
  } else if (accountType === 'one_step') {
    return {
      dailyDrawdownLimit: size * 0.04,
      maxDrawdownLimit: size * 0.08
    };
  } else if (accountType === 'payout_later') {
    return {
      dailyDrawdownLimit: size * 0.03,
      maxDrawdownLimit: size * 0.06
    };
  } else {
    return {
      dailyDrawdownLimit: size * 0.05,
      maxDrawdownLimit: size * 0.10
    };
  }
}

