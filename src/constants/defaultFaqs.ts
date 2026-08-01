export interface FAQItem {
  id: string;
  category: 'General' | 'Rules & Drawdowns' | 'Payouts' | 'Accounts & Evaluation' | 'Trading Rules & EAs';
  question: string;
  answer: string;
  order: number;
}

export const DEFAULT_FAQS: FAQItem[] = [
  {
    id: 'FAQ-001',
    category: 'General',
    question: 'What is ATFunding?',
    answer: 'ATFunding is a premier prop trading evaluation firm providing skilled traders with access to simulated accounts ranging from $5,000 up to $200,000+. Traders demonstrate disciplined risk management and consistency. Successful evaluation or instant funding traders earn up to 90% profit split payouts with real capital backing.',
    order: 1
  },
  {
    id: 'FAQ-002',
    category: 'Payouts',
    question: 'How do payouts work?',
    answer: 'Payouts at ATFunding are fast and straightforward. Once you achieve your profit target or complete a 14-day cycle on a Funded Account, you can request your payout directly from your Trader Dashboard via Crypto (USDT TRC20 / ERC20) or Direct Bank Transfer. Profit splits range from 80% to 90%, and disbursements are approved within 24 to 48 business hours.',
    order: 2
  },
  {
    id: 'FAQ-003',
    category: 'Trading Rules & EAs',
    question: 'What is the minimum hold time?',
    answer: 'There is no mandatory minimum holding time for standard trades. You are free to scalp, day trade, or swing trade according to your personal trading strategy. However, trades held for less than 1 second to exploit latency or platform bugs are prohibited under our fair market execution rules.',
    order: 3
  },
  {
    id: 'FAQ-004',
    category: 'Rules & Drawdowns',
    question: 'What is Daily Drawdown?',
    answer: 'Daily Drawdown is the maximum loss permitted in a single trading day, calculated based on your starting balance or equity at 00:00 UTC (whichever is higher). For standard evaluation accounts, the Daily Drawdown limit is set to 5%. If your account equity or balance drops below this threshold at any point during the day, the account is breached.',
    order: 4
  },
  {
    id: 'FAQ-005',
    category: 'Rules & Drawdowns',
    question: 'What is Maximum Drawdown?',
    answer: 'Maximum Drawdown is the total maximum loss threshold permitted on your account, calculated from your initial starting capital (e.g., 10% on 2-Step Evaluation Accounts). Unlike trailing drawdowns that follow profits upwards, ATFunding utilizes static maximum drawdowns, ensuring your loss limit remains fixed and predictable.',
    order: 5
  },
  {
    id: 'FAQ-006',
    category: 'Rules & Drawdowns',
    question: 'What happens if I breach an account?',
    answer: 'If an account breaches Daily Drawdown, Maximum Drawdown, or risk limits, open positions are liquidated and trading access is disabled to protect capital. You will be notified in your terminal. You can reset your evaluation account at any time at a discounted rate or purchase a new evaluation challenge from your dashboard.',
    order: 6
  },
  {
    id: 'FAQ-007',
    category: 'Accounts & Evaluation',
    question: 'How do coupon codes work?',
    answer: 'Coupon and promo codes can be entered on the checkout screen when purchasing an evaluation package. Valid codes instantly apply percentage discounts, bonus account scaling, or BOGO (Buy-One-Get-One) free account upgrades to your order total.',
    order: 7
  },
  {
    id: 'FAQ-008',
    category: 'Accounts & Evaluation',
    question: 'How does Phase 1 / Phase 2 work?',
    answer: 'Our 2-Step Evaluation consists of two phases:\n• Phase 1 (Student): Achieve an 8% or 10% profit target while keeping Daily Loss <5% and Overall Loss <10%.\n• Phase 2 (Practitioner): Achieve a 5% profit target under the exact same drawdown parameters.\nOnce Phase 2 is completed and KYC verified, you receive your Funded Master Account with real profit split eligibility!',
    order: 8
  },
  {
    id: 'FAQ-009',
    category: 'Accounts & Evaluation',
    question: 'How do Instant Accounts work?',
    answer: 'Instant Funding (Instant Bolt) accounts eliminate Phase 1 and Phase 2 evaluation challenges completely. You get immediate access to funded capital with no profit targets required. You can start earning and withdrawing real profit splits right from day 1, as long as you maintain Daily and Maximum drawdown rules.',
    order: 9
  },
  {
    id: 'FAQ-010',
    category: 'Accounts & Evaluation',
    question: 'How long does account delivery take?',
    answer: 'Account credentials are delivered instantly! As soon as your checkout payment is confirmed, your login details for the trading terminal (MT4/MT5/ATTerminal) are automatically generated and displayed on your Trader Dashboard and sent via email.',
    order: 10
  },
  {
    id: 'FAQ-011',
    category: 'Payouts',
    question: 'How do payout requests work?',
    answer: 'To submit a payout request:\n1. Log into your Trader Dashboard and navigate to the "Payouts" tab.\n2. Verify that your account has no open trades and meets the minimum trading day requirement.\n3. Enter your preferred withdrawal method (Crypto USDT or Direct Bank) along with payment details.\n4. Click "Submit Payout Request". Our finance team will audit the trades and disburse your profit split within 24–48 hours.',
    order: 11
  },
  {
    id: 'FAQ-012',
    category: 'Trading Rules & EAs',
    question: 'Can I use EAs or bots?',
    answer: 'Yes! You are fully allowed to trade using Expert Advisors (EAs), custom algorithmic bots, risk calculators, and indicators. However, third-party copy trading services that replicate identical trades across hundreds of unrelated accounts or high-frequency latency arbitrage bots are prohibited.',
    order: 12
  },
  {
    id: 'FAQ-013',
    category: 'Trading Rules & EAs',
    question: 'Can I trade during news?',
    answer: 'Yes! High-impact news trading is permitted on ATFunding accounts. You can hold existing positions or execute new trades during major economic calendar events (such as NFP, CPI, FOMC). Always ensure adequate margin to account for news volatility and spread expansion.',
    order: 13
  },
  {
    id: 'FAQ-014',
    category: 'General',
    question: 'How do I contact support?',
    answer: 'Our dedicated trader support desk is available 24/7/365 through multiple channels:\n• Live Chat & Tickets: Submit a ticket directly from your Trader Dashboard.\n• Official Support Email: atfundingsupport@gmail.com\n• Community Channels: Join our official Telegram and Discord channels for live trader support and announcements.',
    order: 14
  }
];
