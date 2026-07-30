export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  name: string;
  firstName?: string;
  lastName?: string;
  username?: string;
  phoneNumber?: string;
  status: string;
  role: 'admin' | 'trader';
  affiliateCode: string;
  referredBy?: string;
  emailVerified?: boolean;
  country?: string;
  state?: string;
  city?: string;
  phone?: string;
  address?: string;
  kycStatus?: 'unverified' | 'pending' | 'approved' | 'rejected' | string;
  kycDocuments?: {
    passport?: string;
    idCard?: string;
    selfie?: string;
    addressProof?: string;
    documentType?: string;
    docFront?: string;
    docBack?: string;
  };
  coins?: number;
  xp?: number;
  createdAt: string;
}

export type AccountType = 'one_step' | 'two_step' | 'payout_later' | 'instant_bolt' | 'trial' | 'funded';
export type AccountStatus = 'active' | 'breached' | 'passed' | 'payout_requested' | 'Pending Approval' | 'phase2_pending' | 'PHASE2_PENDING' | 'funded_pending' | 'FUNDED_PENDING' | 'pending_review' | 'Pending Review' | 'rejected' | 'approved' | 'funded';

export interface TradingAccount {
  id: string;
  userId: string;
  userEmail?: string;
  accountType: AccountType;
  size: number;
  balance: number;
  startingBalance: number;
  equity: number;
  dailyStartingBalance: number;
  dailyStartingEquity: number;
  phase: number; // 1, 2, or 3 (Funded)
  status: AccountStatus;
  phaseStatus?: string; // 'phase1_active', 'phase2_pending', 'phase2_active', 'funded_pending', 'funded'
  cooldownUntil?: string; // ISO string timestamp for 10-minute calm down cooldown
  login: string;
  password: string;
  platform: string;
  server: string;
  profitTarget: number; // 0 for instant bolt or already funded
  dailyDrawdownLimit: number; // e.g. 5% of starting or daily starting
  maxDrawdownLimit: number; // e.g. 10% of starting balance
  passedAt?: string;
  expiresAt?: string | null;
  createdAt: string;
  holdRuleEnabled?: boolean;
  holdRuleUpgradePurchased?: boolean;
  remove2MinuteRule?: boolean;
  lastTradeClosedAt?: string;
}

export interface Trade {
  id: string;
  accountId: string;
  userId: string;
  symbol: string;
  type: 'buy' | 'sell';
  lots: number;
  openPrice: number;
  closePrice?: number;
  profit: number;
  status: 'open' | 'closed';
  openTime: string;
  closeTime?: string;
}

export interface PayoutRequest {
  id: string;
  userId: string;
  userEmail?: string;
  accountId: string;
  amount: number;
  status: 'pending' | 'approved' | 'rejected';
  payoutMethod: string;
  payoutAddress: string;
  createdAt: string;
  processedAt?: string;
}

export interface OtpRequest {
  id?: string;
  userId: string;
  email: string;
  otpCode: string;
  createdAt: string;
  expiresAt: string;
  verified: boolean;
  attempts: number;
  expired?: boolean;
}

export interface Affiliate {
  userId: string;
  code: string;
  clicks: number;
  referrals: number;
  unpaidBalance: number;
  totalEarned: number;
}

export interface Coupon {
  id?: string;
  code: string;
  discountType?: 'percent' | 'fixed';
  discountPercent?: number;
  discountAmount?: number;
  active: boolean;
  createdBy?: string;
  expiresAt?: string; // ISO date string e.g. "2026-12-31" or timestamp
  maxUses?: number; // e.g. 100
  usedCount?: number; // e.g. 12
  applicableAccountTypes?: string[]; // e.g. ['one_step', 'two_step', 'payout_later', 'instant_bolt', 'trial'] or ['all']
  applicablePackages?: string[]; // e.g. ['one_step_5k', 'two_step_100k'] or ['all']
}

export interface LeaderboardEntry {
  id: string;
  rank: number;
  userId: string;
  traderName: string;
  email?: string;
  totalProfit: number;
  winRate: number;
  accountType: string;
  accountSize: number | string;
  status: 'Active' | 'Breached' | 'Funded' | 'Payout' | string;
  pinned?: boolean;
  customOrder?: number;
  updatedAt?: string;
}

export interface LeaderboardOverride {
  userId: string;
  pinned?: boolean;
  customOrder?: number;
  profitOffset?: number;
  winRateOverride?: number;
  statusOverride?: string;
  traderNameOverride?: string;
}

export interface Certificate {
  id: string;
  certificateId: string;
  userId: string;
  name: string;
  userName?: string;
  email?: string;
  userEmail?: string;
  accountSize: string | number;
  accountType: string; // Trial, Instant, 1 Step, 2 Step, Funded
  phase: string; // Trial, Phase 1, Phase 2, Funded
  status?: string;
  issueDate: string;
  uploadDate?: string;
  uploadedBy?: string;
  certificateUrl?: string;
  certificateImage?: string;
  userPhoto?: string;
  createdAt: string;
  type?: 'payout' | 'passed_evaluation' | string;
  certificateType?: string;
  amount?: number;
  date?: string;
  customTitle?: string;
  customMessage?: string;
}

export interface CertificateTemplate {
  id?: string;
  title: string; // e.g. "CERTIFICATE OF ACHIEVEMENT"
  subtitle: string; // e.g. "PROUDLY PRESENTED TO"
  customMessage: string;
  badgeText: string; // e.g. "VERIFIED FUNDED TRADER"
  statusIntro?: string; // e.g. "You are officially"
  statusTitle?: string; // e.g. "FUNDED TRADER"
  ceoName: string; // e.g. "Asjad Khan"
  ceoTitle: string; // e.g. "CEO & FOUNDER"
  riskTeamName?: string; // e.g. "Risk Team"
  riskTeamTitle?: string; // e.g. "RISK TEAM"
  companyName: string; // e.g. "ATFUNDING"
  companyTagline?: string; // e.g. "TRADE. PROVE. GET FUNDED."
  sealText1?: string; // e.g. "DISCIPLINE"
  sealText2?: string; // e.g. "EXCELLENCE"
  sealText3?: string; // e.g. "SUCCESS"
  footerMessage: string;
  bgImageUrl?: string;
  logoUrl?: string;
  signatureUrl?: string;
  riskSignatureUrl?: string;
  updatedAt?: string;
}

export interface LivePrice {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
}

export interface Order {
  orderId: string;
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  country: string;
  state: string;
  city: string;
  postalCode: string;
  address: string;
  accountType: AccountType;
  accountSize: string;
  platform: 'ATTerminal' | string;
  couponCode: string;
  paymentMethod: 'Bitcoin (BTC)' | 'USDT TRC20' | 'USDT ERC20' | 'Litecoin (LTC)' | 'UPI' | string;
  walletAddress: string;
  paymentScreenshot: string; // URL of screenshot (Storage or base64 fallback)
  transactionHash?: string;
  transactionId?: string;
  kycStatus?: 'Pending' | 'Approved' | 'Rejected' | 'N/A' | string;
  kycDocuments?: {
    passport?: string;
    idCard?: string;
    selfie?: string;
    addressProof?: string;
  };
  price: number;
  discount: number;
  finalPrice: number;
  status: 'Pending Payment Review' | 'Approved' | 'Rejected';
  rejectionReason?: string;
  createdAt: string;
  holdRuleUpgradePurchased?: boolean;
}

export interface ReferralWithdrawal {
  id: string;
  userId: string;
  userEmail: string;
  userName?: string;
  amount: number;
  method: 'USDT TRC20' | 'Bank Transfer' | string;
  accountDetails: string;
  status: 'Pending' | 'Approved' | 'Rejected' | 'Paid';
  rejectionReason?: string;
  createdAt: string;
  processedAt?: string;
}

export interface PaymentSettings {
  upiId?: string;
  upiQrCode?: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
  bankQrCode?: string;
  btcAddress: string;
  btcQrCode?: string;
  usdtTrc20Address: string;
  usdtTrc20QrCode?: string;
  usdtErc20Address: string;
  usdtErc20QrCode?: string;
  ltcAddress: string;
  ltcQrCode?: string;
}

export interface RuleSettings {
  oneStepDailyLoss: number;
  oneStepMaxLoss: number;
  oneStepProfitTarget: number;
  oneStepMinDays: number;
  oneStepTenMinuteRule: boolean;

  twoStepDailyLoss: number;
  twoStepMaxLoss: number;
  twoStepPhase1Target: number;
  twoStepPhase2Target: number;
  twoStepMinDays: number;
  twoStepTenMinuteRule: boolean;

  payoutLaterDailyLoss: number;
  payoutLaterMaxLoss: number;
  payoutLaterMinDays: number;
  payoutLaterTenMinuteRule: boolean;
}

export interface RuleViolation {
  id: string;
  userId: string;
  accountId: string;
  accountNumber?: string;
  tradeId?: string;
  symbol?: string;
  type?: string;
  lots?: number;
  openTime?: string;
  closeTime?: string;
  durationSeconds?: number;
  timestamp: string;
  violationType: '2 Minute Hold Rule' | '10 Minute Cooldown' | 'Daily Drawdown' | 'Max Drawdown' | 'Risk Violation' | 'Consistency Violation' | string;
  status: 'Warning' | 'Ignored' | 'Suspended' | 'Breached' | string;
  userEmail?: string;
  userName?: string;
}

export interface BreachRecord {
  id: string;
  userId: string;
  accountId: string;
  breachReason: string;
  breachDate: string;
  adminName: string;
  userEmail?: string;
}

export interface UserNotification {
  id: string;
  userId: string;
  title: string;
  message: string;
  type: 'info' | 'success' | 'alert' | 'danger';
  read: boolean;
  createdAt: string;
}

export interface SocialLink {
  id: string;
  name: string;
  icon: string;
  url: string;
  active: boolean;
  sortOrder: number;
}

export interface PaymentMethod {
  id: string;
  name: string;
  walletAddress: string;
  qrCode?: string;
  notes?: string;
  active: boolean;
}

export interface TicketMessage {
  id: string;
  senderId: string;
  senderEmail: string;
  senderRole: 'trader' | 'admin';
  message: string;
  createdAt: string;
}

export interface SupportTicket {
  id: string;
  userId: string;
  userEmail: string;
  userName: string;
  subject: string;
  status: 'open' | 'replied' | 'closed';
  createdAt: string;
  updatedAt: string;
  messages: TicketMessage[];
}

export interface Announcement {
  id: string;
  title: string;
  message: string;
  startDate: string;
  endDate: string;
  active: boolean;
  createdAt: string;
}

export interface Task {
  id: string;
  name: string;
  description: string;
  platform: string;
  link: string;
  rewardCoins: number;
  rewardXP: number;
  startDate: string;
  endDate: string;
  active: boolean;
  createdAt: string;
}

export interface TaskSubmission {
  id: string;
  taskId: string;
  taskName: string;
  taskPlatform: string;
  userId: string;
  userEmail: string;
  userName: string;
  screenshotUrl: string;
  status: 'Pending Review' | 'Approved' | 'Rejected';
  rewardCoins: number;
  rewardXP: number;
  rejectionReason?: string;
  createdAt: string;
  processedAt?: string;
}

export interface RewardStoreItem {
  id: string;
  name: string;
  coinCost: number;
  quantity: number;
  active: boolean;
  type: 'trial_account' | 'five_k_one_step' | 'ten_k_one_step' | 'twenty_five_k_one_step' | 'discount_coupon' | 'giveaway' | 'custom_reward' | string;
  createdAt: string;
}

export interface RewardRedemption {
  id: string;
  itemId: string;
  itemName: string;
  itemType: string;
  coinCost: number;
  userId: string;
  userEmail: string;
  userName: string;
  status: 'Pending' | 'Approved' | 'Rejected';
  rejectionReason?: string;
  createdAt: string;
  processedAt?: string;
}

export interface CustomLink {
  id: string;
  name: string;
  url: string;
  platform: string;
  active: boolean;
  createdAt: string;
}

export interface CoinHistory {
  id: string;
  userId: string;
  userEmail: string;
  amount: number;
  type: 'task_completion' | 'reward_redemption' | 'manual_add' | 'manual_remove' | 'bonus' | 'event' | string;
  description: string;
  createdAt: string;
}

export interface XPHistory {
  id: string;
  userId: string;
  userEmail: string;
  amount: number;
  type: 'task_completion' | 'manual_add' | 'manual_remove' | string;
  description: string;
  createdAt: string;
}
