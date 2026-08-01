import React, { useState, useEffect, useRef } from 'react';
import * as LucideIcons from 'lucide-react';
import { 
  Users, Layers, DollarSign, Award, Gift, Ticket, ListFilter, Check, X, Plus, Trash2, Shield, RefreshCw,
  Coins, Search, Filter, Image as ImageIcon, AlertTriangle, AlertCircle, Eye, HelpCircle, Mail, MessageSquare, Settings,
  Activity, Clock, Tag, Share2, Bell, Edit3, Upload, FileText, Send, Download, Sparkles, Sliders, ExternalLink,
  Database, ShieldAlert, Copy
} from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { TradingAccount, UserProfile, PayoutRequest, Affiliate, Coupon, Trade, Order, PaymentSettings, AccountType, SocialLink, PaymentMethod, SupportTicket, TicketMessage, Announcement, Task, TaskSubmission, RewardStoreItem, RewardRedemption, CustomLink, ReferralWithdrawal, Certificate, CertificateTemplate } from '../types';
import { CHALLENGE_PACKAGES, getAccountDrawdownLimits } from '../constants';
import { db, auth } from '../firebase';
import { firebaseTelemetry } from '../firebaseTelemetry';
import { updatePassword } from 'firebase/auth';
import { collection, getDocs, doc, getDoc, setDoc, updateDoc, deleteDoc, query, where, limit } from 'firebase/firestore';
import { getDocsCached, getDocCached, invalidateCache } from '../lib/firestoreCache';
import EmailCenter from './EmailCenter';
import AdminCertificateManager from './AdminCertificateManager';
import LeaderboardView from './LeaderboardView';
import { getCandleEngineMetrics } from '../core/candleEngine';
import LuxuryCertificate, { DEFAULT_CERT_TEMPLATE } from './LuxuryCertificate';
import { processAffiliateCommission } from '../utils/affiliateUtils';
import { subscribeToPrices, SymbolPrice, DECIMAL_PLACES } from '../core/priceEngine';
import { getSpikeConfig, setSpikeConfig, resetSpikeConfig, subscribeToMarketEvents, MarketEventLog, SpikeConfig } from '../core/spikeEngine';
import { calculateTradePnL } from '../core/pnlEngine';
import { executeClosePosition } from '../core/positionEngine';
import { auditAccount, calculateDynamicAccountMetrics, calculateAccountRiskScore, detectGamblingBehavior, getMaxLotSize, getProfitableTradingDays, AuditReportItem } from '../core/riskEngine';
import { logAccountAuditChange, verifyAccountIntegrity } from '../utils/auditLogger';
import { createFirestoreBackup, checkAndRunDailyAutoBackup, listFirestoreBackups, restoreFirestoreBackup, FirestoreBackupRecord } from '../utils/backupManager';
import { getAutoCloseDebugMode, setAutoCloseDebugMode, getAutoCloseDebugLogs, AutoCloseDebugLog } from '../utils/autoCloseLogger';

export default function AdminPanel() {
  const [activeTab, setActiveTab] = useState<'stats' | 'search' | 'users' | 'orders' | 'accounts' | 'active_accounts' | 'payouts' | 'coupons' | 'trades' | 'payment_settings' | 'rule_settings' | 'rule_violations' | 'broadcast' | 'cms' | 'settings' | 'social_links' | 'support_tickets' | 'announcements' | 'offers_availability' | 'tasks_rewards' | 'email_center' | 'challenge_reviews' | 'referral_withdrawals' | 'kyc_verification' | 'market_control' | 'certificates' | 'leaderboard' | 'database_backups' | 'auto_close_debug'>('stats');

  // Active Accounts Management States
  const [accountSearchQuery, setAccountSearchQuery] = useState('');
  const [accountFilterStatus, setAccountFilterStatus] = useState<string>('All');
  const [accountFilterType, setAccountFilterType] = useState<string>('All');
  const [editingAccountBalanceModal, setEditingAccountBalanceModal] = useState<TradingAccount | null>(null);
  const [modalNewBalance, setModalNewBalance] = useState<number>(0);
  const [modalNewEquity, setModalNewEquity] = useState<number>(0);
  const [breachingAccountModal, setBreachingAccountModal] = useState<TradingAccount | null>(null);
  const [breachReasonInput, setBreachReasonInput] = useState<string>('Manual Admin Breach');
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [accounts, setAccounts] = useState<TradingAccount[]>([]);
  const [payouts, setPayouts] = useState<PayoutRequest[]>([]);
  const [referralWithdrawals, setReferralWithdrawals] = useState<ReferralWithdrawal[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Audit System States
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [auditFilter, setAuditFilter] = useState<'all' | 'errors' | 'gambling'>('errors');
  const [isRepairingAll, setIsRepairingAll] = useState(false);
  const [auditNoticeMsg, setAuditNoticeMsg] = useState('');

  // Database Backup States
  const [backupsList, setBackupsList] = useState<FirestoreBackupRecord[]>([]);
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [isRestoringBackup, setIsRestoringBackup] = useState(false);
  const [selectedBackupToRestore, setSelectedBackupToRestore] = useState<FirestoreBackupRecord | null>(null);
  const [backupNoticeMsg, setBackupNoticeMsg] = useState('');

  // Auto Close Debugging States
  const [autoCloseDebugMode, setAutoCloseDebugState] = useState<boolean>(getAutoCloseDebugMode());
  const [autoCloseDebugLogs, setAutoCloseDebugLogs] = useState<AutoCloseDebugLog[]>([]);
  const [isLoadingAutoCloseLogs, setIsLoadingAutoCloseLogs] = useState(false);
  const [autoCloseFilterQuery, setAutoCloseFilterQuery] = useState('');

  // Auto-run daily Firestore export check on mount
  useEffect(() => {
    checkAndRunDailyAutoBackup().then((ran) => {
      if (ran) console.log("Daily Firestore backup auto-check completed.");
      refreshBackups();
    });
    fetchAutoCloseDebugLogs();
  }, []);

  const refreshBackups = async () => {
    const list = await listFirestoreBackups();
    setBackupsList(list);
  };

  const fetchAutoCloseDebugLogs = async () => {
    setIsLoadingAutoCloseLogs(true);
    try {
      const logs = await getAutoCloseDebugLogs();
      setAutoCloseDebugLogs(logs);
    } catch (e) {
      console.warn("Failed to fetch auto close debug logs:", e);
    } finally {
      setIsLoadingAutoCloseLogs(false);
    }
  };

  const handleManualBackup = async () => {
    setIsCreatingBackup(true);
    setBackupNoticeMsg("Creating full Firestore snapshot export...");
    try {
      const record = await createFirestoreBackup('MANUAL');
      setBackupNoticeMsg(`Backup snapshot created successfully! (${record.counts?.total || 0} total records archived)`);
      await refreshBackups();
    } catch (e: any) {
      setBackupNoticeMsg(`Backup failed: ${e.message || 'Error creating snapshot'}`);
    } finally {
      setIsCreatingBackup(false);
    }
  };

  const handleRestoreBackup = async (backup: FirestoreBackupRecord) => {
    setIsRestoringBackup(true);
    setBackupNoticeMsg(`Restoring backup ${backup.id}... Please do not navigate away.`);
    try {
      const res = await restoreFirestoreBackup(backup);
      const totalRestored = Object.values(res.restoredCounts || {}).reduce((a, b) => a + b, 0);
      if (!res.errors || res.errors.length === 0) {
        setBackupNoticeMsg(`Restoration Complete! ${totalRestored} records restored into Firestore.`);
        setSelectedBackupToRestore(null);
      } else {
        setBackupNoticeMsg(`Restoration completed with ${res.errors.length} warnings. Restored ${totalRestored} records.`);
      }
    } catch (e: any) {
      setBackupNoticeMsg(`Restoration Failed: ${e.message}`);
    } finally {
      setIsRestoringBackup(false);
    }
  };

  // Computes audit reports across all active accounts directly from trade history
  const runSystemAudit = (): AuditReportItem[] => {
    return accounts.map((acc) => auditAccount(acc, trades, []));
  };

  const auditReports = runSystemAudit();
  const accountsWithErrors = auditReports.filter((r) => r.isBalanceMismatch || r.isEquityMismatch || r.isStatusMismatch);
  const accountsWithGamblingFlags = auditReports.filter((r) => r.gamblingFlags.length > 0);

  // Auto Repair Single Account
  const handleRepairSingleAccount = async (reportItem: AuditReportItem) => {
    try {
      await updateDoc(doc(db, 'accounts', reportItem.accountId), {
        balance: reportItem.expectedBalance,
        equity: reportItem.expectedEquity,
        status: reportItem.expectedStatus,
        updatedAt: new Date().toISOString()
      });
      await logAccountAuditChange({
        accountId: reportItem.accountId,
        accountNumber: reportItem.login,
        previousBalance: reportItem.currentStoredBalance,
        newBalance: reportItem.expectedBalance,
        previousStatus: reportItem.storedStatus,
        newStatus: reportItem.expectedStatus,
        sourceOfChange: 'ADMIN_REPAIR',
        details: `Single account audit repair applied by admin.`
      });
      setAuditNoticeMsg(`Successfully repaired Account #${reportItem.login}: Balance set to $${reportItem.expectedBalance.toLocaleString()}, Status: ${reportItem.expectedStatus}`);
    } catch (err: any) {
      alert(`Error repairing Account #${reportItem.login}: ` + err.message);
    }
  };

  // Auto Repair All Mismatches
  const handleAutoRepairAll = async () => {
    if (accountsWithErrors.length === 0) {
      alert("No account balance or status mismatches detected. System is 100% healthy!");
      return;
    }

    const confirmRepair = window.confirm(`Auto-repair ${accountsWithErrors.length} accounts with balance/equity/status mismatches? This will update Firestore to calculated true values.`);
    if (!confirmRepair) return;

    setIsRepairingAll(true);
    setAuditNoticeMsg("Repairing accounts...");
    let repairedCount = 0;

    try {
      for (const item of accountsWithErrors) {
        await updateDoc(doc(db, 'accounts', item.accountId), {
          balance: item.expectedBalance,
          equity: item.expectedEquity,
          status: item.expectedStatus,
          updatedAt: new Date().toISOString()
        });
        await logAccountAuditChange({
          accountId: item.accountId,
          accountNumber: item.login,
          previousBalance: item.currentStoredBalance,
          newBalance: item.expectedBalance,
          previousStatus: item.storedStatus,
          newStatus: item.expectedStatus,
          sourceOfChange: 'ADMIN_BATCH_REPAIR',
          details: `Batch system audit repair applied by admin.`
        });
        repairedCount++;
      }
      setAuditNoticeMsg(`🎉 System Repair Complete! ${repairedCount} account(s) updated to true trade history values.`);
    } catch (err: any) {
      alert("Error during batch repair: " + err.message);
    } finally {
      setIsRepairingAll(false);
    }
  };

  // Market Spike Control States
  const [spikeEnabled, setSpikeEnabled] = useState<boolean>(false);
  const [spikeSymbol, setSpikeSymbol] = useState<string>('EURUSD');
  const [spikePipSize, setSpikePipSize] = useState<number>(100);
  const [spikeDirection, setSpikeDirection] = useState<'Up' | 'Down'>('Up');
  const [spikeApplyTo, setSpikeApplyTo] = useState<'Next Candle Only' | 'Current Candle'>('Next Candle Only');
  const [spikeAutoReset, setSpikeAutoReset] = useState<boolean>(true);
  const [marketEventLogs, setMarketEventLogs] = useState<MarketEventLog[]>([]);
  const [marketControlMsg, setMarketControlMsg] = useState<string>('');
  const [isApplyingSpike, setIsApplyingSpike] = useState<boolean>(false);
  const [livePrices, setLivePrices] = useState<Record<string, SymbolPrice>>({});

  // Universal Admin Search States
  const [globalSearchQuery, setGlobalSearchQuery] = useState('');
  const [globalSearchCategory, setGlobalSearchCategory] = useState<'all' | 'users' | 'accounts' | 'transactions' | 'payouts'>('all');

  // KYC Verification states
  const [kycSearch, setKycSearch] = useState('');
  const [kycStatusFilter, setKycStatusFilter] = useState<'All' | 'pending' | 'approved' | 'rejected'>('All');
  const [viewingKycUser, setViewingKycUser] = useState<UserProfile | null>(null);

  const [engineMetrics, setEngineMetrics] = useState(getCandleEngineMetrics('EURUSD'));

  useEffect(() => {
    const interval = setInterval(() => {
      setEngineMetrics(getCandleEngineMetrics('EURUSD'));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Realtime Market Spike Control & Live Prices Listener
  useEffect(() => {
    const initialCfg = getSpikeConfig();
    setSpikeEnabled(initialCfg.enabled);
    setSpikeSymbol(initialCfg.symbol);
    setSpikePipSize(initialCfg.pipSize);
    setSpikeDirection(initialCfg.direction);
    setSpikeApplyTo(initialCfg.applyTo);
    setSpikeAutoReset(initialCfg.autoReset);

    const unsubEvents = subscribeToMarketEvents((logs) => {
      setMarketEventLogs(logs);
    });

    const unsubPrices = subscribeToPrices((prices) => {
      setLivePrices(prices);
    });

    return () => {
      unsubEvents();
      unsubPrices();
    };
  }, []);

  const handleApplySpike = async () => {
    setIsApplyingSpike(true);
    setMarketControlMsg('');
    try {
      await setSpikeConfig({
        enabled: spikeEnabled,
        symbol: spikeSymbol,
        pipSize: spikePipSize,
        direction: spikeDirection,
        applyTo: spikeApplyTo,
        autoReset: spikeAutoReset,
        statusMessage: spikeEnabled
          ? `Current Market Event: ${spikePipSize} Pip ${spikeDirection} Spike on ${spikeSymbol}`
          : 'Market Control: Idle (Standard Simulation)',
        adminEmail: auth.currentUser?.email || adminEmailInput || 'ATgrowfund@gmail.com',
      }, auth.currentUser?.email || adminEmailInput || 'ATgrowfund@gmail.com');

      setMarketControlMsg(spikeEnabled ? `✅ Candle Spike Activated! (${spikePipSize} Pips ${spikeDirection} on ${spikeSymbol})` : 'ℹ️ Market Spike Disabled. Standard simulation active.');
    } catch (err: any) {
      setMarketControlMsg(`❌ Error triggering spike: ${err.message || 'Unknown error'}`);
    } finally {
      setIsApplyingSpike(false);
    }
  };

  const handleResetSpike = async () => {
    setIsApplyingSpike(true);
    try {
      await resetSpikeConfig(auth.currentUser?.email || adminEmailInput || 'ATgrowfund@gmail.com');
      setSpikeEnabled(false);
      setMarketControlMsg('✅ Spike cancelled. Market reset to idle standard simulation.');
    } catch (err: any) {
      setMarketControlMsg(`❌ Error resetting spike: ${err.message}`);
    } finally {
      setIsApplyingSpike(false);
    }
  };

  const [telemetryStats, setTelemetryStats] = useState(firebaseTelemetry.getStats());

  useEffect(() => {
    const unsubscribe = firebaseTelemetry.subscribe(() => {
      setTelemetryStats(firebaseTelemetry.getStats({
        users: users.length,
        coupons: coupons.length,
        accounts: accounts.length,
        orders: orders.length,
        payouts: payouts.length,
      }));
    });
    return () => unsubscribe();
  }, [users.length, coupons.length, accounts.length, orders.length, payouts.length]);

  // General settings state
  const [adminEmailInput, setAdminEmailInput] = useState('ATgrowfund@gmail.com');
  const [supportEmailInput, setSupportEmailInput] = useState('atfundingsupport@gmail.com');
  const [facebookLinkInput, setFacebookLinkInput] = useState('https://www.facebook.com/share/1MUjNkYEyF/');
  const [instagramLinkInput, setInstagramLinkInput] = useState('https://www.instagram.com/atfunding_?igsh=MTJwcnNrMTZ2NGppZg==');
  const [telegramLinkInput, setTelegramLinkInput] = useState('https://t.me/httpsAsjadTrades');
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [settingsMsg, setSettingsMsg] = useState('');
  const [isSavingSettings, setIsSavingSettings] = useState(false);

  // Manual wallet settings state
  const [btcAddressInput, setBtcAddressInput] = useState('');
  const [usdtTrc20AddressInput, setUsdtTrc20AddressInput] = useState('');
  const [usdtErc20AddressInput, setUsdtErc20AddressInput] = useState('');
  const [ltcAddressInput, setLtcAddressInput] = useState('');
  const [walletSettingsMsg, setWalletSettingsMsg] = useState('');
  const [isSavingWallets, setIsSavingWallets] = useState(false);

  // New Payment Settings
  const [upiIdInput, setUpiIdInput] = useState('');
  const [upiQrCodeInput, setUpiQrCodeInput] = useState('');
  const [btcQrCodeInput, setBtcQrCodeInput] = useState('');
  const [usdtTrc20QrCodeInput, setUsdtTrc20QrCodeInput] = useState('');
  const [usdtErc20QrCodeInput, setUsdtErc20QrCodeInput] = useState('');
  const [ltcQrCodeInput, setLtcQrCodeInput] = useState('');
  const [isUploadingQR, setIsUploadingQR] = useState<string | null>(null);

  // New Rule Settings
  const [oneStepDailyLoss, setOneStepDailyLoss] = useState(4);
  const [oneStepMaxLoss, setOneStepMaxLoss] = useState(8);
  const [oneStepProfitTarget, setOneStepProfitTarget] = useState(10);
  const [oneStepMinDays, setOneStepMinDays] = useState(0);
  const [oneStepTenMinuteRule, setOneStepTenMinuteRule] = useState(true);

  const [twoStepDailyLoss, setTwoStepDailyLoss] = useState(5);
  const [twoStepMaxLoss, setTwoStepMaxLoss] = useState(10);
  const [twoStepPhase1Target, setTwoStepPhase1Target] = useState(8);
  const [twoStepPhase2Target, setTwoStepPhase2Target] = useState(5);
  const [twoStepMinDays, setTwoStepMinDays] = useState(0);
  const [twoStepTenMinuteRule, setTwoStepTenMinuteRule] = useState(true);

  const [payoutLaterDailyLoss, setPayoutLaterDailyLoss] = useState(3);
  const [payoutLaterMaxLoss, setPayoutLaterMaxLoss] = useState(6);
  const [payoutLaterMinDays, setPayoutLaterMinDays] = useState(5);
  const [payoutLaterTenMinuteRule, setPayoutLaterTenMinuteRule] = useState(true);

  const [ruleSettingsMsg, setRuleSettingsMsg] = useState('');
  const [isSavingRules, setIsSavingRules] = useState(false);

  // Rule violations & Breaches
  const [ruleViolations, setRuleViolations] = useState<any[]>([]);
  const [breaches, setBreaches] = useState<any[]>([]);

  // Orders Filter & Search states
  const [orderSearch, setOrderSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [countryFilter, setCountryFilter] = useState<string>('All');
  const [typeFilter, setTypeFilter] = useState<string>('All');

  // Traders Filter & Search states
  const [userSearch, setUserSearch] = useState('');
  const [userStatusFilter, setUserStatusFilter] = useState<string>('All');

  // Order Rejection state
  const [rejectingOrderId, setRejectingOrderId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [rejectionError, setRejectionError] = useState('');

  // Selected Order for Modal
  const [selectedOrderForModal, setSelectedOrderForModal] = useState<Order | null>(null);

  // Pending Review Modals State
  const [reviewHistoryAccount, setReviewHistoryAccount] = useState<TradingAccount | null>(null);
  const [reviewViolationsAccount, setReviewViolationsAccount] = useState<TradingAccount | null>(null);
  const [reviewRejectAccount, setReviewRejectAccount] = useState<TradingAccount | null>(null);
  const [reviewRejectReason, setReviewRejectReason] = useState<string>('');

  // Toast / Approval message
  const [approvalToast, setApprovalToast] = useState<string | null>(null);

  // Manual account form states
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedPkgId, setSelectedPkgId] = useState(CHALLENGE_PACKAGES[0].id);
  const [manualAccountMsg, setManualAccountMsg] = useState('');

  // Giveaway Center states
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [giveawayUserSearch, setGiveawayUserSearch] = useState('');
  const [propAccountSearch, setPropAccountSearch] = useState('');
  const [giveawayType, setGiveawayType] = useState<AccountType>('one_step');
  const [giveawaySize, setGiveawaySize] = useState<number>(5000);

  // Coupon form states
  const [newCouponCode, setNewCouponCode] = useState('');
  const [newCouponType, setNewCouponType] = useState<'percent' | 'fixed'>('percent');
  const [newCouponValue, setNewCouponValue] = useState<number>(10);
  const [newCouponExpiresAt, setNewCouponExpiresAt] = useState<string>('');
  const [newCouponMaxUses, setNewCouponMaxUses] = useState<string>('');
  const [newCouponAccountTypes, setNewCouponAccountTypes] = useState<string[]>(['one_step', 'two_step', 'payout_later', 'instant_bolt', 'trial']);
  const [editingCoupon, setEditingCoupon] = useState<Coupon | null>(null);

  // Selected User for detailed view
  const [selectedUserForDetails, setSelectedUserForDetails] = useState<UserProfile | null>(null);

  // Lightbox for high-resolution image viewing
  const [lightboxImage, setLightboxImage] = useState<{ src: string, title: string } | null>(null);

  // Get associated KYC details for selected order
  const getAssociatedKycDetails = (order: Order | null) => {
    if (!order) return { docs: null, status: 'N/A' };
    const associatedUser = users.find(u => u.uid === order.userId || u.email === order.email);
    return {
      docs: associatedUser?.kycDocuments || order.kycDocuments || null,
      status: associatedUser?.kycStatus || order.kycStatus || 'N/A'
    };
  };

  // CMS states
  const [cmsTerms, setCmsTerms] = useState('');
  const [cmsPrivacy, setCmsPrivacy] = useState('');
  const [cmsRefund, setCmsRefund] = useState('');
  const [cmsRisk, setCmsRisk] = useState('');
  const [cmsSaveMsg, setCmsSaveMsg] = useState('');
  const [isSavingCms, setIsSavingCms] = useState(false);

  // New CMS Sub-Tab states
  const [cmsSubTab, setCmsSubTab] = useState<'policies' | 'faqs' | 'rules' | 'how_it_works' | 'why_choose'>('policies');

  // FAQ States
  const [faqsList, setFaqsList] = useState<any[]>([]);
  const [faqQuestion, setFaqQuestion] = useState('');
  const [faqAnswer, setFaqAnswer] = useState('');
  const [editingFaqId, setEditingFaqId] = useState<string | null>(null);

  // Challenge Rules States
  const [challengeRulesList, setChallengeRulesList] = useState<any[]>([]);
  const [selectedRuleDocId, setSelectedRuleDocId] = useState<'one_step' | 'two_step' | 'payout_later' | 'instant_bolt' | 'trial'>('one_step');
  const [rulePhases, setRulePhases] = useState('');
  const [ruleProfitTarget, setRuleProfitTarget] = useState('');
  const [ruleDailyDrawdown, setRuleDailyDrawdown] = useState('');
  const [ruleMaxDrawdown, setRuleMaxDrawdown] = useState('');
  const [ruleMinDays, setRuleMinDays] = useState('');
  const [ruleLeverage, setRuleLeverage] = useState('');
  const [ruleFeeStructure, setRuleFeeStructure] = useState('');
  const [rulePayoutInterval, setRulePayoutInterval] = useState('');
  const [ruleCustomRules, setRuleCustomRules] = useState('');

  // How It Works States
  const [howItWorksList, setHowItWorksList] = useState<any[]>([]);
  const [selectedStepId, setSelectedStepId] = useState<'step1' | 'step2' | 'step3' | 'step4'>('step1');
  const [stepTitle, setStepTitle] = useState('');
  const [stepDescription, setStepDescription] = useState('');
  const [stepIcon, setStepIcon] = useState('Award');

  // Why Choose States
  const [whyChooseList, setWhyChooseList] = useState<any[]>([]);
  const [whyChooseTitle, setWhyChooseTitle] = useState('');
  const [whyChooseDescription, setWhyChooseDescription] = useState('');
  const [whyChooseIcon, setWhyChooseIcon] = useState('Award');
  const [editingWhyChooseId, setEditingWhyChooseId] = useState<string | null>(null);

  // Broadcast Communication form states
  const [broadcastRecipientType, setBroadcastRecipientType] = useState<'single' | 'all'>('single');
  const [broadcastTargetUserId, setBroadcastTargetUserId] = useState('');
  const [broadcastSubject, setBroadcastSubject] = useState('');
  const [broadcastBody, setBroadcastBody] = useState('');
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [isBroadcasting, setIsBroadcasting] = useState(false);

  // Certificate Manager States
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [selectedCertUserId, setSelectedCertUserId] = useState<string>('');
  const [certUserName, setCertUserName] = useState('');
  const [certEmail, setCertEmail] = useState('');
  const [certAccountSize, setCertAccountSize] = useState<string>('$10,000');
  const [certAccountType, setCertAccountType] = useState<string>('2 Step');
  const [certPhase, setCertPhase] = useState<string>('Funded');
  const [certIssueDate, setCertIssueDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [certIdInput, setCertIdInput] = useState<string>('');
  const [certUserPhoto, setCertUserPhoto] = useState<string>('');
  const [certSearchQuery, setCertSearchQuery] = useState<string>('');
  const [certFilterPhase, setCertFilterPhase] = useState<string>('All');
  const [certMsg, setCertMsg] = useState<string>('');
  const [isGeneratingCert, setIsGeneratingCert] = useState<boolean>(false);

  // Certificate Template Editor States
  const [activeCertSubTab, setActiveCertSubTab] = useState<'issued' | 'editor'>('issued');
  const [certTemplate, setCertTemplate] = useState<CertificateTemplate>(DEFAULT_CERT_TEMPLATE);
  const [isSavingCertTemplate, setIsSavingCertTemplate] = useState<boolean>(false);
  const [previewCertModal, setPreviewCertModal] = useState<Certificate | null>(null);
  const [isSendingCertEmail, setIsSendingCertEmail] = useState<boolean>(false);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState<boolean>(false);
  const certModalRef = useRef<HTMLDivElement>(null);

  // --- UPGRADE SECTION STATES ---
  // 1. Dynamic Social Links Manager
  const [socialLinks, setSocialLinks] = useState<SocialLink[]>([]);
  const [editingSocialLink, setEditingSocialLink] = useState<SocialLink | null>(null);
  const [socialName, setSocialName] = useState('');
  const [socialIcon, setSocialIcon] = useState('Link');
  const [socialUrl, setSocialUrl] = useState('');
  const [socialActive, setSocialActive] = useState(true);
  const [socialSortOrder, setSocialSortOrder] = useState(0);
  const [socialMsg, setSocialMsg] = useState('');

  // 2. Dynamic Payment Config
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [editingPaymentMethod, setEditingPaymentMethod] = useState<PaymentMethod | null>(null);
  const [payName, setPayName] = useState('');
  const [payAddress, setPayAddress] = useState('');
  const [payQrCode, setPayQrCode] = useState('');
  const [payNotes, setPayNotes] = useState('');
  const [payActive, setPayActive] = useState(true);
  const [payMsg, setPayMsg] = useState('');

  // 4. Support Ticket System
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [ticketReplyMsg, setTicketReplyMsg] = useState('');
  const [ticketFilter, setTicketFilter] = useState<'all' | 'open' | 'replied' | 'closed'>('all');

  // 5. Announcement System
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [editingAnnouncement, setEditingAnnouncement] = useState<Announcement | null>(null);
  const [announceTitle, setAnnounceTitle] = useState('');
  const [announceMessage, setAnnounceMessage] = useState('');
  const [announceStartDate, setAnnounceStartDate] = useState('');
  const [announceEndDate, setAnnounceEndDate] = useState('');
  const [announceActive, setAnnounceActive] = useState(true);
  const [announceMsg, setAnnounceMsg] = useState('');

  // 6. Terminal Credential Manager
  const [editingAccountCredentials, setEditingAccountCredentials] = useState<TradingAccount | null>(null);
  const [credLogin, setCredLogin] = useState('');
  const [credPassword, setCredPassword] = useState('');
  const [credServer, setCredServer] = useState('');
  const [credStatus, setCredStatus] = useState<'active' | 'breached' | 'passed' | 'payout_requested' | 'Pending Approval'>('active');
  const [credMsg, setCredMsg] = useState('');

  // --- BOGO & OFFER SYSTEMS ---
  const [bogoMappings, setBogoMappings] = useState<Record<string, string>>({});
  const [bogoMainSelect, setBogoMainSelect] = useState(CHALLENGE_PACKAGES[0]?.id || '');
  const [bogoFreeSelect, setBogoFreeSelect] = useState(CHALLENGE_PACKAGES[0]?.id || '');
  const [bogoMsg, setBogoMsg] = useState('');

  // Package dynamic configurations (disabled, expectedReturnDate)
  const [packagesConfig, setPackagesConfig] = useState<Record<string, {
    disabled?: boolean;
    expectedReturnDate?: string;
  }>>({});
  const [pkgConfigMsg, setPkgConfigMsg] = useState('');

  // Selected package waitlist view state
  const [selectedPkgWaitlistEmails, setSelectedPkgWaitlistEmails] = useState<string | null>(null);

  // Availability notifications waitlist
  const [interestedUsers, setInterestedUsers] = useState<any[]>([]);
  const [notificationMsg, setNotificationMsg] = useState('');

  // --- TASKS & REWARDS STATES ---
  const [tasks, setTasks] = useState<Task[]>([]);
  const [taskSubmissions, setTaskSubmissions] = useState<TaskSubmission[]>([]);
  const [rewardStoreItems, setRewardStoreItems] = useState<RewardStoreItem[]>([]);
  const [rewardRedemptions, setRewardRedemptions] = useState<RewardRedemption[]>([]);
  const [customLinks, setCustomLinks] = useState<CustomLink[]>([]);
  const [tasksSubTab, setTasksSubTab] = useState<'tasks' | 'submissions' | 'rewards' | 'redemptions' | 'custom_links' | 'ledgers'>('tasks');

  // Task creation/editing form states
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [taskName, setTaskName] = useState('');
  const [taskDesc, setTaskDesc] = useState('');
  const [taskPlatform, setTaskPlatform] = useState('YouTube Subscribe');
  const [taskLink, setTaskLink] = useState('');
  const [taskRewardCoins, setTaskRewardCoins] = useState(10);
  const [taskRewardXP, setTaskRewardXP] = useState(50);
  const [taskStartDate, setTaskStartDate] = useState('');
  const [taskEndDate, setTaskEndDate] = useState('');
  const [taskActive, setTaskActive] = useState(true);
  const [taskMsg, setTaskMsg] = useState('');

  // Reward store creation/editing form states
  const [editingRewardItem, setEditingRewardItem] = useState<RewardStoreItem | null>(null);
  const [rewardName, setRewardName] = useState('');
  const [rewardCoinCost, setRewardCoinCost] = useState(100);
  const [rewardQuantity, setRewardQuantity] = useState(10);
  const [rewardType, setRewardType] = useState('trial_account');
  const [rewardActive, setRewardActive] = useState(true);
  const [rewardMsg, setRewardMsg] = useState('');

  // Custom link manager states
  const [editingCustomLink, setEditingCustomLink] = useState<CustomLink | null>(null);
  const [customLinkName, setCustomLinkName] = useState('');
  const [customLinkUrl, setCustomLinkUrl] = useState('');
  const [customLinkPlatform, setCustomLinkPlatform] = useState('YouTube');
  const [customLinkActive, setCustomLinkActive] = useState(true);
  const [customLinkMsg, setCustomLinkMsg] = useState('');

  // Submissions proof review modal / state
  const [reviewingSubmission, setReviewingSubmission] = useState<TaskSubmission | null>(null);
  const [rejectionReasonText, setRejectionReasonText] = useState('');
  const [submissionMsg, setSubmissionMsg] = useState('');

  // Redemptions approval modal / state
  const [reviewingRedemption, setReviewingRedemption] = useState<RewardRedemption | null>(null);
  const [redemptionRejectionText, setRedemptionRejectionText] = useState('');
  const [redemptionMsg, setRedemptionMsg] = useState('');

  // Manual coin/XP control states
  const [selectedUserForCoinsXP, setSelectedUserForCoinsXP] = useState<string>('');
  const [manualAmount, setManualAmount] = useState<number>(100);
  const [manualDescription, setManualDescription] = useState<string>('Bonus Coins');
  const [manualActionMsg, setManualActionMsg] = useState<string>('');
  const [isQuotaExceeded, setIsQuotaExceeded] = useState<boolean>(false);

  // Efficient 60-second cached data fetcher for Admin Panel (Visible Data Only)
  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);

    const loadAdminData = async () => {
      // Always load core settings with 10-min cache
      try {
        const genSettings = await getDocCached('admin_settings_general', async () => {
          const snap = await getDoc(doc(db, 'settings', 'general'));
          return snap.exists() ? snap.data() : null;
        }, 10 * 60 * 1000, false, 'AdminPanel');
        if (genSettings && isMounted) {
          setAdminEmailInput(genSettings.adminEmail || 'ATgrowfund@gmail.com');
          setSupportEmailInput(genSettings.supportEmail || 'atfundingsupport@gmail.com');
          setFacebookLinkInput(genSettings.facebookLink || '');
          setInstagramLinkInput(genSettings.instagramLink || '');
          setTelegramLinkInput(genSettings.telegramLink || '');
        }
      } catch (e) {}

      // Tab specific visible data fetching with 60s cache
      try {
        if (['stats', 'users', 'search', 'kyc_verification'].includes(activeTab) || users.length === 0) {
          const uList = await getDocsCached<UserProfile>('admin_users', async () => {
            const snap = await getDocs(collection(db, 'users'));
            return snap.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile));
          }, 60000, false, 'AdminPanel');
          if (isMounted) setUsers(uList);
        }

        if (['stats', 'accounts', 'active_accounts', 'challenge_reviews'].includes(activeTab) || accounts.length === 0) {
          const aList = await getDocsCached<TradingAccount>('admin_accounts', async () => {
            const snap = await getDocs(collection(db, 'accounts'));
            return snap.docs.map(d => ({ id: d.id, ...d.data() } as TradingAccount));
          }, 60000, false, 'AdminPanel');
          if (isMounted) setAccounts(aList);
        }

        if (['stats', 'payouts'].includes(activeTab) || payouts.length === 0) {
          const pList = await getDocsCached<PayoutRequest>('admin_payouts', async () => {
            const snap = await getDocs(collection(db, 'payouts'));
            return snap.docs.map(d => ({ id: d.id, ...d.data() } as PayoutRequest));
          }, 60000, false, 'AdminPanel');
          if (isMounted) setPayouts(pList);
        }

        if (['referral_withdrawals'].includes(activeTab)) {
          const rList = await getDocsCached<ReferralWithdrawal>('admin_ref_withdrawals', async () => {
            const snap = await getDocs(collection(db, 'referral_withdrawals'));
            return snap.docs.map(d => ({ id: d.id, ...d.data() as ReferralWithdrawal }));
          }, 60000, false, 'AdminPanel');
          if (isMounted) setReferralWithdrawals(rList);
        }

        if (['coupons'].includes(activeTab)) {
          const cList = await getDocsCached<Coupon>('admin_coupons', async () => {
            const snap = await getDocs(collection(db, 'coupons'));
            return snap.docs.map(d => ({ id: d.id, ...d.data() } as Coupon));
          }, 60000, false, 'AdminPanel');
          if (isMounted) setCoupons(cList);
        }

        if (['trades'].includes(activeTab)) {
          const tList = await getDocsCached<Trade>('admin_trades', async () => {
            const snap = await getDocs(collection(db, 'trades'));
            return snap.docs.map(d => ({ id: d.id, ...d.data() } as Trade));
          }, 60000, false, 'AdminPanel');
          if (isMounted) setTrades(tList);
        }

        if (['stats', 'orders'].includes(activeTab)) {
          const oList = await getDocsCached<Order>('admin_orders', async () => {
            const snap = await getDocs(collection(db, 'orders'));
            return snap.docs.map(d => ({ id: d.id, ...d.data() } as unknown as Order));
          }, 60000, false, 'AdminPanel');
          if (isMounted) setOrders(oList);
        }

        if (['rule_violations'].includes(activeTab)) {
          const rvList = await getDocsCached('admin_rule_violations', async () => {
            const snap = await getDocs(collection(db, 'ruleViolations'));
            return snap.docs.map(d => ({ id: d.id, ...d.data() }));
          }, 60000, false, 'AdminPanel');
          if (isMounted) setRuleViolations(rvList);

          const brList = await getDocsCached('admin_breaches', async () => {
            const snap = await getDocs(collection(db, 'breaches'));
            return snap.docs.map(d => ({ id: d.id, ...d.data() }));
          }, 60000, false, 'AdminPanel');
          if (isMounted) setBreaches(brList);
        }

        if (['support_tickets'].includes(activeTab)) {
          const stList = await getDocsCached<SupportTicket>('admin_support_tickets', async () => {
            const snap = await getDocs(collection(db, 'supportTickets'));
            return snap.docs.map(d => ({ id: d.id, ...d.data() as any }));
          }, 60000, false, 'AdminPanel');
          if (isMounted) setSupportTickets(stList);
        }

        if (['announcements'].includes(activeTab)) {
          const anList = await getDocsCached<Announcement>('admin_announcements', async () => {
            const snap = await getDocs(collection(db, 'announcements'));
            return snap.docs.map(d => ({ id: d.id, ...d.data() as any }));
          }, 60000, false, 'AdminPanel');
          if (isMounted) setAnnouncements(anList);
        }

        if (['tasks_rewards'].includes(activeTab)) {
          const tkList = await getDocsCached<Task>('admin_tasks', async () => {
            const snap = await getDocs(collection(db, 'tasks'));
            return snap.docs.map(d => ({ id: d.id, ...d.data() } as Task));
          }, 60000, false, 'AdminPanel');
          if (isMounted) setTasks(tkList);

          const tsList = await getDocsCached<TaskSubmission>('admin_task_submissions', async () => {
            const snap = await getDocs(collection(db, 'task_submissions'));
            return snap.docs.map(d => ({ id: d.id, ...d.data() } as TaskSubmission));
          }, 60000, false, 'AdminPanel');
          if (isMounted) setTaskSubmissions(tsList);

          const rsList = await getDocsCached<RewardStoreItem>('admin_reward_store', async () => {
            const snap = await getDocs(collection(db, 'reward_store'));
            return snap.docs.map(d => ({ id: d.id, ...d.data() } as RewardStoreItem));
          }, 60000, false, 'AdminPanel');
          if (isMounted) setRewardStoreItems(rsList);

          const rrList = await getDocsCached<RewardRedemption>('admin_reward_redemptions', async () => {
            const snap = await getDocs(collection(db, 'reward_redemptions'));
            return snap.docs.map(d => ({ id: d.id, ...d.data() } as RewardRedemption));
          }, 60000, false, 'AdminPanel');
          if (isMounted) setRewardRedemptions(rrList);
        }

      } catch (err: any) {
        const errMsg = err?.message || String(err);
        if (errMsg.toLowerCase().includes('quota') || errMsg.toLowerCase().includes('exceeded')) {
          setIsQuotaExceeded(true);
        }
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    loadAdminData();
    const timer = setInterval(loadAdminData, 60000);

    return () => {
      isMounted = false;
      clearInterval(timer);
    };
  }, [activeTab]);

  // Sync selected challenge rule into form states
  useEffect(() => {
    const activeRule = challengeRulesList.find(r => r.id === selectedRuleDocId);
    if (activeRule) {
      setRulePhases(activeRule.phases || '');
      setRuleProfitTarget(activeRule.profitTarget || '');
      setRuleDailyDrawdown(activeRule.dailyDrawdown || '');
      setRuleMaxDrawdown(activeRule.maxDrawdown || '');
      setRuleMinDays(activeRule.minDays || '');
      setRuleLeverage(activeRule.leverage || '');
      setRuleFeeStructure(activeRule.feeStructure || '');
      setRulePayoutInterval(activeRule.payoutInterval || '');
      setRuleCustomRules(activeRule.customRules || '');
    } else if (selectedRuleDocId === 'instant_bolt') {
      setRulePhases('Funded Account (Direct)');
      setRuleProfitTarget('No Target');
      setRuleDailyDrawdown('Minimum Loss: $45 - $202.5 (2.25%)');
      setRuleMaxDrawdown('Maximum Loss: $100 - $450 (5%)');
      setRuleMinDays('None');
      setRuleLeverage('1:30');
      setRuleFeeStructure('Standard Instant Fee');
      setRulePayoutInterval('Every 24 Hours');
      setRuleCustomRules('- Profit Target: None\n- Minimum Loss: $45 (2K), $67.5 (3K), $135 (6K), $202.5 (9K)\n- Maximum Loss: $100 (2K), $150 (3K), $300 (6K), $450 (9K)\n- Minimum Trading Days: None\n- Minimum Hold Time: 2 Minutes\n- Cooldown Trades: 10 Minutes\n- Payouts: Every 24 Hours\n- Payout Split: 70%');
    } else {
      setRulePhases('');
      setRuleProfitTarget('');
      setRuleDailyDrawdown('');
      setRuleMaxDrawdown('');
      setRuleMinDays('');
      setRuleLeverage('');
      setRuleFeeStructure('');
      setRulePayoutInterval('');
      setRuleCustomRules('');
    }
  }, [selectedRuleDocId, challengeRulesList]);

  // Sync selected process step into form states
  useEffect(() => {
    const activeStep = howItWorksList.find(s => s.id === selectedStepId);
    if (activeStep) {
      setStepTitle(activeStep.title || '');
      setStepDescription(activeStep.description || '');
      setStepIcon(activeStep.icon || 'Award');
    }
  }, [selectedStepId, howItWorksList]);

  const fetchAllData = async () => {
    // No-op for backward compatibility (real-time active)
    console.log("Realtime sync active. No manual fetch needed.");
  };

  const handleUpdateGeneralSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingSettings(true);
    setSettingsMsg('');

    try {
      // 1. Save general settings in firestore settings/general
      await setDoc(doc(db, 'settings', 'general'), {
        adminEmail: adminEmailInput.trim(),
        supportEmail: supportEmailInput.trim(),
        facebookLink: facebookLinkInput.trim(),
        instagramLink: instagramLinkInput.trim(),
        telegramLink: telegramLinkInput.trim(),
        updatedAt: new Date().toISOString()
      }, { merge: true });

      // 2. If password input is not empty, update user's auth password in Firebase Auth!
      if (adminPasswordInput.trim()) {
        const currentUser = auth.currentUser;
        if (currentUser) {
          await updatePassword(currentUser, adminPasswordInput.trim());
          setAdminPasswordInput('');
          setSettingsMsg("General Settings and Admin Password updated successfully!");
        } else {
          setSettingsMsg("General Settings updated successfully! (Auth password could not be updated: no active auth session found)");
        }
      } else {
        setSettingsMsg("General Settings updated successfully!");
      }
    } catch (err: any) {
      console.error("Error saving general settings:", err);
      setSettingsMsg("Error updating settings: " + err.message);
    } finally {
      setIsSavingSettings(false);
    }
  };

  // --- UPGRADE HANDLERS ---

  // 1. Social Links handlers
  const handleSaveSocialLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setSocialMsg('');
    if (!socialName.trim() || !socialUrl.trim()) {
      setSocialMsg('Please enter platform name and url.');
      return;
    }
    try {
      const id = editingSocialLink ? editingSocialLink.id : 'social_' + Math.random().toString(36).substring(2, 10);
      const data: SocialLink = {
        id,
        name: socialName.trim(),
        icon: socialIcon,
        url: socialUrl.trim(),
        active: socialActive,
        sortOrder: Number(socialSortOrder) || 0
      };
      await setDoc(doc(db, 'socialLinks', id), data);
      setSocialMsg(editingSocialLink ? 'Social link updated successfully!' : 'Social link created successfully!');
      setEditingSocialLink(null);
      setSocialName('');
      setSocialIcon('Link');
      setSocialUrl('');
      setSocialActive(true);
      setSocialSortOrder(0);
    } catch (err: any) {
      setSocialMsg('Error saving: ' + err.message);
    }
  };

  const handleDeleteSocialLink = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this social link?')) return;
    try {
      await deleteDoc(doc(db, 'socialLinks', id));
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleToggleSocialActive = async (id: string, current: boolean) => {
    try {
      await updateDoc(doc(db, 'socialLinks', id), { active: !current });
    } catch (err: any) {
      console.error(err);
    }
  };

  // 2. Payment Methods handlers
  const handleSavePaymentMethod = async (e: React.FormEvent) => {
    e.preventDefault();
    setPayMsg('');
    if (!payName.trim() || !payAddress.trim()) {
      setPayMsg('Please enter method name and address.');
      return;
    }
    try {
      const id = editingPaymentMethod ? editingPaymentMethod.id : 'pay_' + Math.random().toString(36).substring(2, 10);
      const data: PaymentMethod = {
        id,
        name: payName.trim(),
        walletAddress: payAddress.trim(),
        qrCode: payQrCode.trim(),
        notes: payNotes.trim(),
        active: payActive
      };
      await setDoc(doc(db, 'paymentMethods', id), data);
      setPayMsg(editingPaymentMethod ? 'Payment method updated successfully!' : 'Payment method created successfully!');
      setEditingPaymentMethod(null);
      setPayName('');
      setPayAddress('');
      setPayQrCode('');
      setPayNotes('');
      setPayActive(true);
    } catch (err: any) {
      setPayMsg('Error saving: ' + err.message);
    }
  };

  const handleDeletePaymentMethod = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this payment method?')) return;
    try {
      await deleteDoc(doc(db, 'paymentMethods', id));
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleTogglePaymentMethodActive = async (id: string, current: boolean) => {
    try {
      await updateDoc(doc(db, 'paymentMethods', id), { active: !current });
    } catch (err: any) {
      console.error(err);
    }
  };

  // 4. Support Tickets handlers
  const handleReplyTicket = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !ticketReplyMsg.trim()) return;
    try {
      const newMsg: TicketMessage = {
        id: 'msg_' + Math.random().toString(36).substring(2, 10),
        senderId: 'admin_user',
        senderEmail: adminEmailInput,
        senderRole: 'admin',
        message: ticketReplyMsg.trim(),
        createdAt: new Date().toISOString()
      };
      const updatedMessages = [...(selectedTicket.messages || []), newMsg];
      await updateDoc(doc(db, 'supportTickets', selectedTicket.id), {
        messages: updatedMessages,
        status: 'replied',
        updatedAt: new Date().toISOString()
      });
      setSelectedTicket({
        ...selectedTicket,
        messages: updatedMessages,
        status: 'replied',
        updatedAt: new Date().toISOString()
      });
      setTicketReplyMsg('');
    } catch (err) {
      console.error("Error replying to ticket:", err);
    }
  };

  const handleCloseTicket = async (ticketId: string) => {
    try {
      await updateDoc(doc(db, 'supportTickets', ticketId), {
        status: 'closed',
        updatedAt: new Date().toISOString()
      });
      if (selectedTicket && selectedTicket.id === ticketId) {
        setSelectedTicket({ ...selectedTicket, status: 'closed', updatedAt: new Date().toISOString() });
      }
    } catch (err) {
      console.error("Error closing ticket:", err);
    }
  };

  // 5. Announcements handlers
  const handleSaveAnnouncement = async (e: React.FormEvent) => {
    e.preventDefault();
    setAnnounceMsg('');
    if (!announceTitle.trim() || !announceMessage.trim()) {
      setAnnounceMsg('Please enter a title and message.');
      return;
    }
    try {
      const id = editingAnnouncement ? editingAnnouncement.id : 'ann_' + Math.random().toString(36).substring(2, 10);
      const data: Announcement = {
        id,
        title: announceTitle.trim(),
        message: announceMessage.trim(),
        startDate: announceStartDate || new Date().toISOString().split('T')[0],
        endDate: announceEndDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        active: announceActive,
        createdAt: editingAnnouncement ? editingAnnouncement.createdAt : new Date().toISOString()
      };
      await setDoc(doc(db, 'announcements', id), data);
      setAnnounceMsg(editingAnnouncement ? 'Announcement updated successfully!' : 'Announcement created successfully!');
      setEditingAnnouncement(null);
      setAnnounceTitle('');
      setAnnounceMessage('');
      setAnnounceStartDate('');
      setAnnounceEndDate('');
      setAnnounceActive(true);
    } catch (err: any) {
      setAnnounceMsg('Error saving announcement: ' + err.message);
    }
  };

  const handleDeleteAnnouncement = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this announcement?')) return;
    try {
      await deleteDoc(doc(db, 'announcements', id));
    } catch (err) {
      console.error(err);
    }
  };

  const handleToggleAnnouncementActive = async (id: string, current: boolean) => {
    try {
      await updateDoc(doc(db, 'announcements', id), { active: !current });
    } catch (err) {
      console.error(err);
    }
  };

  // 6. Terminal Credential Manager handlers
  const handleSaveAccountCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setCredMsg('');
    if (!editingAccountCredentials) return;
    try {
      await updateDoc(doc(db, 'accounts', editingAccountCredentials.id), {
        login: credLogin.trim(),
        password: credPassword.trim(),
        server: credServer.trim(),
        status: credStatus
      });
      setCredMsg('Account credentials updated successfully!');
      setEditingAccountCredentials(null);
    } catch (err: any) {
      setCredMsg('Error saving credentials: ' + err.message);
    }
  };

  const handlePromoteAdmin = async (userId: string) => {
    try {
      await updateDoc(doc(db, 'users', userId), { role: 'admin' });
    } catch (e) {
      console.error(e);
    }
  };

  const handleToggleUserStatus = async (userId: string, currentStatus: string) => {
    try {
      const nextStatus = currentStatus === 'suspended' ? 'active' : 'suspended';
      await updateDoc(doc(db, 'users', userId), { status: nextStatus });
    } catch (e) {
      console.error("Error toggling user status:", e);
    }
  };

  const handleActivatePhase2 = async (acc: TradingAccount) => {
    const startBal = acc.startingBalance || acc.size || 10000;
    const confirmP2 = window.confirm(`Activate Account #${acc.login || acc.id} (${acc.userEmail || 'User'}) to Phase 2?`);
    if (!confirmP2) return;
    try {
      const phase2Target = startBal * 0.05;
      const nowIso = new Date().toISOString();
      await updateDoc(doc(db, 'accounts', acc.id), {
        phase: 2,
        status: 'active',
        phaseStatus: 'phase2_active',
        balance: startBal,
        equity: startBal,
        dailyStartingBalance: startBal,
        dailyStartingEquity: startBal,
        profitTarget: phase2Target,
        updatedAt: nowIso
      });

      // In-app Notification
      const notifId = 'NOTIF-P2-' + Math.floor(100000 + Math.random() * 900000);
      await setDoc(doc(db, 'notifications', notifId), {
        id: notifId,
        userId: acc.userId,
        title: 'Phase 2 Account Activated! 🎉',
        message: `Your Phase 2 Evaluation Account #${acc.login || acc.id} ($${startBal.toLocaleString()}) has been activated by Admin!`,
        type: 'success',
        read: false,
        createdAt: nowIso
      }).catch(() => {});

      // Queue welcome email
      const recipientEmail = acc.userEmail || '';
      if (recipientEmail) {
        await setDoc(doc(db, 'email_queue', `queue-p2-${Date.now()}`), {
          id: `queue-p2-${Date.now()}`,
          recipient: recipientEmail,
          subject: `ATFunding: Phase 2 Activated for Account #${acc.login || acc.id}`,
          message: `Hello,\n\nYour Phase 2 Evaluation Account #${acc.login || acc.id} ($${startBal.toLocaleString()}) is now ACTIVE!\n\nLog in to your terminal to start trading.\n\nATFunding Admin Desk`,
          html: `<div style="font-family:sans-serif;padding:24px;background:#0b0f19;color:#f8fafc;border-radius:16px;">
            <h2 style="color:#38bdf8;">Phase 2 Account Activated! 🎉</h2>
            <p>Your Phase 2 Account <strong>#${acc.login || acc.id}</strong> ($${startBal.toLocaleString()}) is now ready.</p>
          </div>`,
          status: 'pending',
          createdAt: nowIso,
          userId: acc.userId
        }).catch(() => {});
      }

      alert(`Account #${acc.login || acc.id} successfully activated to Phase 2!`);
      fetchAllData();
    } catch (err: any) {
      alert("Error activating Phase 2: " + err.message);
    }
  };

  const handleActivateFunded = async (acc: TradingAccount) => {
    const startBal = acc.startingBalance || acc.size || 10000;
    const confirmFunded = window.confirm(`Activate Account #${acc.login || acc.id} (${acc.userEmail || 'User'}) as LIVE FUNDED ACCOUNT (Phase 3)?`);
    if (!confirmFunded) return;
    try {
      const nowIso = new Date().toISOString();
      await updateDoc(doc(db, 'accounts', acc.id), {
        phase: 3,
        accountType: 'funded',
        status: 'active',
        phaseStatus: 'funded',
        balance: startBal,
        equity: startBal,
        dailyStartingBalance: startBal,
        dailyStartingEquity: startBal,
        profitTarget: 0,
        updatedAt: nowIso
      });

      // In-app Notification
      const notifId = 'NOTIF-FUNDED-' + Math.floor(100000 + Math.random() * 900000);
      await setDoc(doc(db, 'notifications', notifId), {
        id: notifId,
        userId: acc.userId,
        title: 'Live Funded Account Activated! 🚀',
        message: `Congratulations! Your Live Funded Account #${acc.login || acc.id} ($${startBal.toLocaleString()}) is now ACTIVE!`,
        type: 'success',
        read: false,
        createdAt: nowIso
      }).catch(() => {});

      // Queue welcome email
      const recipientEmail = acc.userEmail || '';
      if (recipientEmail) {
        await setDoc(doc(db, 'email_queue', `queue-funded-${Date.now()}`), {
          id: `queue-funded-${Date.now()}`,
          recipient: recipientEmail,
          subject: `ATFunding: Live Funded Account Activated #${acc.login || acc.id}`,
          message: `Hello,\n\nYour Live Funded Account #${acc.login || acc.id} ($${startBal.toLocaleString()}) is now ACTIVE!\n\nYou are now eligible for profit split payouts.\n\nATFunding Admin Desk`,
          html: `<div style="font-family:sans-serif;padding:24px;background:#0b0f19;color:#f8fafc;border-radius:16px;">
            <h2 style="color:#22c55e;">Live Funded Account Activated! 🚀</h2>
            <p>Your Live Funded Account <strong>#${acc.login || acc.id}</strong> ($${startBal.toLocaleString()}) is now ACTIVE.</p>
          </div>`,
          status: 'pending',
          createdAt: nowIso,
          userId: acc.userId
        }).catch(() => {});
      }

      alert(`Account #${acc.login || acc.id} successfully activated as Live Funded Account!`);
      fetchAllData();
    } catch (err: any) {
      alert("Error activating Live Funded Account: " + err.message);
    }
  };

  const handleCreateAccountManually = async (isGiveaway = false) => {
    if (!selectedUserId) {
      setManualAccountMsg("Please choose a target user first.");
      return;
    }

    const pkg = CHALLENGE_PACKAGES.find(p => p.id === selectedPkgId);
    if (!pkg) return;

    try {
      const accountId = 'AT-' + Math.floor(100000 + Math.random() * 900000);
      const randomLogin = String(Math.floor(2000000 + Math.random() * 8000000));
      const randomPassword = Math.random().toString(36).substring(2, 10).toUpperCase();
      
      const targetUser = users.find(u => u.uid === selectedUserId);

      const expiresAt = pkg.type === 'trial'
        ? new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString()
        : null;

      const newAccount = {
        id: accountId,
        userId: selectedUserId,
        userEmail: targetUser?.email || 'unknown@atfunding.io',
        accountType: pkg.type,
        size: pkg.size,
        balance: pkg.size,
        startingBalance: pkg.size,
        equity: pkg.size,
        dailyStartingBalance: pkg.size,
        dailyStartingEquity: pkg.size,
        phase: isGiveaway || pkg.type === 'instant_bolt' ? 3 : 1, // Phase 3 means funded/live
        status: 'active',
        login: randomLogin,
        password: randomPassword,
        platform: 'ATTerminal',
        server: 'ATFunding-DemoServer',
        profitTarget: isGiveaway ? 0 : (pkg.profitTargetPercent > 0 ? (pkg.size * pkg.profitTargetPercent / 100) : 0),
        dailyDrawdownLimit: pkg.size * pkg.dailyDrawdownPercent / 100,
        maxDrawdownLimit: pkg.size * pkg.maxDrawdownPercent / 100,
        expiresAt: expiresAt,
        createdAt: new Date().toISOString(),
        isGiveaway: isGiveaway
      };

      await setDoc(doc(db, 'accounts', accountId), newAccount);
      setManualAccountMsg(`Account ${accountId} successfully provisioned for user!`);
      fetchAllData();
    } catch (e) {
      console.error(e);
      setManualAccountMsg("Manual account creation failed.");
    }
  };

  const handleProvisionGiveaway = async () => {
    if (selectedUserIds.length === 0) {
      setManualAccountMsg("Please select at least one trader first.");
      return;
    }

    const matchedPkg = CHALLENGE_PACKAGES.find(p => p.type === giveawayType && p.size === giveawaySize)
      || CHALLENGE_PACKAGES.find(p => p.type === giveawayType)
      || CHALLENGE_PACKAGES[0];

    try {
      let successCount = 0;
      for (const userId of selectedUserIds) {
        const targetUser = users.find(u => u.uid === userId || u.id === userId);
        const accountId = 'AT-' + Math.floor(100000 + Math.random() * 900000);
        const randomLogin = String(Math.floor(2000000 + Math.random() * 8000000));
        const randomPassword = Math.random().toString(36).substring(2, 10).toUpperCase();

        const expiresAt = giveawayType === 'trial'
          ? new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString()
          : null;

        const newAccount = {
          id: accountId,
          userId: userId,
          userEmail: targetUser?.email || 'unknown@atfunding.io',
          accountType: giveawayType,
          size: giveawaySize,
          balance: giveawaySize,
          startingBalance: giveawaySize,
          equity: giveawaySize,
          dailyStartingBalance: giveawaySize,
          dailyStartingEquity: giveawaySize,
          phase: giveawayType === 'trial' ? 1 : 3, // Trials are evaluation, others are live funded (phase 3)
          status: 'active',
          login: randomLogin,
          password: randomPassword,
          platform: 'ATTerminal',
          server: 'ATFunding-DemoServer',
          profitTarget: 0,
          dailyDrawdownLimit: giveawaySize * matchedPkg.dailyDrawdownPercent / 100,
          maxDrawdownLimit: giveawaySize * matchedPkg.maxDrawdownPercent / 100,
          expiresAt: expiresAt,
          createdAt: new Date().toISOString(),
          isGiveaway: true
        };

        await setDoc(doc(db, 'accounts', accountId), newAccount);
        successCount++;
      }

      setManualAccountMsg(`Instantly provisioned ${successCount} Giveaway Funded Account(s) successfully!`);
      setSelectedUserIds([]);
      fetchAllData();
    } catch (e) {
      console.error(e);
      setManualAccountMsg("Giveaway provisioning failed.");
    }
  };

  const handleApprovePayout = async (payout: PayoutRequest) => {
    const now = new Date().toISOString();

    try {
      // 1. Approve Payout request doc
      await updateDoc(doc(db, 'payouts', payout.id), {
        status: 'approved',
        processedAt: now
      });

      // 2. Award a payout certificate
      const certId = 'CERT-' + Math.floor(100000 + Math.random() * 900000);
      const targetUser = users.find(u => u.uid === payout.userId);
      
      await setDoc(doc(db, 'certificates', certId), {
        id: certId,
        userId: payout.userId,
        userName: targetUser?.displayName || 'Elite Trader',
        accountId: payout.accountId,
        type: 'payout',
        amount: payout.amount,
        date: now
      });

      // 3. Subtract requested payout from trading account balance
      const accountRef = doc(db, 'accounts', payout.accountId);
      const accSnap = await getDoc(accountRef);
      if (accSnap.exists()) {
        const acc = accSnap.data() as TradingAccount;
        const remainingBalance = acc.balance - payout.amount;
        await updateDoc(accountRef, {
          balance: remainingBalance,
          equity: remainingBalance,
          dailyStartingBalance: remainingBalance, // reset daily starting
          status: 'active' // reset status back to active after successful payout
        });
      }

      // Trigger payout approved and paid emails
      try {
        const { triggerPayoutApprovedEmail, triggerPayoutPaidEmail } = await import('../utils/emailTriggers');
        const displayName = targetUser?.displayName || targetUser?.name || 'Trader';
        const formattedAmount = `$${payout.amount.toFixed(2)}`;
        await triggerPayoutApprovedEmail(payout.userId, payout.userEmail, displayName, formattedAmount);
        await triggerPayoutPaidEmail(payout.userId, payout.userEmail, displayName, formattedAmount, payout.payoutMethod || 'USDT');
      } catch (err) {
        console.warn("Could not send payout approval/paid emails:", err);
      }

      fetchAllData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleRejectPayout = async (payoutId: string, accountId: string) => {
    try {
      await updateDoc(doc(db, 'payouts', payoutId), { status: 'rejected' });
      
      // Restore account status to active
      await updateDoc(doc(db, 'accounts', accountId), { status: 'active' });
      
      // Fetch payout details for the email trigger
      const payoutRef = doc(db, 'payouts', payoutId);
      const paySnap = await getDoc(payoutRef);
      if (paySnap.exists()) {
        const payData = paySnap.data() as PayoutRequest;
        const userSnap = await getDoc(doc(db, 'users', payData.userId));
        const displayName = userSnap.exists() ? (userSnap.data().displayName || userSnap.data().name || 'Trader') : 'Trader';
        
        try {
          const { triggerPayoutRejectedEmail } = await import('../utils/emailTriggers');
          await triggerPayoutRejectedEmail(
            payData.userId,
            payData.userEmail,
            displayName,
            `$${payData.amount.toFixed(2)}`,
            'Drawdown condition checks failed or validation requirements not satisfied.'
          );
        } catch (err) {
          console.warn("Could not send payout rejection email:", err);
        }
      }
      
      fetchAllData();
    } catch (e) {
      console.error(e);
    }
  };

  const handleAddCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCouponCode.trim()) return;

    const codeUpper = newCouponCode.trim().toUpperCase();
    const isAllSelected = newCouponAccountTypes.length === 5 || newCouponAccountTypes.length === 0;
    const finalTypes = isAllSelected ? ['all'] : newCouponAccountTypes;

    const isFixed = newCouponType === 'fixed';
    const val = Number(newCouponValue) || 0;

    const docData: any = {
      id: codeUpper,
      code: codeUpper,
      discountType: newCouponType,
      discountPercent: isFixed ? 0 : val,
      discountAmount: isFixed ? val : 0,
      active: true,
      applicableAccountTypes: finalTypes,
      createdBy: 'admin',
      usedCount: 0
    };

    if (newCouponExpiresAt.trim()) {
      docData.expiresAt = newCouponExpiresAt.trim();
    }
    if (newCouponMaxUses && Number(newCouponMaxUses) > 0) {
      docData.maxUses = Number(newCouponMaxUses);
    }

    // Optimistic UI update for immediate response
    setCoupons(prev => [docData, ...prev.filter(c => c.code !== codeUpper && c.id !== codeUpper)]);
    setNewCouponCode('');
    setNewCouponValue(10);
    setNewCouponType('percent');
    setNewCouponExpiresAt('');
    setNewCouponMaxUses('');
    setNewCouponAccountTypes(['one_step', 'two_step', 'payout_later', 'instant_bolt', 'trial']);

    try {
      await setDoc(doc(db, 'coupons', codeUpper), docData);
      invalidateCache('admin_coupons');
    } catch (e) {
      console.error("Error adding coupon:", e);
      invalidateCache('admin_coupons');
    }
  };

  const handleToggleCoupon = async (code: string, currentActive: boolean, docId?: string) => {
    const idToUse = docId || code;
    // Optimistic UI update
    setCoupons(prev => prev.map(c => (c.code === code || c.id === idToUse) ? { ...c, active: !currentActive } : c));

    try {
      await updateDoc(doc(db, 'coupons', idToUse), { active: !currentActive });
      invalidateCache('admin_coupons');
    } catch (e) {
      console.error("Error toggling coupon:", e);
      try {
        await updateDoc(doc(db, 'coupons', code), { active: !currentActive });
      } catch (err) {}
      invalidateCache('admin_coupons');
    }
  };

  const handleDeleteCoupon = async (code: string, docId?: string) => {
    const idToUse = docId || code;
    // Optimistic UI update - immediate deletion from list
    setCoupons(prev => prev.filter(c => c.code !== code && c.id !== idToUse));

    try {
      await deleteDoc(doc(db, 'coupons', idToUse));
      if (code && code !== idToUse) {
        try { await deleteDoc(doc(db, 'coupons', code)); } catch(e){}
      }
      invalidateCache('admin_coupons');
    } catch (e) {
      console.error("Error deleting coupon:", e);
      try {
        await deleteDoc(doc(db, 'coupons', code));
      } catch(err) {}
      invalidateCache('admin_coupons');
    }
  };

  const handleSendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    setBroadcastMsg('');
    if (!broadcastSubject.trim() || !broadcastBody.trim()) {
      setBroadcastMsg('Error: Subject and body content are required.');
      return;
    }
    if (broadcastRecipientType === 'single' && !broadcastTargetUserId) {
      setBroadcastMsg('Error: Target recipient is required.');
      return;
    }

    setIsBroadcasting(true);
    try {
      const emailId = 'MAIL-' + Math.floor(100000 + Math.random() * 900000);
      const now = new Date().toISOString();

      if (broadcastRecipientType === 'single') {
        const targetUser = users.find(u => u.uid === broadcastTargetUserId);
        if (!targetUser) throw new Error('Target user not found.');

        // 1. Save outbound email simulation record to Firestore
        await setDoc(doc(db, 'outboundEmails', emailId), {
          id: emailId,
          type: 'single',
          recipientEmail: targetUser.email,
          recipientUid: targetUser.uid,
          recipientName: targetUser.displayName || 'Trader',
          subject: broadcastSubject.trim(),
          body: broadcastBody.trim(),
          status: 'Delivered (Simulated Send)',
          createdAt: now
        });

        // 2. Post direct user notification inside user notifications collection
        const notifId = 'NOTIF-' + Math.floor(100000 + Math.random() * 900000);
        await setDoc(doc(db, 'notifications', notifId), {
          id: notifId,
          userId: targetUser.uid,
          title: broadcastSubject.trim(),
          message: broadcastBody.trim(),
          type: 'info',
          read: false,
          createdAt: now
        });

        setBroadcastMsg(`Success! Emailed and notified trader: ${targetUser.email}`);
      } else {
        // Broadcast to ALL users
        if (users.length === 0) throw new Error('No registered users found to target.');

        // 1. Save outbound global email simulation record
        await setDoc(doc(db, 'outboundEmails', emailId), {
          id: emailId,
          type: 'all_users',
          recipientEmail: 'all_registered_users@atfunding.io',
          subject: broadcastSubject.trim(),
          body: broadcastBody.trim(),
          status: 'Delivered (Simulated Send)',
          createdAt: now
        });

        // 2. Deliver real-time notifications to everyone
        const promises = users.map(async (u) => {
          const notifId = 'NOTIF-' + Math.floor(100000 + Math.random() * 900000);
          await setDoc(doc(db, 'notifications', notifId), {
            id: notifId,
            userId: u.uid,
            title: broadcastSubject.trim(),
            message: broadcastBody.trim(),
            type: 'info',
            read: false,
            createdAt: now
          });
        });

        await Promise.all(promises);
        setBroadcastMsg(`Success! Broadcasted communication & notification to all ${users.length} active traders.`);
      }

      setBroadcastSubject('');
      setBroadcastBody('');
      setBroadcastTargetUserId('');
    } catch (err: any) {
      console.error("Failed to send broadcast:", err);
      setBroadcastMsg(`Failed to dispatch message: ${err.message}`);
    } finally {
      setIsBroadcasting(false);
    }
  };

  // --- CERTIFICATE MANAGER HANDLERS ---
  const handleGenerateCertificate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCertMsg('');
    if (!certUserName.trim() || !certEmail.trim()) {
      setCertMsg('Please enter Trader Name and Email.');
      return;
    }

    setIsGeneratingCert(true);
    try {
      const generatedId = certIdInput.trim() || `CERT-${Math.floor(100000 + Math.random() * 900000)}`;
      
      const targetUser = users.find(u => u.email?.toLowerCase() === certEmail.trim().toLowerCase());
      const targetUid = targetUser ? targetUser.uid : `user_${Math.random().toString(36).substring(2, 9)}`;

      const certData: Certificate = {
        id: generatedId,
        certificateId: generatedId,
        userId: targetUid,
        userName: certUserName.trim(),
        name: certUserName.trim(),
        email: certEmail.trim().toLowerCase(),
        accountSize: certAccountSize,
        accountType: certAccountType,
        phase: certPhase,
        issueDate: certIssueDate || new Date().toISOString().split('T')[0],
        date: certIssueDate || new Date().toISOString().split('T')[0],
        userPhoto: certUserPhoto.trim() || '',
        certificateImage: certUserPhoto.trim() || '',
        createdAt: new Date().toISOString(),
        type: 'passed_evaluation'
      };

      await setDoc(doc(db, 'certificates', generatedId), certData);

      if (targetUser) {
        const notifId = 'NOTIF-' + Math.floor(100000 + Math.random() * 900000);
        await setDoc(doc(db, 'notifications', notifId), {
          id: notifId,
          userId: targetUser.uid,
          title: '🎉 New Certificate Awarded!',
          message: `Congratulations ${certUserName}! You have been awarded a ${certPhase} Certificate for your ${certAccountSize} account. View it in your Certificates tab.`,
          type: 'success',
          read: false,
          createdAt: new Date().toISOString()
        });
      }

      setCertMsg(`Success! Certificate #${generatedId} issued for ${certUserName}.`);
      setCertUserName('');
      setCertEmail('');
      setCertIdInput('');
      setCertUserPhoto('');
    } catch (err: any) {
      console.error("Generate Certificate Error:", err);
      setCertMsg("Error generating certificate: " + (err.message || "Unknown error"));
    } finally {
      setIsGeneratingCert(false);
    }
  };

  const handleDeleteCertificate = async (certId: string) => {
    if (!window.confirm("Are you sure you want to delete this certificate record?")) return;
    try {
      await deleteDoc(doc(db, 'certificates', certId));
    } catch (err: any) {
      console.error("Delete certificate error:", err);
      alert("Could not delete certificate.");
    }
  };

  const handleExportCertificatesCSV = () => {
    if (certificates.length === 0) {
      alert("No certificate records available to export.");
      return;
    }

    const headers = ["Certificate ID", "Trader Name", "Email", "Account Size", "Account Type", "Phase", "Issue Date"];
    const rows = certificates.map(c => [
      `"${c.certificateId || c.id}"`,
      `"${c.name || c.userName || ''}"`,
      `"${c.email || ''}"`,
      `"${c.accountSize || ''}"`,
      `"${c.accountType || ''}"`,
      `"${c.phase || ''}"`,
      `"${c.issueDate || c.date || ''}"`
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `ATFunding_Certificates_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSaveCertTemplate = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setIsSavingCertTemplate(true);
    setCertMsg('');
    try {
      await setDoc(doc(db, 'settings', 'certificate_template'), {
        ...certTemplate,
        updatedAt: new Date().toISOString()
      });
      setCertMsg('Success! Certificate Template saved to Firestore.');
    } catch (err: any) {
      console.error("Save cert template error:", err);
      setCertMsg('Error saving template: ' + (err.message || 'Unknown error'));
    } finally {
      setIsSavingCertTemplate(false);
    }
  };

  const handleCertImageUpload = (e: React.ChangeEvent<HTMLInputElement>, field: 'bgImageUrl' | 'logoUrl' | 'signatureUrl') => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        const maxDim = 1200;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const base64Url = canvas.toDataURL('image/png', 0.85);
          setCertTemplate(prev => ({ ...prev, [field]: base64Url }));
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleSendCertEmail = async (cert: Certificate) => {
    if (!cert.email) {
      alert("Trader email address is required.");
      return;
    }
    setIsSendingCertEmail(true);
    try {
      const notifId = 'NOTIF-' + Math.floor(100000 + Math.random() * 900000);
      const certTitle = cert.customTitle || certTemplate.title || 'CERTIFICATE OF ACHIEVEMENT';
      const certMessage = `Congratulations ${cert.name || cert.userName}! Your official ${certTitle} (#${cert.certificateId || cert.id}) has been issued. View and download it anytime from your Dashboard Certificates tab.`;

      if (cert.userId) {
        await setDoc(doc(db, 'notifications', notifId), {
          id: notifId,
          userId: cert.userId,
          title: `🏆 ${certTitle} Issued!`,
          message: certMessage,
          type: 'success',
          read: false,
          createdAt: new Date().toISOString()
        });
      }

      const emailQueueId = 'EMAIL-' + Math.floor(100000 + Math.random() * 900000);
      await setDoc(doc(db, 'email_queue', emailQueueId), {
        id: emailQueueId,
        recipient: cert.email,
        subject: `🏆 Official ATFunding Certificate Issued - ${cert.certificateId || cert.id}`,
        message: `Dear ${cert.name || cert.userName},\n\nCongratulations! Your official ATFunding Certificate of Achievement has been issued.\n\nCertificate ID: ${cert.certificateId || cert.id}\nAccount Size: ${cert.accountSize}\nPhase: ${cert.phase}\nIssue Date: ${cert.issueDate || cert.date}\n\nYou can view, download PNG/PDF, and print your certificate directly from your ATFunding Dashboard under the Certificates section.\n\nBest regards,\n${certTemplate.companyName || 'ATFunding'} Team`,
        status: 'pending',
        userId: cert.userId || '',
        createdAt: new Date().toISOString()
      });

      alert(`Email & notification successfully sent to ${cert.email}!`);
    } catch (err: any) {
      console.error("Send cert email error:", err);
      alert("Could not send email: " + (err.message || "Unknown error"));
    } finally {
      setIsSendingCertEmail(false);
    }
  };

  const handleDownloadCertPdf = async (targetRef: React.RefObject<HTMLDivElement>, fileName: string) => {
    if (!targetRef.current) return;
    setIsDownloadingPdf(true);
    try {
      const canvas = await html2canvas(targetRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#020617'
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'landscape',
        unit: 'px',
        format: [canvas.width, canvas.height]
      });
      pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
      pdf.save(`${fileName}.pdf`);
    } catch (err: any) {
      console.error("PDF download error:", err);
      alert("Error downloading PDF: " + err.message);
    } finally {
      setIsDownloadingPdf(false);
    }
  };

  const formatPreviewMessage = (msg: string, certName: string, accountSize: string, phase: string, date: string, certId: string) => {
    if (!msg) return `has successfully achieved ${phase} on a ${accountSize} account.`;
    return msg
      .replace(/{USER_NAME}/gi, certName || 'Asjad Khan')
      .replace(/\[USER NAME\]/gi, certName || 'Asjad Khan')
      .replace(/{ACCOUNT_SIZE}/gi, accountSize || '$100,000')
      .replace(/\[ACCOUNT SIZE\]/gi, accountSize || '$100,000')
      .replace(/{PHASE}/gi, phase || 'Phase 1')
      .replace(/\[PHASE\]/gi, phase || 'Phase 1')
      .replace(/{DATE}/gi, date || new Date().toISOString().split('T')[0])
      .replace(/\[DATE\]/gi, date || new Date().toISOString().split('T')[0])
      .replace(/{CERTIFICATE_ID}/gi, certId || 'CERT-100001')
      .replace(/\[CERTIFICATE ID\]/gi, certId || 'CERT-100001');
  };

  const compressQrCode = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const size = 400; // 400x400 is ideal for clear QR reading and small size
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, size, size);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.65);
          resolve(dataUrl);
        };
        img.onerror = (err) => reject(err);
      };
      reader.onerror = (err) => reject(err);
    });
  };

  const handleQRUpload = async (e: React.ChangeEvent<HTMLInputElement>, field: string) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setIsUploadingQR(field);
      try {
        // Compress the QR code first to make it extremely lightweight and rapid
        const compressedBase64 = await compressQrCode(file);
        let downloadURL = '';
        try {
          const response = await fetch(compressedBase64);
          const blob = await response.blob();
          const { ref: storageRef, uploadBytes, getDownloadURL } = await import('firebase/storage');
          const { storage } = await import('../firebase');
          const sRef = storageRef(storage, `qrCodes/${field}_${Date.now()}.jpg`);
          
          const uploadPromise = uploadBytes(sRef, blob);
          const snapshot = await Promise.race([
            uploadPromise,
            new Promise((_, reject) => setTimeout(() => reject(new Error("Timeout")), 1500))
          ]) as any;

          downloadURL = await getDownloadURL(snapshot.ref);
        } catch (storageErr) {
          console.warn("Storage upload failed or timed out, falling back to lightweight compressed base64", storageErr);
          downloadURL = compressedBase64;
        }

        switch(field) {
          case 'upi': setUpiQrCodeInput(downloadURL); break;
          case 'btc': setBtcQrCodeInput(downloadURL); break;
          case 'usdtTrc20': setUsdtTrc20QrCodeInput(downloadURL); break;
          case 'usdtErc20': setUsdtErc20QrCodeInput(downloadURL); break;
          case 'ltc': setLtcQrCodeInput(downloadURL); break;
        }
      } catch (err) {
        console.error("QR Code upload error", err);
      } finally {
        setIsUploadingQR(null);
      }
    }
  };

  const handleUpdateWalletSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setWalletSettingsMsg('');
    setIsSavingWallets(true);
    try {
      await setDoc(doc(db, 'settings', 'payment'), {
        btcAddress: btcAddressInput.trim(),
        btcQrCode: btcQrCodeInput.trim(),
        usdtTrc20Address: usdtTrc20AddressInput.trim(),
        usdtTrc20QrCode: usdtTrc20QrCodeInput.trim(),
        usdtErc20Address: usdtErc20AddressInput.trim(),
        usdtErc20QrCode: usdtErc20QrCodeInput.trim(),
        ltcAddress: ltcAddressInput.trim(),
        ltcQrCode: ltcQrCodeInput.trim(),
        upiId: upiIdInput.trim(),
        upiQrCode: upiQrCodeInput.trim()
      });
      setWalletSettingsMsg("Payment information saved successfully inside settings/payment!");
      setTimeout(() => setWalletSettingsMsg(''), 4000);
      fetchAllData();
    } catch (err: any) {
      console.error(err);
      setWalletSettingsMsg("Failed to save payment settings.");
    } finally {
      setIsSavingWallets(false);
    }
  };

  const handleUpdateRuleSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setRuleSettingsMsg('');
    setIsSavingRules(true);
    try {
      await setDoc(doc(db, 'settings', 'rules'), {
        oneStepDailyLoss: Number(oneStepDailyLoss),
        oneStepMaxLoss: Number(oneStepMaxLoss),
        oneStepProfitTarget: Number(oneStepProfitTarget),
        oneStepMinDays: Number(oneStepMinDays),
        oneStepTenMinuteRule: Boolean(oneStepTenMinuteRule),

        twoStepDailyLoss: Number(twoStepDailyLoss),
        twoStepMaxLoss: Number(twoStepMaxLoss),
        twoStepPhase1Target: Number(twoStepPhase1Target),
        twoStepPhase2Target: Number(twoStepPhase2Target),
        twoStepMinDays: Number(twoStepMinDays),
        twoStepTenMinuteRule: Boolean(twoStepTenMinuteRule),

        payoutLaterDailyLoss: Number(payoutLaterDailyLoss),
        payoutLaterMaxLoss: Number(payoutLaterMaxLoss),
        payoutLaterMinDays: Number(payoutLaterMinDays),
        payoutLaterTenMinuteRule: Boolean(payoutLaterTenMinuteRule)
      });
      setRuleSettingsMsg("Account rules saved successfully!");
      setTimeout(() => setRuleSettingsMsg(''), 4000);
      fetchAllData();
    } catch (err: any) {
      console.error(err);
      setRuleSettingsMsg("Failed to save account rules.");
    } finally {
      setIsSavingRules(false);
    }
  };

  const handleViolationAction = async (violationId: string, action: 'Ignored' | 'Warning' | 'Suspended' | 'Breached') => {
    try {
      await updateDoc(doc(db, 'ruleViolations', violationId), {
        status: action
      }).catch(() => {});

      const viol = ruleViolations.find(v => v.id === violationId);
      if (viol && action === 'Suspended') {
        // Mark account as suspended
        if (viol.accountId) {
          await updateDoc(doc(db, 'accounts', viol.accountId), {
            status: 'suspended'
          }).catch(() => {});
        }

        // Send dashboard notification
        if (viol.userId) {
          const notifId = 'NOTIF-' + Math.floor(100000 + Math.random() * 900000);
          await setDoc(doc(db, 'notifications', notifId), {
            id: notifId,
            userId: viol.userId,
            title: 'Account Suspended',
            message: `Your trading account #${viol.accountId || 'N/A'} has been suspended due to: ${viol.violationType || 'Rule violation'}.`,
            type: 'warning',
            read: false,
            createdAt: new Date().toISOString()
          }).catch(() => {});
        }
      } else if (viol && action === 'Breached') {
        // Mark account as breached
        if (viol.accountId) {
          await updateDoc(doc(db, 'accounts', viol.accountId), {
            status: 'breached',
            breachedAt: new Date().toISOString(),
            breachReason: viol.violationType || 'Rule Breach'
          }).catch(() => {});
        }

        // Create a Breach record in breaches collection
        const breachId = 'BRCH-' + Math.floor(100000 + Math.random() * 900000);
        await setDoc(doc(db, 'breaches', breachId), {
          id: breachId,
          userId: viol.userId || '',
          accountId: viol.accountId || '',
          breachReason: `Breached due to: ${viol.violationType || 'Rule Violation'}`,
          breachDate: new Date().toISOString(),
          adminName: 'Admin',
          userEmail: viol.userEmail || 'unknown@atfunding.online'
        }).catch(() => {});

        // Send dashboard notification
        if (viol.userId) {
          const notifId = 'NOTIF-' + Math.floor(100000 + Math.random() * 900000);
          await setDoc(doc(db, 'notifications', notifId), {
            id: notifId,
            userId: viol.userId,
            title: 'Account BREACHED!',
            message: `Your trading account #${viol.accountId || 'N/A'} has been breached due to a violation of: ${viol.violationType || 'Rule Violation'}.`,
            type: 'danger',
            read: false,
            createdAt: new Date().toISOString()
          }).catch(() => {});
        }
      }

      alert(`Violation action successfully updated to ${action}.`);
      fetchAllData();
    } catch (e: any) {
      console.error("Failed to process violation action:", e);
      alert("Error updating violation: " + (e?.message || String(e)));
    }
  };

  const handleApproveOrder = async (order: Order) => {
    setApprovalToast(null);
    try {
      const randomLogin = String(Math.floor(2000000 + Math.random() * 8000000));
      const randomPassword = Math.random().toString(36).substring(2, 10).toUpperCase();

      const expiresAt = order.accountType === 'trial'
        ? new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString()
        : null;

      const linkedAccountId = (order as any).accountId;
      if (linkedAccountId) {
        // If pre-approved account exists, activate it and provision credentials!
        const accRef = doc(db, 'accounts', linkedAccountId);
        await updateDoc(accRef, {
          status: 'active',
          login: randomLogin,
          password: randomPassword,
          expiresAt: expiresAt,
          rejectionReason: "" // Clear previous rejection reason
        });
      } else {
        // Fallback: create account if not existing (for legacy records)
        const accountId = 'AT-' + Math.floor(100000 + Math.random() * 900000);
        const sizeMap: Record<string, number> = {
          '1K': 1000,
          '1.5K': 1500,
          '3K': 3000,
          '5K': 5000,
          '6K': 6000,
          '9K': 9000,
          '10K': 10000,
          '25K': 25000,
          '50K': 50000,
          '100K': 100000
        };
        const sizeVal = sizeMap[order.accountSize] || 50000;
        const newAccount = {
          id: accountId,
          userId: order.userId,
          userEmail: order.email,
          accountType: order.accountType,
          size: sizeVal,
          balance: sizeVal,
          startingBalance: sizeVal,
          equity: sizeVal,
          dailyStartingBalance: sizeVal,
          dailyStartingEquity: sizeVal,
          phase: order.accountType === 'two_step' ? 1 : 3,
          status: 'active',
          login: randomLogin,
          password: randomPassword,
          platform: 'ATTerminal',
          server: 'ATFunding-LiveServer',
          profitTarget: order.accountType === 'two_step' ? sizeVal * 0.08 : order.accountType === 'one_step' ? sizeVal * 0.10 : order.accountType === 'payout_later' ? sizeVal * 0.08 : 0,
          dailyDrawdownLimit: getAccountDrawdownLimits(order.accountType, sizeVal).dailyDrawdownLimit,
          maxDrawdownLimit: getAccountDrawdownLimits(order.accountType, sizeVal).maxDrawdownLimit,
          expiresAt: expiresAt,
          createdAt: new Date().toISOString()
        };
        await setDoc(doc(db, 'accounts', accountId), newAccount);
      }

      // Update the order status and kycStatus to Approved if documents are submitted
      await updateDoc(doc(db, 'orders', order.orderId), {
        status: 'Approved',
        kycStatus: order.kycDocuments ? 'Approved' : 'N/A'
      });

      // Process affiliate commission automatically if referred
      try {
        await processAffiliateCommission(order, db);
      } catch (commErr) {
        console.warn("Could not process affiliate commission:", commErr);
      }

      // Create Dashboard notification for the trader
      const notifId = 'NOTIF-' + Math.floor(100000 + Math.random() * 900000);
      await setDoc(doc(db, 'notifications', notifId), {
        id: notifId,
        userId: order.userId,
        title: 'Funding Account Active!',
        message: `Your payment of $${order.finalPrice.toFixed(2)} was approved. Funded account has been successfully generated and activated. Platform: ATTerminal.`,
        type: 'success',
        read: false,
        createdAt: new Date().toISOString()
      });

      // Trigger order approved email
      try {
        const { triggerApprovedEmail } = await import('../utils/emailTriggers');
        const userSnap = await getDoc(doc(db, 'users', order.userId));
        const userName = userSnap.exists() ? (userSnap.data().displayName || userSnap.data().name || 'Trader') : 'Trader';
        await triggerApprovedEmail(order.userId, order.email, userName, order.accountType, order.accountSize);
      } catch (err) {
        console.warn("Could not send order approved email:", err);
      }

      setApprovalToast(`Success! Order approved & account successfully activated for ${order.email}.`);
      console.log(`[EMAIL SEND SIMULATION] To: ${order.email}, Subject: ATFunding Account Approved! Creds - Login: ${randomLogin}, Password: ${randomPassword}`);
      setTimeout(() => setApprovalToast(null), 8000);
    } catch (err: any) {
      console.error("Failed to approve order:", err);
      alert("Error approving order: " + err.message);
    }
  };

  const handleRejectOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setRejectionError('');
    if (!rejectingOrderId) return;
    if (!rejectionReason.trim()) {
      setRejectionError('Rejection reason is required.');
      return;
    }

    try {
      const orderToReject = orders.find(o => o.orderId === rejectingOrderId);
      if (!orderToReject) return;

      // 1. Update order status and kycStatus to Rejected if documents are submitted
      await updateDoc(doc(db, 'orders', rejectingOrderId), {
        status: 'Rejected',
        rejectionReason: rejectionReason.trim(),
        kycStatus: orderToReject.kycDocuments ? 'Rejected' : 'N/A'
      });

      // 2. Update associated pre-approved account status to Rejected so it indicates reject
      const linkedAccountId = (orderToReject as any).accountId;
      if (linkedAccountId) {
        await updateDoc(doc(db, 'accounts', linkedAccountId), {
          status: 'Rejected',
          login: 'Rejected / Proof Disapproved',
          password: 'Rejected / Proof Disapproved',
          rejectionReason: rejectionReason.trim()
        });
      }

      // 3. Write notification for the trader
      const notifId = 'NOTIF-' + Math.floor(100000 + Math.random() * 900000);
      await setDoc(doc(db, 'notifications', notifId), {
        id: notifId,
        userId: orderToReject.userId,
        title: 'Checkout Payment Disapproved',
        message: `Your payment of $${orderToReject.finalPrice.toFixed(2)} for ${orderToReject.accountSize} was rejected. Reason: "${rejectionReason.trim()}". Please re-submit correct transaction proof.`,
        type: 'danger',
        read: false,
        createdAt: new Date().toISOString()
      });

      // Trigger order rejected email
      try {
        const { triggerRejectedEmail } = await import('../utils/emailTriggers');
        const userSnap = await getDoc(doc(db, 'users', orderToReject.userId));
        const userName = userSnap.exists() ? (userSnap.data().displayName || userSnap.data().name || 'Trader') : 'Trader';
        await triggerRejectedEmail(orderToReject.userId, orderToReject.email, userName, rejectionReason.trim());
      } catch (err) {
        console.warn("Could not send order rejected email:", err);
      }

      setRejectingOrderId(null);
      setRejectionReason('');
    } catch (err: any) {
      console.error("Failed to reject order:", err);
      setRejectionError("Failed to update order rejection: " + err.message);
    }
  };

  // Universal Search calculations
  const searchQueryClean = globalSearchQuery.trim().toLowerCase();

  const matchedSearchUsers = searchQueryClean ? users.filter((u) => {
    return (
      u.uid?.toLowerCase().includes(searchQueryClean) ||
      u.displayName?.toLowerCase().includes(searchQueryClean) ||
      u.name?.toLowerCase().includes(searchQueryClean) ||
      u.firstName?.toLowerCase().includes(searchQueryClean) ||
      u.lastName?.toLowerCase().includes(searchQueryClean) ||
      u.username?.toLowerCase().includes(searchQueryClean) ||
      u.email?.toLowerCase().includes(searchQueryClean) ||
      u.phone?.toLowerCase().includes(searchQueryClean) ||
      u.phoneNumber?.toLowerCase().includes(searchQueryClean) ||
      u.affiliateCode?.toLowerCase().includes(searchQueryClean) ||
      u.country?.toLowerCase().includes(searchQueryClean)
    );
  }) : [];

  const matchedSearchAccounts = searchQueryClean ? accounts.filter((a) => {
    return (
      a.id?.toLowerCase().includes(searchQueryClean) ||
      a.login?.toLowerCase().includes(searchQueryClean) ||
      a.userId?.toLowerCase().includes(searchQueryClean) ||
      a.userEmail?.toLowerCase().includes(searchQueryClean) ||
      a.accountType?.toLowerCase().includes(searchQueryClean) ||
      a.server?.toLowerCase().includes(searchQueryClean) ||
      a.status?.toLowerCase().includes(searchQueryClean)
    );
  }) : [];

  const matchedSearchOrders = searchQueryClean ? orders.filter((o) => {
    return (
      o.orderId?.toLowerCase().includes(searchQueryClean) ||
      o.transactionHash?.toLowerCase().includes(searchQueryClean) ||
      (o as any).txHash?.toLowerCase().includes(searchQueryClean) ||
      (o as any).transactionId?.toLowerCase().includes(searchQueryClean) ||
      o.userId?.toLowerCase().includes(searchQueryClean) ||
      o.accountId?.toLowerCase().includes(searchQueryClean) ||
      o.email?.toLowerCase().includes(searchQueryClean) ||
      o.firstName?.toLowerCase().includes(searchQueryClean) ||
      o.lastName?.toLowerCase().includes(searchQueryClean) ||
      o.phone?.toLowerCase().includes(searchQueryClean) ||
      o.walletAddress?.toLowerCase().includes(searchQueryClean) ||
      o.couponCode?.toLowerCase().includes(searchQueryClean) ||
      o.paymentMethod?.toLowerCase().includes(searchQueryClean) ||
      o.accountSize?.toLowerCase().includes(searchQueryClean) ||
      o.accountType?.toLowerCase().includes(searchQueryClean)
    );
  }) : [];

  const matchedSearchPayouts = searchQueryClean ? payouts.filter((p) => {
    return (
      p.id?.toLowerCase().includes(searchQueryClean) ||
      p.userId?.toLowerCase().includes(searchQueryClean) ||
      p.userEmail?.toLowerCase().includes(searchQueryClean) ||
      p.accountId?.toLowerCase().includes(searchQueryClean) ||
      p.payoutAddress?.toLowerCase().includes(searchQueryClean) ||
      p.payoutMethod?.toLowerCase().includes(searchQueryClean) ||
      (p as any).txHash?.toLowerCase().includes(searchQueryClean) ||
      p.status?.toLowerCase().includes(searchQueryClean)
    );
  }) : [];

  const searchResultsTotalCount = matchedSearchUsers.length + matchedSearchAccounts.length + matchedSearchOrders.length + matchedSearchPayouts.length;

  return (
    <div id="admin-panel" className="space-y-6">
      {/* Top Bar with Global Search */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-900/80 border border-white/10 rounded-2xl p-4 backdrop-blur-md shadow-xl">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white flex items-center space-x-2">
            <Shield className="w-5 h-5 text-blue-400" />
            <span>Admin Control Panel</span>
          </h2>
          <p className="text-xs text-slate-400">Manage prop evaluation challenges, accounts, payouts, and system settings.</p>
        </div>

        <div className="flex items-center gap-3 flex-1 max-w-xl">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-blue-400" />
            <input
              type="text"
              placeholder="Search Transaction ID, Tx Hash, User UID, Name, Email, Account ID..."
              value={globalSearchQuery}
              onChange={(e) => {
                setGlobalSearchQuery(e.target.value);
                if (e.target.value.trim() && activeTab !== 'search') {
                  setActiveTab('search');
                }
              }}
              className="w-full h-10 bg-black/40 border border-blue-500/30 rounded-xl pl-10 pr-9 text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 shadow-inner"
            />
            {globalSearchQuery && (
              <button
                onClick={() => setGlobalSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white p-0.5"
                title="Clear Search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <button 
            onClick={fetchAllData}
            className="flex items-center space-x-1.5 px-3 py-2 bg-white/5 border border-white/10 hover:border-blue-500/30 text-xs text-slate-300 rounded-xl font-semibold transition-colors shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {isQuotaExceeded && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-start gap-3 text-amber-200 text-sm">
          <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-bold text-amber-300">Firebase Daily Read Quota Reached</div>
            <p className="text-xs text-amber-200/80 leading-relaxed">
              All user records, trading accounts, challenges, payouts, and transactions remain <strong>safe and intact in Firestore</strong>. Real-time reads are temporarily paused by Google Cloud until the daily free tier quota resets, or until quota is upgraded.
            </p>
            <a 
              href="https://console.firebase.google.com/project/gen-lang-client-0674008062/firestore/databases/ai-studio-atfunding-572fc147-1cbf-4a6b-9c9c-3af639e06bcc/data?openUpgradeDialog=true"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-amber-300 font-medium underline hover:text-amber-100 mt-1"
            >
              Manage Quota in Firebase Console <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      )}

      {/* Admin NavTabs - Horizontal Scroll Container */}
      <div className="w-full bg-slate-900/80 border border-white/10 rounded-2xl p-2 overflow-x-auto overflow-y-hidden scrollbar-thin scrollbar-thumb-white/20 whitespace-nowrap shadow-2xl backdrop-blur-md flex items-center space-x-2">
        {[
          { id: 'stats', label: 'Dashboard', icon: Layers },
          { id: 'market_control', label: 'Market Control', icon: Sliders },
          { id: 'search', label: 'Universal Search', icon: Search },
          { id: 'users', label: 'Users', icon: Users },
          { id: 'active_accounts', label: 'Active Accounts', icon: Shield },
          { id: 'accounts', label: 'Giveaways & Provisioning', icon: Gift },
          { id: 'orders', label: 'Payments', icon: Coins },
          { id: 'certificates', label: '📜 Certificate Manager', icon: Award },
          { id: 'leaderboard', label: '🏆 Leaderboard', icon: Award },
          { id: 'challenge_reviews', label: 'Challenge Reviews', icon: Award },
          { id: 'referral_withdrawals', label: 'Referral Withdrawals', icon: DollarSign },
          { id: 'payouts', label: 'Payout Requests', icon: DollarSign },
          { id: 'coupons', label: 'Coupons', icon: Ticket },
          { id: 'kyc_verification', label: 'KYC Verification', icon: Shield },
          { id: 'announcements', label: 'Announcements', icon: Bell },
          { id: 'support_tickets', label: 'Support Tickets', icon: MessageSquare },
          { id: 'settings', label: 'Settings', icon: Settings },
          { id: 'trades', label: 'Live Monitor', icon: ListFilter },
          { id: 'payment_settings', label: 'Payment Config', icon: Coins },
          { id: 'social_links', label: 'Social Manager', icon: Share2 },
          { id: 'rule_settings', label: 'Rule Settings', icon: Shield },
          { id: 'rule_violations', label: 'Breach Center', icon: AlertTriangle },
          { id: 'broadcast', label: 'Broadcast Center', icon: Mail },
          { id: 'cms', label: 'Policy CMS', icon: ImageIcon },
          { id: 'offers_availability', label: 'Offers & Availability', icon: Tag },
          { id: 'tasks_rewards', label: 'Tasks & Rewards', icon: Coins },
          { id: 'email_center', label: 'Email Automation', icon: Mail },
          { id: 'database_backups', label: '💾 Database Backups', icon: Database },
          { id: 'auto_close_debug', label: '🛠️ Auto-Close Debug', icon: ShieldAlert }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap flex items-center space-x-2 transition-all cursor-pointer ${
              activeTab === tab.id 
                ? 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-500/25 font-bold border border-blue-400/30' 
                : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
            }`}
          >
            <tab.icon className="w-3.5 h-3.5" />
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="py-20 text-center text-xs text-slate-400">Loading admin dataset records...</div>
      ) : (
        <div className="space-y-6">
          {/* Global Active Market Event Banner */}
          <div className={`p-4 rounded-3xl border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 transition-all ${
            spikeEnabled
              ? 'bg-amber-500/10 border-amber-500/40 text-amber-300 shadow-xl shadow-amber-500/5'
              : 'bg-white/5 border-white/10 text-slate-300'
          }`}>
            <div className="flex items-center space-x-3">
              <div className={`p-2.5 rounded-2xl ${spikeEnabled ? 'bg-amber-500/20 text-amber-400 animate-pulse' : 'bg-slate-800 text-slate-400'}`}>
                <Activity className="w-5 h-5" />
              </div>
              <div>
                <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-400">Market Control Status</div>
                <div className="text-sm font-black font-mono">
                  {spikeEnabled
                    ? `⚡ Current Market Event: ${spikePipSize} Pip ${spikeDirection} Spike on ${spikeSymbol}`
                    : 'Current Market Event: Standard Engine Simulation (Idle)'}
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-2 w-full sm:w-auto">
              <button
                onClick={() => setActiveTab('market_control')}
                className="px-3.5 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 text-xs font-bold rounded-xl transition font-mono whitespace-nowrap"
              >
                Configure Market
              </button>
              {spikeEnabled && (
                <button
                  onClick={handleResetSpike}
                  disabled={isApplyingSpike}
                  className="px-3.5 py-1.5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-300 text-xs font-bold rounded-xl transition font-mono whitespace-nowrap"
                >
                  Cancel Spike
                </button>
              )}
            </div>
          </div>

          {/* MARKET CONTROL TAB */}
          {activeTab === 'market_control' && (
            <div className="space-y-6 animate-fade-in">
              {/* Active Event Status Header */}
              <div className={`p-5 rounded-3xl border transition-all ${
                spikeEnabled
                  ? 'bg-amber-500/10 border-amber-500/40 text-amber-200 shadow-lg shadow-amber-500/5'
                  : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              }`}>
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                  <div className="flex items-center space-x-3.5">
                    <div className={`p-3 rounded-2xl ${spikeEnabled ? 'bg-amber-500/20 text-amber-400 animate-pulse' : 'bg-emerald-500/20 text-emerald-400'}`}>
                      <Activity className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="text-[10px] font-mono font-bold uppercase tracking-widest text-slate-400">Market Engine Status</div>
                      <div className="text-lg font-black font-mono mt-0.5">
                        {spikeEnabled
                          ? `⚡ Current Market Event: ${spikePipSize} Pip ${spikeDirection} Spike`
                          : 'Current Market Event: Standard Engine Simulation (Idle)'}
                      </div>
                      {spikeEnabled && (
                        <div className="text-xs text-amber-300/80 mt-0.5 font-medium">
                          Target: <span className="font-bold text-white font-mono">{spikeSymbol}</span> | Apply To: <span className="font-bold text-white font-mono">{spikeApplyTo}</span> | Auto Reset: <span className="font-bold text-white font-mono">{spikeAutoReset ? 'ON' : 'OFF'}</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {spikeEnabled && (
                    <button
                      onClick={handleResetSpike}
                      disabled={isApplyingSpike}
                      className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-300 text-xs font-bold rounded-2xl transition-all shadow-md flex items-center space-x-1.5 shrink-0"
                    >
                      <X className="w-4 h-4" />
                      <span>Cancel Active Spike</span>
                    </button>
                  )}
                </div>
              </div>

              {marketControlMsg && (
                <div className={`p-4 rounded-2xl border text-xs font-bold ${
                  marketControlMsg.includes('✅')
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : marketControlMsg.includes('ℹ️')
                    ? 'bg-blue-500/10 border-blue-500/30 text-blue-300'
                    : 'bg-red-500/10 border-red-500/30 text-red-300'
                }`}>
                  {marketControlMsg}
                </div>
              )}

              {/* Main Market Spike Controls Grid */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                <div className="lg:col-span-7 bg-white/5 border border-white/10 rounded-3xl p-6 space-y-6 backdrop-blur-sm shadow-xl">
                  <div className="flex items-center justify-between border-b border-white/10 pb-4">
                    <div>
                      <h3 className="text-base font-bold text-white flex items-center space-x-2">
                        <Sliders className="w-5 h-5 text-blue-400" />
                        <span>Candle Spike Configuration</span>
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">Inject controlled high-volatility liquidity spikes into live chart feeds</p>
                    </div>

                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={spikeEnabled}
                        onChange={(e) => setSpikeEnabled(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                      <span className="ml-2.5 text-xs font-bold text-slate-200">Enable Candle Spike</span>
                    </label>
                  </div>

                  {/* Controls Form */}
                  <div className="space-y-5">
                    {/* Symbol & Size */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1.5 uppercase tracking-wider">Target Symbol</label>
                        <select
                          value={spikeSymbol}
                          onChange={(e) => setSpikeSymbol(e.target.value)}
                          className="w-full bg-slate-900/80 border border-white/10 rounded-2xl px-4 py-2.5 text-xs font-bold text-white font-mono focus:outline-none focus:border-blue-500"
                        >
                          {['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'XAUUSD', 'BTCUSD', 'ETHUSD', 'NAS100', 'US30'].map((sym) => (
                            <option key={sym} value={sym} className="bg-slate-900 text-white font-mono">{sym}</option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1.5 uppercase tracking-wider">Spike Size (Pips)</label>
                        <input
                          type="number"
                          min="10"
                          max="2000"
                          step="10"
                          value={spikePipSize}
                          onChange={(e) => setSpikePipSize(Number(e.target.value))}
                          className="w-full bg-slate-900/80 border border-white/10 rounded-2xl px-4 py-2.5 text-xs font-bold text-white font-mono focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>

                    {/* Preset Buttons for Pip Size */}
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Quick Pip Presets</label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {[
                          { size: 50, label: '50 Pips (Small News)' },
                          { size: 100, label: '100 Pips (Medium)' },
                          { size: 200, label: '200 Pips (Strong)' },
                          { size: 500, label: '500 Pips (Extreme)' },
                        ].map((p) => (
                          <button
                            key={p.size}
                            type="button"
                            onClick={() => setSpikePipSize(p.size)}
                            className={`px-3 py-2 rounded-2xl text-xs font-bold font-mono transition-all border ${
                              spikePipSize === p.size
                                ? 'bg-blue-600 text-white border-blue-400 shadow-md'
                                : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'
                            }`}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Direction & Apply To */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1.5 uppercase tracking-wider">Spike Direction</label>
                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => setSpikeDirection('Up')}
                            className={`px-4 py-2.5 rounded-2xl text-xs font-bold uppercase font-mono flex items-center justify-center space-x-1.5 transition-all border ${
                              spikeDirection === 'Up'
                                ? 'bg-emerald-600 text-white border-emerald-400 shadow-lg shadow-emerald-500/20'
                                : 'bg-white/5 text-slate-400 border-white/10 hover:text-white'
                            }`}
                          >
                            <span>Up ▲</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setSpikeDirection('Down')}
                            className={`px-4 py-2.5 rounded-2xl text-xs font-bold uppercase font-mono flex items-center justify-center space-x-1.5 transition-all border ${
                              spikeDirection === 'Down'
                                ? 'bg-red-600 text-white border-red-400 shadow-lg shadow-red-500/20'
                                : 'bg-white/5 text-slate-400 border-white/10 hover:text-white'
                            }`}
                          >
                            <span>Down ▼</span>
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-300 mb-1.5 uppercase tracking-wider">Apply To</label>
                        <select
                          value={spikeApplyTo}
                          onChange={(e) => setSpikeApplyTo(e.target.value as any)}
                          className="w-full bg-slate-900/80 border border-white/10 rounded-2xl px-4 py-2.5 text-xs font-bold text-white font-mono focus:outline-none focus:border-blue-500"
                        >
                          <option value="Next Candle Only" className="bg-slate-900 text-white">Next Candle Only</option>
                          <option value="Current Candle" className="bg-slate-900 text-white">Current Candle</option>
                        </select>
                      </div>
                    </div>

                    {/* Auto Reset Toggle */}
                    <div className="flex items-center justify-between p-4 bg-slate-900/50 border border-white/10 rounded-2xl">
                      <div>
                        <div className="text-xs font-bold text-white">Auto Reset After Spike</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">Automatically turns off spike system once candle completes and enters 3-5 candle stabilization mode</div>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer shrink-0 ml-4">
                        <input
                          type="checkbox"
                          checked={spikeAutoReset}
                          onChange={(e) => setSpikeAutoReset(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600"></div>
                      </label>
                    </div>

                    {/* Action Buttons */}
                    <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
                      <button
                        type="button"
                        onClick={handleApplySpike}
                        disabled={isApplyingSpike}
                        className={`w-full sm:flex-1 py-3 px-6 rounded-2xl font-bold text-xs uppercase tracking-wider transition-all shadow-xl flex items-center justify-center space-x-2 ${
                          spikeEnabled
                            ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 font-black shadow-amber-500/20'
                            : 'bg-blue-600 hover:bg-blue-500 text-white shadow-blue-500/20'
                        }`}
                      >
                        <Activity className="w-4 h-4" />
                        <span>{spikeEnabled ? 'Update Active Spike Event' : '🚀 Trigger Market Spike'}</span>
                      </button>

                      {spikeEnabled && (
                        <button
                          type="button"
                          onClick={handleResetSpike}
                          disabled={isApplyingSpike}
                          className="w-full sm:w-auto py-3 px-5 bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-300 text-xs font-bold rounded-2xl transition-all"
                        >
                          Reset Engine
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Safety & Realtime Price Overview */}
                <div className="lg:col-span-5 space-y-6">
                  {/* Safety Box */}
                  <div className="bg-blue-500/10 border border-blue-500/20 rounded-3xl p-6 backdrop-blur-sm space-y-3">
                    <div className="flex items-center space-x-2 text-blue-300 font-bold text-sm">
                      <Shield className="w-5 h-5 text-blue-400" />
                      <span>Safety & Logic Rules</span>
                    </div>
                    <ul className="text-xs text-slate-300 space-y-2 list-disc list-inside leading-relaxed font-medium">
                      <li><strong>Chart Feeds Only:</strong> Spike logic drives price fluctuations and 1m candle formation cleanly.</li>
                      <li><strong>Account Integrity:</strong> User account balances, open positions, rules, and database schema remain 100% safe and uncorrupted.</li>
                      <li><strong>Realistic Market Dynamics:</strong> Price moves smoothly without single-frame teleportation, forming complete body and wicks.</li>
                      <li><strong>Smooth Stabilization:</strong> After spike execution, market volatility smoothly normalizes over 3–5 candles.</li>
                    </ul>
                  </div>

                  {/* Live Prices Ticker */}
                  <div className="bg-white/5 border border-white/10 rounded-3xl p-6 space-y-4 backdrop-blur-sm shadow-xl">
                    <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center justify-between">
                      <span>Live Price Feed Ticker</span>
                      <span className="text-[10px] text-emerald-400 font-mono">Realtime 500ms</span>
                    </h4>
                    <div className="grid grid-cols-2 gap-3 max-h-[220px] overflow-y-auto scrollbar-none pr-1">
                      {['EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'BTCUSD', 'ETHUSD'].map((s) => {
                        const item = livePrices[s];
                        return (
                          <div key={s} className="bg-slate-900/60 border border-white/5 rounded-2xl p-3">
                            <div className="text-[10px] font-bold text-slate-400 font-mono">{s}</div>
                            <div className="text-sm font-black font-mono text-white mt-0.5">
                              {item ? item.last.toFixed(DECIMAL_PLACES[s] || 4) : 'Loading...'}
                            </div>
                            <div className={`text-[10px] font-mono font-bold mt-0.5 ${item && item.changePercent >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              {item ? `${item.changePercent >= 0 ? '+' : ''}${item.changePercent.toFixed(2)}%` : '--'}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Firestore Audit Logs: marketEvents Collection */}
              <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-sm shadow-xl space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center space-x-2">
                      <Clock className="w-5 h-5 text-amber-400" />
                      <span>Market Events Log (`marketEvents` Collection)</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">Firestore audit collection logging every administrative market spike event</p>
                  </div>
                  <div className="text-xs font-mono font-bold text-slate-400">
                    Total Logs: {marketEventLogs.length}
                  </div>
                </div>

                {marketEventLogs.length === 0 ? (
                  <div className="py-12 text-center text-xs text-slate-500 font-mono">No market events recorded in `marketEvents` collection yet.</div>
                ) : (
                  <div className="overflow-x-auto max-h-[350px] scrollbar-none">
                    <table className="w-full text-left text-xs text-slate-300">
                      <thead>
                        <tr className="border-b border-white/10 font-mono uppercase text-slate-400">
                          <th className="py-2.5">Timestamp</th>
                          <th className="py-2.5">Event Type</th>
                          <th className="py-2.5">Symbol</th>
                          <th className="py-2.5">Size (Pips)</th>
                          <th className="py-2.5">Direction</th>
                          <th className="py-2.5">Apply To</th>
                          <th className="py-2.5">Admin Email</th>
                          <th className="py-2.5 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/10 font-medium">
                        {marketEventLogs.map((log) => (
                          <tr key={log.id || log.timestamp}>
                            <td className="py-2.5 font-mono text-slate-400 text-[11px]">{new Date(log.timestamp).toLocaleString()}</td>
                            <td className="py-2.5 font-bold font-mono text-amber-400">{log.eventType}</td>
                            <td className="py-2.5 font-bold font-mono text-white">{log.symbol}</td>
                            <td className="py-2.5 font-mono text-white">{log.pipSize} Pips</td>
                            <td className="py-2.5 font-mono">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                log.direction === 'Up' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                              }`}>
                                {log.direction}
                              </span>
                            </td>
                            <td className="py-2.5 font-mono text-slate-300">{log.applyTo}</td>
                            <td className="py-2.5 font-mono text-slate-400">{log.adminEmail}</td>
                            <td className="py-2.5 text-right font-mono">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                                log.status === 'ACTIVE' ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 animate-pulse' : 'bg-emerald-500/10 text-emerald-400'
                              }`}>
                                {log.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 1: OVERALL STATISTICS */}
          {activeTab === 'stats' && (
            <div className="space-y-6 animate-fade-in">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
                {/* Pending KYC */}
                <div className="bg-white/5 border border-amber-500/30 rounded-3xl p-5 backdrop-blur-sm shadow-xl flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-amber-400 font-bold uppercase tracking-wider">Pending KYC</p>
                    <p className="text-2xl font-black text-amber-400 mt-1.5 font-mono">
                      {users.filter(u => u.kycStatus === 'pending').length}
                    </p>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center">
                    <Shield className="w-5 h-5 text-amber-400" />
                  </div>
                </div>

                {/* Approved KYC */}
                <div className="bg-white/5 border border-emerald-500/30 rounded-3xl p-5 backdrop-blur-sm shadow-xl flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">Approved KYC</p>
                    <p className="text-2xl font-black text-emerald-400 mt-1.5 font-mono">
                      {users.filter(u => u.kycStatus === 'approved').length}
                    </p>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center">
                    <Check className="w-5 h-5 text-emerald-400" />
                  </div>
                </div>

                {/* Rejected KYC */}
                <div className="bg-white/5 border border-red-500/30 rounded-3xl p-5 backdrop-blur-sm shadow-xl flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-red-400 font-bold uppercase tracking-wider">Rejected KYC</p>
                    <p className="text-2xl font-black text-red-400 mt-1.5 font-mono">
                      {users.filter(u => u.kycStatus === 'rejected').length}
                    </p>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-red-500/15 border border-red-500/20 flex items-center justify-center">
                    <X className="w-5 h-5 text-red-400" />
                  </div>
                </div>

                {/* Total Traders */}
                <div className="bg-white/5 border border-white/10 rounded-3xl p-5 backdrop-blur-sm shadow-xl flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Total Traders</p>
                    <p className="text-2xl font-black text-white mt-1.5 font-mono">
                      {users.filter(u => u.role !== 'admin').length}
                    </p>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/20 flex items-center justify-center">
                    <Users className="w-5 h-5 text-blue-400" />
                  </div>
                </div>

                {/* Total Active Accounts */}
                <div className="bg-white/5 border border-white/10 rounded-3xl p-5 backdrop-blur-sm shadow-xl flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Total Active Accounts</p>
                    <p className="text-2xl font-black text-white mt-1.5 font-mono">
                      {accounts.filter(a => a.status === 'active').length}
                    </p>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center">
                    <Activity className="w-5 h-5 text-emerald-400" />
                  </div>
                </div>

                {/* Total Pending Accounts */}
                <div className="bg-white/5 border border-white/10 rounded-3xl p-5 backdrop-blur-sm shadow-xl flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Total Pending Accounts</p>
                    <p className="text-2xl font-black text-amber-500 mt-1.5 font-mono">
                      {accounts.filter(a => a.status === 'Pending Approval').length}
                    </p>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center">
                    <Clock className="w-5 h-5 text-amber-400" />
                  </div>
                </div>

                {/* Total Breached Accounts */}
                <div className="bg-white/5 border border-white/10 rounded-3xl p-5 backdrop-blur-sm shadow-xl flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Total Breached Accounts</p>
                    <p className="text-2xl font-black text-red-500 mt-1.5 font-mono">
                      {accounts.filter(a => a.status === 'breached').length}
                    </p>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-red-500/15 border border-red-500/20 flex items-center justify-center">
                    <AlertTriangle className="w-5 h-5 text-red-400" />
                  </div>
                </div>

                {/* Total Coupons Used */}
                <div className="bg-white/5 border border-white/10 rounded-3xl p-5 backdrop-blur-sm shadow-xl flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Total Coupons Used</p>
                    <p className="text-2xl font-black text-violet-400 mt-1.5 font-mono">
                      {orders.filter(o => o.couponCode).length}
                    </p>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-violet-500/15 border border-violet-500/20 flex items-center justify-center">
                    <Tag className="w-5 h-5 text-violet-400" />
                  </div>
                </div>

                {/* Total Giveaway Accounts */}
                <div className="bg-white/5 border border-white/10 rounded-3xl p-5 backdrop-blur-sm shadow-xl flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Total Giveaway Accounts</p>
                    <p className="text-2xl font-black text-pink-400 mt-1.5 font-mono">
                      {accounts.filter(a => a.isGiveaway).length}
                    </p>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-pink-500/15 border border-pink-500/20 flex items-center justify-center">
                    <Gift className="w-5 h-5 text-pink-400" />
                  </div>
                </div>

                {/* Total Revenue */}
                <div className="bg-white/5 border border-white/10 rounded-3xl p-5 backdrop-blur-sm shadow-xl flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Total Revenue</p>
                    <p className="text-2xl font-black text-emerald-400 mt-1.5 font-mono">
                      ${orders.filter(o => o.status === 'Approved').reduce((acc, curr) => acc + (curr.finalPrice || curr.price || 0), 0).toLocaleString()}
                    </p>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center">
                    <Coins className="w-5 h-5 text-emerald-400" />
                  </div>
                </div>

                {/* Total Payouts Approved */}
                <div className="bg-white/5 border border-white/10 rounded-3xl p-5 backdrop-blur-sm shadow-xl flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Total Approved Payouts</p>
                    <p className="text-2xl font-black text-blue-400 mt-1.5 font-mono">
                      ${payouts.filter(p => p.status === 'approved').reduce((acc, curr) => acc + curr.amount, 0).toLocaleString()}
                    </p>
                  </div>
                  <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/20 flex items-center justify-center">
                    <DollarSign className="w-5 h-5 text-blue-400" />
                  </div>
                </div>
              </div>

              {/* MARKET ENGINE & CANDLE STORE VALIDATION PANEL */}
              <div className="bg-slate-900/90 border border-blue-500/30 rounded-3xl p-6 backdrop-blur-md shadow-2xl space-y-4">
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <div className="flex items-center space-x-2.5">
                    <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                      PriceEngine & CandleStore Validation Panel
                    </h3>
                  </div>
                  <span className="text-[11px] bg-blue-500/20 text-blue-300 border border-blue-500/30 px-3 py-1 rounded-full font-mono font-semibold">
                    {engineMetrics.engineRunningStatus}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-1">
                  {/* 1. Last Saved Candle Time */}
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-1">
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Last Saved Candle Time</p>
                    <p className="text-sm font-black text-emerald-400 font-mono truncate">
                      {engineMetrics.lastSavedCandleTime}
                    </p>
                  </div>

                  {/* 2. Current UTC Time */}
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-1">
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Current UTC Time</p>
                    <p className="text-sm font-black text-blue-400 font-mono truncate">
                      {engineMetrics.currentUTCTime}
                    </p>
                  </div>

                  {/* 3. Missing Candles Generated */}
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-1">
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Missing Candles Generated</p>
                    <p className="text-sm font-black text-amber-400 font-mono truncate">
                      {engineMetrics.missingCandlesSummary}
                    </p>
                  </div>

                  {/* 4. Engine Running Status */}
                  <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-1">
                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Engine Running Status</p>
                    <p className="text-sm font-black text-emerald-400 font-mono truncate">
                      {engineMetrics.engineRunningStatus}
                    </p>
                  </div>
                </div>
              </div>

              {/* Latest Registrations & Purchases */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Latest Registrations */}
                <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-sm shadow-xl space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider">Latest Registrations</h3>
                    <span className="text-[10px] bg-white/10 text-white px-2 py-0.5 rounded-full font-mono">New Traders</span>
                  </div>
                  <div className="divide-y divide-white/10 overflow-hidden">
                    {users.slice(0, 5).map((u) => (
                      <div key={u.uid} className="py-3 flex justify-between items-center text-xs">
                        <div>
                          <p className="font-semibold text-white">{u.displayName || u.name || 'Anonymous User'}</p>
                          <p className="text-[10px] text-slate-400 font-mono">{u.email}</p>
                        </div>
                        <div className="text-right text-[10px] text-slate-500 font-mono">
                          {u.createdAt ? new Date(u.createdAt).toLocaleDateString() : 'N/A'}
                        </div>
                      </div>
                    ))}
                    {users.length === 0 && (
                      <p className="py-6 text-center text-xs text-slate-500">No registrations found.</p>
                    )}
                  </div>
                </div>

                {/* Latest Purchases */}
                <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-sm shadow-xl space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider">Latest Purchases</h3>
                    <span className="text-[10px] bg-white/10 text-white px-2 py-0.5 rounded-full font-mono">New Orders</span>
                  </div>
                  <div className="divide-y divide-white/10 overflow-hidden">
                    {orders.slice(0, 5).map((o) => (
                      <div key={o.orderId} className="py-3 flex justify-between items-center text-xs">
                        <div>
                          <p className="font-semibold text-white">{o.email}</p>
                          <p className="text-[10px] text-slate-400 capitalize">{o.accountType.replace('_', ' ')} ({o.accountSize})</p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-white font-mono">${o.finalPrice || o.price}</p>
                          <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                            o.status === 'Approved' ? 'bg-emerald-500/10 text-emerald-400' :
                            o.status === 'Rejected' ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'
                          }`}>
                            {o.status}
                          </span>
                        </div>
                      </div>
                    ))}
                    {orders.length === 0 && (
                      <p className="py-6 text-center text-xs text-slate-500">No purchases found.</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Firebase Live telemetry monitor */}
              <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-sm shadow-xl space-y-4">
                <div className="flex items-center justify-between border-b border-white/5 pb-3">
                  <div className="flex items-center space-x-2.5">
                    <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">Firebase Real-time Health Monitor</h3>
                  </div>
                  <span className="text-[10px] font-mono font-bold text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded border border-emerald-400/20">Operational</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div className="bg-black/25 rounded-2xl p-4 border border-white/5">
                    <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider font-mono">Firestore Writes</p>
                    <p className="text-xl font-bold text-white mt-1 font-mono">{telemetryStats.firestoreWrites} writes</p>
                    <div className="w-full bg-white/5 h-1 rounded-full overflow-hidden mt-2">
                      <div className="bg-blue-500 h-full rounded-full animate-pulse" style={{ width: '45%' }}></div>
                    </div>
                  </div>

                  <div className="bg-black/25 rounded-2xl p-4 border border-white/5">
                    <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider font-mono">Firestore Reads</p>
                    <p className="text-xl font-bold text-white mt-1 font-mono">{telemetryStats.firestoreReads} reads</p>
                    <div className="w-full bg-white/5 h-1 rounded-full overflow-hidden mt-2">
                      <div className="bg-emerald-500 h-full rounded-full" style={{ width: '65%' }}></div>
                    </div>
                  </div>

                  <div className="bg-black/25 rounded-2xl p-4 border border-white/5">
                    <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider font-mono">Active Listeners</p>
                    <p className="text-xl font-bold text-white mt-1 font-mono">{telemetryStats.realtimeListeners} onSnapshot</p>
                    <div className="w-full bg-white/5 h-1 rounded-full overflow-hidden mt-2">
                      <div className="bg-amber-500 h-full rounded-full" style={{ width: '80%' }}></div>
                    </div>
                  </div>

                  <div className="bg-black/25 rounded-2xl p-4 border border-white/5 flex flex-col justify-center">
                    <p className="text-[10px] text-slate-500 uppercase font-bold tracking-wider font-mono">Sync DB ID</p>
                    <p className="text-xs font-mono font-bold text-slate-300 mt-1 break-all select-all">ai-studio-atfunding-572fc147</p>
                  </div>
                </div>

                <div className="space-y-2 pt-2">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">Connected & Verified Collections</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                    {telemetryStats.connectedCollections.map((col) => (
                      <div key={col.name} className="flex items-center justify-between px-3.5 py-2 bg-black/20 rounded-xl border border-white/5">
                        <div className="flex items-center space-x-2">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500"></div>
                          <span className="text-[11px] font-medium text-slate-300 font-mono">{col.name}</span>
                        </div>
                        <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">Verified</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB: CERTIFICATE MANAGER */}
          {activeTab === 'certificates' && (
            <AdminCertificateManager 
              users={users} 
              accounts={accounts} 
              certificates={certificates} 
            />
          )}

          {/* TAB: DYNAMIC LEADERBOARD */}
          {activeTab === 'leaderboard' && (
            <LeaderboardView 
              isAdmin={true} 
              accountsList={accounts} 
              usersList={users} 
              payoutsList={payouts} 
            />
          )}


          {/* LEGACY INLINE CERTIFICATES (DISABLED IN FAVOR OF AdminCertificateManager) */}
          {false && (
            <div>
              {/* MODE 1: ISSUED CERTIFICATES & ISSUANCE FORM */}
              {activeCertSubTab === 'issued' && (
                <>
                  {/* Top Certificate Analytics Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                    <div className="bg-white/5 border border-amber-500/30 rounded-3xl p-5 backdrop-blur-sm shadow-xl flex items-center justify-between">
                      <div>
                        <p className="text-[10px] text-amber-400 font-bold uppercase tracking-wider">Total Issued</p>
                        <p className="text-2xl font-black text-amber-400 mt-1.5 font-mono">{certificates.length}</p>
                      </div>
                      <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center">
                        <Award className="w-5 h-5 text-amber-400" />
                      </div>
                    </div>

                    <div className="bg-white/5 border border-blue-500/30 rounded-3xl p-5 backdrop-blur-sm shadow-xl flex items-center justify-between">
                      <div>
                        <p className="text-[10px] text-blue-400 font-bold uppercase tracking-wider">Phase 1</p>
                        <p className="text-2xl font-black text-blue-400 mt-1.5 font-mono">
                          {certificates.filter(c => (c.phase || '').toLowerCase().includes('phase 1')).length}
                        </p>
                      </div>
                      <div className="w-10 h-10 rounded-xl bg-blue-500/15 border border-blue-500/20 flex items-center justify-center">
                        <Award className="w-5 h-5 text-blue-400" />
                      </div>
                    </div>

                    <div className="bg-white/5 border border-cyan-500/30 rounded-3xl p-5 backdrop-blur-sm shadow-xl flex items-center justify-between">
                      <div>
                        <p className="text-[10px] text-cyan-400 font-bold uppercase tracking-wider">Phase 2</p>
                        <p className="text-2xl font-black text-cyan-400 mt-1.5 font-mono">
                          {certificates.filter(c => (c.phase || '').toLowerCase().includes('phase 2')).length}
                        </p>
                      </div>
                      <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/20 flex items-center justify-center">
                        <Award className="w-5 h-5 text-cyan-400" />
                      </div>
                    </div>

                    <div className="bg-white/5 border border-emerald-500/30 rounded-3xl p-5 backdrop-blur-sm shadow-xl flex items-center justify-between">
                      <div>
                        <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider">Funded</p>
                        <p className="text-2xl font-black text-emerald-400 mt-1.5 font-mono">
                          {certificates.filter(c => (c.phase || '').toLowerCase().includes('funded')).length}
                        </p>
                      </div>
                      <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center">
                        <Award className="w-5 h-5 text-emerald-400" />
                      </div>
                    </div>
                  </div>

                  {/* Issue Form Section */}
                  <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-sm shadow-xl space-y-5">
                    <div className="border-b border-white/10 pb-4">
                      <h3 className="text-base font-bold text-white flex items-center gap-2">
                        <Plus className="w-5 h-5 text-amber-400" />
                        <span>Issue New Performance Certificate</span>
                      </h3>
                      <p className="text-xs text-slate-400 mt-0.5">Award official certificates automatically tied to user accounts.</p>
                    </div>

                    <form onSubmit={handleGenerateCertificate} className="space-y-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="space-y-1 sm:col-span-2">
                          <label className="text-[10px] font-bold text-amber-400 uppercase tracking-wider block">Select Trader / User *</label>
                          <select
                            required
                            value={selectedCertUserId}
                            onChange={(e) => {
                              const uid = e.target.value;
                              setSelectedCertUserId(uid);
                              const u = users.find(x => x.uid === uid);
                              if (u) {
                                const uName = u.displayName || u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Trader';
                                setCertUserName(uName);
                                setCertEmail(u.email);
                                
                                // Auto detect account size & phase if trading account exists
                                const userAcc = accounts.find(a => a.userId === uid);
                                if (userAcc) {
                                  if (userAcc.size) setCertAccountSize(`$${userAcc.size.toLocaleString()}`);
                                  if (userAcc.phase) setCertPhase(userAcc.phase === 3 ? 'Funded' : `Phase ${userAcc.phase}`);
                                }
                              } else {
                                setCertUserName('');
                                setCertEmail('');
                              }
                            }}
                            className="w-full h-10 bg-black/40 border border-amber-500/30 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-amber-400 font-bold"
                          >
                            <option value="">-- Choose Registered Trader --</option>
                            {users.map(u => (
                              <option key={u.uid} value={u.uid} className="bg-slate-900 text-white">
                                {u.displayName || u.name || 'Trader'} ({u.email})
                              </option>
                            ))}
                          </select>
                        </div>

                        {selectedCertUserId && (
                          <div className="space-y-1 sm:col-span-2 bg-amber-500/10 border border-amber-500/20 rounded-xl p-2.5 flex items-center justify-between">
                            <div>
                              <span className="text-[10px] font-bold text-amber-400 block uppercase">Selected Trader</span>
                              <span className="text-xs font-black text-white">{certUserName}</span>
                              <span className="text-[10px] text-slate-400 font-mono ml-2">({certEmail})</span>
                            </div>
                            <span className="text-[10px] bg-emerald-500/20 text-emerald-400 font-mono font-bold px-2 py-0.5 rounded">
                              Auto-Verified
                            </span>
                          </div>
                        )}

                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Account Size</label>
                          <select
                            value={certAccountSize}
                            onChange={(e) => setCertAccountSize(e.target.value)}
                            className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-amber-400"
                          >
                            <option value="$1,000">$1,000</option>
                            <option value="$5,000">$5,000</option>
                            <option value="$10,000">$10,000</option>
                            <option value="$25,000">$25,000</option>
                            <option value="$50,000">$50,000</option>
                            <option value="$100,000">$100,000</option>
                            <option value="$200,000">$200,000</option>
                          </select>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Phase</label>
                          <select
                            value={certPhase}
                            onChange={(e) => setCertPhase(e.target.value)}
                            className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-amber-400"
                          >
                            <option value="Trial">Trial</option>
                            <option value="Phase 1">Phase 1</option>
                            <option value="Phase 2">Phase 2</option>
                            <option value="Funded">Funded</option>
                          </select>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Account Type</label>
                          <select
                            value={certAccountType}
                            onChange={(e) => setCertAccountType(e.target.value)}
                            className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-amber-400"
                          >
                            <option value="Trial">Trial</option>
                            <option value="Instant">Instant</option>
                            <option value="1 Step">1 Step</option>
                            <option value="2 Step">2 Step</option>
                            <option value="Funded">Funded</option>
                          </select>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Issue Date</label>
                          <input
                            type="date"
                            value={certIssueDate}
                            onChange={(e) => setCertIssueDate(e.target.value)}
                            className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3.5 text-xs text-white focus:outline-none focus:border-amber-400 font-mono"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Certificate ID (Optional)</label>
                          <input
                            type="text"
                            placeholder="Auto-generated if empty"
                            value={certIdInput}
                            onChange={(e) => setCertIdInput(e.target.value)}
                            className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3.5 text-xs text-white font-mono placeholder-slate-500 focus:outline-none focus:border-amber-400"
                          />
                        </div>
                      </div>

                      <div className="flex justify-end pt-2">
                        <button
                          type="submit"
                          disabled={isGeneratingCert}
                          className="px-6 h-11 bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold rounded-xl text-xs uppercase tracking-wider transition-all shadow-lg shadow-amber-500/20 cursor-pointer flex items-center gap-2"
                        >
                          <Award className="w-4 h-4" />
                          <span>{isGeneratingCert ? 'Generating...' : 'Issue Certificate'}</span>
                        </button>
                      </div>
                    </form>
                  </div>

                  {/* Certificates Table */}
                  <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-sm shadow-xl space-y-5">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4">
                      <div>
                        <h3 className="text-base font-bold text-white flex items-center gap-2">
                          <Award className="w-5 h-5 text-amber-400" />
                          <span>Issued Certificates List</span>
                        </h3>
                        <p className="text-xs text-slate-400 mt-0.5">Manage, preview, download PDF, or dispatch via email.</p>
                      </div>

                      <div className="flex items-center gap-3">
                        <button
                          onClick={handleExportCertificatesCSV}
                          className="px-3.5 py-2 bg-emerald-600/20 hover:bg-emerald-600 text-emerald-400 hover:text-white border border-emerald-500/30 rounded-xl text-xs font-extrabold transition-all cursor-pointer flex items-center gap-1.5"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Export CSV</span>
                        </button>
                      </div>
                    </div>

                    {/* Filters */}
                    <div className="flex flex-col sm:flex-row gap-3">
                      <div className="relative flex-1">
                        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                        <input
                          type="text"
                          placeholder="Search Name, Email, Certificate ID..."
                          value={certSearchQuery}
                          onChange={(e) => setCertSearchQuery(e.target.value)}
                          className="w-full h-10 bg-black/40 border border-white/10 rounded-xl pl-10 pr-4 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400"
                        />
                      </div>

                      <select
                        value={certFilterPhase}
                        onChange={(e) => setCertFilterPhase(e.target.value)}
                        className="h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-amber-400"
                      >
                        <option value="All">All Phases</option>
                        <option value="Phase 1">Phase 1</option>
                        <option value="Phase 2">Phase 2</option>
                        <option value="Funded">Funded</option>
                        <option value="Trial">Trial</option>
                      </select>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs text-slate-300">
                        <thead className="bg-black/40 text-slate-400 uppercase font-mono text-[10px]">
                          <tr>
                            <th className="p-3 rounded-l-xl">Cert ID</th>
                            <th className="p-3">Trader Name</th>
                            <th className="p-3">Email</th>
                            <th className="p-3">Account Size</th>
                            <th className="p-3">Phase</th>
                            <th className="p-3">Issue Date</th>
                            <th className="p-3 text-right rounded-r-xl">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {certificates
                            .filter(c => {
                              const q = certSearchQuery.toLowerCase().trim();
                              const matchesQuery = !q || 
                                (c.name || '').toLowerCase().includes(q) ||
                                (c.userName || '').toLowerCase().includes(q) ||
                                (c.email || '').toLowerCase().includes(q) ||
                                (c.certificateId || c.id || '').toLowerCase().includes(q);
                              const matchesPhase = certFilterPhase === 'All' || (c.phase || '').toLowerCase() === certFilterPhase.toLowerCase();
                              return matchesQuery && matchesPhase;
                            })
                            .map(c => (
                              <tr key={c.id} className="hover:bg-white/5 transition-colors">
                                <td className="p-3 font-mono text-amber-400 font-bold">{c.certificateId || c.id}</td>
                                <td className="p-3 font-bold text-white">{c.name || c.userName || 'Trader'}</td>
                                <td className="p-3 text-slate-400 font-mono">{c.email}</td>
                                <td className="p-3 text-emerald-400 font-bold font-mono">{c.accountSize}</td>
                                <td className="p-3">
                                  <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                    {c.phase || 'Phase 1'}
                                  </span>
                                </td>
                                <td className="p-3 font-mono text-slate-400">{c.issueDate || c.date}</td>
                                <td className="p-3 text-right">
                                  <div className="flex items-center justify-end space-x-1">
                                    <button
                                      type="button"
                                      onClick={() => setPreviewCertModal(c)}
                                      className="p-1.5 text-amber-400 hover:text-amber-300 hover:bg-amber-500/10 rounded-lg transition-colors cursor-pointer"
                                      title="Preview Certificate"
                                    >
                                      <Eye className="w-4 h-4" />
                                    </button>

                                    <button
                                      type="button"
                                      disabled={isSendingCertEmail}
                                      onClick={() => handleSendCertEmail(c)}
                                      className="p-1.5 text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded-lg transition-colors cursor-pointer"
                                      title="Send Certificate to Email"
                                    >
                                      <Send className="w-4 h-4" />
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => handleDeleteCertificate(c.id)}
                                      className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors cursor-pointer"
                                      title="Delete Certificate"
                                    >
                                      <Trash2 className="w-4 h-4" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          {certificates.length === 0 && (
                            <tr>
                              <td colSpan={7} className="text-center py-8 text-slate-500">
                                No certificates issued yet.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}

              {/* MODE 2: CERTIFICATE TEMPLATE EDITOR */}
              {activeCertSubTab === 'editor' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Template Editor Form */}
                  <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-sm shadow-xl space-y-5">
                    <div className="border-b border-white/10 pb-4 flex justify-between items-center">
                      <div>
                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                          <Sliders className="w-5 h-5 text-amber-400" />
                          <span>Certificate Template Settings</span>
                        </h3>
                        <p className="text-xs text-slate-400 mt-0.5">Customize texts, images, signatures, and dynamic variables.</p>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleSaveCertTemplate()}
                        disabled={isSavingCertTemplate}
                        className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold rounded-xl text-xs uppercase tracking-wider transition-all shadow-md cursor-pointer flex items-center gap-1.5"
                      >
                        <Check className="w-4 h-4" />
                        <span>{isSavingCertTemplate ? 'Saving...' : 'Save Template'}</span>
                      </button>
                    </div>

                    <form onSubmit={handleSaveCertTemplate} className="space-y-4">
                      {/* Image Upload Row */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-black/20 p-4 rounded-2xl border border-white/5">
                        {/* Background Image Upload */}
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-amber-400 uppercase tracking-wider block">Background Image</label>
                          <div className="relative">
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => handleCertImageUpload(e, 'bgImageUrl')}
                              className="hidden"
                              id="cert-bg-upload"
                            />
                            <label
                              htmlFor="cert-bg-upload"
                              className="w-full h-20 border-2 border-dashed border-white/20 hover:border-amber-400 rounded-xl flex flex-col items-center justify-center cursor-pointer p-2 transition-all text-center bg-black/40"
                            >
                              {certTemplate.bgImageUrl ? (
                                <img src={certTemplate.bgImageUrl} alt="BG Preview" className="h-full w-full object-cover rounded-lg" />
                              ) : (
                                <>
                                  <Upload className="w-5 h-5 text-amber-400 mb-1" />
                                  <span className="text-[10px] text-slate-300 font-bold">Upload Custom BG</span>
                                </>
                              )}
                            </label>
                          </div>
                          {certTemplate.bgImageUrl && (
                            <button
                              type="button"
                              onClick={() => setCertTemplate(p => ({ ...p, bgImageUrl: '' }))}
                              className="text-[10px] text-red-400 hover:underline block mx-auto"
                            >
                              Remove Background
                            </button>
                          )}
                        </div>

                        {/* Company Logo Upload */}
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-blue-400 uppercase tracking-wider block">Company Logo</label>
                          <div className="relative">
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => handleCertImageUpload(e, 'logoUrl')}
                              className="hidden"
                              id="cert-logo-upload"
                            />
                            <label
                              htmlFor="cert-logo-upload"
                              className="w-full h-20 border-2 border-dashed border-white/20 hover:border-blue-400 rounded-xl flex flex-col items-center justify-center cursor-pointer p-2 transition-all text-center bg-black/40"
                            >
                              {certTemplate.logoUrl ? (
                                <img src={certTemplate.logoUrl} alt="Logo Preview" className="h-full object-contain rounded-lg" />
                              ) : (
                                <>
                                  <ImageIcon className="w-5 h-5 text-blue-400 mb-1" />
                                  <span className="text-[10px] text-slate-300 font-bold">Upload Logo</span>
                                </>
                              )}
                            </label>
                          </div>
                          {certTemplate.logoUrl && (
                            <button
                              type="button"
                              onClick={() => setCertTemplate(p => ({ ...p, logoUrl: '' }))}
                              className="text-[10px] text-red-400 hover:underline block mx-auto"
                            >
                              Remove Logo
                            </button>
                          )}
                        </div>

                        {/* CEO Signature Upload */}
                        <div className="space-y-1.5">
                          <label className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider block">CEO Signature</label>
                          <div className="relative">
                            <input
                              type="file"
                              accept="image/*"
                              onChange={(e) => handleCertImageUpload(e, 'signatureUrl')}
                              className="hidden"
                              id="cert-sig-upload"
                            />
                            <label
                              htmlFor="cert-sig-upload"
                              className="w-full h-20 border-2 border-dashed border-white/20 hover:border-emerald-400 rounded-xl flex flex-col items-center justify-center cursor-pointer p-2 transition-all text-center bg-black/40"
                            >
                              {certTemplate.signatureUrl ? (
                                <img src={certTemplate.signatureUrl} alt="Signature Preview" className="h-full object-contain filter invert rounded-lg" />
                              ) : (
                                <>
                                  <FileText className="w-5 h-5 text-emerald-400 mb-1" />
                                  <span className="text-[10px] text-slate-300 font-bold">Upload Signature</span>
                                </>
                              )}
                            </label>
                          </div>
                          {certTemplate.signatureUrl && (
                            <button
                              type="button"
                              onClick={() => setCertTemplate(p => ({ ...p, signatureUrl: '' }))}
                              className="text-[10px] text-red-400 hover:underline block mx-auto"
                            >
                              Remove Signature
                            </button>
                          )}
                        </div>
                      </div>

                      {/* Header & Brand Inputs */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Company Name</label>
                          <input
                            type="text"
                            value={certTemplate.companyName}
                            onChange={(e) => setCertTemplate(p => ({ ...p, companyName: e.target.value }))}
                            className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3.5 text-xs text-white focus:outline-none focus:border-amber-400 font-bold"
                            placeholder="e.g. ATFUNDING"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Company Tagline / Subtitle</label>
                          <input
                            type="text"
                            value={certTemplate.companyTagline || ''}
                            onChange={(e) => setCertTemplate(p => ({ ...p, companyTagline: e.target.value }))}
                            className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3.5 text-xs text-white focus:outline-none focus:border-amber-400"
                            placeholder="e.g. PROPRIETARY TRADING FIRM"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Certificate Title</label>
                          <input
                            type="text"
                            value={certTemplate.title}
                            onChange={(e) => setCertTemplate(p => ({ ...p, title: e.target.value }))}
                            className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3.5 text-xs text-white focus:outline-none focus:border-amber-400 font-bold"
                            placeholder="e.g. CERTIFICATE OF ACHIEVEMENT"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Subtitle Line</label>
                          <input
                            type="text"
                            value={certTemplate.subtitle}
                            onChange={(e) => setCertTemplate(p => ({ ...p, subtitle: e.target.value }))}
                            className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3.5 text-xs text-white focus:outline-none focus:border-amber-400"
                            placeholder="e.g. PROUDLY PRESENTED TO"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Top Badge Text</label>
                          <input
                            type="text"
                            value={certTemplate.badgeText}
                            onChange={(e) => setCertTemplate(p => ({ ...p, badgeText: e.target.value }))}
                            className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3.5 text-xs text-white focus:outline-none focus:border-amber-400 font-bold"
                            placeholder="e.g. VERIFIED FUNDED TRADER"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Status Intro Line</label>
                          <input
                            type="text"
                            value={certTemplate.statusIntro || ''}
                            onChange={(e) => setCertTemplate(p => ({ ...p, statusIntro: e.target.value }))}
                            className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3.5 text-xs text-white focus:outline-none focus:border-amber-400"
                            placeholder="e.g. HAS OFFICIALLY ACHIEVED"
                          />
                        </div>

                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Status Title</label>
                          <input
                            type="text"
                            value={certTemplate.statusTitle || ''}
                            onChange={(e) => setCertTemplate(p => ({ ...p, statusTitle: e.target.value }))}
                            className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3.5 text-xs text-white focus:outline-none focus:border-amber-400 font-bold text-amber-400"
                            placeholder="e.g. FUNDED TRADER STATUS"
                          />
                        </div>
                      </div>

                      {/* Custom Message Field with Dynamic Variable Tokens */}
                      <div className="space-y-2 bg-black/20 p-4 rounded-2xl border border-white/5">
                        <div className="flex justify-between items-center">
                          <label className="text-[10px] font-bold text-amber-400 uppercase tracking-wider block">
                            Custom Certificate Body Text
                          </label>
                          <span className="text-[10px] text-slate-400">Click variable tag to insert:</span>
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                          {['{USER_NAME}', '{ACCOUNT_SIZE}', '{PHASE}', '{DATE}', '{CERTIFICATE_ID}'].map((token) => (
                            <button
                              key={token}
                              type="button"
                              onClick={() => setCertTemplate(p => ({ ...p, customMessage: p.customMessage + ' ' + token }))}
                              className="px-2.5 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded-lg text-[10px] font-mono font-bold transition-all cursor-pointer"
                            >
                              + {token}
                            </button>
                          ))}
                        </div>

                        <textarea
                          rows={4}
                          value={certTemplate.customMessage}
                          onChange={(e) => setCertTemplate(p => ({ ...p, customMessage: e.target.value }))}
                          className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-400 leading-relaxed font-sans"
                          placeholder="e.g. For successfully passing {PHASE} evaluation on a {ACCOUNT_SIZE} account."
                        />
                      </div>

                      {/* Signatories & Team Details */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-black/20 p-4 rounded-2xl border border-white/5">
                        {/* CEO Section */}
                        <div className="space-y-2">
                          <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider block">Signatory 1 (CEO / Founder)</span>
                          <input
                            type="text"
                            value={certTemplate.ceoName}
                            onChange={(e) => setCertTemplate(p => ({ ...p, ceoName: e.target.value }))}
                            className="w-full h-9 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-amber-400"
                            placeholder="Name (e.g. Asjad Khan)"
                          />
                          <input
                            type="text"
                            value={certTemplate.ceoTitle}
                            onChange={(e) => setCertTemplate(p => ({ ...p, ceoTitle: e.target.value }))}
                            className="w-full h-9 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-amber-400"
                            placeholder="Title (e.g. CEO & FOUNDER)"
                          />
                        </div>

                        {/* Risk Team Section */}
                        <div className="space-y-2">
                          <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider block">Signatory 2 (Risk Management)</span>
                          <input
                            type="text"
                            value={certTemplate.riskTeamName || ''}
                            onChange={(e) => setCertTemplate(p => ({ ...p, riskTeamName: e.target.value }))}
                            className="w-full h-9 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-amber-400"
                            placeholder="Name (e.g. Risk Management Team)"
                          />
                          <input
                            type="text"
                            value={certTemplate.riskTeamTitle || ''}
                            onChange={(e) => setCertTemplate(p => ({ ...p, riskTeamTitle: e.target.value }))}
                            className="w-full h-9 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-amber-400"
                            placeholder="Title (e.g. HEAD OF RISK)"
                          />
                        </div>
                      </div>

                      {/* Golden Seal Texts */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-black/20 p-4 rounded-2xl border border-white/5">
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-amber-400 uppercase tracking-wider block">Seal Top Text</label>
                          <input
                            type="text"
                            value={certTemplate.sealText1 || ''}
                            onChange={(e) => setCertTemplate(p => ({ ...p, sealText1: e.target.value }))}
                            className="w-full h-9 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-amber-400 font-mono text-[11px]"
                            placeholder="e.g. ATFUNDING"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-amber-400 uppercase tracking-wider block">Seal Center Text</label>
                          <input
                            type="text"
                            value={certTemplate.sealText2 || ''}
                            onChange={(e) => setCertTemplate(p => ({ ...p, sealText2: e.target.value }))}
                            className="w-full h-9 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-amber-400 font-mono text-[11px]"
                            placeholder="e.g. OFFICIAL"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[10px] font-bold text-amber-400 uppercase tracking-wider block">Seal Bottom Text</label>
                          <input
                            type="text"
                            value={certTemplate.sealText3 || ''}
                            onChange={(e) => setCertTemplate(p => ({ ...p, sealText3: e.target.value }))}
                            className="w-full h-9 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-amber-400 font-mono text-[11px]"
                            placeholder="e.g. SEAL OF EXCELLENCE"
                          />
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Footer Message / Tagline</label>
                        <input
                          type="text"
                          value={certTemplate.footerMessage}
                          onChange={(e) => setCertTemplate(p => ({ ...p, footerMessage: e.target.value }))}
                          className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3.5 text-xs text-white focus:outline-none focus:border-amber-400"
                          placeholder="e.g. THANK YOU FOR TRUSTING ATFUNDING..."
                        />
                      </div>

                      <button
                        type="submit"
                        disabled={isSavingCertTemplate}
                        className="w-full h-11 bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold rounded-xl text-xs uppercase tracking-wider transition-all shadow-lg shadow-amber-500/20 cursor-pointer flex items-center justify-center gap-2 mt-4"
                      >
                        <Check className="w-4 h-4" />
                        <span>{isSavingCertTemplate ? 'Saving Changes...' : 'Save Template to Firestore'}</span>
                      </button>
                    </form>
                  </div>

                  {/* Live Template Visual Preview */}
                  <div className="space-y-4">
                    <div className="flex justify-between items-center bg-white/5 border border-white/10 rounded-2xl px-5 py-3">
                      <div className="flex items-center space-x-2">
                        <Sparkles className="w-4 h-4 text-amber-400" />
                        <span className="text-xs font-bold text-white uppercase tracking-wider">Template Live Canvas Preview</span>
                      </div>
                      <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full font-bold">
                        Auto Updates
                      </span>
                    </div>

                    <LuxuryCertificate
                      certificate={{
                        id: 'ATF-2026-001',
                        certificateId: 'ATF-2026-001',
                        userId: 'demo',
                        userName: certUserName || 'Asjad Khan',
                        name: certUserName || 'Asjad Khan',
                        email: certEmail || 'trader@atfunding.io',
                        accountSize: certAccountSize || '$10,000',
                        phase: certPhase || 'Funded',
                        issueDate: certIssueDate || new Date().toISOString().split('T')[0],
                        date: certIssueDate || new Date().toISOString().split('T')[0],
                        createdAt: new Date().toISOString()
                      }}
                      template={certTemplate}
                      containerRef={certModalRef}
                    />
                  </div>
                </div>
              )}

              {/* Full Screen High-Res Live Certificate Preview Modal */}
              {previewCertModal && (
                <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 overflow-y-auto backdrop-blur-md">
                  <div className="relative w-full max-w-4xl space-y-4 my-8">
                    {/* Modal Control Bar */}
                    <div className="flex justify-between items-center bg-slate-900 border border-white/10 rounded-2xl px-5 py-3">
                      <div className="flex items-center space-x-2 text-white font-bold text-xs">
                        <Award className="w-4 h-4 text-amber-400" />
                        <span>Certificate #{previewCertModal.certificateId || previewCertModal.id}</span>
                      </div>

                      <div className="flex items-center space-x-2">
                        <button
                          type="button"
                          disabled={isDownloadingPdf}
                          onClick={() => handleDownloadCertPdf(certModalRef, `ATFunding_Certificate_${previewCertModal.certificateId || previewCertModal.id}`)}
                          className="flex items-center space-x-1.5 px-3.5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs font-extrabold transition-all cursor-pointer shadow-lg shadow-amber-500/20"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>{isDownloadingPdf ? 'Generating PDF...' : 'Download PDF'}</span>
                        </button>

                        <button
                          type="button"
                          disabled={isSendingCertEmail}
                          onClick={() => handleSendCertEmail(previewCertModal)}
                          className="flex items-center space-x-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-lg shadow-blue-600/20"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>{isSendingCertEmail ? 'Sending...' : 'Send to Email'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setPreviewCertModal(null)}
                          className="p-2 text-slate-400 hover:text-white rounded-xl bg-white/5 hover:bg-white/10 transition-colors"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                    </div>

                    {/* Certificate Card Node */}
                    <LuxuryCertificate
                      certificate={previewCertModal}
                      template={certTemplate}
                      containerRef={certModalRef}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB: UNIVERSAL SEARCH */}
          {activeTab === 'search' && (
            <div className="space-y-6 animate-fade-in">
              <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-sm shadow-xl space-y-5">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-5">
                  <div>
                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                      <Search className="w-5 h-5 text-blue-400" />
                      <span>Universal System Search</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Search instantly by Transaction ID, Crypto Tx Hash, User UID, Name, Email, Phone, Account ID, or Wallet Address.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => setGlobalSearchCategory('all')}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        globalSearchCategory === 'all'
                          ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                          : 'bg-white/5 text-slate-400 hover:text-white border border-white/10'
                      }`}
                    >
                      All ({searchResultsTotalCount})
                    </button>
                    <button
                      onClick={() => setGlobalSearchCategory('users')}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        globalSearchCategory === 'users'
                          ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                          : 'bg-white/5 text-slate-400 hover:text-white border border-white/10'
                      }`}
                    >
                      Users ({matchedSearchUsers.length})
                    </button>
                    <button
                      onClick={() => setGlobalSearchCategory('accounts')}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        globalSearchCategory === 'accounts'
                          ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                          : 'bg-white/5 text-slate-400 hover:text-white border border-white/10'
                      }`}
                    >
                      Accounts ({matchedSearchAccounts.length})
                    </button>
                    <button
                      onClick={() => setGlobalSearchCategory('transactions')}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        globalSearchCategory === 'transactions'
                          ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                          : 'bg-white/5 text-slate-400 hover:text-white border border-white/10'
                      }`}
                    >
                      Transactions & Orders ({matchedSearchOrders.length})
                    </button>
                    <button
                      onClick={() => setGlobalSearchCategory('payouts')}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                        globalSearchCategory === 'payouts'
                          ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/20'
                          : 'bg-white/5 text-slate-400 hover:text-white border border-white/10'
                      }`}
                    >
                      Payouts ({matchedSearchPayouts.length})
                    </button>
                  </div>
                </div>

                {/* Big Search Input */}
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-blue-400" />
                  <input
                    type="text"
                    placeholder="Enter Transaction ID, Hash, User UID, Name, Email, Account ID, Phone..."
                    value={globalSearchQuery}
                    onChange={(e) => setGlobalSearchQuery(e.target.value)}
                    className="w-full h-12 bg-black/50 border-2 border-blue-500/40 rounded-2xl pl-12 pr-10 text-sm text-white placeholder-slate-400 focus:outline-none focus:border-blue-400 shadow-inner"
                    autoFocus
                  />
                  {globalSearchQuery && (
                    <button
                      onClick={() => setGlobalSearchQuery('')}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  )}
                </div>

                {!searchQueryClean && (
                  <div className="py-12 text-center space-y-3 bg-black/20 rounded-2xl border border-dashed border-white/10">
                    <Search className="w-10 h-10 text-slate-600 mx-auto animate-pulse" />
                    <p className="text-sm font-semibold text-slate-300">Type anything in the search bar above to query across all users, orders, transactions, and accounts.</p>
                    <div className="flex flex-wrap justify-center gap-2 pt-2 text-[11px] text-slate-500">
                      <span className="bg-white/5 px-2.5 py-1 rounded-lg border border-white/5">Tx Hash e.g. 0x7a8...</span>
                      <span className="bg-white/5 px-2.5 py-1 rounded-lg border border-white/5">Order ID e.g. ORD-10928</span>
                      <span className="bg-white/5 px-2.5 py-1 rounded-lg border border-white/5">UID e.g. usr_82910</span>
                      <span className="bg-white/5 px-2.5 py-1 rounded-lg border border-white/5">User Name / Email</span>
                    </div>
                  </div>
                )}

                {searchQueryClean && searchResultsTotalCount === 0 && (
                  <div className="py-12 text-center space-y-3 bg-black/20 rounded-2xl border border-white/10">
                    <AlertCircle className="w-10 h-10 text-amber-400 mx-auto" />
                    <p className="text-sm font-bold text-white">No matches found for "{globalSearchQuery}"</p>
                    <p className="text-xs text-slate-400">Double check spelling, Transaction ID, Tx Hash, or UID.</p>
                  </div>
                )}

                {/* SEARCH RESULTS DISPLAY */}
                {searchQueryClean && searchResultsTotalCount > 0 && (
                  <div className="space-y-8 pt-2">
                    {/* 1. MATCHED USERS */}
                    {(globalSearchCategory === 'all' || globalSearchCategory === 'users') && matchedSearchUsers.length > 0 && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between border-b border-white/10 pb-2">
                          <h4 className="text-sm font-bold text-blue-400 flex items-center gap-2 uppercase tracking-wider font-mono">
                            <Users className="w-4 h-4" />
                            <span>Matched Users ({matchedSearchUsers.length})</span>
                          </h4>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {matchedSearchUsers.map((u) => (
                            <div key={u.uid} className="bg-black/30 border border-white/10 hover:border-blue-500/40 rounded-2xl p-4 transition-all shadow-lg space-y-3">
                              <div className="flex items-start justify-between">
                                <div>
                                  <p className="text-sm font-bold text-white">{u.displayName || u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Trader'}</p>
                                  <p className="text-xs text-blue-400 font-mono">{u.email}</p>
                                  {u.username && <p className="text-[11px] text-slate-400">@{u.username}</p>}
                                </div>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                                  u.role === 'admin' ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                                }`}>
                                  {u.role || 'Trader'}
                                </span>
                              </div>

                              <div className="text-[11px] space-y-1 bg-black/40 p-2.5 rounded-xl font-mono text-slate-300">
                                <p><span className="text-slate-500">UID:</span> <span className="text-amber-300 font-bold select-all">{u.uid}</span></p>
                                {u.phone || u.phoneNumber ? <p><span className="text-slate-500">Phone:</span> {u.phone || u.phoneNumber}</p> : null}
                                {u.country && <p><span className="text-slate-500">Country:</span> {u.country}</p>}
                              </div>

                              <div className="flex items-center gap-2 pt-1">
                                <button
                                  onClick={() => setSelectedUserForDetails(u)}
                                  className="flex-1 py-1.5 px-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>View User Details</span>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 2. MATCHED ORDERS & TRANSACTIONS */}
                    {(globalSearchCategory === 'all' || globalSearchCategory === 'transactions') && matchedSearchOrders.length > 0 && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between border-b border-white/10 pb-2">
                          <h4 className="text-sm font-bold text-emerald-400 flex items-center gap-2 uppercase tracking-wider font-mono">
                            <Coins className="w-4 h-4" />
                            <span>Matched Orders & Transactions ({matchedSearchOrders.length})</span>
                          </h4>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {matchedSearchOrders.map((o) => (
                            <div key={o.orderId} className="bg-black/30 border border-white/10 hover:border-emerald-500/40 rounded-2xl p-4 transition-all shadow-lg space-y-3">
                              <div className="flex items-start justify-between">
                                <div>
                                  <p className="text-xs font-bold text-slate-400 font-mono">ORDER #{o.orderId}</p>
                                  <p className="text-sm font-bold text-white">{o.firstName} {o.lastName}</p>
                                  <p className="text-xs text-blue-400 font-mono">{o.email}</p>
                                </div>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                                  o.status === 'Approved' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
                                  o.status === 'Rejected' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                }`}>
                                  {o.status}
                                </span>
                              </div>

                              <div className="text-[11px] space-y-1 bg-black/40 p-2.5 rounded-xl font-mono text-slate-300">
                                <p><span className="text-slate-500">Amount:</span> <span className="text-emerald-400 font-bold">${o.finalPrice || o.price}</span> ({o.accountSize})</p>
                                <p><span className="text-slate-500">Method:</span> {o.paymentMethod || 'Crypto'}</p>
                                {o.transactionHash && (
                                  <p className="truncate"><span className="text-slate-500">Tx Hash:</span> <span className="text-amber-300 font-mono select-all">{o.transactionHash}</span></p>
                                )}
                                {(o as any).transactionId && (
                                  <p className="truncate"><span className="text-slate-500">Tx ID:</span> <span className="text-amber-300 font-mono select-all">{(o as any).transactionId}</span></p>
                                )}
                                <p><span className="text-slate-500">User UID:</span> <span className="text-slate-300 select-all">{o.userId}</span></p>
                              </div>

                              <div className="flex items-center gap-2 pt-1">
                                <button
                                  onClick={() => setSelectedOrderForModal(o)}
                                  className="flex-1 py-1.5 px-3 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>Review Payment Details</span>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 3. MATCHED TRADING ACCOUNTS */}
                    {(globalSearchCategory === 'all' || globalSearchCategory === 'accounts') && matchedSearchAccounts.length > 0 && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between border-b border-white/10 pb-2">
                          <h4 className="text-sm font-bold text-amber-400 flex items-center gap-2 uppercase tracking-wider font-mono">
                            <Gift className="w-4 h-4" />
                            <span>Matched Trading Accounts ({matchedSearchAccounts.length})</span>
                          </h4>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {matchedSearchAccounts.map((a) => (
                            <div key={a.id} className="bg-black/30 border border-white/10 hover:border-amber-500/40 rounded-2xl p-4 transition-all shadow-lg space-y-3">
                              <div className="flex items-start justify-between">
                                <div>
                                  <p className="text-xs font-bold text-slate-400 font-mono">ACCOUNT ID: {a.id}</p>
                                  <p className="text-sm font-bold text-white">Login: {a.login || 'Pending'}</p>
                                  <p className="text-xs text-blue-400 font-mono">{a.userEmail}</p>
                                </div>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                                  a.status === 'Active' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
                                  a.status === 'Passed' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' : 'bg-slate-500/20 text-slate-300 border border-slate-500/30'
                                }`}>
                                  {a.status}
                                </span>
                              </div>

                              <div className="text-[11px] space-y-1 bg-black/40 p-2.5 rounded-xl font-mono text-slate-300">
                                <p><span className="text-slate-500">Balance / Size:</span> <span className="text-emerald-400 font-bold">${a.balance || a.size}</span></p>
                                <p><span className="text-slate-500">Type:</span> {a.accountType?.replace('_', ' ')}</p>
                                <p><span className="text-slate-500">User UID:</span> <span className="text-slate-300 select-all">{a.userId}</span></p>
                                {a.server && <p><span className="text-slate-500">Server:</span> {a.server}</p>}
                              </div>

                              <div className="flex items-center gap-2 pt-1">
                                <button
                                  onClick={() => {
                                    setActiveTab('accounts');
                                  }}
                                  className="flex-1 py-1.5 px-3 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>Manage Accounts Panel</span>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* 4. MATCHED PAYOUTS */}
                    {(globalSearchCategory === 'all' || globalSearchCategory === 'payouts') && matchedSearchPayouts.length > 0 && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between border-b border-white/10 pb-2">
                          <h4 className="text-sm font-bold text-purple-400 flex items-center gap-2 uppercase tracking-wider font-mono">
                            <DollarSign className="w-4 h-4" />
                            <span>Matched Payout Requests ({matchedSearchPayouts.length})</span>
                          </h4>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                          {matchedSearchPayouts.map((p) => (
                            <div key={p.id} className="bg-black/30 border border-white/10 hover:border-purple-500/40 rounded-2xl p-4 transition-all shadow-lg space-y-3">
                              <div className="flex items-start justify-between">
                                <div>
                                  <p className="text-xs font-bold text-slate-400 font-mono">PAYOUT #{p.id}</p>
                                  <p className="text-sm font-bold text-white">{p.userEmail}</p>
                                  <p className="text-xs text-purple-400 font-mono font-bold">${p.amount}</p>
                                </div>
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${
                                  p.status === 'approved' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' :
                                  p.status === 'rejected' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                                }`}>
                                  {p.status}
                                </span>
                              </div>

                              <div className="text-[11px] space-y-1 bg-black/40 p-2.5 rounded-xl font-mono text-slate-300">
                                <p><span className="text-slate-500">Method:</span> {p.payoutMethod}</p>
                                <p className="truncate"><span className="text-slate-500">Address:</span> <span className="text-amber-300 select-all">{p.payoutAddress}</span></p>
                                <p><span className="text-slate-500">User UID:</span> <span className="text-slate-300 select-all">{p.userId}</span></p>
                                <p><span className="text-slate-500">Account ID:</span> <span className="text-slate-300">{p.accountId}</span></p>
                              </div>

                              <div className="flex items-center gap-2 pt-1">
                                <button
                                  onClick={() => setActiveTab('payouts')}
                                  className="flex-1 py-1.5 px-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-xs font-semibold transition-colors flex items-center justify-center gap-1.5"
                                >
                                  <Eye className="w-3.5 h-3.5" />
                                  <span>View in Payouts Tab</span>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
          {activeTab === 'users' && (
            <div className="space-y-6 animate-fade-in">
              {/* Header Statistics Card or Filter row */}
              <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-sm shadow-xl space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                      <Users className="w-5 h-5 text-blue-500" />
                      <span>Traders Center</span>
                    </h3>
                    <p className="text-xs text-slate-400">
                      View, search, and manage registered proprietary traders in real-time.
                    </p>
                  </div>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative">
                      <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input
                        type="text"
                        placeholder="Search Name or Email..."
                        value={userSearch}
                        onChange={(e) => setUserSearch(e.target.value)}
                        className="h-10 w-full sm:w-64 bg-black/30 border border-white/10 rounded-xl pl-10 pr-4 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                    <select
                      value={userStatusFilter}
                      onChange={(e) => setUserStatusFilter(e.target.value)}
                      className="h-10 bg-black/30 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="All">All Statuses</option>
                      <option value="active">Active Traders</option>
                      <option value="suspended">Suspended Traders</option>
                      <option value="admin">Administrator Role</option>
                    </select>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead>
                      <tr className="border-b border-white/10 font-mono uppercase text-slate-400 pb-3">
                        <th className="py-3">Full Name & Username</th>
                        <th className="py-3">Email Address</th>
                        <th className="py-3">Phone Number</th>
                        <th className="py-3">Country</th>
                        <th className="py-3">Registration Date</th>
                        <th className="py-3">Status</th>
                        <th className="py-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10 font-medium">
                      {users
                        .filter((u) => {
                          const queryLower = userSearch.toLowerCase();
                          const matchesSearch = 
                            u.displayName?.toLowerCase().includes(queryLower) ||
                            u.name?.toLowerCase().includes(queryLower) ||
                            u.username?.toLowerCase().includes(queryLower) ||
                            u.email?.toLowerCase().includes(queryLower) ||
                            u.phone?.toLowerCase().includes(queryLower) ||
                            u.phoneNumber?.toLowerCase().includes(queryLower) ||
                            u.country?.toLowerCase().includes(queryLower) ||
                            u.uid?.toLowerCase().includes(queryLower);
                          
                          if (userStatusFilter === 'All') return matchesSearch;
                          if (userStatusFilter === 'active') return matchesSearch && (u.status || 'active') === 'active';
                          if (userStatusFilter === 'suspended') return matchesSearch && u.status === 'suspended';
                          if (userStatusFilter === 'admin') return matchesSearch && u.role === 'admin';
                          return matchesSearch;
                        })
                        .map((u) => {
                          const userAccounts = accounts.filter(a => a.userId === u.uid);
                          const fullName = u.displayName || u.name || (u.firstName ? `${u.firstName} ${u.lastName || ''}`.trim() : 'Unnamed Trader');
                          const phoneDisplay = u.phoneNumber || u.phone || 'N/A';
                          return (
                            <tr key={u.uid} className="hover:bg-white/[0.02] transition-colors">
                              <td className="py-3.5">
                                <div className="flex flex-col">
                                  <span className="text-white font-bold text-sm">{fullName}</span>
                                  {u.username && (
                                    <span className="text-blue-400 font-mono text-xs mt-0.5">@{u.username}</span>
                                  )}
                                  <span className="text-[10px] font-mono text-slate-600 mt-0.5 uppercase">UID: {u.uid}</span>
                                </div>
                              </td>
                              <td className="py-3.5">
                                <span className="text-slate-200 font-mono text-xs">{u.email}</span>
                              </td>
                              <td className="py-3.5">
                                <span className="text-slate-300 font-mono text-xs">{phoneDisplay}</span>
                              </td>
                              <td className="py-3.5">
                                <span className="text-slate-300 font-medium text-xs">{u.country || 'N/A'}</span>
                              </td>
                              <td className="py-3.5">
                                <span className="text-slate-400 font-mono text-xs">
                                  {u.createdAt ? new Date(u.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : 'N/A'}
                                </span>
                              </td>
                              <td className="py-3.5">
                                <div className="flex flex-col gap-1 items-start">
                                  <span className={`px-2 py-0.5 rounded-full font-mono text-[10px] font-bold uppercase ${
                                    u.status === 'suspended' 
                                      ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' 
                                      : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                  }`}>
                                    {u.status === 'suspended' ? 'Suspended' : 'Active'}
                                  </span>
                                  <span className="text-[10px] text-slate-500 font-mono">
                                    {userAccounts.length} {userAccounts.length === 1 ? 'Account' : 'Accounts'}
                                  </span>
                                </div>
                              </td>
                              <td className="py-3.5 text-right space-x-1.5 whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => setSelectedUserForDetails(u)}
                                  className="px-3 py-1.5 bg-white/5 hover:bg-white/10 text-white font-bold rounded-xl text-[10px] transition-colors border border-white/10"
                                >
                                  View Details
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleToggleUserStatus(u.uid, u.status || 'active')}
                                  className={`px-3 py-1.5 rounded-xl text-[10px] font-bold transition-all ${
                                    u.status === 'suspended'
                                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                                      : 'bg-rose-600/20 hover:bg-rose-600 text-rose-300 hover:text-white border border-rose-500/20'
                                  }`}
                                >
                                  {u.status === 'suspended' ? 'Activate' : 'Suspend'}
                                </button>
                                {u.role !== 'admin' ? (
                                  <button
                                    type="button"
                                    onClick={() => handlePromoteAdmin(u.uid)}
                                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-[10px] transition-colors"
                                  >
                                    Promote Admin
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      await updateDoc(doc(db, 'users', u.uid), { role: 'trader' });
                                    }}
                                    className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 font-bold rounded-xl text-[10px] transition-colors"
                                  >
                                    Demote
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TRADER DETAILS MODAL */}
          {selectedUserForDetails && (() => {
            const u = selectedUserForDetails;
            const uAccounts = accounts.filter(a => a.userId === u.uid);
            const uActiveAccounts = uAccounts.filter(a => a.status === 'active');
            const uBreachedAccounts = uAccounts.filter(a => a.status === 'breached');
            const uPayouts = payouts.filter(p => p.userId === u.uid || p.userEmail === u.email);
            const uOrders = orders.filter(o => o.email === u.email);
            const uTrades = trades.filter(t => t.userId === u.uid || uAccounts.some(a => a.id === t.accountId || a.login === t.accountId));

            return (
              <div className="fixed inset-0 z-50 overflow-y-auto bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
                <div className="bg-slate-950 border border-white/10 w-full max-w-4xl rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
                  {/* Header */}
                  <div className="p-6 border-b border-white/10 bg-white/5 flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-black text-white uppercase tracking-wider flex items-center gap-2">
                        <Users className="w-5 h-5 text-blue-400" />
                        <span>Trader Profile Details</span>
                      </h4>
                      <p className="text-[10px] text-slate-500 font-mono mt-0.5">UID: {u.uid}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedUserForDetails(null)}
                      className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white flex items-center justify-center transition-colors border border-white/10"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Body */}
                  <div className="p-6 overflow-y-auto space-y-6">
                    {/* Basic Info */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                      <div className="bg-white/5 p-4 border border-white/5 rounded-2xl space-y-2">
                        <p className="text-[9px] uppercase font-bold text-slate-400 font-mono tracking-widest">Personal Info</p>
                        <div>
                          <p className="text-[10px] text-slate-500 font-semibold uppercase">Full Name</p>
                          <p className="text-xs text-white font-bold">{u.displayName || u.name || 'N/A'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-500 font-semibold uppercase">Email Address</p>
                          <p className="text-xs text-white font-mono font-bold break-all">{u.email}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-500 font-semibold uppercase">Phone Number</p>
                          <p className="text-xs text-white font-mono">{u.phone || 'N/A'}</p>
                        </div>
                      </div>

                      <div className="bg-white/5 p-4 border border-white/5 rounded-2xl space-y-2">
                        <p className="text-[9px] uppercase font-bold text-slate-400 font-mono tracking-widest">Location & Registration</p>
                        <div>
                          <p className="text-[10px] text-slate-500 font-semibold uppercase">Country</p>
                          <p className="text-xs text-white font-bold">{u.country || 'N/A'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-500 font-semibold uppercase">City</p>
                          <p className="text-xs text-white font-bold">{u.city || 'N/A'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-500 font-semibold uppercase">Registration Date</p>
                          <p className="text-xs text-white font-mono">
                            {u.createdAt ? new Date(u.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'N/A'}
                          </p>
                        </div>
                      </div>

                      <div className="bg-white/5 p-4 border border-white/5 rounded-2xl space-y-2">
                        <p className="text-[9px] uppercase font-bold text-slate-400 font-mono tracking-widest">Status & Access Control</p>
                        <div>
                          <p className="text-[10px] text-slate-500 font-semibold uppercase">KYC Status</p>
                          <div className="flex items-center gap-1.5 mt-1">
                            <span className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase ${
                              (u.kycStatus || 'unverified') === 'approved' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/10' :
                              (u.kycStatus || 'unverified') === 'pending' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/10' :
                              'bg-slate-500/10 text-slate-400 border border-white/5'
                            }`}>
                              {u.kycStatus || 'unverified'}
                            </span>
                            <select
                              value={u.kycStatus || 'unverified'}
                              onChange={async (e) => {
                                const newKyc = e.target.value;
                                await updateDoc(doc(db, 'users', u.uid), { kycStatus: newKyc });
                                setSelectedUserForDetails({ ...u, kycStatus: newKyc });
                              }}
                              className="bg-black/60 border border-white/10 rounded px-1.5 py-0.5 text-[10px] text-white focus:outline-none focus:border-blue-500"
                            >
                              <option value="unverified">Unverified</option>
                              <option value="pending">Pending</option>
                              <option value="approved">Approved</option>
                              <option value="rejected">Rejected</option>
                            </select>
                          </div>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-500 font-semibold uppercase">Account Status</p>
                          <p className={`text-xs font-bold font-mono mt-0.5 capitalize ${u.status === 'suspended' ? 'text-rose-400' : 'text-emerald-400'}`}>
                            {u.status || 'Active'}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-slate-500 font-semibold uppercase">Privilege Role</p>
                          <p className="text-xs text-blue-400 font-bold uppercase font-mono">{u.role}</p>
                        </div>
                      </div>
                    </div>

                    {/* KYC Document Audit Section */}
                    <div className="bg-white/5 border border-white/5 rounded-2xl p-5 space-y-4">
                      <div className="flex justify-between items-center border-b border-white/5 pb-2">
                        <h5 className="text-[11px] font-black text-white uppercase tracking-wider font-mono flex items-center gap-2">
                          <LucideIcons.ShieldAlert className="w-4 h-4 text-blue-400" />
                          <span>KYC Document Audit Panel</span>
                        </h5>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                          (u.kycStatus || 'unverified') === 'approved' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/15' :
                          (u.kycStatus || 'unverified') === 'pending' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/15' :
                          (u.kycStatus || 'unverified') === 'rejected' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/15' :
                          'bg-slate-500/10 text-slate-400 border border-white/5'
                        }`}>
                          {u.kycStatus || 'unverified'}
                        </span>
                      </div>

                      {u.kycDocuments ? (
                        <div className="space-y-4">
                          <div className="text-xs text-slate-400">
                            <strong>Selected Document Type:</strong> <span className="text-white font-bold">{u.kycDocuments.documentType || (u.kycDocuments.passport ? 'Passport' : u.kycDocuments.idCard ? 'National ID Card' : 'Unspecified')}</span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            {/* Front Image */}
                            <div className="bg-black/30 border border-white/5 rounded-xl p-3 flex flex-col justify-between h-56">
                              <div>
                                <p className="text-[10px] text-slate-500 uppercase font-semibold">Document Front</p>
                                <p className="text-[11px] text-white mt-1 font-medium truncate">
                                  {u.kycDocuments.docFront || u.kycDocuments.passport || u.kycDocuments.idCard ? "Image Uploaded" : "Not Provided"}
                                </p>
                              </div>
                              {(u.kycDocuments.docFront || u.kycDocuments.passport || u.kycDocuments.idCard) ? (
                                <div className="space-y-2 mt-2">
                                  <button 
                                    type="button"
                                    onClick={() => setLightboxImage({ 
                                      src: u.kycDocuments.docFront || u.kycDocuments.passport || u.kycDocuments.idCard || "", 
                                      title: `${u.displayName || u.name || "User"}'s Document Front` 
                                    })}
                                    className="text-[10px] text-blue-400 hover:underline flex items-center gap-1 mt-1"
                                  >
                                    <ImageIcon className="w-3 h-3" />
                                    <span>Inspect Front (Fullscreen) ↗</span>
                                  </button>
                                  <img 
                                    src={u.kycDocuments.docFront || u.kycDocuments.passport || u.kycDocuments.idCard} 
                                    alt="Doc Front" 
                                    onClick={() => setLightboxImage({ 
                                      src: u.kycDocuments.docFront || u.kycDocuments.passport || u.kycDocuments.idCard || "", 
                                      title: `${u.displayName || u.name || "User"}'s Document Front` 
                                    })}
                                    className="h-28 w-full object-contain bg-slate-950/60 p-1 rounded-lg border border-white/10 hover:scale-[1.03] transition-all duration-200 cursor-zoom-in"
                                    referrerPolicy="no-referrer"
                                  />
                                </div>
                              ) : (
                                <span className="text-[10px] text-slate-600">Not Uploaded</span>
                              )}
                            </div>

                            {/* Back Image */}
                            <div className="bg-black/30 border border-white/5 rounded-xl p-3 flex flex-col justify-between h-56">
                              <div>
                                <p className="text-[10px] text-slate-500 uppercase font-semibold">Document Back</p>
                                <p className="text-[11px] text-white mt-1 font-medium truncate">
                                  {u.kycDocuments.docBack ? "Image Uploaded" : (u.kycDocuments.documentType === 'Passport' ? 'Not Required (Passport)' : 'Not Provided')}
                                </p>
                              </div>
                              {u.kycDocuments.docBack ? (
                                <div className="space-y-2 mt-2">
                                  <button 
                                    type="button"
                                    onClick={() => setLightboxImage({ 
                                      src: u.kycDocuments.docBack || "", 
                                      title: `${u.displayName || u.name || "User"}'s Document Back` 
                                    })}
                                    className="text-[10px] text-blue-400 hover:underline flex items-center gap-1 mt-1"
                                  >
                                    <ImageIcon className="w-3 h-3" />
                                    <span>Inspect Back (Fullscreen) ↗</span>
                                  </button>
                                  <img 
                                    src={u.kycDocuments.docBack} 
                                    alt="Doc Back" 
                                    onClick={() => setLightboxImage({ 
                                      src: u.kycDocuments.docBack || "", 
                                      title: `${u.displayName || u.name || "User"}'s Document Back` 
                                    })}
                                    className="h-28 w-full object-contain bg-slate-950/60 p-1 rounded-lg border border-white/10 hover:scale-[1.03] transition-all duration-200 cursor-zoom-in"
                                    referrerPolicy="no-referrer"
                                  />
                                </div>
                              ) : (
                                <span className="text-[10px] text-slate-600">Not Uploaded</span>
                              )}
                            </div>

                            {/* Selfie Image */}
                            <div className="bg-black/30 border border-white/5 rounded-xl p-3 flex flex-col justify-between h-56">
                              <div>
                                <p className="text-[10px] text-slate-500 uppercase font-semibold">Face Selfie</p>
                                <p className="text-[11px] text-white mt-1 font-medium truncate">
                                  {u.kycDocuments.selfie ? "Selfie Uploaded" : "Not Provided"}
                                </p>
                              </div>
                              {u.kycDocuments.selfie ? (
                                <div className="space-y-2 mt-2">
                                  <button 
                                    type="button"
                                    onClick={() => setLightboxImage({ 
                                      src: u.kycDocuments.selfie || "", 
                                      title: `${u.displayName || u.name || "User"}'s Face Selfie` 
                                    })}
                                    className="text-[10px] text-blue-400 hover:underline flex items-center gap-1 mt-1"
                                  >
                                    <ImageIcon className="w-3 h-3" />
                                    <span>Inspect Selfie (Fullscreen) ↗</span>
                                  </button>
                                  <img 
                                    src={u.kycDocuments.selfie} 
                                    alt="Selfie" 
                                    onClick={() => setLightboxImage({ 
                                      src: u.kycDocuments.selfie || "", 
                                      title: `${u.displayName || u.name || "User"}'s Face Selfie` 
                                    })}
                                    className="h-28 w-full object-contain bg-slate-950/60 p-1 rounded-lg border border-white/10 hover:scale-[1.03] transition-all duration-200 cursor-zoom-in"
                                    referrerPolicy="no-referrer"
                                  />
                                </div>
                              ) : (
                                <span className="text-[10px] text-slate-600">Not Uploaded</span>
                              )}
                            </div>
                          </div>

                          {/* Quick Decision Actions */}
                          <div className="flex gap-3 pt-2">
                            <button
                              type="button"
                              onClick={async () => {
                                await updateDoc(doc(db, 'users', u.uid), { kycStatus: 'approved' });
                                setSelectedUserForDetails({ ...u, kycStatus: 'approved' });
                              }}
                              className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-[10px] uppercase tracking-wider transition-colors"
                            >
                              Approve KYC Compliance
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                const reason = window.prompt("Reason for rejection:") || "Documents unclear or do not match.";
                                await updateDoc(doc(db, 'users', u.uid), { kycStatus: 'rejected', kycRejectionReason: reason });
                                setSelectedUserForDetails({ ...u, kycStatus: 'rejected' });
                              }}
                              className="flex-1 py-2.5 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-[10px] uppercase tracking-wider transition-colors"
                            >
                              Reject KYC Compliance
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500 py-2">No KYC documents have been uploaded by this user yet.</p>
                      )}
                    </div>

                    {/* Proprietary Trading Accounts (Purchased, Active, Breached) */}
                    <div className="space-y-3">
                      <h5 className="text-[11px] font-black text-white uppercase tracking-wider font-mono">Proprietary Trading Accounts ({uAccounts.length})</h5>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Active & Evaluation Accounts */}
                        <div className="bg-black/30 border border-white/5 p-4 rounded-2xl space-y-3">
                          <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider font-mono">Active Accounts ({uActiveAccounts.length})</p>
                          <div className="space-y-2 max-h-48 overflow-y-auto">
                            {uActiveAccounts.map(acc => (
                              <div key={acc.id} className="p-2.5 bg-white/5 border border-white/5 rounded-xl text-xs flex justify-between items-center gap-2">
                                <div>
                                  <p className="font-bold text-white font-mono flex items-center gap-1.5">
                                    <span>#{acc.login || acc.id}</span>
                                  </p>
                                  <p className="text-[10px] text-slate-400 capitalize">{acc.accountType.replace('_', ' ')} (${acc.size.toLocaleString()})</p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <div className="text-right">
                                    <p className="font-bold font-mono text-emerald-400">${acc.balance.toLocaleString()}</p>
                                    <p className="text-[9px] text-slate-500">Eq: ${acc.equity.toLocaleString()}</p>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setBreachingAccountModal(acc);
                                      setBreachReasonInput('Manual Admin Breach');
                                    }}
                                    title="Breach Account"
                                    className="px-2 py-1 bg-rose-600/20 hover:bg-rose-600 border border-rose-500/30 text-rose-300 hover:text-white rounded-lg text-[10px] font-bold uppercase transition-all shadow-sm"
                                  >
                                    Breach
                                  </button>
                                </div>
                              </div>
                            ))}
                            {uActiveAccounts.length === 0 && (
                              <p className="text-xs text-slate-500 text-center py-4">No active trading accounts.</p>
                            )}
                          </div>
                        </div>

                        {/* Breach History */}
                        <div className="bg-black/30 border border-white/5 p-4 rounded-2xl space-y-3">
                          <p className="text-[10px] font-bold text-rose-400 uppercase tracking-wider font-mono">Breach History ({uBreachedAccounts.length})</p>
                          <div className="space-y-2 max-h-40 overflow-y-auto">
                            {uBreachedAccounts.map(acc => (
                              <div key={acc.id} className="p-2.5 bg-white/5 border border-white/5 rounded-xl text-xs flex justify-between items-center">
                                <div>
                                  <p className="font-bold text-slate-400 font-mono">{acc.id}</p>
                                  <p className="text-[10px] text-slate-500 capitalize">{acc.accountType.replace('_', ' ')} (${acc.size.toLocaleString()})</p>
                                </div>
                                <div className="text-right">
                                  <span className="px-1.5 py-0.5 rounded text-[8px] font-mono font-bold bg-rose-500/10 text-rose-400">BREACHED</span>
                                  <p className="text-[10px] font-mono text-slate-500 mt-1">Bal: ${acc.balance.toLocaleString()}</p>
                                </div>
                              </div>
                            ))}
                            {uBreachedAccounts.length === 0 && (
                              <p className="text-xs text-slate-500 text-center py-4">No breached accounts.</p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Purchase & Checkout History */}
                    <div className="space-y-3">
                      <h5 className="text-[11px] font-black text-white uppercase tracking-wider font-mono">Purchase & Order History ({uOrders.length})</h5>
                      <div className="bg-black/40 border border-white/5 rounded-2xl overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs text-slate-300">
                            <thead>
                              <tr className="border-b border-white/5 bg-white/5 text-[9px] font-mono uppercase text-slate-400">
                                <th className="p-3">Order ID</th>
                                <th className="p-3">Challenge Type</th>
                                <th className="p-3">Account Size</th>
                                <th className="p-3">Price Paid</th>
                                <th className="p-3">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                              {uOrders.map(o => (
                                <tr key={o.orderId} className="hover:bg-white/[0.01]">
                                  <td className="p-3 font-mono text-slate-400">#{o.orderId}</td>
                                  <td className="p-3 capitalize">{o.accountType.replace('_', ' ')}</td>
                                  <td className="p-3 font-semibold text-white">{o.accountSize}</td>
                                  <td className="p-3 font-mono font-bold text-emerald-400">${o.finalPrice || o.price}</td>
                                  <td className="p-3">
                                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold ${
                                      o.status === 'Approved' ? 'bg-emerald-500/10 text-emerald-400' :
                                      o.status === 'Rejected' ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'
                                    }`}>
                                      {o.status}
                                    </span>
                                  </td>
                                </tr>
                              ))}
                              {uOrders.length === 0 && (
                                <tr>
                                  <td colSpan={5} className="p-6 text-center text-slate-500 text-xs">No purchase transactions found.</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>

                    {/* Payout History */}
                    <div className="space-y-3">
                      <h5 className="text-[11px] font-black text-white uppercase tracking-wider font-mono">Payout & Withdrawal History ({uPayouts.length})</h5>
                      <div className="bg-black/40 border border-white/5 rounded-2xl overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs text-slate-300">
                            <thead>
                              <tr className="border-b border-white/5 bg-white/5 text-[9px] font-mono uppercase text-slate-400">
                                <th className="p-3">Payout ID</th>
                                <th className="p-3">Trading Account</th>
                                <th className="p-3">Amount Requested</th>
                                <th className="p-3">Status</th>
                                <th className="p-3">Requested At</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5">
                              {uPayouts.map(p => (
                                <tr key={p.id} className="hover:bg-white/[0.01]">
                                  <td className="p-3 font-mono text-slate-400">{p.id}</td>
                                  <td className="p-3 font-mono font-bold text-white">{p.accountId}</td>
                                  <td className="p-3 font-mono font-bold text-emerald-400">${p.amount.toLocaleString()}</td>
                                  <td className="p-3">
                                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase ${
                                      p.status === 'approved' ? 'bg-emerald-500/10 text-emerald-400' :
                                      p.status === 'rejected' ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'
                                    }`}>
                                      {p.status}
                                    </span>
                                  </td>
                                  <td className="p-3 text-[10px] text-slate-500 font-mono">
                                    {p.createdAt ? new Date(p.createdAt).toLocaleDateString() : 'N/A'}
                                  </td>
                                </tr>
                              ))}
                              {uPayouts.length === 0 && (
                                <tr>
                                  <td colSpan={5} className="p-6 text-center text-slate-500 text-xs">No payouts found.</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>

                    {/* Account Trade History (Full Details with Open & Close Time) */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h5 className="text-[11px] font-black text-white uppercase tracking-wider font-mono flex items-center gap-2">
                          <ListFilter className="w-4 h-4 text-blue-400" />
                          <span>Account Trade History ({uTrades.length} Total Trades)</span>
                        </h5>
                        <span className="text-[10px] font-mono text-slate-400">
                          Open: <strong className="text-emerald-400">{uTrades.filter(t => (t.status || '').toLowerCase() === 'open').length}</strong> | Closed: <strong className="text-slate-300">{uTrades.filter(t => (t.status || '').toLowerCase() !== 'open').length}</strong>
                        </span>
                      </div>

                      <div className="bg-black/40 border border-white/5 rounded-2xl overflow-hidden shadow-xl">
                        <div className="overflow-x-auto max-h-80 overflow-y-auto">
                          <table className="w-full text-left text-xs text-slate-300">
                            <thead className="sticky top-0 bg-slate-900/95 backdrop-blur border-b border-white/10 text-[9px] font-mono uppercase text-slate-400 z-10">
                              <tr>
                                <th className="p-3">Trade ID / Account</th>
                                <th className="p-3">Symbol</th>
                                <th className="p-3">Type</th>
                                <th className="p-3">Lots</th>
                                <th className="p-3">Open Price & Time</th>
                                <th className="p-3">Close Price & Time</th>
                                <th className="p-3">Hold Duration</th>
                                <th className="p-3 text-right">Profit / Loss</th>
                                <th className="p-3 text-center">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/5 font-mono text-[11px]">
                              {uTrades.map((t, idx) => {
                                const isBuy = (t.type || '').toUpperCase() === 'BUY';
                                const isOpen = (t.status || '').toLowerCase() === 'open';
                                const openTimeMs = t.openTime ? new Date(t.openTime).getTime() : 0;
                                const closeTimeMs = t.closeTime ? new Date(t.closeTime).getTime() : Date.now();
                                const holdMins = openTimeMs > 0 ? Math.round((closeTimeMs - openTimeMs) / 60000) : 0;
                                
                                const formattedOpenTime = t.openTime ? new Date(t.openTime).toLocaleString(undefined, {
                                  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
                                }) : 'N/A';

                                const formattedCloseTime = t.closeTime ? new Date(t.closeTime).toLocaleString(undefined, {
                                  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
                                }) : (isOpen ? 'ACTIVE' : 'N/A');

                                return (
                                  <tr key={t.id || idx} className="hover:bg-white/[0.02] transition-colors">
                                    <td className="p-3">
                                      <span className="font-bold text-white block">#{t.id ? t.id.slice(-6) : idx + 1}</span>
                                      <span className="text-[10px] text-slate-400 font-mono">Acc: #{t.accountId}</span>
                                    </td>
                                    <td className="p-3 font-extrabold text-white">{t.symbol}</td>
                                    <td className="p-3">
                                      <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                                        isBuy ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                                      }`}>
                                        {t.type}
                                      </span>
                                    </td>
                                    <td className="p-3 text-slate-200 font-bold">{t.lots || t.amount || 0.1}</td>
                                    <td className="p-3">
                                      <div className="text-white font-bold">${t.openPrice != null ? Number(t.openPrice).toFixed(2) : 'N/A'}</div>
                                      <div className="text-[9px] text-slate-400 font-mono">{formattedOpenTime}</div>
                                    </td>
                                    <td className="p-3">
                                      <div className="text-white font-bold">{t.closePrice != null && t.closePrice !== '' ? `$${Number(t.closePrice).toFixed(2)}` : (isOpen ? '-' : 'N/A')}</div>
                                      <div className="text-[9px] text-slate-400 font-mono">{formattedCloseTime}</div>
                                    </td>
                                    <td className="p-3 text-slate-400 font-mono">
                                      {isOpen ? `${Math.round((Date.now() - openTimeMs) / 60000)} mins (live)` : `${holdMins} mins`}
                                    </td>
                                    <td className={`p-3 text-right font-extrabold font-mono text-xs ${Number(t.profit || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                      {Number(t.profit || 0) >= 0 ? '+' : ''}${Number(t.profit || 0).toFixed(2)}
                                    </td>
                                    <td className="p-3 text-center">
                                      <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${
                                        isOpen ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30 animate-pulse' : 'bg-slate-500/20 text-slate-400'
                                      }`}>
                                        {t.status || 'closed'}
                                      </span>
                                    </td>
                                  </tr>
                                );
                              })}
                              {uTrades.length === 0 && (
                                <tr>
                                  <td colSpan={9} className="p-8 text-center text-slate-500 text-xs">
                                    No trade execution history found for this trader's accounts.
                                  </td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Footer */}
                  <div className="p-6 border-t border-white/10 bg-white/5 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => setSelectedUserForDetails(null)}
                      className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl text-xs uppercase tracking-wider transition-colors border border-white/10"
                    >
                      Close Profile
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

          {/* TAB 2.5: PAYMENT MANAGEMENT CENTER (ORDERS & WALLETS) */}
          {activeTab === 'orders' && (
            <div className="space-y-8 animate-fade-in">
              {/* Wallet Address & Payment QR Configuration */}
              <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-sm shadow-xl space-y-6">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-white/10 pb-4">
                  <div>
                    <h3 className="text-base font-bold text-white uppercase tracking-wider flex items-center gap-2">
                      <Coins className="w-5 h-5 text-blue-400" />
                      <span>Administrative Payment & QR Code Setup</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Set receiving crypto wallet addresses, UPI ID, and QR code images shown to traders on checkout.
                    </p>
                  </div>
                  {walletSettingsMsg && (
                    <span className="text-xs text-emerald-400 font-bold flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-xl animate-fade-in">
                      <Check className="w-4 h-4" />
                      <span>{walletSettingsMsg}</span>
                    </span>
                  )}
                </div>

                <form onSubmit={handleUpdateWalletSettings} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

                    {[
                      {
                        key: 'btc',
                        label: 'Bitcoin (BTC)',
                        addressValue: btcAddressInput,
                        setAddress: setBtcAddressInput,
                        qrValue: btcQrCodeInput,
                        setQr: setBtcQrCodeInput,
                        placeholder: 'e.g. bc1q...',
                        badge: 'BTC',
                        badgeBg: 'bg-amber-500/10 border-amber-500/30 text-amber-400',
                        type: 'crypto'
                      },
                      {
                        key: 'usdtTrc20',
                        label: 'USDT (TRC20)',
                        addressValue: usdtTrc20AddressInput,
                        setAddress: setUsdtTrc20AddressInput,
                        qrValue: usdtTrc20QrCodeInput,
                        setQr: setUsdtTrc20QrCodeInput,
                        placeholder: 'e.g. TL5o...',
                        badge: 'TRC20',
                        badgeBg: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400',
                        type: 'crypto'
                      },
                      {
                        key: 'usdtErc20',
                        label: 'USDT (ERC20)',
                        addressValue: usdtErc20AddressInput,
                        setAddress: setUsdtErc20AddressInput,
                        qrValue: usdtErc20QrCodeInput,
                        setQr: setUsdtErc20QrCodeInput,
                        placeholder: 'e.g. 0x71C...',
                        badge: 'ERC20',
                        badgeBg: 'bg-blue-500/10 border-blue-500/30 text-blue-400',
                        type: 'crypto'
                      },
                      {
                        key: 'ltc',
                        label: 'Litecoin (LTC)',
                        addressValue: ltcAddressInput,
                        setAddress: setLtcAddressInput,
                        qrValue: ltcQrCodeInput,
                        setQr: setLtcQrCodeInput,
                        placeholder: 'e.g. ltc1q...',
                        badge: 'LTC',
                        badgeBg: 'bg-indigo-500/10 border-indigo-500/30 text-indigo-400',
                        type: 'crypto'
                      },
                      {
                        key: 'upi',
                        label: 'UPI Payment',
                        addressValue: upiIdInput,
                        setAddress: setUpiIdInput,
                        qrValue: upiQrCodeInput,
                        setQr: setUpiQrCodeInput,
                        placeholder: 'e.g. atfunding@upi or 9876543210@paytm',
                        badge: 'UPI / VPA',
                        badgeBg: 'bg-purple-500/10 border-purple-500/30 text-purple-400',
                        type: 'upi'
                      },
                    ].map((item) => {
                      const effectiveQr = item.qrValue || (item.addressValue ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(item.addressValue)}` : '');
                      return (
                        <div key={item.key} className="bg-black/40 border border-white/10 rounded-2xl p-5 space-y-4 flex flex-col justify-between shadow-lg hover:border-white/20 transition-all">
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-sm font-extrabold text-white flex items-center gap-2">
                                <span>{item.label}</span>
                              </span>
                              <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold uppercase border ${item.badgeBg}`}>
                                {item.badge}
                              </span>
                            </div>

                            {/* Address / UPI ID input */}
                            <div className="space-y-1">
                              <label className="text-[11px] text-slate-400 font-bold uppercase tracking-wider block">
                                {item.type === 'upi' ? 'UPI ID / VPA Address' : 'Wallet Address'}
                              </label>
                              <input
                                type="text"
                                placeholder={item.placeholder}
                                value={item.addressValue}
                                onChange={(e) => item.setAddress(e.target.value)}
                                className="w-full h-10 bg-white/5 border border-white/10 rounded-xl px-3 text-xs font-mono text-white focus:outline-none focus:border-blue-500 transition-colors"
                              />
                            </div>

                            {/* Custom QR URL or Upload */}
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between">
                                <label className="text-[11px] text-slate-400 font-bold uppercase tracking-wider">
                                  QR Code Image
                                </label>
                                <label className="cursor-pointer text-[10px] bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 font-bold px-2.5 py-1 rounded-lg flex items-center gap-1 transition-colors">
                                  <Upload className="w-3 h-3" />
                                  <span>{isUploadingQR === item.key ? 'Uploading...' : 'Upload Image'}</span>
                                  <input 
                                    type="file" 
                                    accept="image/*" 
                                    className="hidden" 
                                    onChange={(e) => handleQRUpload(e, item.key)} 
                                  />
                                </label>
                              </div>
                              <div className="flex gap-1.5">
                                <input
                                  type="text"
                                  placeholder="Paste Custom QR Image URL (Optional)"
                                  value={item.qrValue}
                                  onChange={(e) => item.setQr(e.target.value)}
                                  className="w-full h-9 bg-white/5 border border-white/10 rounded-xl px-3 text-[11px] font-mono text-slate-300 focus:outline-none focus:border-blue-500"
                                />
                                {item.qrValue && (
                                  <button
                                    type="button"
                                    onClick={() => item.setQr('')}
                                    className="px-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 rounded-xl text-xs flex items-center justify-center transition-colors"
                                    title="Clear custom QR"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>

                          {/* QR Code Preview Box */}
                          <div className="pt-2">
                            <div className="bg-black/60 border border-white/10 rounded-xl p-3 flex flex-col items-center justify-center min-h-[160px] text-center gap-2 relative">
                              {effectiveQr ? (
                                <>
                                  <img 
                                    src={effectiveQr} 
                                    alt={`${item.label} QR Code`} 
                                    className="w-32 h-32 object-contain rounded-lg border border-white/10 bg-white p-1"
                                    referrerPolicy="no-referrer"
                                  />
                                  <span className="text-[10px] font-mono text-slate-400">
                                    {item.qrValue ? '🟢 Custom QR Image Uploaded' : '⚡ Auto-Generated from Address'}
                                  </span>
                                </>
                              ) : (
                                <div className="space-y-1 text-slate-500 p-4">
                                  <ImageIcon className="w-8 h-8 mx-auto opacity-30" />
                                  <p className="text-[11px] font-medium">No QR Code Available</p>
                                  <p className="text-[10px] text-slate-600">Enter address or upload custom QR</p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}

                  </div>

                  {/* Save button */}
                  <div className="flex items-center justify-between pt-4 border-t border-white/10">
                    <p className="text-xs text-slate-400 font-medium">
                      Changes will take effect instantly across trader checkout screens.
                    </p>
                    <button
                      type="submit"
                      disabled={isSavingWallets}
                      className="px-8 h-11 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white font-extrabold rounded-xl text-xs uppercase tracking-wider transition-all shadow-lg shadow-blue-600/20 flex items-center gap-2"
                    >
                      {isSavingWallets ? (
                        <span>Saving Config...</span>
                      ) : (
                        <>
                          <Check className="w-4 h-4" />
                          <span>Save Wallet & QR Settings</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>

              {/* Order management system */}
              <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-sm shadow-xl space-y-6">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                  <div>
                    <h3 className="text-base font-bold text-white uppercase tracking-wider">Payment Proof Reviews</h3>
                    <p className="text-xs text-slate-400 mt-1">Audit proof of payment screenshot uploads and activate funded challenge accounts.</p>
                  </div>

                  {approvalToast && (
                    <div className="p-2.5 bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 text-xs rounded-xl flex items-center gap-2 max-w-md animate-pulse">
                      <Check className="w-4 h-4 text-emerald-400" />
                      <span>{approvalToast}</span>
                    </div>
                  )}
                </div>

                {/* Search and Filters */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 bg-black/20 p-4 rounded-2xl border border-white/5">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="text"
                      placeholder="Search name, email, ID..."
                      value={orderSearch}
                      onChange={(e) => setOrderSearch(e.target.value)}
                      className="w-full h-10 bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <Filter className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      className="w-full h-10 bg-white/5 border border-white/10 rounded-xl px-2 text-xs text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="All" className="bg-slate-900">All Statuses</option>
                      <option value="Pending Payment Review" className="bg-slate-900">Pending</option>
                      <option value="Approved" className="bg-slate-900">Approved</option>
                      <option value="Rejected" className="bg-slate-900">Rejected</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    <Filter className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                    <select
                      value={countryFilter}
                      onChange={(e) => setCountryFilter(e.target.value)}
                      className="w-full h-10 bg-white/5 border border-white/10 rounded-xl px-2 text-xs text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="All" className="bg-slate-900">All Countries</option>
                      {Array.from(new Set(orders.map(o => o.country).filter(Boolean))).map(c => (
                        <option key={c} value={c} className="bg-slate-900">{c}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-2">
                    <Filter className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                    <select
                      value={typeFilter}
                      onChange={(e) => setTypeFilter(e.target.value)}
                      className="w-full h-10 bg-white/5 border border-white/10 rounded-xl px-2 text-xs text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="All" className="bg-slate-900">All Types</option>
                      {Array.from(new Set(orders.map(o => o.accountType).filter(Boolean))).map(t => (
                        <option key={t} value={t} className="bg-slate-900">{(t as string).replace('_', ' ').toUpperCase()}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Rejection reason modal form (rendered if rejectingOrderId matches) */}
                {rejectingOrderId && (
                  <form onSubmit={handleRejectOrder} className="bg-rose-500/10 border border-rose-500/20 rounded-2xl p-5 space-y-4 animate-fade-in">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 text-rose-400 mt-0.5 flex-shrink-0" />
                      <div>
                        <h4 className="text-xs font-bold text-white uppercase tracking-wider">Reject Proof of Payment - Reason Required</h4>
                        <p className="text-[11px] text-slate-400 mt-0.5">Please specify why this screenshot or payment details are incorrect. This notice will appear in the user's dashboard.</p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <textarea
                        required
                        rows={2}
                        placeholder="e.g., Transaction hash could not be verified on the TRC20 blockchain explorers. Please resubmit."
                        value={rejectionReason}
                        onChange={(e) => setRejectionReason(e.target.value)}
                        className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-500"
                      />
                    </div>

                    {rejectionError && (
                      <p className="text-[11px] text-rose-400 font-semibold">{rejectionError}</p>
                    )}

                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setRejectingOrderId(null);
                          setRejectionReason('');
                          setRejectionError('');
                        }}
                        className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg text-[10px] uppercase font-bold"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-[10px] uppercase font-bold"
                      >
                        Confirm Rejection
                      </button>
                    </div>
                  </form>
                )}

                {/* Orders table */}
                {orders.length === 0 ? (
                  <div className="py-12 text-center text-xs text-slate-500">No checkout orders found on the database.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-300">
                      <thead>
                        <tr className="border-b border-white/10 font-mono uppercase text-slate-400">
                          <th className="py-2.5">Order ID</th>
                          <th className="py-2.5">User Details</th>
                          <th className="py-2.5">Challenge spec</th>
                          <th className="py-2.5">Paid Coin & Wallet</th>
                          <th className="py-2.5">Proof Screenshot</th>
                          <th className="py-2.5">Grand Total</th>
                          <th className="py-2.5">Status</th>
                          <th className="py-2.5 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/10 font-medium">
                        {orders
                          .filter(o => {
                            const searchStr = orderSearch.toLowerCase();
                            const matchesSearch = 
                              o.orderId.toLowerCase().includes(searchStr) ||
                              o.firstName.toLowerCase().includes(searchStr) ||
                              o.lastName.toLowerCase().includes(searchStr) ||
                              o.email.toLowerCase().includes(searchStr);
                            
                            const matchesStatus = statusFilter === 'All' || o.status === statusFilter;
                            const matchesCountry = countryFilter === 'All' || o.country === countryFilter;
                            const matchesType = typeFilter === 'All' || o.accountType === typeFilter;

                            return matchesSearch && matchesStatus && matchesCountry && matchesType;
                          })
                          .map((ord) => (
                            <tr key={ord.orderId}>
                              <td className="py-3 font-mono text-slate-500 text-[10px]">
                                #{ord.orderId}
                                <span className="block text-[9px] text-slate-500 font-normal">{new Date(ord.createdAt).toLocaleDateString()}</span>
                              </td>
                              <td className="py-3">
                                <span className="text-white block font-semibold">{ord.firstName} {ord.lastName}</span>
                                <span className="text-slate-500 block font-mono text-[9px]">{ord.email}</span>
                                <span className="text-[9px] text-slate-400 block">{ord.phone} | {ord.country}</span>
                              </td>
                              <td className="py-3 uppercase font-mono text-[10px]">
                                <span className="text-white block font-bold">{ord.accountSize}</span>
                                <span className="text-slate-500 block">{ord.accountType.replace('_', ' ')}</span>
                                <span className="text-[9px] text-blue-400 block font-normal">{ord.platform}</span>
                              </td>
                              <td className="py-3">
                                <span className="text-white block font-bold text-[10px]">{ord.paymentMethod}</span>
                                <span className="text-[9px] font-mono text-slate-500 break-all select-all max-w-[120px] block" title={ord.walletAddress}>
                                  {ord.walletAddress.substring(0, 12)}...
                                </span>
                              </td>
                              <td className="py-3">
                                <a
                                  href={ord.paymentScreenshot}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex items-center gap-1.5 text-blue-400 hover:underline text-[10px]"
                                >
                                  <ImageIcon className="w-3.5 h-3.5 flex-shrink-0 text-blue-400" />
                                  <span>View Screenshot</span>
                                </a>
                              </td>
                              <td className="py-3 font-mono text-white text-[11px] font-bold">
                                ${ord.finalPrice.toFixed(2)}
                              </td>
                              <td className="py-3">
                                <span className={`px-2.5 py-0.5 rounded-full text-[9px] font-mono font-bold uppercase tracking-wider ${
                                  ord.status === 'Pending Payment Review' ? 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20' :
                                  ord.status === 'Approved' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                                  'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                }`}>
                                  {ord.status}
                                </span>
                              </td>
                              <td className="py-3 text-right">
                                <div className="flex gap-1.5 justify-end items-center">
                                  <button
                                    type="button"
                                    onClick={() => setSelectedOrderForModal(ord)}
                                    className="px-2.5 py-1 bg-white/5 hover:bg-white/15 border border-white/10 text-slate-200 rounded text-[10px] font-bold uppercase transition-all"
                                  >
                                    View Audit
                                  </button>
                                  {ord.status === 'Pending Payment Review' || ord.status === 'Rejected' ? (
                                    <>
                                      <button
                                        type="button"
                                        onClick={() => handleApproveOrder(ord)}
                                        className="px-2 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[10px] font-bold uppercase tracking-wider transition-colors"
                                      >
                                        Approve
                                      </button>
                                      {ord.status === 'Pending Payment Review' && (
                                        <button
                                          type="button"
                                          onClick={() => setRejectingOrderId(ord.orderId)}
                                          className="px-2 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded text-[10px] font-bold uppercase tracking-wider transition-colors"
                                        >
                                          Reject
                                        </button>
                                      )}
                                    </>
                                  ) : (
                                    <span className="text-[10px] font-mono text-slate-500">Reviewed</span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB: ACTIVE ACCOUNTS MANAGER */}
          {activeTab === 'active_accounts' && (
            <div className="space-y-6 animate-fade-in">
              {/* Top Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="p-5 bg-white/5 border border-white/10 rounded-2xl backdrop-blur-sm shadow-xl">
                  <div className="text-[10px] font-mono font-bold text-slate-400 uppercase tracking-wider">Total Prop Accounts</div>
                  <div className="text-2xl font-black font-mono text-white mt-1">{accounts.length}</div>
                </div>
                <div className="p-5 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl backdrop-blur-sm shadow-xl">
                  <div className="text-[10px] font-mono font-bold text-emerald-400 uppercase tracking-wider">Active Trading Accounts</div>
                  <div className="text-2xl font-black font-mono text-emerald-300 mt-1">
                    {accounts.filter(a => a.status === 'active' || a.status === 'passed' || a.status === 'phase_passed' || a.status === 'phase2_active').length}
                  </div>
                </div>
                <div className="p-5 bg-rose-500/10 border border-rose-500/20 rounded-2xl backdrop-blur-sm shadow-xl">
                  <div className="text-[10px] font-mono font-bold text-rose-400 uppercase tracking-wider">Breached Accounts</div>
                  <div className="text-2xl font-black font-mono text-rose-300 mt-1">
                    {accounts.filter(a => a.status === 'breached').length}
                  </div>
                </div>
                <div className="p-5 bg-blue-500/10 border border-blue-500/20 rounded-2xl backdrop-blur-sm shadow-xl">
                  <div className="text-[10px] font-mono font-bold text-blue-400 uppercase tracking-wider">Total System Equity</div>
                  <div className="text-2xl font-black font-mono text-blue-300 mt-1">
                    ${accounts.reduce((sum, a) => sum + (a.equity || a.balance || 0), 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </div>
                </div>
              </div>

              {/* AUDIT & INTEGRITY CONTROL BANNER */}
              <div className="bg-gradient-to-r from-blue-950/80 via-slate-900 to-indigo-950/80 border border-blue-500/30 rounded-3xl p-5 shadow-2xl space-y-3">
                <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="p-3 rounded-2xl bg-blue-500/20 border border-blue-500/40 text-blue-400">
                      <Shield className="w-6 h-6 animate-pulse" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-extrabold text-white uppercase tracking-wider">SYSTEM AUDIT & INTEGRITY REPAIR</h4>
                        {accountsWithErrors.length > 0 ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                            {accountsWithErrors.length} DISCREPANCIES DETECTED
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                            SYSTEM 100% HEALTHY
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5 font-mono">
                        Recalculates all account balances, equity, daily loss, and max drawdown directly from trade history.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 w-full md:w-auto">
                    <button
                      type="button"
                      onClick={() => setShowAuditModal(true)}
                      className="px-4 py-2 bg-blue-600/30 hover:bg-blue-600 border border-blue-500/40 text-blue-200 hover:text-white rounded-xl text-xs font-bold uppercase transition-all flex items-center gap-2 cursor-pointer shadow-lg shadow-blue-600/10"
                    >
                      <Activity className="w-4 h-4 text-blue-400" />
                      <span>View Audit Details ({auditReports.length})</span>
                    </button>

                    <button
                      type="button"
                      disabled={isRepairingAll || accountsWithErrors.length === 0}
                      onClick={handleAutoRepairAll}
                      className="px-4 py-2 bg-emerald-600/30 hover:bg-emerald-500 disabled:opacity-50 border border-emerald-500/40 text-emerald-200 hover:text-slate-950 rounded-xl text-xs font-bold uppercase transition-all flex items-center gap-2 cursor-pointer shadow-lg shadow-emerald-600/20"
                    >
                      <RefreshCw className={`w-4 h-4 ${isRepairingAll ? 'animate-spin' : ''}`} />
                      <span>{isRepairingAll ? 'Repairing...' : `Auto Repair All (${accountsWithErrors.length})`}</span>
                    </button>
                  </div>
                </div>

                {auditNoticeMsg && (
                  <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-xl text-xs font-mono text-blue-300 flex items-center justify-between animate-fade-in">
                    <span>{auditNoticeMsg}</span>
                    <button onClick={() => setAuditNoticeMsg('')} className="text-slate-400 hover:text-white">✕</button>
                  </div>
                )}
              </div>

              {/* Main Panel */}
              <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-sm shadow-xl space-y-5">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-white/10 pb-5">
                  <div>
                    <h3 className="text-base font-bold text-white uppercase tracking-wider flex items-center gap-2">
                      <Shield className="w-5 h-5 text-blue-400" />
                      <span>Active Prop Accounts Management</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Monitor, breach, reset, promote or edit balances for all trader accounts across all evaluation phases.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
                    {/* Search Input */}
                    <div className="relative flex-1 md:w-64">
                      <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
                      <input
                        type="text"
                        placeholder="Search ID, email or name..."
                        value={accountSearchQuery}
                        onChange={(e) => setAccountSearchQuery(e.target.value)}
                        className="w-full h-9 bg-black/40 border border-white/10 rounded-xl pl-9 pr-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    {/* Status Filter */}
                    <select
                      value={accountFilterStatus}
                      onChange={(e) => setAccountFilterStatus(e.target.value)}
                      className="h-9 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="All" className="bg-slate-900">All Statuses</option>
                      <option value="active" className="bg-slate-900">Active Only</option>
                      <option value="breached" className="bg-slate-900">Breached Only</option>
                      <option value="passed" className="bg-slate-900">Phase Passed / Pending</option>
                    </select>

                    {/* Type Filter */}
                    <select
                      value={accountFilterType}
                      onChange={(e) => setAccountFilterType(e.target.value)}
                      className="h-9 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-blue-500"
                    >
                      <option value="All" className="bg-slate-900">All Challenge Types</option>
                      <option value="one_step" className="bg-slate-900">1-Step Challenge</option>
                      <option value="two_step" className="bg-slate-900">2-Step Challenge</option>
                      <option value="payout_later" className="bg-slate-900">Payout Later</option>
                      <option value="instant_bolt" className="bg-slate-900">Instant Bolt</option>
                      <option value="funded" className="bg-slate-900">Live Funded</option>
                    </select>
                  </div>
                </div>

                {/* Accounts Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead>
                      <tr className="border-b border-white/10 font-mono uppercase text-slate-400 text-[10px]">
                        <th className="py-3 px-2">Account ID / Login</th>
                        <th className="py-3 px-2">Trader Email</th>
                        <th className="py-3 px-2">Type / Phase</th>
                        <th className="py-3 px-2">Size</th>
                        <th className="py-3 px-2">Balance (Calculated vs Stored)</th>
                        <th className="py-3 px-2">Equity</th>
                        <th className="py-3 px-2">Risk Level</th>
                        <th className="py-3 px-2">Status</th>
                        <th className="py-3 px-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10 font-medium">
                      {accounts
                        .filter(acc => {
                          const query = accountSearchQuery.toLowerCase().trim();
                          const matchesQuery = !query ||
                            acc.id.toLowerCase().includes(query) ||
                            (acc.login && String(acc.login).includes(query)) ||
                            (acc.userEmail && acc.userEmail.toLowerCase().includes(query)) ||
                            (acc.userName && acc.userName.toLowerCase().includes(query));

                          const matchesStatus = accountFilterStatus === 'All' ||
                            (accountFilterStatus === 'active' && (acc.status === 'active' || acc.status === 'phase2_active')) ||
                            (accountFilterStatus === 'breached' && acc.status === 'breached') ||
                            (accountFilterStatus === 'passed' && (acc.status === 'passed' || acc.status === 'phase_passed' || acc.phaseStatus === 'phase_passed'));

                          const matchesType = accountFilterType === 'All' || acc.accountType === accountFilterType;

                          return matchesQuery && matchesStatus && matchesType;
                        })
                        .map(acc => {
                          const startBal = acc.startingBalance || acc.size || 5000;
                          const pnl = (acc.equity || acc.balance) - startBal;
                          const auditRes = auditAccount(acc, trades, []);

                          return (
                            <tr key={acc.id} className="hover:bg-white/[0.02] transition-colors">
                              <td className="py-3 px-2 font-mono">
                                <span className="text-white font-bold block">#{acc.login || acc.id}</span>
                                {acc.isGiveaway && (
                                  <span className="inline-block px-1.5 py-0.5 bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[8px] font-bold rounded uppercase">Giveaway</span>
                                )}
                              </td>
                              <td className="py-3 px-2">
                                <span className="text-white font-semibold block">{acc.userEmail || 'N/A'}</span>
                                {acc.userName && <span className="text-slate-500 text-[10px]">{acc.userName}</span>}
                              </td>
                              <td className="py-3 px-2 font-mono text-[10px]">
                                <span className="text-blue-300 font-bold block uppercase">{acc.accountType.replace('_', ' ')}</span>
                                <span className="text-slate-400">Phase {acc.phase || 1}</span>
                              </td>
                              <td className="py-3 px-2 font-mono text-slate-300">
                                ${startBal.toLocaleString()}
                              </td>
                              <td className="py-3 px-2 font-mono">
                                <div className="flex items-center gap-1.5">
                                  <span className="text-white font-bold block">
                                    ${auditRes.expectedBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                  </span>
                                  {auditRes.isBalanceMismatch ? (
                                    <span className="px-1.5 py-0.5 rounded bg-rose-500/20 border border-rose-500/30 text-rose-300 text-[9px] font-bold" title={`Stored: $${acc.balance.toFixed(2)}`}>
                                      Mismatch! (Stored $${acc.balance.toFixed(0)})
                                    </span>
                                  ) : (
                                    <span className="text-emerald-400 text-xs" title="Verified matches trade history">✓</span>
                                  )}
                                </div>
                              </td>
                              <td className="py-3 px-2 font-mono font-bold">
                                <span className={pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                                  ${acc.equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </span>
                              </td>
                              <td className="py-3 px-2 font-mono text-[9px]">
                                <span className={`px-1.5 py-0.5 rounded font-bold ${
                                  auditRes.riskLevel === 'LOW' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                                  auditRes.riskLevel === 'MEDIUM' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                                  'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                }`}>
                                  Risk: {auditRes.riskScore}% ({auditRes.riskLevel})
                                </span>
                              </td>
                              <td className="py-3 px-2">
                                <span className={`px-2.5 py-1 rounded-full text-[9px] font-mono font-bold uppercase tracking-wider ${
                                  acc.status === 'active' || acc.status === 'phase2_active' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                                  acc.status === 'breached' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
                                  'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                }`}>
                                  {acc.status}
                                </span>
                              </td>
                              <td className="py-3 px-2 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  {/* Quick Repair Button if discrepancy exists */}
                                  {(auditRes.isBalanceMismatch || auditRes.isEquityMismatch || auditRes.isStatusMismatch) && (
                                    <button
                                      type="button"
                                      onClick={() => handleRepairSingleAccount(auditRes)}
                                      title="Auto repair account balance/equity/status to match calculated trade history"
                                      className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black rounded-lg text-[10px] uppercase transition-all shadow-md shadow-emerald-500/20"
                                    >
                                      Repair
                                    </button>
                                  )}

                                  {/* Edit Balance & Equity Button */}
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingAccountBalanceModal(acc);
                                      setModalNewBalance(acc.balance);
                                      setModalNewEquity(acc.equity);
                                    }}
                                    title="Edit Balance / Equity"
                                    className="px-2.5 py-1 bg-blue-600/20 hover:bg-blue-600/40 border border-blue-500/30 text-blue-300 rounded-lg text-[10px] font-bold uppercase transition-colors"
                                  >
                                    Edit Bal
                                  </button>

                                  {/* Breach Account Option */}
                                  {acc.status !== 'breached' ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setBreachingAccountModal(acc);
                                        setBreachReasonInput('Daily Loss Limit Exceeded / Rule Violation');
                                      }}
                                      title="Breach Account"
                                      className="px-2.5 py-1 bg-rose-600/20 hover:bg-rose-600 border border-rose-500/30 text-rose-300 hover:text-white rounded-lg text-[10px] font-bold uppercase transition-all shadow-md shadow-rose-600/10"
                                    >
                                      Breach
                                    </button>
                                  ) : (
                                    /* Reset Account Option */
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        const confirmReset = window.confirm(`Reset Account #${acc.login || acc.id} back to ACTIVE status with balance $${startBal.toLocaleString()}?`);
                                        if (!confirmReset) return;
                                        try {
                                          await updateDoc(doc(db, 'accounts', acc.id), {
                                            status: 'active',
                                            balance: startBal,
                                            equity: startBal,
                                            dailyStartingBalance: startBal,
                                            dailyStartingEquity: startBal,
                                            updatedAt: new Date().toISOString()
                                          });
                                          alert(`Account #${acc.login || acc.id} reset to ACTIVE.`);
                                          fetchAllData();
                                        } catch (err: any) {
                                          alert("Error resetting account: " + err.message);
                                        }
                                      }}
                                      title="Reset / Unbreach Account"
                                      className="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500 border border-amber-500/30 text-amber-300 hover:text-slate-950 rounded-lg text-[10px] font-bold uppercase transition-all"
                                    >
                                      Reset
                                    </button>
                                  )}

                                  {/* Activate Phase 2 Option */}
                                  <button
                                    type="button"
                                    onClick={() => handleActivatePhase2(acc)}
                                    title="Activate Phase 2 Account"
                                    className="px-2 py-1 bg-cyan-600/20 hover:bg-cyan-500 border border-cyan-500/40 text-cyan-300 hover:text-slate-950 rounded-lg text-[10px] font-bold uppercase transition-all shadow-sm shadow-cyan-500/10 flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                  >
                                    <Sparkles className="w-3 h-3 text-cyan-400 shrink-0" />
                                    <span>Activate Phase 2</span>
                                  </button>

                                  {/* Activate Funded Account Option */}
                                  <button
                                    type="button"
                                    onClick={() => handleActivateFunded(acc)}
                                    title="Activate Live Funded Account"
                                    className="px-2 py-1 bg-emerald-600/20 hover:bg-emerald-500 border border-emerald-500/40 text-emerald-300 hover:text-slate-950 rounded-lg text-[10px] font-bold uppercase transition-all shadow-sm shadow-emerald-500/20 flex items-center gap-1 cursor-pointer whitespace-nowrap"
                                  >
                                    <Shield className="w-3 h-3 text-emerald-400 shrink-0" />
                                    <span>Activate Funded</span>
                                  </button>

                                  {/* Delete Account Option */}
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      const confirmDel = window.confirm(`Delete Account #${acc.login || acc.id}? This cannot be undone.`);
                                      if (!confirmDel) return;
                                      try {
                                        await deleteDoc(doc(db, 'accounts', acc.id));
                                        alert(`Account #${acc.login || acc.id} deleted.`);
                                        fetchAllData();
                                      } catch (err: any) {
                                        alert("Error deleting account: " + err.message);
                                      }
                                    }}
                                    title="Delete Account"
                                    className="p-1 bg-white/5 hover:bg-rose-600/20 text-slate-400 hover:text-rose-400 rounded-lg transition-colors"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Full Audit System Modal */}
              {showAuditModal && (
                <div className="fixed inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in">
                  <div className="bg-[#0b0f19] border border-blue-500/30 rounded-3xl p-6 max-w-5xl w-full max-h-[90vh] flex flex-col space-y-4 shadow-2xl overflow-hidden">
                    {/* Header */}
                    <div className="flex justify-between items-center border-b border-white/10 pb-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <Shield className="w-5 h-5 text-blue-400" />
                          <h3 className="text-base font-extrabold text-white uppercase tracking-wider">
                            CRITICAL SYSTEM AUDIT & RISK REPORT
                          </h3>
                        </div>
                        <p className="text-xs text-slate-400 font-mono mt-0.5">
                          Calculated from trade history. Formula: Balance = Initial + Closed PnL | Equity = Balance + Floating PnL
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={isRepairingAll || accountsWithErrors.length === 0}
                          onClick={handleAutoRepairAll}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black rounded-xl text-xs uppercase transition-all"
                        >
                          Auto Repair All ({accountsWithErrors.length})
                        </button>
                        <button
                          onClick={() => setShowAuditModal(false)}
                          className="p-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white"
                        >
                          ✕
                        </button>
                      </div>
                    </div>

                    {/* Stat Badges */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 font-mono text-xs">
                      <div className="p-3 rounded-2xl bg-black/40 border border-white/10">
                        <span className="text-slate-400 text-[10px] uppercase block">Total Accounts</span>
                        <span className="text-lg font-bold text-white">{auditReports.length}</span>
                      </div>
                      <div className={`p-3 rounded-2xl border ${accountsWithErrors.length > 0 ? 'bg-rose-500/10 border-rose-500/30 text-rose-300' : 'bg-black/40 border-white/10 text-emerald-400'}`}>
                        <span className="text-[10px] uppercase block">Balance/Status Discrepancies</span>
                        <span className="text-lg font-bold">{accountsWithErrors.length}</span>
                      </div>
                      <div className="p-3 rounded-2xl bg-black/40 border border-white/10">
                        <span className="text-slate-400 text-[10px] uppercase block">Gambling Flags</span>
                        <span className="text-lg font-bold text-indigo-400">{accountsWithGamblingFlags.length}</span>
                      </div>
                    </div>

                    {/* Filter Tabs */}
                    <div className="flex items-center gap-2 border-b border-white/10 pb-2 text-xs font-mono">
                      <button
                        onClick={() => setAuditFilter('errors')}
                        className={`px-3 py-1.5 rounded-xl font-bold uppercase transition-all ${
                          auditFilter === 'errors' ? 'bg-rose-500/20 text-rose-300 border border-rose-500/30' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        Discrepancies ({accountsWithErrors.length})
                      </button>
                      <button
                        onClick={() => setAuditFilter('gambling')}
                        className={`px-3 py-1.5 rounded-xl font-bold uppercase transition-all ${
                          auditFilter === 'gambling' ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        Gambling Flags ({accountsWithGamblingFlags.length})
                      </button>
                      <button
                        onClick={() => setAuditFilter('all')}
                        className={`px-3 py-1.5 rounded-xl font-bold uppercase transition-all ${
                          auditFilter === 'all' ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        All Accounts ({auditReports.length})
                      </button>
                    </div>

                    {/* Report List */}
                    <div className="flex-1 overflow-y-auto space-y-3 pr-1 text-xs">
                      {auditReports
                        .filter((r) => {
                          if (auditFilter === 'errors') return r.isBalanceMismatch || r.isEquityMismatch || r.isStatusMismatch;
                          if (auditFilter === 'gambling') return r.gamblingFlags.length > 0;
                          return true;
                        })
                        .map((r) => (
                          <div
                            key={r.accountId}
                            className={`p-4 rounded-2xl border transition-all ${
                              r.isBalanceMismatch || r.isEquityMismatch || r.isStatusMismatch
                                ? 'bg-rose-950/20 border-rose-500/30'
                                : 'bg-black/30 border-white/5'
                            }`}
                          >
                            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 border-b border-white/5 pb-2">
                              <div>
                                <span className="text-white font-bold font-mono text-sm">Account #{r.login || r.accountId}</span>
                                <span className="text-slate-400 font-mono text-xs ml-2">({r.userEmail})</span>
                              </div>

                              <div className="flex items-center gap-2">
                                <span className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase ${
                                  r.storedStatus === 'active' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                }`}>
                                  Stored Status: {r.storedStatus}
                                </span>

                                {(r.isBalanceMismatch || r.isEquityMismatch || r.isStatusMismatch) && (
                                  <button
                                    onClick={() => handleRepairSingleAccount(r)}
                                    className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-slate-950 font-black rounded-lg text-[10px] uppercase transition-all"
                                  >
                                    Repair Account
                                  </button>
                                )}
                              </div>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-3 font-mono text-xs">
                              <div>
                                <span className="text-slate-500 text-[10px] uppercase block">Starting Size</span>
                                <span className="text-white font-bold">${r.startingBalance.toLocaleString()}</span>
                              </div>
                              <div>
                                <span className="text-slate-500 text-[10px] uppercase block">Calculated Balance</span>
                                <span className="text-emerald-400 font-bold">${r.expectedBalance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                                {r.isBalanceMismatch && <span className="text-rose-400 text-[9px] block">Stored: ${r.currentStoredBalance.toLocaleString()}</span>}
                              </div>
                              <div>
                                <span className="text-slate-500 text-[10px] uppercase block">Risk Score</span>
                                <span className="text-amber-400 font-bold">{r.riskScore}% ({r.riskLevel})</span>
                              </div>
                            </div>

                            {/* Warnings & Flags */}
                            {(r.errorsFound.length > 0 || r.gamblingFlags.length > 0 || !r.canRequestPayout) && (
                              <div className="mt-3 p-2 bg-black/40 border border-white/5 rounded-xl space-y-1 text-[11px] font-mono">
                                {r.errorsFound.map((d, i) => (
                                  <p key={i} className="text-rose-300 flex items-center gap-1">
                                    <span>🚫</span> <span>{d}</span>
                                  </p>
                                ))}
                                {r.gamblingFlags.map((g, i) => (
                                  <p key={i} className="text-amber-300 flex items-center gap-1">
                                    <span>⚠️ Gambling Flag:</span> <span>{g}</span>
                                  </p>
                                ))}
                                {!r.canRequestPayout && (
                                  <p className="text-indigo-300 flex items-center gap-1">
                                    <span>🔒 Payout Protection:</span> <span>{r.payoutBlockedReason}</span>
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Edit Balance Modal */}
              {editingAccountBalanceModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in">
                  <div className="bg-[#0b0f19] border border-white/10 rounded-3xl p-6 max-w-md w-full space-y-4 shadow-2xl">
                    <div className="flex justify-between items-center border-b border-white/10 pb-3">
                      <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                        Edit Account #${editingAccountBalanceModal.login || editingAccountBalanceModal.id} Balance
                      </h3>
                      <button
                        onClick={() => setEditingAccountBalanceModal(null)}
                        className="text-slate-400 hover:text-white"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-bold text-slate-400 block mb-1">New Balance ($)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={modalNewBalance}
                          onChange={(e) => setModalNewBalance(parseFloat(e.target.value) || 0)}
                          className="w-full bg-black/40 border border-white/10 rounded-xl p-2.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-bold text-slate-400 block mb-1">New Equity ($)</label>
                        <input
                          type="number"
                          step="0.01"
                          value={modalNewEquity}
                          onChange={(e) => setModalNewEquity(parseFloat(e.target.value) || 0)}
                          className="w-full bg-black/40 border border-white/10 rounded-xl p-2.5 text-xs text-white font-mono focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setEditingAccountBalanceModal(null)}
                        className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-xl text-xs font-bold"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            await updateDoc(doc(db, 'accounts', editingAccountBalanceModal.id), {
                              balance: modalNewBalance,
                              equity: modalNewEquity,
                              updatedAt: new Date().toISOString()
                            });
                            alert("Account balance & equity updated successfully!");
                            setEditingAccountBalanceModal(null);
                            fetchAllData();
                          } catch (err: any) {
                            alert("Error updating account: " + err.message);
                          }
                        }}
                        className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-blue-600/20"
                      >
                        Save Changes
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Breach Account Modal */}
              {breachingAccountModal && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-fade-in">
                  <div className="bg-[#0b0f19] border border-rose-500/30 rounded-3xl p-6 max-w-md w-full space-y-4 shadow-2xl">
                    <div className="flex justify-between items-center border-b border-white/10 pb-3">
                      <h3 className="text-sm font-bold text-rose-400 uppercase tracking-wider flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-rose-400" />
                        <span>Confirm Account Breach</span>
                      </h3>
                      <button
                        onClick={() => setBreachingAccountModal(null)}
                        className="text-slate-400 hover:text-white"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>

                    <p className="text-xs text-slate-300 leading-relaxed">
                      You are about to mark Account <strong className="text-white">#{breachingAccountModal.login || breachingAccountModal.id}</strong> ({breachingAccountModal.userEmail}) as <span className="text-rose-400 font-bold uppercase">Breached</span>.
                    </p>

                    <div>
                      <label className="text-xs font-bold text-slate-400 block mb-1">Reason for Breach</label>
                      <textarea
                        rows={3}
                        value={breachReasonInput}
                        onChange={(e) => setBreachReasonInput(e.target.value)}
                        placeholder="e.g. Daily loss limit exceeded or rule violation"
                        className="w-full bg-black/40 border border-white/10 rounded-xl p-2.5 text-xs text-white focus:outline-none focus:border-rose-500"
                      />
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setBreachingAccountModal(null)}
                        className="px-4 py-2 bg-white/5 hover:bg-white/10 text-white rounded-xl text-xs font-bold"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const nowIso = new Date().toISOString();
                          try {
                            const accId = breachingAccountModal.id;
                            if (!accId) {
                              alert("Error: Account ID is missing.");
                              return;
                            }

                            const reasonStr = breachReasonInput || 'Manual Admin Breach';

                            // 1. Update account status
                            await updateDoc(doc(db, 'accounts', accId), {
                              status: 'breached',
                              breachedAt: nowIso,
                              breachReason: reasonStr,
                              updatedAt: nowIso
                            });

                            // 2. Record in ruleViolations collection
                            const violId = `viol-admin-${Date.now()}`;
                            await setDoc(doc(db, 'ruleViolations', violId), {
                              id: violId,
                              accountId: accId,
                              login: breachingAccountModal.login || accId,
                              userId: breachingAccountModal.userId || '',
                              userEmail: breachingAccountModal.userEmail || 'unknown@atfunding.online',
                              violationType: reasonStr,
                              status: 'Breached',
                              equityAtViolation: breachingAccountModal.equity || 0,
                              balanceAtViolation: breachingAccountModal.balance || 0,
                              createdAt: nowIso
                            }).catch((e) => console.warn("Failed to set ruleViolations doc:", e));

                            // 3. Record in rule_violations collection (backwards compatibility)
                            await setDoc(doc(db, 'rule_violations', violId), {
                              id: violId,
                              accountId: accId,
                              userId: breachingAccountModal.userId || '',
                              userEmail: breachingAccountModal.userEmail || '',
                              type: 'manual_admin_breach',
                              reason: reasonStr,
                              equityAtViolation: breachingAccountModal.equity || 0,
                              balanceAtViolation: breachingAccountModal.balance || 0,
                              createdAt: nowIso
                            }).catch((e) => console.warn("Failed to set rule_violations doc:", e));

                            // 4. Record in breaches collection
                            const breachId = 'BRCH-' + Math.floor(100000 + Math.random() * 900000);
                            await setDoc(doc(db, 'breaches', breachId), {
                              id: breachId,
                              userId: breachingAccountModal.userId || '',
                              accountId: accId,
                              login: breachingAccountModal.login || accId,
                              breachReason: reasonStr,
                              breachDate: nowIso,
                              adminName: 'Admin',
                              userEmail: breachingAccountModal.userEmail || 'unknown@atfunding.online'
                            }).catch((e) => console.warn("Failed to set breaches doc:", e));

                            // 5. Send user notification if userId exists
                            if (breachingAccountModal.userId) {
                              const notifId = `notif-breach-${Date.now()}`;
                              await setDoc(doc(db, 'notifications', notifId), {
                                id: notifId,
                                userId: breachingAccountModal.userId,
                                title: 'Account Status Update - Breached ⚠️',
                                message: `Account #${breachingAccountModal.login || accId} was marked as breached by risk management. Reason: ${reasonStr}.`,
                                type: 'warning',
                                read: false,
                                createdAt: nowIso
                              }).catch((e) => console.warn("Failed to set notification doc:", e));
                            }

                            alert(`Account #${breachingAccountModal.login || accId} marked as BREACHED.`);
                            setBreachingAccountModal(null);
                            fetchAllData();
                          } catch (err: any) {
                            console.error("Error breaching account:", err);
                            alert("Error breaching account: " + (err?.message || String(err)));
                          }
                        }}
                        className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-xl text-xs font-bold shadow-lg shadow-rose-600/20"
                      >
                        Confirm Breach
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: CREATE / GIVEAWAY ACCOUNTS */}
          {activeTab === 'accounts' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-fade-in">
              {/* Left Column: Trader Selection & Specification */}
              <div className="lg:col-span-8 bg-white/5 border border-white/10 rounded-3xl p-6 space-y-6 backdrop-blur-sm shadow-xl">
                <div>
                  <h3 className="text-base font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <Gift className="w-5 h-5 text-amber-400" />
                    <span>Giveaway Center & Manual Provisioner</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Instantly create evaluations or funded giveaway accounts for one, multiple, or all traders.
                  </p>
                </div>

                {manualAccountMsg && (
                  <div className="p-3 bg-blue-500/10 border border-blue-500/25 rounded-xl text-xs text-blue-300">
                    {manualAccountMsg}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* Trader Selector List */}
                  <div className="space-y-3 bg-black/20 p-4 border border-white/5 rounded-2xl">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-bold text-slate-300">Select Traders ({selectedUserIds.length} selected)</label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const nonAdminTraders = users.filter(u => u.role !== 'admin');
                            const filtered = nonAdminTraders.filter(u => {
                              if (!giveawayUserSearch.trim()) return true;
                              const q = giveawayUserSearch.toLowerCase().trim();
                              return (u.email || '').toLowerCase().includes(q) || 
                                     (u.displayName || u.name || '').toLowerCase().includes(q) || 
                                     (u.uid || '').toLowerCase().includes(q);
                            });
                            setSelectedUserIds(Array.from(new Set([...selectedUserIds, ...filtered.map(u => u.uid)])));
                          }}
                          className="text-[9px] text-blue-400 hover:underline font-bold"
                        >
                          Select {giveawayUserSearch.trim() ? 'Filtered' : 'All'}
                        </button>
                        <span className="text-slate-600">|</span>
                        <button
                          type="button"
                          onClick={() => setSelectedUserIds([])}
                          className="text-[9px] text-slate-400 hover:underline font-bold"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    {/* Search Input for Traders */}
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        placeholder="Search trader by email, name, or UID..."
                        value={giveawayUserSearch}
                        onChange={(e) => setGiveawayUserSearch(e.target.value)}
                        className="w-full h-8 pl-8 pr-7 bg-black/40 border border-blue-500/30 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-400 font-medium"
                      />
                      {giveawayUserSearch && (
                        <button
                          type="button"
                          onClick={() => setGiveawayUserSearch('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs font-bold"
                        >
                          ✕
                        </button>
                      )}
                    </div>

                    <div className="max-h-56 overflow-y-auto space-y-1 pr-1">
                      {users
                        .filter(u => u.role !== 'admin')
                        .filter(u => {
                          if (!giveawayUserSearch.trim()) return true;
                          const q = giveawayUserSearch.toLowerCase().trim();
                          const email = (u.email || '').toLowerCase();
                          const name = (u.displayName || u.name || '').toLowerCase();
                          const uid = (u.uid || '').toLowerCase();
                          return email.includes(q) || name.includes(q) || uid.includes(q);
                        })
                        .map(u => {
                          const isChecked = selectedUserIds.includes(u.uid);
                          return (
                            <label key={u.uid} className="flex items-center space-x-2.5 p-2 rounded-lg hover:bg-white/5 cursor-pointer transition-colors border border-transparent hover:border-white/5">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => {
                                  if (isChecked) {
                                    setSelectedUserIds(selectedUserIds.filter(id => id !== u.uid));
                                  } else {
                                    setSelectedUserIds([...selectedUserIds, u.uid]);
                                  }
                                }}
                                className="rounded border-white/20 bg-black/40 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                              />
                              <div className="text-[11px] truncate">
                                <span className="text-white block font-semibold leading-none truncate">{u.email}</span>
                                <span className="text-slate-400 text-[9px] leading-tight mt-0.5 block truncate">{u.displayName || u.name || 'Anonymous'} ({u.uid})</span>
                              </div>
                            </label>
                          );
                        })}
                      {users
                        .filter(u => u.role !== 'admin')
                        .filter(u => {
                          if (!giveawayUserSearch.trim()) return true;
                          const q = giveawayUserSearch.toLowerCase().trim();
                          return (u.email || '').toLowerCase().includes(q) || 
                                 (u.displayName || u.name || '').toLowerCase().includes(q) || 
                                 (u.uid || '').toLowerCase().includes(q);
                        }).length === 0 && (
                        <p className="text-slate-500 text-center py-6 text-xs">
                          {giveawayUserSearch ? `No traders found matching "${giveawayUserSearch}"` : 'No registered traders found.'}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Account Specifications */}
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-400">Account Type</label>
                      <select
                        value={giveawayType}
                        onChange={(e) => {
                          const type = e.target.value as AccountType;
                          setGiveawayType(type);
                          // Reset sizes based on type
                          if (type === 'trial') setGiveawaySize(1000);
                          else if (type === 'instant_bolt') setGiveawaySize(2000);
                          else setGiveawaySize(5000);
                        }}
                        className="w-full h-10 bg-black/30 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-blue-500"
                      >
                        <option value="one_step">One Step Evaluation</option>
                        <option value="two_step">Two Step Evaluation</option>
                        <option value="payout_later">Payout Later Challenge</option>
                        <option value="instant_bolt">ATF Instant (Funded)</option>
                        <option value="trial">AT Trial Account</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-400">Account Size</label>
                      <select
                        value={giveawaySize}
                        onChange={(e) => setGiveawaySize(Number(e.target.value))}
                        className="w-full h-10 bg-black/30 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-blue-500"
                      >
                        {giveawayType === 'trial' ? (
                          <option value="1000">$1,000 (AT Trial)</option>
                        ) : giveawayType === 'instant_bolt' ? (
                          <>
                            <option value="2000">$2,000 (ATF Instant)</option>
                            <option value="3000">$3,000 (ATF Instant)</option>
                            <option value="6000">$6,000 (ATF Instant)</option>
                            <option value="9000">$9,000 (ATF Instant)</option>
                          </>
                        ) : (
                          <>
                            <option value="5000">$5,000</option>
                            <option value="10000">$10,000</option>
                            <option value="25000">$25,000</option>
                            <option value="50000">$50,000</option>
                            <option value="100000">$100,000</option>
                          </>
                        )}
                      </select>
                    </div>

                    <div className="pt-2 space-y-2">
                      <button
                        onClick={handleProvisionGiveaway}
                        className="w-full h-11 bg-amber-600 hover:bg-amber-500 text-white font-bold rounded-full text-xs flex items-center justify-center space-x-1.5 transition-colors shadow-lg shadow-amber-600/10 cursor-pointer"
                      >
                        <Gift className="w-4 h-4" />
                        <span>Instantly Provision Funded Giveaway</span>
                      </button>
                      
                      <button
                        onClick={async () => {
                          if (selectedUserIds.length === 0) {
                            setManualAccountMsg("Please select at least one trader first.");
                            return;
                          }
                          const matchedPkg = CHALLENGE_PACKAGES.find(p => p.type === giveawayType && p.size === giveawaySize)
                            || CHALLENGE_PACKAGES.find(p => p.type === giveawayType)
                            || CHALLENGE_PACKAGES[0];

                          try {
                            let successCount = 0;
                            for (const userId of selectedUserIds) {
                              const targetUser = users.find(u => u.uid === userId || u.id === userId);
                              const accountId = 'AT-' + Math.floor(100000 + Math.random() * 900000);
                              const randomLogin = String(Math.floor(2000000 + Math.random() * 8000000));
                              const randomPassword = Math.random().toString(36).substring(2, 10).toUpperCase();

                              const newAccount = {
                                id: accountId,
                                userId: userId,
                                userEmail: targetUser?.email || 'unknown@atfunding.io',
                                accountType: giveawayType,
                                size: giveawaySize,
                                balance: giveawaySize,
                                startingBalance: giveawaySize,
                                equity: giveawaySize,
                                dailyStartingBalance: giveawaySize,
                                dailyStartingEquity: giveawaySize,
                                phase: 1, // Phase 1 evaluation
                                status: 'active',
                                login: randomLogin,
                                password: randomPassword,
                                platform: 'ATTerminal',
                                server: 'ATFunding-DemoServer',
                                profitTarget: matchedPkg.profitTargetPercent > 0 ? (giveawaySize * matchedPkg.profitTargetPercent / 100) : 0,
                                dailyDrawdownLimit: giveawaySize * matchedPkg.dailyDrawdownPercent / 100,
                                maxDrawdownLimit: giveawaySize * matchedPkg.maxDrawdownPercent / 100,
                                createdAt: new Date().toISOString(),
                                isGiveaway: false
                              };

                              await setDoc(doc(db, 'accounts', accountId), newAccount);
                              successCount++;
                            }

                            setManualAccountMsg(`Instantly provisioned ${successCount} Evaluation Challenge Account(s) successfully!`);
                            setSelectedUserIds([]);
                            fetchAllData();
                          } catch (e) {
                            console.error(e);
                            setManualAccountMsg("Evaluation challenge provisioning failed.");
                          }
                        }}
                        className="w-full h-11 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-full text-xs flex items-center justify-center space-x-1.5 transition-colors shadow-lg shadow-blue-600/10 cursor-pointer"
                      >
                        <Award className="w-4 h-4" />
                        <span>Instantly Provision Evaluation (Phase 1)</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Active Prop Accounts List with Search */}
              <div className="lg:col-span-4 bg-white/5 border border-white/10 rounded-3xl p-6 space-y-4 backdrop-blur-sm shadow-xl">
                <h3 className="text-base font-bold text-white uppercase tracking-wider flex items-center justify-between">
                  <span>All Prop Accounts ({accounts.length})</span>
                  <span className="text-[10px] text-slate-500 font-mono">Live Sync</span>
                </h3>

                {/* Account Search Input */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search account ID, email, status..."
                    value={propAccountSearch}
                    onChange={(e) => setPropAccountSearch(e.target.value)}
                    className="w-full h-8 pl-8 pr-7 bg-black/40 border border-blue-500/30 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-400 font-medium"
                  />
                  {propAccountSearch && (
                    <button
                      type="button"
                      onClick={() => setPropAccountSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs font-bold"
                    >
                      ✕
                    </button>
                  )}
                </div>

                <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                  {accounts
                    .filter(acc => {
                      if (!propAccountSearch.trim()) return true;
                      const q = propAccountSearch.toLowerCase().trim();
                      return (acc.id || '').toLowerCase().includes(q) ||
                             (acc.userEmail || '').toLowerCase().includes(q) ||
                             (acc.status || '').toLowerCase().includes(q) ||
                             (acc.accountType || '').toLowerCase().includes(q);
                    })
                    .map(acc => (
                    <div key={acc.id} className="p-3 bg-white/5 border border-white/10 rounded-2xl text-xs flex justify-between items-center hover:border-white/20 transition-colors">
                      <div>
                        <div className="flex items-center space-x-1.5">
                          <p className="font-bold text-white font-mono">{acc.id}</p>
                          {acc.isGiveaway && (
                            <span className="bg-amber-500/10 border border-amber-500/25 text-amber-400 text-[8px] px-1 py-0.5 rounded font-bold uppercase">Giveaway</span>
                          )}
                        </div>
                        <p className="text-[10px] text-slate-400 mt-0.5">{acc.userEmail}</p>
                        <p className="text-[9px] text-slate-500 capitalize">{acc.accountType.replace('_', ' ')} - ${acc.size.toLocaleString()}</p>
                      </div>
                      <div className="text-right">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase ${
                          acc.status === 'active' ? 'bg-emerald-500/10 text-emerald-400' :
                          acc.status === 'breached' ? 'bg-red-500/10 text-red-400' : 'bg-amber-500/10 text-amber-400'
                        }`}>
                          {acc.status}
                        </span>
                        <p className="text-[10px] font-mono text-slate-400 mt-1">Bal: ${acc.balance.toLocaleString()}</p>
                      </div>
                    </div>
                  ))}
                  {accounts
                    .filter(acc => {
                      if (!propAccountSearch.trim()) return true;
                      const q = propAccountSearch.toLowerCase().trim();
                      return (acc.id || '').toLowerCase().includes(q) ||
                             (acc.userEmail || '').toLowerCase().includes(q) ||
                             (acc.status || '').toLowerCase().includes(q) ||
                             (acc.accountType || '').toLowerCase().includes(q);
                    }).length === 0 && (
                    <p className="text-slate-500 text-center py-12 text-xs">
                      {propAccountSearch ? `No accounts matching "${propAccountSearch}"` : 'No active prop accounts found.'}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: PAYOUT APPROVALS */}
          {activeTab === 'payouts' && (
            <div className="bg-white/5 border border-white/10 rounded-3xl p-5 backdrop-blur-sm shadow-xl">
              <h3 className="text-base font-bold text-white uppercase tracking-wider mb-4">Pending Profit Share Requests</h3>
              {payouts.filter(p => p.status === 'pending').length === 0 ? (
                <div className="py-12 text-center text-xs text-slate-500">No pending payout requests.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead>
                      <tr className="border-b border-white/10 font-mono uppercase text-slate-400">
                        <th className="py-2">Payout ID</th>
                        <th className="py-2">User Email</th>
                        <th className="py-2">Account ID</th>
                        <th className="py-2">Amount Requested</th>
                        <th className="py-2">Method / Address</th>
                        <th className="py-2 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {payouts.filter(p => p.status === 'pending').map((payout) => (
                        <tr key={payout.id}>
                          <td className="py-3 font-mono font-bold text-white">{payout.id}</td>
                          <td className="py-3">{payout.userEmail || 'trader@atfunding.io'}</td>
                          <td className="py-3 font-mono">{payout.accountId}</td>
                          <td className="py-3 font-mono text-emerald-400 font-bold">${payout.amount.toFixed(2)}</td>
                          <td className="py-3">
                            <span className="font-bold text-white">{payout.payoutMethod}</span>
                            <p className="text-[10px] text-slate-500 truncate max-w-[150px]">{payout.payoutAddress}</p>
                          </td>
                          <td className="py-3 text-right space-x-2">
                            <button
                              onClick={() => handleApprovePayout(payout)}
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-full text-[10px] transition-colors"
                            >
                              Approve & Certify
                            </button>
                            <button
                              onClick={() => handleRejectPayout(payout.id, payout.accountId)}
                              className="px-3 py-1.5 bg-red-600/10 hover:bg-red-600 border border-red-600/20 text-red-400 hover:text-white rounded-full text-[10px] transition-all"
                            >
                              Reject
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB: KYC VERIFICATION PANEL */}
          {activeTab === 'kyc_verification' && (
            <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-sm shadow-xl space-y-6 animate-fade-in">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-white/10 pb-4">
                <div>
                  <h3 className="text-base font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <Shield className="w-5 h-5 text-blue-400" />
                    <span>KYC Verification Management</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">Review trader identity documentation, passport/ID proofs, and selfie verifications.</p>
                </div>

                {/* Status Filter buttons */}
                <div className="flex items-center space-x-1.5 bg-black/40 p-1 rounded-full border border-white/10">
                  {(['All', 'pending', 'approved', 'rejected'] as const).map(st => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setKycStatusFilter(st)}
                      className={`px-3 py-1 rounded-full text-xs font-bold uppercase transition-all cursor-pointer ${
                        kycStatusFilter === st
                          ? 'bg-blue-600 text-white shadow-md'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {st === 'All' ? 'All Records' : st}
                    </button>
                  ))}
                </div>
              </div>

              {/* Search Bar */}
              <div className="relative max-w-md">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search by name, email, phone, or country..."
                  value={kycSearch}
                  onChange={(e) => setKycSearch(e.target.value)}
                  className="w-full h-10 bg-black/30 border border-white/10 rounded-xl pl-10 pr-4 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>

              {/* KYC Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-slate-300">
                  <thead>
                    <tr className="border-b border-white/10 font-mono uppercase text-slate-400">
                      <th className="py-3">User Name</th>
                      <th className="py-3">Email</th>
                      <th className="py-3">Phone Number</th>
                      <th className="py-3">Country</th>
                      <th className="py-3">Account Type</th>
                      <th className="py-3">KYC Status</th>
                      <th className="py-3">Documents</th>
                      <th className="py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {users
                      .filter(u => {
                        const status = u.kycStatus || 'unverified';
                        if (kycStatusFilter !== 'All' && status !== kycStatusFilter) return false;
                        
                        const queryLower = kycSearch.toLowerCase();
                        if (!queryLower) return true;
                        
                        const fullName = `${u.displayName || u.name || ''} ${u.firstName || ''} ${u.lastName || ''}`.toLowerCase();
                        const email = (u.email || '').toLowerCase();
                        const phone = (u.phoneNumber || u.phone || '').toLowerCase();
                        const country = (u.country || '').toLowerCase();
                        
                        return fullName.includes(queryLower) || email.includes(queryLower) || phone.includes(queryLower) || country.includes(queryLower);
                      })
                      .map(u => {
                        const userAccounts = accounts.filter(a => a.userId === u.uid);
                        const accountTypesStr = userAccounts.length > 0 
                          ? Array.from(new Set(userAccounts.map(a => a.accountType === 'trial' ? 'AT Trial' : a.accountType === 'instant_bolt' ? 'ATF Instant' : a.accountType.replace('_', ' ')))).join(', ')
                          : 'No Accounts';
                        const status = u.kycStatus || 'unverified';
                        const docs = u.kycDocuments || {};

                        return (
                          <tr key={u.uid} className="hover:bg-white/[0.02] transition-colors">
                            <td className="py-3.5">
                              <div className="flex flex-col">
                                <span className="font-bold text-white text-sm">{u.displayName || u.name || `${u.firstName || ''} ${u.lastName || ''}`.trim() || 'Trader'}</span>
                                {u.username && <span className="text-[10px] font-mono text-blue-400">@{u.username}</span>}
                              </div>
                            </td>
                            <td className="py-3.5 font-mono text-slate-200">{u.email}</td>
                            <td className="py-3.5 font-mono text-slate-300">{u.phoneNumber || u.phone || 'N/A'}</td>
                            <td className="py-3.5 font-medium text-slate-300">{u.country || 'N/A'}</td>
                            <td className="py-3.5">
                              <span className="px-2 py-0.5 bg-white/5 border border-white/10 rounded text-[10px] font-mono font-bold text-slate-300 capitalize">
                                {accountTypesStr}
                              </span>
                            </td>
                            <td className="py-3.5">
                              <span className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-bold uppercase border ${
                                status === 'approved' 
                                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' 
                                  : status === 'pending'
                                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                                  : status === 'rejected'
                                  ? 'bg-red-500/10 text-red-400 border-red-500/20'
                                  : 'bg-slate-500/10 text-slate-400 border-slate-500/20'
                              }`}>
                                {status === 'approved' ? 'Approved' : status === 'pending' ? 'Pending' : status === 'rejected' ? 'Rejected' : 'Unverified'}
                              </span>
                            </td>
                            <td className="py-3.5">
                              <div className="flex items-center space-x-2">
                                {docs.docFront || docs.passport || docs.idCard ? (
                                  <img
                                    src={docs.docFront || docs.passport || docs.idCard}
                                    alt="Front"
                                    title="Click to inspect Front ID"
                                    onClick={() => setLightboxImage({
                                      src: docs.docFront || docs.passport || docs.idCard || "",
                                      title: `${u.displayName || u.name || 'Trader'}'s Front ID`
                                    })}
                                    className="w-10 h-10 object-contain bg-black/60 rounded-lg border border-white/10 hover:border-blue-400 cursor-pointer hover:scale-110 transition-transform p-0.5"
                                    referrerPolicy="no-referrer"
                                  />
                                ) : (
                                  <span className="text-[10px] text-slate-600 font-mono">No Front</span>
                                )}

                                {docs.docBack ? (
                                  <img
                                    src={docs.docBack}
                                    alt="Back"
                                    title="Click to inspect Back ID"
                                    onClick={() => setLightboxImage({
                                      src: docs.docBack || "",
                                      title: `${u.displayName || u.name || 'Trader'}'s Back ID`
                                    })}
                                    className="w-10 h-10 object-contain bg-black/60 rounded-lg border border-white/10 hover:border-blue-400 cursor-pointer hover:scale-110 transition-transform p-0.5"
                                    referrerPolicy="no-referrer"
                                  />
                                ) : (
                                  <span className="text-[10px] text-slate-600 font-mono">No Back</span>
                                )}

                                {docs.selfie ? (
                                  <img
                                    src={docs.selfie}
                                    alt="Selfie"
                                    title="Click to inspect Selfie"
                                    onClick={() => setLightboxImage({
                                      src: docs.selfie || "",
                                      title: `${u.displayName || u.name || 'Trader'}'s Face Selfie`
                                    })}
                                    className="w-10 h-10 object-contain bg-black/60 rounded-lg border border-white/10 hover:border-blue-400 cursor-pointer hover:scale-110 transition-transform p-0.5"
                                    referrerPolicy="no-referrer"
                                  />
                                ) : (
                                  <span className="text-[10px] text-slate-600 font-mono">No Selfie</span>
                                )}
                              </div>
                            </td>
                            <td className="py-3.5 text-right space-x-1.5 whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => setViewingKycUser(u)}
                                className="px-2.5 py-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-lg text-[10px] font-bold transition-all cursor-pointer"
                              >
                                View Documents
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  await updateDoc(doc(db, 'users', u.uid), { kycStatus: 'approved' });
                                }}
                                className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-[10px] font-bold transition-all cursor-pointer shadow-sm shadow-emerald-600/20"
                              >
                                Approve KYC
                              </button>
                              <button
                                type="button"
                                onClick={async () => {
                                  await updateDoc(doc(db, 'users', u.uid), { kycStatus: 'rejected' });
                                }}
                                className="px-2.5 py-1 bg-red-600/10 hover:bg-red-600 border border-red-600/20 text-red-400 hover:text-white rounded-lg text-[10px] font-bold transition-all cursor-pointer"
                              >
                                Reject KYC
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB: CHALLENGE REVIEWS & PHASE APPROVAL WORKFLOW */}
          {activeTab === 'challenge_reviews' && (
            <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-sm shadow-xl space-y-6 animate-fade-in">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-white/10 pb-4">
                <div>
                  <h3 className="text-base font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <Award className="w-5 h-5 text-amber-400" />
                    <span>Pending Challenge Reviews & Manual Audit Panel</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">Audit trader evaluation performance, inspect trade histories and rule violations, and approve or reject accounts.</p>
                </div>
                <div className="flex gap-2 font-mono text-xs">
                  <span className="px-3.5 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 font-bold flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-amber-400" />
                    <span>
                      {accounts.filter(a => 
                        a.status === 'pending_review' || 
                        a.status === 'Pending Review' || 
                        a.status === 'phase2_pending' || 
                        a.status === 'funded_pending' || 
                        a.status === 'Pending Approval' || 
                        a.status === 'passed_phase1' || 
                        a.status === 'passed_phase2' || 
                        a.phaseStatus === 'phase2_pending' || 
                        a.phaseStatus === 'funded_pending'
                      ).length} Pending Reviews
                    </span>
                  </span>
                </div>
              </div>

              {accounts.filter(a => 
                a.status === 'pending_review' || 
                a.status === 'Pending Review' || 
                a.status === 'phase2_pending' || 
                a.status === 'funded_pending' || 
                a.status === 'Pending Approval' || 
                a.status === 'passed_phase1' || 
                a.status === 'passed_phase2' || 
                a.phaseStatus === 'phase2_pending' || 
                a.phaseStatus === 'funded_pending'
              ).length === 0 ? (
                <div className="py-16 text-center text-xs text-slate-500 space-y-2">
                  <Award className="w-12 h-12 mx-auto text-slate-600 opacity-40" />
                  <p className="font-bold text-slate-400 text-sm">No Pending Account Reviews</p>
                  <p className="text-slate-500">All challenge evaluations and phase promotions have been processed.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead>
                      <tr className="border-b border-white/10 font-mono uppercase text-slate-400 text-[10px]">
                        <th className="py-3 px-3">Trader Name & Login</th>
                        <th className="py-3 px-3">Challenge Type</th>
                        <th className="py-3 px-3">Account Size</th>
                        <th className="py-3 px-3">Profit & Gain %</th>
                        <th className="py-3 px-3">Rule Violations</th>
                        <th className="py-3 px-3">Trading History</th>
                        <th className="py-3 px-3 text-right">Review Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10 font-medium">
                      {accounts.filter(a => 
                        a.status === 'pending_review' || 
                        a.status === 'Pending Review' || 
                        a.status === 'phase2_pending' || 
                        a.status === 'funded_pending' || 
                        a.status === 'Pending Approval' || 
                        a.status === 'passed_phase1' || 
                        a.status === 'passed_phase2' || 
                        a.phaseStatus === 'phase2_pending' || 
                        a.phaseStatus === 'funded_pending'
                      ).map((acc) => {
                        const userObj = users.find(u => u.uid === acc.userId || u.id === acc.userId || u.email === acc.userEmail);
                        const traderName = acc.userName || userObj?.displayName || userObj?.name || userObj?.email?.split('@')[0] || 'Trader';
                        const startBal = acc.startingBalance || acc.size || 10000;
                        const profit = acc.balance - startBal;
                        const profitPct = startBal > 0 ? ((profit / startBal) * 100).toFixed(2) : '0.00';

                        const accViolations = ruleViolations.filter(v => v.accountId === acc.id || v.login === acc.login || v.userId === acc.userId);
                        const accTrades = trades.filter(t => t.accountId === acc.id || t.userId === acc.userId);

                        let challengeLabel = '1-Step Challenge';
                        if (acc.accountType === 'two_step') {
                          if (acc.status === 'phase2_pending' || acc.phaseStatus === 'phase2_pending' || acc.phase === 1) {
                            challengeLabel = '2-Step Phase 1';
                          } else {
                            challengeLabel = '2-Step Phase 2';
                          }
                        } else if (acc.accountType === 'payout_later') {
                          challengeLabel = 'Payout Later';
                        } else if (acc.accountType === 'one_step') {
                          challengeLabel = '1-Step Challenge';
                        }

                        return (
                          <tr key={acc.id} className="hover:bg-white/[0.02] transition-colors">
                            <td className="py-3 px-3 space-y-0.5">
                              <span className="font-bold text-white block">{traderName}</span>
                              <div className="flex items-center gap-1.5 font-mono text-[10px] text-slate-400">
                                <span>Login: {acc.login || acc.id}</span>
                                <span>•</span>
                                <span className="text-slate-500 truncate max-w-[140px]">{acc.userEmail || userObj?.email}</span>
                              </div>
                            </td>
                            <td className="py-3 px-3 font-mono text-slate-200">
                              <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-300 border border-blue-500/20 uppercase">
                                {challengeLabel}
                              </span>
                            </td>
                            <td className="py-3 px-3 font-mono font-bold text-white">
                              ${startBal.toLocaleString()}
                            </td>
                            <td className="py-3 px-3 font-mono">
                              <div className={`font-bold ${profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {profit >= 0 ? '+' : ''}${profit.toFixed(2)}
                              </div>
                              <div className={`text-[10px] ${profit >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                                ({profit >= 0 ? '+' : ''}{profitPct}%)
                              </div>
                            </td>
                            <td className="py-3 px-3">
                              <button
                                type="button"
                                onClick={() => setReviewViolationsAccount(acc)}
                                className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-bold border flex items-center gap-1 cursor-pointer transition-colors ${
                                  accViolations.length > 0 
                                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 hover:bg-rose-500/30' 
                                    : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
                                }`}
                              >
                                <AlertTriangle className="w-3 h-3" />
                                <span>{accViolations.length} Violations</span>
                              </button>
                            </td>
                            <td className="py-3 px-3">
                              <button
                                type="button"
                                onClick={() => setReviewHistoryAccount(acc)}
                                className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 flex items-center gap-1 cursor-pointer transition-colors"
                              >
                                <FileText className="w-3 h-3 text-blue-400" />
                                <span>{accTrades.length} Trades</span>
                              </button>
                            </td>
                            <td className="py-3 px-3 text-right space-x-2">
                              {/* Approve Button */}
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    const nowIso = new Date().toISOString();
                                    const notifId = 'NOTIF-' + Math.floor(100000 + Math.random() * 900000);
                                    const recipientEmail = acc.userEmail || userObj?.email || '';

                                    if (challengeLabel === '2-Step Phase 1') {
                                      const phase2Target = startBal * 0.05;
                                      await updateDoc(doc(db, 'accounts', acc.id), {
                                        phase: 2,
                                        status: 'active',
                                        phaseStatus: 'phase2_active',
                                        balance: startBal,
                                        equity: startBal,
                                        dailyStartingBalance: startBal,
                                        dailyStartingEquity: startBal,
                                        profitTarget: phase2Target,
                                        approvedAt: nowIso
                                      });

                                      await setDoc(doc(db, 'notifications', notifId), {
                                        id: notifId,
                                        userId: acc.userId,
                                        title: 'Phase 2 Unlocked! 🎉',
                                        message: `Congratulations! Your Phase 1 performance on Account #${acc.login || acc.id} was verified and approved by Admin. Phase 2 is now active!`,
                                        type: 'success',
                                        read: false,
                                        createdAt: nowIso
                                      });

                                      if (recipientEmail) {
                                        const qId = `queue-appr-${Date.now()}`;
                                        await setDoc(doc(db, 'email_queue', qId), {
                                          id: qId,
                                          recipient: recipientEmail,
                                          subject: 'ATFunding - Phase 2 Unlocked! 🎉',
                                          message: `Hello ${traderName},\n\nGreat news! Your Phase 1 evaluation for Account #${acc.login || acc.id} has been approved by our risk management team.\n\nYour Phase 2 Evaluation is now ACTIVE! Target: 5% ($${phase2Target.toLocaleString()}).\n\nATFunding Team`,
                                          createdAt: nowIso,
                                          status: 'pending'
                                        });
                                      }

                                      alert(`Phase 2 unlocked successfully for Account #${acc.login || acc.id}! Notification & email sent.`);

                                    } else if (challengeLabel === '2-Step Phase 2' || challengeLabel === '1-Step Challenge' || challengeLabel === 'Payout Later') {
                                      await updateDoc(doc(db, 'accounts', acc.id), {
                                        phase: 3,
                                        accountType: 'funded',
                                        status: 'active',
                                        phaseStatus: 'funded',
                                        balance: startBal,
                                        equity: startBal,
                                        dailyStartingBalance: startBal,
                                        dailyStartingEquity: startBal,
                                        profitTarget: 0,
                                        approvedAt: nowIso
                                      });

                                      await setDoc(doc(db, 'notifications', notifId), {
                                        id: notifId,
                                        userId: acc.userId,
                                        title: 'Live Funded Account Approved! 🏆',
                                        message: `Congratulations! Your evaluation for Account #${acc.login || acc.id} was verified and approved! You are now an official Funded Trader. Payout request section unlocked!`,
                                        type: 'success',
                                        read: false,
                                        createdAt: nowIso
                                      });

                                      if (recipientEmail) {
                                        const qId = `queue-appr-${Date.now()}`;
                                        await setDoc(doc(db, 'email_queue', qId), {
                                          id: qId,
                                          recipient: recipientEmail,
                                          subject: 'ATFunding - Live Funded Account Issued! 🏆',
                                          message: `Hello ${traderName},\n\nCongratulations! Your review for Account #${acc.login || acc.id} has been officially APPROVED by our management team.\n\nYour live Funded Account ($${startBal.toLocaleString()}) is now active! The payout withdrawal section is now unlocked on your dashboard.\n\nWelcome to ATFunding!`,
                                          createdAt: nowIso,
                                          status: 'pending'
                                        });
                                      }

                                      alert(`Funded Account approved successfully for Account #${acc.login || acc.id}! Payout section unlocked.`);

                                    } else {
                                      await updateDoc(doc(db, 'accounts', acc.id), {
                                        status: 'active',
                                        approvedAt: nowIso
                                      });
                                      alert(`Account ${acc.login || acc.id} approved.`);
                                    }

                                    fetchAllData();
                                  } catch (err: any) {
                                    alert("Approval Error: " + err.message);
                                  }
                                }}
                                className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold rounded-full text-[10px] transition-colors uppercase tracking-wider shadow-md shadow-emerald-500/20 cursor-pointer"
                              >
                                Approve
                              </button>

                              {/* Reject Button */}
                              <button
                                type="button"
                                onClick={() => {
                                  setReviewRejectAccount(acc);
                                  setReviewRejectReason('');
                                }}
                                className="px-3 py-1.5 bg-rose-500/20 hover:bg-rose-500 text-rose-300 hover:text-white border border-rose-500/40 rounded-full text-[10px] font-extrabold transition-colors uppercase tracking-wider cursor-pointer"
                              >
                                Reject
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* MODAL: REJECTION REASON (REQUIRED FIELD) */}
              {reviewRejectAccount && (
                <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
                  <div className="bg-slate-900 border border-rose-500/30 rounded-3xl p-6 max-w-md w-full space-y-5 shadow-2xl animate-fade-in">
                    <div className="flex justify-between items-center border-b border-white/10 pb-3">
                      <div className="flex items-center gap-2 text-rose-400">
                        <AlertTriangle className="w-5 h-5" />
                        <h3 className="text-sm font-bold text-white uppercase tracking-wider">Reject Account Review</h3>
                      </div>
                      <button onClick={() => setReviewRejectAccount(null)} className="text-slate-400 hover:text-white">
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="space-y-3 text-xs text-slate-300">
                      <p className="leading-relaxed">
                        Specify the reason for rejecting Account <span className="text-white font-bold font-mono">#{reviewRejectAccount.login || reviewRejectAccount.id}</span>.
                      </p>
                      <div className="p-3 bg-white/5 border border-white/10 rounded-2xl space-y-1 font-mono text-[11px]">
                        <div>User: <span className="text-white font-bold">{reviewRejectAccount.userEmail || reviewRejectAccount.userId}</span></div>
                        <div>Size: <span className="text-emerald-400 font-bold">${reviewRejectAccount.startingBalance?.toLocaleString()}</span></div>
                      </div>

                      <div className="space-y-1.5">
                        <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                          Rejection Reason <span className="text-rose-400">* Required</span>
                        </label>
                        <textarea
                          rows={3}
                          value={reviewRejectReason}
                          onChange={(e) => setReviewRejectReason(e.target.value)}
                          placeholder="e.g. Non-compliance with risk guidelines: hold time limit exceeded or copy trading detected."
                          className="w-full bg-slate-950 border border-white/15 rounded-xl p-3 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-rose-500 transition-colors"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => setReviewRejectAccount(null)}
                        className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 rounded-full text-xs font-bold transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!reviewRejectReason.trim()) {
                            alert("Rejection reason is required before rejecting an account.");
                            return;
                          }

                          try {
                            const nowIso = new Date().toISOString();
                            const acc = reviewRejectAccount;
                            const reasonText = reviewRejectReason.trim();

                            await updateDoc(doc(db, 'accounts', acc.id), {
                              status: 'rejected',
                              rejectionReason: reasonText,
                              breachReason: reasonText,
                              rejectedAt: nowIso
                            });

                            // Dashboard notification
                            const notifId = 'NOTIF-' + Math.floor(100000 + Math.random() * 900000);
                            await setDoc(doc(db, 'notifications', notifId), {
                              id: notifId,
                              userId: acc.userId,
                              title: 'Account Review Rejected ❌',
                              message: `Your review for Account #${acc.login || acc.id} was rejected. Reason: ${reasonText}`,
                              type: 'error',
                              read: false,
                              createdAt: nowIso
                            });

                            // Queue email
                            const userEmail = acc.userEmail || '';
                            if (userEmail) {
                              const qId = `queue-rej-${Date.now()}`;
                              await setDoc(doc(db, 'email_queue', qId), {
                                id: qId,
                                recipient: userEmail,
                                subject: `ATFunding - Account Review Update: Rejected`,
                                message: `Hello Trader,\n\nYour review for Account #${acc.login || acc.id} has been rejected during audit.\n\nRejection Reason:\n${reasonText}\n\nIf you have any questions, please contact ATFunding support.\n\nATFunding Compliance Team`,
                                createdAt: nowIso,
                                status: 'pending'
                              });
                            }

                            alert(`Account #${acc.login || acc.id} review rejected. Trader notified via email and dashboard.`);
                            setReviewRejectAccount(null);
                            setReviewRejectReason('');
                            fetchAllData();
                          } catch (err: any) {
                            alert("Rejection Error: " + err.message);
                          }
                        }}
                        className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-full text-xs shadow-lg shadow-rose-600/20 transition-colors"
                      >
                        Confirm Rejection
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* MODAL: TRADING HISTORY */}
              {reviewHistoryAccount && (
                <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
                  <div className="bg-slate-900 border border-white/10 rounded-3xl p-6 max-w-3xl w-full space-y-5 shadow-2xl max-h-[85vh] flex flex-col">
                    <div className="flex justify-between items-center border-b border-white/10 pb-3">
                      <div className="flex items-center gap-2">
                        <FileText className="w-5 h-5 text-blue-400" />
                        <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                          Trading History — Account #{reviewHistoryAccount.login || reviewHistoryAccount.id}
                        </h3>
                      </div>
                      <button onClick={() => setReviewHistoryAccount(null)} className="text-slate-400 hover:text-white">
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="overflow-y-auto flex-1 space-y-3 pr-1">
                      {trades.filter(t => t.accountId === reviewHistoryAccount.id || t.userId === reviewHistoryAccount.userId).length === 0 ? (
                        <p className="text-center py-10 text-xs text-slate-500">No executed trades logged for this account.</p>
                      ) : (
                        <table className="w-full text-left text-xs text-slate-300">
                          <thead>
                            <tr className="border-b border-white/10 font-mono uppercase text-slate-400 text-[10px]">
                              <th className="py-2 px-2">Symbol</th>
                              <th className="py-2 px-2">Type</th>
                              <th className="py-2 px-2">Lots</th>
                              <th className="py-2 px-2">Open Price</th>
                              <th className="py-2 px-2">Close Price</th>
                              <th className="py-2 px-2">Profit ($)</th>
                              <th className="py-2 px-2">Hold Time</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5 font-mono text-[11px]">
                            {trades.filter(t => t.accountId === reviewHistoryAccount.id || t.userId === reviewHistoryAccount.userId).map((t, idx) => {
                              const openTime = t.openTime ? new Date(t.openTime).getTime() : 0;
                              const closeTime = t.closeTime ? new Date(t.closeTime).getTime() : Date.now();
                              const holdMins = openTime > 0 ? Math.round((closeTime - openTime) / 60000) : 0;

                              return (
                                <tr key={t.id || idx} className="hover:bg-white/[0.02]">
                                  <td className="py-2 px-2 font-bold text-white">{t.symbol}</td>
                                  <td className="py-2 px-2">
                                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${t.type === 'BUY' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-rose-500/20 text-rose-400'}`}>
                                      {t.type}
                                    </span>
                                  </td>
                                  <td className="py-2 px-2 text-slate-300">{t.amount || t.lots || 0.1}</td>
                                  <td className="py-2 px-2 text-slate-400">{t.openPrice != null ? `$${Number(t.openPrice).toFixed(2)}` : 'N/A'}</td>
                                  <td className="py-2 px-2 text-slate-400">{t.closePrice != null ? `$${Number(t.closePrice).toFixed(2)}` : 'N/A'}</td>
                                  <td className={`py-2 px-2 font-bold ${Number(t.profit || 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                    {Number(t.profit || 0) >= 0 ? '+' : ''}${Number(t.profit || 0).toFixed(2)}
                                  </td>
                                  <td className="py-2 px-2 text-slate-400">
                                    {holdMins} min{holdMins !== 1 ? 's' : ''}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      )}
                    </div>

                    <div className="flex justify-end pt-2 border-t border-white/10">
                      <button
                        type="button"
                        onClick={() => setReviewHistoryAccount(null)}
                        className="px-5 py-2 bg-white/10 hover:bg-white/20 text-white rounded-full text-xs font-bold transition-colors"
                      >
                        Close History
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* MODAL: RULE VIOLATIONS */}
              {reviewViolationsAccount && (
                <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
                  <div className="bg-slate-900 border border-white/10 rounded-3xl p-6 max-w-xl w-full space-y-5 shadow-2xl">
                    <div className="flex justify-between items-center border-b border-white/10 pb-3">
                      <div className="flex items-center gap-2 text-rose-400">
                        <AlertTriangle className="w-5 h-5" />
                        <h3 className="text-sm font-bold text-white uppercase tracking-wider">
                          Rule Violations — Account #{reviewViolationsAccount.login || reviewViolationsAccount.id}
                        </h3>
                      </div>
                      <button onClick={() => setReviewViolationsAccount(null)} className="text-slate-400 hover:text-white">
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    <div className="space-y-3">
                      {ruleViolations.filter(v => v.accountId === reviewViolationsAccount.id || v.login === reviewViolationsAccount.login || v.userId === reviewViolationsAccount.userId).length === 0 ? (
                        <div className="p-6 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-center text-xs text-emerald-300">
                          ✅ Perfect Compliance! No rule violations or risk warnings detected on this account.
                        </div>
                      ) : (
                        ruleViolations.filter(v => v.accountId === reviewViolationsAccount.id || v.login === reviewViolationsAccount.login || v.userId === reviewViolationsAccount.userId).map((v, i) => (
                          <div key={v.id || i} className="p-3.5 bg-slate-950 border border-rose-500/20 rounded-2xl text-xs space-y-1">
                            <div className="flex justify-between items-center font-mono">
                              <span className="font-bold text-rose-300 uppercase">{v.ruleName || v.type || 'Rule Violation'}</span>
                              <span className="text-[10px] text-slate-500">{v.timestamp || v.createdAt ? new Date(v.timestamp || v.createdAt).toLocaleString() : 'Recent'}</span>
                            </div>
                            <p className="text-slate-300 text-[11px] leading-relaxed">{v.details || v.reason || v.message || 'Violation detected during trading session.'}</p>
                          </div>
                        ))
                      )}
                    </div>

                    <div className="flex justify-end pt-2 border-t border-white/10">
                      <button
                        type="button"
                        onClick={() => setReviewViolationsAccount(null)}
                        className="px-5 py-2 bg-white/10 hover:bg-white/20 text-white rounded-full text-xs font-bold transition-colors"
                      >
                        Close Violations
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB: REFERRAL WITHDRAWALS MANAGER */}
          {activeTab === 'referral_withdrawals' && (
            <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-sm shadow-xl space-y-6 animate-fade-in">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-white/10 pb-4">
                <div>
                  <h3 className="text-base font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <DollarSign className="w-5 h-5 text-emerald-400" />
                    <span>Referral Commission Withdrawals Manager</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">Review and process partner referral commission payouts ($20 - $100 limits).</p>
                </div>
                <div className="flex gap-2 font-mono text-xs">
                  <span className="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 font-bold">
                    {referralWithdrawals.filter(r => r.status === 'Pending').length} Pending Requests
                  </span>
                </div>
              </div>

              {referralWithdrawals.length === 0 ? (
                <div className="py-16 text-center text-xs text-slate-500">
                  <DollarSign className="w-10 h-10 mx-auto text-slate-600 mb-3 opacity-50" />
                  <p>No referral withdrawal requests submitted yet.</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead>
                      <tr className="border-b border-white/10 font-mono uppercase text-slate-400 text-[10px]">
                        <th className="py-3 px-3">Request ID</th>
                        <th className="py-3 px-3">Trader Email</th>
                        <th className="py-3 px-3">Amount</th>
                        <th className="py-3 px-3">Method & Details</th>
                        <th className="py-3 px-3">Status</th>
                        <th className="py-3 px-3">Submitted At</th>
                        <th className="py-3 px-3 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10 font-medium">
                      {referralWithdrawals.map((req) => (
                        <tr key={req.id} className="hover:bg-white/[0.02]">
                          <td className="py-3 px-3 font-mono font-bold text-white">{req.id}</td>
                          <td className="py-3 px-3 text-slate-300">{req.userEmail}</td>
                          <td className="py-3 px-3 font-mono text-emerald-400 font-bold">${req.amount.toFixed(2)}</td>
                          <td className="py-3 px-3">
                            <span className="font-bold text-white block text-[11px]">{req.method}</span>
                            <span className="text-[10px] text-slate-400 font-mono select-all truncate max-w-[200px] block">{req.accountDetails}</span>
                          </td>
                          <td className="py-3 px-3">
                            <span className={`px-2 py-0.5 rounded text-[9px] font-mono font-bold uppercase ${
                              req.status === 'Paid' || req.status === 'Approved' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                              req.status === 'Rejected' ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            }`}>
                              {req.status}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-[10px] text-slate-500 font-mono">
                            {req.createdAt ? new Date(req.createdAt).toLocaleDateString() : 'N/A'}
                          </td>
                          <td className="py-3 px-3 text-right space-x-2">
                            {req.status === 'Pending' && (
                              <>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    try {
                                      await updateDoc(doc(db, 'referral_withdrawals', req.id), {
                                        status: 'Paid',
                                        processedAt: new Date().toISOString()
                                      });

                                      // Send notification
                                      const notifId = 'NOTIF-' + Math.floor(100000 + Math.random() * 900000);
                                      await setDoc(doc(db, 'notifications', notifId), {
                                        id: notifId,
                                        userId: req.userId,
                                        title: 'Referral Withdrawal Paid! 💵',
                                        message: `Your referral commission payout request of $${req.amount.toFixed(2)} (${req.method}) has been paid out successfully.`,
                                        type: 'success',
                                        read: false,
                                        createdAt: new Date().toISOString()
                                      });

                                      alert(`Referral withdrawal ${req.id} marked as Paid!`);
                                      fetchAllData();
                                    } catch (err: any) {
                                      alert("Error processing withdrawal: " + err.message);
                                    }
                                  }}
                                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-full text-[10px] transition-colors"
                                >
                                  Approve & Pay
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    const reason = prompt("Enter rejection reason:") || "Validation checks failed.";
                                    try {
                                      await updateDoc(doc(db, 'referral_withdrawals', req.id), {
                                        status: 'Rejected',
                                        rejectionReason: reason,
                                        processedAt: new Date().toISOString()
                                      });
                                      alert(`Withdrawal request ${req.id} rejected.`);
                                      fetchAllData();
                                    } catch (err: any) {
                                      alert("Error rejecting request: " + err.message);
                                    }
                                  }}
                                  className="px-3 py-1.5 bg-red-600/10 hover:bg-red-600 border border-red-600/20 text-red-400 hover:text-white rounded-full text-[10px] transition-colors"
                                >
                                  Reject
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 5: MANAGE COUPONS */}
          {activeTab === 'coupons' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Add Coupon */}
              <div className="lg:col-span-5 bg-white/5 border border-white/10 rounded-3xl p-5 space-y-4 backdrop-blur-sm shadow-xl">
                <h3 className="text-base font-bold text-white uppercase tracking-wider flex items-center gap-2">
                  <Ticket className="w-5 h-5 text-blue-400" />
                  <span>Add Discount Coupon</span>
                </h3>
                <form onSubmit={handleAddCoupon} className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-400">Coupon Code</label>
                    <input
                      type="text"
                      placeholder="e.g. FLASH80"
                      value={newCouponCode}
                      onChange={(e) => setNewCouponCode(e.target.value)}
                      className="w-full h-11 glass-input rounded-xl px-3 text-xs text-white uppercase focus:outline-none font-mono"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-400">Discount Type</label>
                      <select
                        value={newCouponType}
                        onChange={(e) => setNewCouponType(e.target.value as 'percent' | 'fixed')}
                        className="w-full h-11 glass-input rounded-xl px-3 text-xs text-white focus:outline-none font-mono bg-slate-900 border border-white/10"
                      >
                        <option value="percent">% Percentage</option>
                        <option value="fixed">$ Fixed Amount</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-400">
                        {newCouponType === 'percent' ? 'Discount %' : 'Discount ($)'}
                      </label>
                      <input
                        type="number"
                        min="1"
                        max={newCouponType === 'percent' ? 100 : 10000}
                        value={newCouponValue}
                        onChange={(e) => setNewCouponValue(Number(e.target.value))}
                        className="w-full h-11 glass-input rounded-xl px-3 text-xs text-white focus:outline-none font-mono"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-400">Max Usage Limit</label>
                      <input
                        type="number"
                        placeholder="Unlimited (e.g. 100)"
                        value={newCouponMaxUses}
                        onChange={(e) => setNewCouponMaxUses(e.target.value)}
                        className="w-full h-11 glass-input rounded-xl px-3 text-xs text-white focus:outline-none font-mono"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-400">Expiry Date</label>
                      <input
                        type="date"
                        value={newCouponExpiresAt}
                        onChange={(e) => setNewCouponExpiresAt(e.target.value)}
                        className="w-full h-11 glass-input rounded-xl px-3 text-xs text-white focus:outline-none font-mono bg-slate-900 border border-white/10"
                      />
                    </div>
                  </div>

                  {/* Account Types Checkbox Selector */}
                  <div className="space-y-2 pt-2 border-t border-white/10">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-bold text-slate-300">Applicable Accounts / Challenges</label>
                      <div className="flex space-x-2 text-[10px]">
                        <button
                          type="button"
                          onClick={() => setNewCouponAccountTypes(['one_step', 'two_step', 'payout_later', 'instant_bolt', 'trial'])}
                          className="text-blue-400 hover:underline font-semibold cursor-pointer"
                        >
                          Select All
                        </button>
                        <span className="text-slate-600">•</span>
                        <button
                          type="button"
                          onClick={() => setNewCouponAccountTypes([])}
                          className="text-slate-400 hover:underline cursor-pointer"
                        >
                          Clear
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1.5 bg-black/30 border border-white/10 rounded-2xl p-3">
                      {[
                        { id: 'one_step', label: 'One Step Challenge', icon: '⚡' },
                        { id: 'two_step', label: 'Two Step Challenge', icon: '🚀' },
                        { id: 'payout_later', label: 'Payout Later Challenge', icon: '⏳' },
                        { id: 'instant_bolt', label: 'Instant Bolt Account', icon: '⚡' },
                        { id: 'trial', label: 'AT Trial Account', icon: '🎁' },
                      ].map((opt) => {
                        const isChecked = newCouponAccountTypes.includes(opt.id);
                        return (
                          <label key={opt.id} className="flex items-center space-x-2.5 cursor-pointer p-1.5 hover:bg-white/5 rounded-xl transition-colors select-none">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => {
                                if (isChecked) {
                                  setNewCouponAccountTypes(newCouponAccountTypes.filter(t => t !== opt.id));
                                } else {
                                  setNewCouponAccountTypes([...newCouponAccountTypes, opt.id]);
                                }
                              }}
                              className="w-4 h-4 rounded border-white/20 bg-black text-blue-600 focus:ring-0 cursor-pointer"
                            />
                            <span className="text-xs font-medium text-slate-200 flex items-center gap-1.5">
                              <span>{opt.icon}</span>
                              <span>{opt.label}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                    <p className="text-[10px] text-slate-400 italic">This coupon code will only work when traders purchase the selected account types above.</p>
                  </div>

                  <button
                    type="submit"
                    className="w-full h-11 bg-blue-600 hover:bg-blue-500 text-white rounded-full text-xs font-bold transition-colors shadow-lg shadow-blue-500/10 cursor-pointer"
                  >
                    Add Code
                  </button>
                </form>
              </div>

              {/* Coupons List */}
              <div className="lg:col-span-7 bg-white/5 border border-white/10 rounded-3xl p-5 backdrop-blur-sm shadow-xl space-y-4">
                <h3 className="text-base font-bold text-white uppercase tracking-wider">Active Promo Coupons</h3>
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead>
                      <tr className="border-b border-white/10 font-mono uppercase text-slate-400">
                        <th className="py-2.5">Code</th>
                        <th className="py-2.5">Discount</th>
                        <th className="py-2.5">Usage</th>
                        <th className="py-2.5">Expiry</th>
                        <th className="py-2.5">Accounts</th>
                        <th className="py-2.5">Status</th>
                        <th className="py-2.5 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10 font-medium">
                      {coupons.map((c) => {
                        const types = c.applicableAccountTypes || ['all'];
                        const isAll = types.includes('all') || types.length === 5 || types.length === 0;

                        const isFixed = c.discountType === 'fixed' || (c.discountAmount && c.discountAmount > 0 && !c.discountPercent);
                        const discDisplay = isFixed ? `$${c.discountAmount} OFF` : `${c.discountPercent}% OFF`;
                        const usageDisplay = c.maxUses && c.maxUses > 0 ? `${c.usedCount || 0} / ${c.maxUses}` : `${c.usedCount || 0} (Unlimited)`;

                        return (
                          <tr key={c.code} className="hover:bg-white/[0.02]">
                            <td className="py-3 font-mono font-bold text-white">{c.code}</td>
                            <td className="py-3 font-mono text-blue-400 font-bold">{discDisplay}</td>
                            <td className="py-3 font-mono text-xs text-slate-300">{usageDisplay}</td>
                            <td className="py-3 font-mono text-xs text-slate-400">{c.expiresAt || 'No Expiry'}</td>
                            <td className="py-3">
                              {isAll ? (
                                <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-full text-[10px] font-bold">
                                  All
                                </span>
                              ) : (
                                <div className="flex flex-wrap gap-1 max-w-[150px]">
                                  {types.map(t => {
                                    const labels: Record<string, string> = {
                                      one_step: 'One Step',
                                      two_step: 'Two Step',
                                      payout_later: 'Payout Later',
                                      instant_bolt: 'Instant',
                                      trial: 'Trial'
                                    };
                                    return (
                                      <span key={t} className="px-1.5 py-0.5 bg-blue-500/10 text-blue-300 border border-blue-500/20 rounded text-[9px] font-mono">
                                        {labels[t] || t}
                                      </span>
                                    );
                                  })}
                                </div>
                              )}
                            </td>
                            <td className="py-3">
                              <button
                                onClick={() => handleToggleCoupon(c.code, c.active, c.id)}
                                className={`px-2 py-0.5 rounded-full text-[10px] font-bold cursor-pointer ${
                                  c.active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                                }`}
                              >
                                {c.active ? 'Active' : 'Disabled'}
                              </button>
                            </td>
                            <td className="py-3 text-right space-x-1">
                              <button
                                type="button"
                                onClick={() => setEditingCoupon({
                                  ...c,
                                  applicableAccountTypes: c.applicableAccountTypes || ['all']
                                })}
                                className="p-1.5 text-blue-400 hover:text-blue-300 hover:bg-white/5 rounded-lg transition-colors cursor-pointer"
                                title="Edit Coupon & Applicable Accounts"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteCoupon(c.code, c.id)}
                                className="p-1.5 text-red-400 hover:text-red-500 hover:bg-white/5 rounded-lg transition-colors cursor-pointer"
                                title="Delete Coupon"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 6: LIVE MONITOR & ALL TRADES */}
          {activeTab === 'trades' && (
            <div className="space-y-6 animate-fade-in">
              {/* Live Monitor Summary Cards */}
              {(() => {
                const openPositions = trades.filter((t) => t.status === 'open' || t.status === 'OPEN');
                const closedPositions = trades.filter((t) => t.status !== 'open' && t.status !== 'OPEN');

                let totalFloatingPnL = 0;
                let totalOpenVolume = 0;

                openPositions.forEach((t) => {
                  const dir = (t.type || 'buy').toLowerCase() as 'buy' | 'sell';
                  const lots = t.lots || (t as any).volume || 1;
                  const entryPrice = t.entryPrice || t.openPrice || 0;
                  const curBid = livePrices[t.symbol]?.bid || livePrices[t.symbol]?.last || entryPrice;
                  const curAsk = livePrices[t.symbol]?.ask || livePrices[t.symbol]?.last || entryPrice;
                  
                  const pnl = calculateTradePnL(t.symbol, dir, entryPrice, lots, curBid, curAsk);
                  totalFloatingPnL += pnl;
                  totalOpenVolume += lots;
                });

                return (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      <div className="bg-white/5 border border-white/10 rounded-3xl p-5 backdrop-blur-sm shadow-xl">
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Active Open User Trades</p>
                        <p className="text-2xl font-black text-white mt-1.5 font-mono">{openPositions.length}</p>
                        <p className="text-[11px] text-slate-400 mt-1">Live market positions</p>
                      </div>

                      <div className="bg-white/5 border border-white/10 rounded-3xl p-5 backdrop-blur-sm shadow-xl">
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Live Floating PnL</p>
                        <p className={`text-2xl font-black mt-1.5 font-mono ${totalFloatingPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {totalFloatingPnL >= 0 ? '+' : ''}${totalFloatingPnL.toFixed(2)}
                        </p>
                        <p className="text-[11px] text-slate-400 mt-1">Combined floating profit/loss</p>
                      </div>

                      <div className="bg-white/5 border border-white/10 rounded-3xl p-5 backdrop-blur-sm shadow-xl">
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Total Active Volume</p>
                        <p className="text-2xl font-black text-blue-400 mt-1.5 font-mono">{totalOpenVolume.toFixed(2)} Lots</p>
                        <p className="text-[11px] text-slate-400 mt-1 font-mono">Exposure across all symbols</p>
                      </div>

                      <div className="bg-white/5 border border-white/10 rounded-3xl p-5 backdrop-blur-sm shadow-xl">
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Total Historical Trades</p>
                        <p className="text-2xl font-black text-amber-400 mt-1.5 font-mono">{trades.length}</p>
                        <p className="text-[11px] text-slate-400 mt-1 font-mono">{closedPositions.length} closed trades</p>
                      </div>
                    </div>

                    {/* Active Open User Trades Table */}
                    <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-sm shadow-xl space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-base font-bold text-white flex items-center space-x-2">
                            <Activity className="w-5 h-5 text-emerald-400 animate-pulse" />
                            <span>Live Active User Positions & Floating PnL</span>
                          </h3>
                          <p className="text-xs text-slate-400 mt-0.5">Real-time open user positions updating live with tick prices and PnL</p>
                        </div>
                        <span className="px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full text-xs font-mono font-bold">
                          {openPositions.length} Open Positions
                        </span>
                      </div>

                      {openPositions.length === 0 ? (
                        <div className="py-12 text-center text-xs text-slate-500 font-mono">No open user positions currently active on the platform.</div>
                      ) : (
                        <div className="overflow-x-auto max-h-[400px] scrollbar-none">
                          <table className="w-full text-left text-xs text-slate-300">
                            <thead>
                              <tr className="border-b border-white/10 font-mono uppercase text-slate-400">
                                <th className="py-2.5">User / Account</th>
                                <th className="py-2.5">Symbol</th>
                                <th className="py-2.5">Type</th>
                                <th className="py-2.5">Volume</th>
                                <th className="py-2.5">Entry Price</th>
                                <th className="py-2.5">Live Price</th>
                                <th className="py-2.5">Floating PnL</th>
                                <th className="py-2.5 text-right">Actions</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/10 font-medium">
                              {openPositions.map((t) => {
                                const dir = (t.type || 'buy').toLowerCase() as 'buy' | 'sell';
                                const lots = t.lots || (t as any).volume || 1;
                                const entryPrice = t.entryPrice || t.openPrice || 0;
                                const curBid = livePrices[t.symbol]?.bid || livePrices[t.symbol]?.last || entryPrice;
                                const curAsk = livePrices[t.symbol]?.ask || livePrices[t.symbol]?.last || entryPrice;
                                const curPrice = livePrices[t.symbol]?.last || entryPrice;

                                const livePnl = calculateTradePnL(t.symbol, dir, entryPrice, lots, curBid, curAsk);
                                const decs = DECIMAL_PLACES[t.symbol] || 4;

                                const userObj = users.find(u => u.uid === t.userId);

                                return (
                                  <tr key={t.id} className="hover:bg-white/[0.02]">
                                    <td className="py-3">
                                      <div className="font-bold text-white text-xs">{userObj?.email || userObj?.displayName || t.userId || 'User'}</div>
                                      <div className="font-mono text-[10px] text-slate-400">Acc: {t.accountId}</div>
                                    </td>
                                    <td className="py-3 font-bold font-mono text-white text-sm">{t.symbol}</td>
                                    <td className="py-3">
                                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold font-mono uppercase ${
                                        dir === 'buy' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'
                                      }`}>
                                        {dir}
                                      </span>
                                    </td>
                                    <td className="py-3 font-mono text-white font-bold">{lots} Lots</td>
                                    <td className="py-3 font-mono text-slate-300">{entryPrice.toFixed(decs)}</td>
                                    <td className="py-3 font-mono text-white font-bold">{curPrice.toFixed(decs)}</td>
                                    <td className={`py-3 font-mono font-bold text-sm ${livePnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                      {livePnl >= 0 ? '+' : ''}${livePnl.toFixed(2)}
                                    </td>
                                    <td className="py-3 text-right">
                                      <button
                                        type="button"
                                        onClick={async () => {
                                          if (confirm(`Close open position ${t.id} for ${t.symbol} at live price $${curPrice.toFixed(decs)}?`)) {
                                            try {
                                              await executeClosePosition(t.id, curPrice, 'Closed by Admin via Live Monitor');
                                              alert('Position closed!');
                                            } catch (err: any) {
                                              alert(`Error closing trade: ${err.message}`);
                                            }
                                          }
                                        }}
                                        className="px-2.5 py-1 bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-300 text-[10px] font-bold rounded-xl transition cursor-pointer"
                                      >
                                        Close Position
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>

                    {/* Historical Closed Trades Table */}
                    <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-sm shadow-xl space-y-4">
                      <h3 className="text-base font-bold text-white uppercase tracking-wider">Historical Closed Trades Record</h3>
                      {closedPositions.length === 0 ? (
                        <div className="py-8 text-center text-xs text-slate-500 font-mono">No closed trades in history yet.</div>
                      ) : (
                        <div className="overflow-x-auto max-h-[300px] scrollbar-none">
                          <table className="w-full text-left text-xs text-slate-300">
                            <thead>
                              <tr className="border-b border-white/10 font-mono uppercase text-slate-400">
                                <th className="py-2">Trade ID</th>
                                <th className="py-2">Account ID</th>
                                <th className="py-2">Asset</th>
                                <th className="py-2">Type</th>
                                <th className="py-2">Volume</th>
                                <th className="py-2">PnL</th>
                                <th className="py-2 text-right">Status</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-white/10 font-medium">
                              {closedPositions.map((t) => (
                                <tr key={t.id}>
                                  <td className="py-2.5 font-mono text-slate-500">{t.id}</td>
                                  <td className="py-2.5 font-mono text-white">{t.accountId}</td>
                                  <td className="py-2.5 font-bold font-mono">{t.symbol}</td>
                                  <td className="py-2.5">
                                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold font-mono uppercase ${
                                      t.type === 'buy' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                                    }`}>
                                      {t.type}
                                    </span>
                                  </td>
                                  <td className="py-2.5 font-mono">{t.lots} Lots</td>
                                  <td className={`py-2.5 font-mono font-bold ${Number(t.profit || 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    ${Number(t.profit || 0).toFixed(2)}
                                  </td>
                                  <td className="py-2.5 text-right uppercase text-[10px] text-slate-400 font-mono font-bold">{t.status}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </div>
          )}

          {/* TAB 7: ADMINISTRATIVE PAYMENT SYSTEM SETTINGS */}
          {activeTab === 'payment_settings' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-fade-in">
              {/* Left Column: Form to Add/Edit Method */}
              <div className="lg:col-span-5 bg-white/5 border border-white/10 rounded-3xl p-6 space-y-4 backdrop-blur-sm shadow-xl">
                <div>
                  <h3 className="text-base font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <Coins className="w-5 h-5 text-blue-400" />
                    <span>{editingPaymentMethod ? 'Edit Payment Method' : 'Add Payment Method'}</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Define active checkout options for traders buying challenge accounts.
                  </p>
                </div>

                {payMsg && (
                  <div className={`p-3 rounded-xl text-xs font-bold ${payMsg.includes('Error') ? 'bg-red-500/10 border border-red-500/25 text-red-300' : 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-300'}`}>
                    {payMsg}
                  </div>
                )}

                <form onSubmit={handleSavePaymentMethod} className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400 uppercase font-semibold">Method Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Bitcoin, USDT (TRC-20), UPI"
                      required
                      value={payName}
                      onChange={(e) => setPayName(e.target.value)}
                      className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400 uppercase font-semibold">Address or Receiving ID</label>
                    <input
                      type="text"
                      placeholder="e.g. Wallet address or UPI ID"
                      required
                      value={payAddress}
                      onChange={(e) => setPayAddress(e.target.value)}
                      className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400 uppercase font-semibold">QR Code Image URL (Optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. https://domain.com/qr.png"
                      value={payQrCode}
                      onChange={(e) => setPayQrCode(e.target.value)}
                      className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400 uppercase font-semibold">Instructions or Notes (Optional)</label>
                    <textarea
                      placeholder="e.g. Please send exact BTC value. Screenshot upload required."
                      rows={3}
                      value={payNotes}
                      onChange={(e) => setPayNotes(e.target.value)}
                      className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-blue-500 resize-none"
                    />
                  </div>

                  <label className="flex items-center space-x-2 cursor-pointer py-1">
                    <input
                      type="checkbox"
                      checked={payActive}
                      onChange={(e) => setPayActive(e.target.checked)}
                      className="rounded border-white/20 bg-black/40 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                    />
                    <span className="text-xs text-slate-300 font-bold">Enabled & Active on Checkout</span>
                  </label>

                  <div className="flex gap-2.5 pt-2">
                    <button
                      type="submit"
                      className="flex-1 h-10 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs transition-colors"
                    >
                      {editingPaymentMethod ? 'Update Method' : 'Save Payment Method'}
                    </button>
                    {editingPaymentMethod && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingPaymentMethod(null);
                          setPayName('');
                          setPayAddress('');
                          setPayQrCode('');
                          setPayNotes('');
                          setPayActive(true);
                        }}
                        className="px-4 h-10 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 font-bold rounded-xl text-xs transition-colors"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </form>
              </div>

              {/* Right Column: List of Configured Payment Methods */}
              <div className="lg:col-span-7 bg-white/5 border border-white/10 rounded-3xl p-6 space-y-4 backdrop-blur-sm shadow-xl">
                <h3 className="text-base font-bold text-white uppercase tracking-wider flex items-center justify-between">
                  <span>Payment Checkout Options ({paymentMethods.length})</span>
                  <span className="text-[10px] font-mono text-slate-500 uppercase">Live Sync</span>
                </h3>

                <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                  {paymentMethods.map((pm) => (
                    <div key={pm.id} className="p-4 bg-black/20 border border-white/5 hover:border-white/10 rounded-2xl space-y-3 transition-colors">
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="text-sm font-bold text-white flex items-center gap-2">
                            <span>{pm.name}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase ${pm.active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                              {pm.active ? 'Active' : 'Disabled'}
                            </span>
                          </h4>
                          <p className="text-[11px] text-slate-400 font-mono mt-1 break-all select-all bg-black/40 px-2 py-1 rounded border border-white/5">{pm.walletAddress}</p>
                        </div>
                        <div className="flex gap-1.5 shrink-0">
                          <button
                            onClick={() => {
                              setEditingPaymentMethod(pm);
                              setPayName(pm.name);
                              setPayAddress(pm.walletAddress);
                              setPayQrCode(pm.qrCode || '');
                              setPayNotes(pm.notes || '');
                              setPayActive(pm.active);
                            }}
                            className="p-1.5 bg-white/5 hover:bg-blue-600/20 border border-white/10 hover:border-blue-500/30 text-slate-400 hover:text-blue-400 rounded-lg text-xs transition-colors"
                            title="Edit"
                          >
                            <Settings className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleTogglePaymentMethodActive(pm.id, pm.active)}
                            className={`p-1.5 border rounded-lg text-xs transition-colors ${pm.active ? 'bg-amber-500/10 border-amber-500/20 text-amber-400 hover:bg-amber-500/20' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20'}`}
                            title={pm.active ? 'Disable' : 'Enable'}
                          >
                            {pm.active ? <X className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => handleDeletePaymentMethod(pm.id)}
                            className="p-1.5 bg-white/5 hover:bg-red-600/20 border border-white/10 hover:border-red-500/30 text-slate-400 hover:text-red-400 rounded-lg text-xs transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {pm.notes && (
                        <p className="text-[10px] text-slate-500 italic bg-white/5 p-2 rounded-xl border border-white/5">{pm.notes}</p>
                      )}

                      {pm.qrCode && (
                        <div className="flex items-center gap-3">
                          <img src={pm.qrCode} alt="QR" className="w-12 h-12 rounded border border-white/10 object-cover" />
                          <span className="text-[9px] text-slate-500 font-mono">QR code configured</span>
                        </div>
                      )}
                    </div>
                  ))}

                  {paymentMethods.length === 0 && (
                    <div className="text-center py-12 bg-black/10 rounded-2xl border border-white/5">
                      <p className="text-xs text-slate-500 font-medium">No checkout payment methods configured.</p>
                      <p className="text-[10px] text-slate-600 mt-1">Please add a method (e.g. UPI or Crypto Wallet) using the form on the left.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 8: RULE SETTINGS PAGE */}
          {activeTab === 'rule_settings' && (
            <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-sm shadow-xl space-y-6">
              <div>
                <h3 className="text-base font-bold text-white uppercase tracking-wider mb-1 flex items-center gap-2">
                  <Shield className="w-5 h-5 text-blue-400" />
                  <span>Configurable Account Trading Rules</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Modify targets, drawdown boundaries, minimum trading requirements, and turn the 10-Minute Trade pacing rule On/Off.
                </p>
              </div>

              <form onSubmit={handleUpdateRuleSettings} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  
                  {/* One Step challenge */}
                  <div className="p-5 bg-white/5 border border-white/10 rounded-2xl space-y-4">
                    <div className="flex justify-between items-center pb-2 border-b border-white/10">
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">One Step Rules</h4>
                      <span className="text-[10px] font-mono text-blue-400 font-bold bg-blue-500/10 px-2 py-0.5 rounded border border-blue-500/25">ONE STEP</span>
                    </div>
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 font-semibold uppercase">Daily Loss Limit (%)</label>
                        <input
                          type="number"
                          step="0.1"
                          value={oneStepDailyLoss}
                          onChange={(e) => setOneStepDailyLoss(Number(e.target.value))}
                          className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 font-semibold uppercase">Max Drawdown Limit (%)</label>
                        <input
                          type="number"
                          step="0.1"
                          value={oneStepMaxLoss}
                          onChange={(e) => setOneStepMaxLoss(Number(e.target.value))}
                          className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 font-semibold uppercase">Profit Target (%)</label>
                        <input
                          type="number"
                          step="0.1"
                          value={oneStepProfitTarget}
                          onChange={(e) => setOneStepProfitTarget(Number(e.target.value))}
                          className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 font-semibold uppercase">Minimum Trading Days</label>
                        <input
                          type="number"
                          value={oneStepMinDays}
                          onChange={(e) => setOneStepMinDays(Number(e.target.value))}
                          className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div className="flex items-center justify-between pt-2">
                        <span className="text-[10px] text-slate-400 font-semibold uppercase">10-Min Trade Rule</span>
                        <button
                          type="button"
                          onClick={() => setOneStepTenMinuteRule(!oneStepTenMinuteRule)}
                          className={`w-12 h-6 rounded-full p-0.5 transition-colors duration-200 focus:outline-none ${
                            oneStepTenMinuteRule ? 'bg-blue-600' : 'bg-slate-800'
                          }`}
                        >
                          <div className={`w-5 h-5 rounded-full bg-white transition-transform duration-200 transform ${
                            oneStepTenMinuteRule ? 'translate-x-6' : 'translate-x-0'
                          }`} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Two Step challenge */}
                  <div className="p-5 bg-white/5 border border-white/10 rounded-2xl space-y-4">
                    <div className="flex justify-between items-center pb-2 border-b border-white/10">
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">Two Step Rules</h4>
                      <span className="text-[10px] font-mono text-amber-400 font-bold bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/25">TWO STEP</span>
                    </div>
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 font-semibold uppercase">Daily Loss Limit (%)</label>
                        <input
                          type="number"
                          step="0.1"
                          value={twoStepDailyLoss}
                          onChange={(e) => setTwoStepDailyLoss(Number(e.target.value))}
                          className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 font-semibold uppercase">Max Drawdown Limit (%)</label>
                        <input
                          type="number"
                          step="0.1"
                          value={twoStepMaxLoss}
                          onChange={(e) => setTwoStepMaxLoss(Number(e.target.value))}
                          className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <label className="text-[9px] text-slate-400 font-semibold uppercase">Phase 1 Target (%)</label>
                          <input
                            type="number"
                            step="0.1"
                            value={twoStepPhase1Target}
                            onChange={(e) => setTwoStepPhase1Target(Number(e.target.value))}
                            className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-2 text-xs text-white focus:outline-none focus:border-blue-500"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-[9px] text-slate-400 font-semibold uppercase">Phase 2 Target (%)</label>
                          <input
                            type="number"
                            step="0.1"
                            value={twoStepPhase2Target}
                            onChange={(e) => setTwoStepPhase2Target(Number(e.target.value))}
                            className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-2 text-xs text-white focus:outline-none focus:border-blue-500"
                          />
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 font-semibold uppercase">Minimum Trading Days</label>
                        <input
                          type="number"
                          value={twoStepMinDays}
                          onChange={(e) => setTwoStepMinDays(Number(e.target.value))}
                          className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div className="flex items-center justify-between pt-2">
                        <span className="text-[10px] text-slate-400 font-semibold uppercase">10-Min Trade Rule</span>
                        <button
                          type="button"
                          onClick={() => setTwoStepTenMinuteRule(!twoStepTenMinuteRule)}
                          className={`w-12 h-6 rounded-full p-0.5 transition-colors duration-200 focus:outline-none ${
                            twoStepTenMinuteRule ? 'bg-blue-600' : 'bg-slate-800'
                          }`}
                        >
                          <div className={`w-5 h-5 rounded-full bg-white transition-transform duration-200 transform ${
                            twoStepTenMinuteRule ? 'translate-x-6' : 'translate-x-0'
                          }`} />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Payout Later challenge */}
                  <div className="p-5 bg-white/5 border border-white/10 rounded-2xl space-y-4">
                    <div className="flex justify-between items-center pb-2 border-b border-white/10">
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider">Payout Later Rules</h4>
                      <span className="text-[10px] font-mono text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/25">PAYOUT LATER</span>
                    </div>
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 font-semibold uppercase">Daily Loss Limit (%)</label>
                        <input
                          type="number"
                          step="0.1"
                          value={payoutLaterDailyLoss}
                          onChange={(e) => setPayoutLaterDailyLoss(Number(e.target.value))}
                          className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 font-semibold uppercase">Max Drawdown Limit (%)</label>
                        <input
                          type="number"
                          step="0.1"
                          value={payoutLaterMaxLoss}
                          onChange={(e) => setPayoutLaterMaxLoss(Number(e.target.value))}
                          className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 font-semibold uppercase font-mono">No profit target (Live)</label>
                        <div className="w-full h-10 bg-black/20 border border-white/5 rounded-xl px-3 text-xs text-slate-500 flex items-center">
                          Immediate Live Funded Trading
                        </div>
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 font-semibold uppercase">Minimum Trading Days</label>
                        <input
                          type="number"
                          value={payoutLaterMinDays}
                          onChange={(e) => setPayoutLaterMinDays(Number(e.target.value))}
                          className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div className="flex items-center justify-between pt-2">
                        <span className="text-[10px] text-slate-400 font-semibold uppercase">10-Min Trade Rule</span>
                        <button
                          type="button"
                          onClick={() => setPayoutLaterTenMinuteRule(!payoutLaterTenMinuteRule)}
                          className={`w-12 h-6 rounded-full p-0.5 transition-colors duration-200 focus:outline-none ${
                            payoutLaterTenMinuteRule ? 'bg-blue-600' : 'bg-slate-800'
                          }`}
                        >
                          <div className={`w-5 h-5 rounded-full bg-white transition-transform duration-200 transform ${
                            payoutLaterTenMinuteRule ? 'translate-x-6' : 'translate-x-0'
                          }`} />
                        </button>
                      </div>
                    </div>
                  </div>

                </div>

                <div className="flex items-center justify-between pt-4 border-t border-white/10">
                  {ruleSettingsMsg && (
                    <span className="text-xs text-emerald-400 font-semibold flex items-center gap-1 animate-pulse">
                      <Check className="w-4 h-4 text-emerald-400" />
                      <span>{ruleSettingsMsg}</span>
                    </span>
                  )}
                  <span className="flex-grow" />
                  <button
                    type="submit"
                    disabled={isSavingRules}
                    className="px-8 h-11 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white font-bold rounded-xl text-xs transition-colors shadow-lg shadow-blue-500/10"
                  >
                    {isSavingRules ? "Saving Rules..." : "Save Account Rules"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* TAB 9: BREACH CENTER & RULE VIOLATIONS */}
          {activeTab === 'rule_violations' && (
            <div className="space-y-8 animate-fade-in">
              
              {/* Breach Center Overview */}
              <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-sm shadow-xl space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="text-base font-bold text-white uppercase tracking-wider mb-1 flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-red-400" />
                      <span>Admin Rule Breach Center</span>
                    </h3>
                    <p className="text-xs text-slate-400">
                      Monitor all system-detected risk, drawdown, and pacing rule violations. Action notices to Warning, Ignored, or Breach statuses.
                    </p>
                  </div>
                  <span className="px-3 py-1 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-full font-mono font-bold uppercase tracking-wider">
                    {ruleViolations.filter(v => v.status === 'Warning' || v.status === 'Breached').length} Violations Active
                  </span>
                </div>

                {ruleViolations.length === 0 ? (
                  <div className="py-12 text-center text-xs text-slate-500 bg-black/20 rounded-2xl border border-white/5">No trading rule violations recorded on the system.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-300">
                      <thead>
                        <tr className="border-b border-white/10 font-mono uppercase text-slate-400 pb-3">
                          <th className="py-2.5">Date / Time</th>
                          <th className="py-2.5">Trader</th>
                          <th className="py-2.5">Account / Login</th>
                          <th className="py-2.5">Violation details</th>
                          <th className="py-2.5">Trade Execution Details</th>
                          <th className="py-2.5">Current Status</th>
                          <th className="py-2.5 text-right">Administrative Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/10 font-medium">
                        {ruleViolations.map((v) => (
                          <tr key={v.id}>
                            <td className="py-3.5 font-mono text-slate-400">
                              {new Date(v.timestamp).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                            </td>
                            <td className="py-3.5">
                              <span className="text-white block font-bold">{v.userName || 'Elite Trader'}</span>
                              <span className="text-[10px] text-slate-500 font-mono block">{v.userEmail || 'trader@atfunding.io'}</span>
                            </td>
                            <td className="py-3.5 font-mono">
                              <span className="text-blue-400 font-bold block">{v.accountId}</span>
                              {v.accountNumber && (
                                <span className="text-[10px] text-slate-400 block font-mono">Login: #{v.accountNumber}</span>
                              )}
                            </td>
                            <td className="py-3.5">
                              <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/25 text-amber-400 text-[10px] font-bold font-mono block w-fit mb-1">
                                {v.violationType}
                              </span>
                              {v.description && (
                                <p className="text-[10px] text-slate-300 max-w-xs">{v.description}</p>
                              )}
                              {v.tradeId && (
                                <p className="text-[9px] font-mono text-slate-500 mt-0.5">Ref Trade: {v.tradeId}</p>
                              )}
                            </td>
                            <td className="py-3.5 font-mono text-[11px]">
                              {v.symbol ? (
                                <div className="space-y-0.5">
                                  <div className="flex items-center gap-1.5">
                                    <span className="font-bold text-white">{v.symbol}</span>
                                    <span className={`uppercase font-bold text-[9px] px-1 rounded ${v.type === 'buy' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'}`}>
                                      {v.type}
                                    </span>
                                    <span className="text-slate-400">{v.lots} Lots</span>
                                  </div>
                                  {v.durationSeconds !== undefined && (
                                    <p className="text-[10px] text-amber-300">Duration: {v.durationSeconds}s</p>
                                  )}
                                </div>
                              ) : (
                                <span className="text-slate-500">—</span>
                              )}
                            </td>
                            <td className="py-3.5">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono font-bold ${
                                v.status === 'Breached' ? 'bg-red-500/10 text-red-400 border border-red-500/25 animate-pulse' :
                                v.status === 'Warning' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/25' :
                                'bg-slate-500/10 text-slate-400'
                              }`}>
                                {v.status}
                              </span>
                            </td>
                            <td className="py-3.5 text-right">
                              {v.status !== 'Breached' ? (
                                <div className="flex gap-1.5 justify-end">
                                  <button
                                    onClick={() => handleViolationAction(v.id, 'Ignored')}
                                    className="px-2 py-1 bg-white/5 hover:bg-white/10 text-slate-300 rounded text-[10px] font-bold uppercase tracking-wider border border-white/10"
                                  >
                                    Ignore
                                  </button>
                                  <button
                                    onClick={() => handleViolationAction(v.id, 'Warning')}
                                    className="px-2 py-1 bg-amber-600/10 hover:bg-amber-600 hover:text-white text-amber-400 rounded text-[10px] font-bold uppercase tracking-wider border border-amber-500/25"
                                  >
                                    Warn
                                  </button>
                                  <button
                                    onClick={() => handleViolationAction(v.id, 'Suspended')}
                                    className="px-2 py-1 bg-purple-600/20 hover:bg-purple-600 hover:text-white text-purple-300 rounded text-[10px] font-bold uppercase tracking-wider border border-purple-500/30"
                                  >
                                    Suspend
                                  </button>
                                  <button
                                    onClick={() => handleViolationAction(v.id, 'Breached')}
                                    className="px-2 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-[10px] font-bold uppercase tracking-wider"
                                  >
                                    Breach
                                  </button>
                                </div>
                              ) : (
                                <span className="text-[10px] font-mono text-red-500/60 uppercase font-bold">✓ Account Locked</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Historic Breaches Registry */}
              <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-sm shadow-xl space-y-4">
                <h3 className="text-base font-bold text-white uppercase tracking-wider">Breach Audit Log</h3>
                {breaches.length === 0 ? (
                  <div className="py-8 text-center text-xs text-slate-500 bg-black/10 rounded-2xl">No historic breach logs recorded.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs text-slate-400">
                      <thead>
                        <tr className="border-b border-white/5 font-mono uppercase text-slate-500">
                          <th className="py-2">Breach Date</th>
                          <th className="py-2">Account ID</th>
                          <th className="py-2">User Email</th>
                          <th className="py-2">Reason for lock</th>
                          <th className="py-2 text-right">Authorized By</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 font-medium">
                        {breaches.map(b => (
                          <tr key={b.id}>
                            <td className="py-2.5 font-mono text-[11px]">
                              {new Date(b.breachDate).toLocaleDateString()}
                            </td>
                            <td className="py-2.5 text-white font-mono font-bold">{b.accountId}</td>
                            <td className="py-2.5 text-slate-300 font-mono">{b.userEmail}</td>
                            <td className="py-2.5 text-rose-400 font-bold">{b.breachReason}</td>
                            <td className="py-2.5 text-right font-mono text-[10px] text-slate-500">{b.adminName || 'System Admin'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

            </div>
          )}

          {/* TAB 11: BROADCAST CENTER */}
          {activeTab === 'broadcast' && (
            <div className="space-y-8 animate-fade-in">
              <div className="bg-[#0e1322] border border-white/10 rounded-3xl p-6 md:p-8 backdrop-blur-sm shadow-xl space-y-6">
                <div>
                  <h3 className="text-lg font-black text-white uppercase tracking-wider flex items-center gap-2">
                    <Mail className="w-5 h-5 text-blue-400" />
                    <span>Real-Time Broadcast Communication Hub</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Compose and dispatch real-time global messages or direct emails to targeted registered traders. Notifications sync instantly with client terminals.
                  </p>
                </div>

                <form onSubmit={handleSendBroadcast} className="space-y-4">
                  {broadcastMsg && (
                    <div className={`p-4 rounded-xl text-xs font-bold ${
                      broadcastMsg.startsWith('Error') 
                        ? 'bg-rose-500/10 border border-rose-500/25 text-rose-300' 
                        : 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-300'
                    }`}>
                      {broadcastMsg}
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-1">
                      <label className="text-xs font-semibold text-slate-400">Recipient Scope</label>
                      <select
                        value={broadcastRecipientType}
                        onChange={(e) => setBroadcastRecipientType(e.target.value as any)}
                        className="w-full h-11 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-blue-500"
                      >
                        <option value="single" className="bg-slate-950">Single Targeted Trader</option>
                        <option value="all" className="bg-slate-950">All Registered Traders (Global Broadcast)</option>
                      </select>
                    </div>

                    {broadcastRecipientType === 'single' && (
                      <div className="space-y-1">
                        <label className="text-xs font-semibold text-slate-400">Target User Account</label>
                        <select
                          required
                          value={broadcastTargetUserId}
                          onChange={(e) => setBroadcastTargetUserId(e.target.value)}
                          className="w-full h-11 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-blue-500"
                        >
                          <option value="" className="bg-slate-950">-- Choose Recipient Trader --</option>
                          {users.map(u => (
                            <option key={u.uid} value={u.uid} className="bg-slate-950">
                              {u.email} ({u.displayName || 'No Name'})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-400">Email/Notice Subject Line</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g., Urgent Maintenance Notice / System Updates"
                      value={broadcastSubject}
                      onChange={(e) => setBroadcastSubject(e.target.value)}
                      className="w-full h-11 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-semibold text-slate-400">Message Content (Markdown / Plaintext)</label>
                    <textarea
                      required
                      rows={5}
                      placeholder="Compose your rich notification message here..."
                      value={broadcastBody}
                      onChange={(e) => setBroadcastBody(e.target.value)}
                      className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 font-sans"
                    />
                  </div>

                  <div className="flex justify-end pt-2">
                    <button
                      type="submit"
                      disabled={isBroadcasting}
                      className="px-8 h-11 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white font-bold rounded-xl text-xs transition-colors shadow-lg shadow-blue-500/10 flex items-center gap-2"
                    >
                      {isBroadcasting ? (
                        <span>Dispatched Communication...</span>
                      ) : (
                        <>
                          <Mail className="w-4 h-4" />
                          <span>Dispatch Broadcast Message</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* TAB 11.5: COMPREHENSIVE CMS MANAGEMENT */}
          {activeTab === 'cms' && (
            <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-sm shadow-xl space-y-6 animate-fade-in">
              <div>
                <h3 className="text-base font-bold text-white uppercase tracking-wider mb-1 flex items-center gap-2">
                  <ImageIcon className="w-5 h-5 text-blue-400" />
                  <span>Real-time Content Management System (CMS)</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Update and refine landing page content, FAQs, challenge parameters, and step-by-step evaluation guides in real-time.
                </p>
              </div>

              {cmsSaveMsg && (
                <div className="p-3 bg-emerald-500/15 border border-emerald-500/30 rounded-xl text-xs text-emerald-300">
                  {cmsSaveMsg}
                </div>
              )}

              {/* CMS Sub-Tabs Navigation */}
              <div className="flex flex-wrap border-b border-white/10 pb-1 gap-2">
                <button
                  type="button"
                  onClick={() => setCmsSubTab('policies')}
                  className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${
                    cmsSubTab === 'policies'
                      ? 'border-blue-500 text-blue-400'
                      : 'border-transparent text-slate-400 hover:text-white'
                  }`}
                >
                  Footer Policies
                </button>
                <button
                  type="button"
                  onClick={() => setCmsSubTab('faqs')}
                  className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${
                    cmsSubTab === 'faqs'
                      ? 'border-blue-500 text-blue-400'
                      : 'border-transparent text-slate-400 hover:text-white'
                  }`}
                >
                  FAQs Manager
                </button>
                <button
                  type="button"
                  onClick={() => setCmsSubTab('rules')}
                  className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${
                    cmsSubTab === 'rules'
                      ? 'border-blue-500 text-blue-400'
                      : 'border-transparent text-slate-400 hover:text-white'
                  }`}
                >
                  Challenge Rules
                </button>
                <button
                  type="button"
                  onClick={() => setCmsSubTab('how_it_works')}
                  className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${
                    cmsSubTab === 'how_it_works'
                      ? 'border-blue-500 text-blue-400'
                      : 'border-transparent text-slate-400 hover:text-white'
                  }`}
                >
                  How It Works
                </button>
                <button
                  type="button"
                  onClick={() => setCmsSubTab('why_choose')}
                  className={`px-4 py-2 text-xs font-bold uppercase tracking-wider border-b-2 transition-colors ${
                    cmsSubTab === 'why_choose'
                      ? 'border-blue-500 text-blue-400'
                      : 'border-transparent text-slate-400 hover:text-white'
                  }`}
                >
                  Why Choose Us
                </button>
              </div>

              {/* SUB-TAB 1: LEGAL & RISKS POLICIES */}
              {cmsSubTab === 'policies' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Terms of Service */}
                  <div className="space-y-2 bg-black/20 p-4 border border-white/5 rounded-2xl flex flex-col">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-bold text-slate-300">Terms of Service (ToS)</label>
                      <span className="text-[9px] text-slate-500 font-mono">Live on Website</span>
                    </div>
                    <textarea
                      rows={8}
                      value={cmsTerms}
                      onChange={(e) => setCmsTerms(e.target.value)}
                      placeholder="Describe proprietary challenge terms, user rules, trading regulations, and IP guidelines..."
                      className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-xs text-white placeholder-slate-600 font-mono focus:outline-none focus:border-blue-500 flex-1"
                    />
                    <button
                      onClick={async () => {
                        setIsSavingCms(true);
                        try {
                          await setDoc(doc(db, 'cms_pages', 'terms_of_service'), { content: cmsTerms });
                          setCmsSaveMsg("Terms of Service updated successfully!");
                          setTimeout(() => setCmsSaveMsg(''), 3000);
                        } catch (err) {
                          console.error(err);
                          setCmsSaveMsg("Error updating Terms of Service.");
                        }
                        setIsSavingCms(false);
                      }}
                      disabled={isSavingCms}
                      className="mt-2 h-9 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white font-bold rounded-lg text-xs transition-colors"
                    >
                      Save Terms of Service
                    </button>
                  </div>

                  {/* Privacy Policy */}
                  <div className="space-y-2 bg-black/20 p-4 border border-white/5 rounded-2xl flex flex-col">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-bold text-slate-300">Privacy Policy</label>
                      <span className="text-[9px] text-slate-500 font-mono">Live on Website</span>
                    </div>
                    <textarea
                      rows={8}
                      value={cmsPrivacy}
                      onChange={(e) => setCmsPrivacy(e.target.value)}
                      placeholder="Describe how user profiles, email addresses, KYC documentation, and trading histories are handled privately..."
                      className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-xs text-white placeholder-slate-600 font-mono focus:outline-none focus:border-blue-500 flex-1"
                    />
                    <button
                      onClick={async () => {
                        setIsSavingCms(true);
                        try {
                          await setDoc(doc(db, 'cms_pages', 'privacy_policy'), { content: cmsPrivacy });
                          setCmsSaveMsg("Privacy Policy updated successfully!");
                          setTimeout(() => setCmsSaveMsg(''), 3000);
                        } catch (err) {
                          console.error(err);
                          setCmsSaveMsg("Error updating Privacy Policy.");
                        }
                        setIsSavingCms(false);
                      }}
                      disabled={isSavingCms}
                      className="mt-2 h-9 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white font-bold rounded-lg text-xs transition-colors"
                    >
                      Save Privacy Policy
                    </button>
                  </div>

                  {/* Refund Policy */}
                  <div className="space-y-2 bg-black/20 p-4 border border-white/5 rounded-2xl flex flex-col">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-bold text-slate-300">Refund Policy</label>
                      <span className="text-[9px] text-slate-500 font-mono">Live on Website</span>
                    </div>
                    <textarea
                      rows={8}
                      value={cmsRefund}
                      onChange={(e) => setCmsRefund(e.target.value)}
                      placeholder="Describe key-fee refunds upon passing the evaluation challenges and first payout, with refund eligibility policies..."
                      className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-xs text-white placeholder-slate-600 font-mono focus:outline-none focus:border-blue-500 flex-1"
                    />
                    <button
                      onClick={async () => {
                        setIsSavingCms(true);
                        try {
                          await setDoc(doc(db, 'cms_pages', 'refund_policy'), { content: cmsRefund });
                          setCmsSaveMsg("Refund Policy updated successfully!");
                          setTimeout(() => setCmsSaveMsg(''), 3000);
                        } catch (err) {
                          console.error(err);
                          setCmsSaveMsg("Error updating Refund Policy.");
                        }
                        setIsSavingCms(false);
                      }}
                      disabled={isSavingCms}
                      className="mt-2 h-9 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white font-bold rounded-lg text-xs transition-colors"
                    >
                      Save Refund Policy
                    </button>
                  </div>

                  {/* Risk Disclosure */}
                  <div className="space-y-2 bg-black/20 p-4 border border-white/5 rounded-2xl flex flex-col">
                    <div className="flex justify-between items-center">
                      <label className="text-xs font-bold text-slate-300">Risk Disclosure</label>
                      <span className="text-[9px] text-slate-500 font-mono">Live on Website</span>
                    </div>
                    <textarea
                      rows={8}
                      value={cmsRisk}
                      onChange={(e) => setCmsRisk(e.target.value)}
                      placeholder="Provide standard financial risk warnings regarding leveraged trading, demo servers, and simulated capital usage..."
                      className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-xs text-white placeholder-slate-600 font-mono focus:outline-none focus:border-blue-500 flex-1"
                    />
                    <button
                      onClick={async () => {
                        setIsSavingCms(true);
                        try {
                          await setDoc(doc(db, 'cms_pages', 'risk_disclosure'), { content: cmsRisk });
                          setCmsSaveMsg("Risk Disclosure updated successfully!");
                          setTimeout(() => setCmsSaveMsg(''), 3000);
                        } catch (err) {
                          console.error(err);
                          setCmsSaveMsg("Error updating Risk Disclosure.");
                        }
                        setIsSavingCms(false);
                      }}
                      disabled={isSavingCms}
                      className="mt-2 h-9 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white font-bold rounded-lg text-xs transition-colors"
                    >
                      Save Risk Disclosure
                    </button>
                  </div>
                </div>
              )}

              {/* SUB-TAB 2: FAQS CMS */}
              {cmsSubTab === 'faqs' && (
                <div className="space-y-6">
                  {/* Add/Edit FAQ Form */}
                  <div className="bg-black/30 p-5 border border-white/5 rounded-2xl space-y-4">
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                      {editingFaqId ? 'Edit Frequently Asked Question' : 'Add New Frequently Asked Question'}
                    </h4>
                    <div className="grid grid-cols-1 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 uppercase font-semibold">Question String</label>
                        <input
                          type="text"
                          value={faqQuestion}
                          onChange={(e) => setFaqQuestion(e.target.value)}
                          placeholder="e.g., What are the payout guidelines?"
                          className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 uppercase font-semibold">Detailed Answer</label>
                        <textarea
                          rows={4}
                          value={faqAnswer}
                          onChange={(e) => setFaqAnswer(e.target.value)}
                          placeholder="Provide the complete parameter answer for traders here..."
                          className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>
                    <div className="flex gap-2 justify-end pt-2">
                      {editingFaqId && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingFaqId(null);
                            setFaqQuestion('');
                            setFaqAnswer('');
                          }}
                          className="px-4 h-9 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-lg text-xs transition-colors"
                        >
                          Cancel Edit
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={async () => {
                          if (!faqQuestion.trim() || !faqAnswer.trim()) {
                            alert("Please fill in both fields!");
                            return;
                          }
                          setIsSavingCms(true);
                          try {
                            if (editingFaqId) {
                              await setDoc(doc(db, 'faqs', editingFaqId), {
                                question: faqQuestion.trim(),
                                answer: faqAnswer.trim(),
                                order: faqsList.find(f => f.id === editingFaqId)?.order || Date.now()
                              }, { merge: true });
                              setCmsSaveMsg("FAQ updated successfully!");
                            } else {
                              const newId = 'FAQ-' + Math.floor(100000 + Math.random() * 900000);
                              await setDoc(doc(db, 'faqs', newId), {
                                id: newId,
                                question: faqQuestion.trim(),
                                answer: faqAnswer.trim(),
                                order: faqsList.length + 1,
                                createdAt: new Date().toISOString()
                              });
                              setCmsSaveMsg("FAQ added successfully!");
                            }
                            setFaqQuestion('');
                            setFaqAnswer('');
                            setEditingFaqId(null);
                            setTimeout(() => setCmsSaveMsg(''), 3000);
                          } catch (err) {
                            console.error(err);
                            setCmsSaveMsg("Error saving FAQ.");
                          }
                          setIsSavingCms(false);
                        }}
                        disabled={isSavingCms}
                        className="px-5 h-9 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white font-bold rounded-lg text-xs transition-colors"
                      >
                        {editingFaqId ? 'Update FAQ' : 'Create FAQ'}
                      </button>
                    </div>
                  </div>

                  {/* FAQ List */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider">Active Frequently Asked Questions ({faqsList.length})</h4>
                    <div className="space-y-2">
                      {faqsList.map((faq, idx) => (
                        <div key={faq.id || idx} className="bg-black/20 border border-white/5 p-4 rounded-xl flex justify-between items-start gap-4">
                          <div className="space-y-1">
                            <h5 className="text-xs font-bold text-white">{faq.question}</h5>
                            <p className="text-[11px] text-slate-400 whitespace-pre-wrap">{faq.answer}</p>
                          </div>
                          <div className="flex gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingFaqId(faq.id);
                                setFaqQuestion(faq.question);
                                setFaqAnswer(faq.answer);
                              }}
                              className="px-2.5 py-1.5 bg-white/5 border border-white/10 text-slate-300 hover:text-white rounded-lg text-[10px] transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                if (!confirm("Are you sure you want to delete this FAQ?")) return;
                                setIsSavingCms(true);
                                try {
                                  await deleteDoc(doc(db, 'faqs', faq.id));
                                  setCmsSaveMsg("FAQ deleted successfully!");
                                  setTimeout(() => setCmsSaveMsg(''), 3000);
                                } catch (err) {
                                  console.error(err);
                                }
                                setIsSavingCms(false);
                              }}
                              className="px-2.5 py-1.5 bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 rounded-lg text-[10px] transition-colors"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                      {faqsList.length === 0 && (
                        <p className="text-xs text-slate-500 italic">No FAQs recorded. Use the form above to bootstrap default questions.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* SUB-TAB 3: CHALLENGE RULES CMS */}
              {cmsSubTab === 'rules' && (
                <div className="space-y-6">
                  {/* Select Challenge Type Selector */}
                  <div className="flex flex-wrap gap-2 p-1 bg-black/40 border border-white/5 rounded-2xl max-w-2xl">
                    {(['one_step', 'two_step', 'payout_later', 'instant_bolt', 'trial'] as const).map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setSelectedRuleDocId(type)}
                        className={`flex-1 min-w-[100px] py-2.5 rounded-xl text-xs font-bold transition-all uppercase tracking-wider ${
                          selectedRuleDocId === type
                            ? 'bg-blue-600 text-white shadow-md'
                            : 'text-slate-400 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        {type.replace('_', ' ')}
                      </button>
                    ))}
                  </div>

                  {/* Challenge Rules Edit Form */}
                  <div className="bg-black/30 p-5 border border-white/5 rounded-2xl space-y-4">
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                      Edit Rules for: <span className="text-blue-400 uppercase">{selectedRuleDocId.replace('_', ' ')}</span>
                    </h4>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 uppercase font-semibold">Evaluation Phases Detail</label>
                        <input
                          type="text"
                          value={rulePhases}
                          onChange={(e) => setRulePhases(e.target.value)}
                          placeholder="e.g., Single Phase Evaluation"
                          className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 uppercase font-semibold">Profit Target Spec</label>
                        <input
                          type="text"
                          value={ruleProfitTarget}
                          onChange={(e) => setRuleProfitTarget(e.target.value)}
                          placeholder="e.g., 10% Phase 1"
                          className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 uppercase font-semibold">Daily Drawdown Limit Spec</label>
                        <input
                          type="text"
                          value={ruleDailyDrawdown}
                          onChange={(e) => setRuleDailyDrawdown(e.target.value)}
                          placeholder="e.g., 4% (Balance Based)"
                          className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 uppercase font-semibold">Max Drawdown Limit Spec</label>
                        <input
                          type="text"
                          value={ruleMaxDrawdown}
                          onChange={(e) => setRuleMaxDrawdown(e.target.value)}
                          placeholder="e.g., 8% Overall"
                          className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 uppercase font-semibold">Minimum Days Required Spec</label>
                        <input
                          type="text"
                          value={ruleMinDays}
                          onChange={(e) => setRuleMinDays(e.target.value)}
                          placeholder="e.g., 0 Days"
                          className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 uppercase font-semibold">Trading Leverage Spec</label>
                        <input
                          type="text"
                          value={ruleLeverage}
                          onChange={(e) => setRuleLeverage(e.target.value)}
                          placeholder="e.g., 1:100"
                          className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none font-mono"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 uppercase font-semibold">Payout Interval Spec</label>
                        <input
                          type="text"
                          value={rulePayoutInterval}
                          onChange={(e) => setRulePayoutInterval(e.target.value)}
                          placeholder="e.g., Bi-Weekly"
                          className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 uppercase font-semibold">Fee Structure Spec</label>
                        <input
                          type="text"
                          value={ruleFeeStructure}
                          onChange={(e) => setRuleFeeStructure(e.target.value)}
                          placeholder="e.g., Standard Fee (Refundable)"
                          className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1 md:col-span-2">
                        <label className="text-[10px] text-slate-400 uppercase font-semibold block">Additional Rules & Condition Lines</label>
                        <textarea
                          rows={5}
                          value={ruleCustomRules}
                          onChange={(e) => setRuleCustomRules(e.target.value)}
                          placeholder="- Minimum trading days: 0 days&#10;- Overnight and weekend holding: Allowed&#10;- Expert advisors: Fully supported"
                          className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-xs text-white font-mono placeholder-slate-600 focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end pt-2">
                      <button
                        type="button"
                        onClick={async () => {
                          setIsSavingCms(true);
                          try {
                            await setDoc(doc(db, 'challenge_rules', selectedRuleDocId), {
                              id: selectedRuleDocId,
                              phases: rulePhases.trim(),
                              profitTarget: ruleProfitTarget.trim(),
                              dailyDrawdown: ruleDailyDrawdown.trim(),
                              maxDrawdown: ruleMaxDrawdown.trim(),
                              minDays: ruleMinDays.trim(),
                              leverage: ruleLeverage.trim(),
                              feeStructure: ruleFeeStructure.trim(),
                              payoutInterval: rulePayoutInterval.trim(),
                              customRules: ruleCustomRules.trim(),
                              updatedAt: new Date().toISOString()
                            });
                            setCmsSaveMsg(`Rules for ${selectedRuleDocId.replace('_', ' ')} saved successfully!`);
                            setTimeout(() => setCmsSaveMsg(''), 3000);
                          } catch (err) {
                            console.error(err);
                            setCmsSaveMsg("Error saving challenge rules.");
                          }
                          setIsSavingCms(false);
                        }}
                        disabled={isSavingCms}
                        className="px-6 h-10 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white font-bold rounded-xl text-xs transition-colors shadow-lg shadow-blue-500/10"
                      >
                        Save Challenge Specifications
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* SUB-TAB 4: HOW IT WORKS CMS */}
              {cmsSubTab === 'how_it_works' && (
                <div className="space-y-6">
                  {/* Select Step Selector */}
                  <div className="flex gap-2 p-1 bg-black/40 border border-white/5 rounded-2xl max-w-md">
                    {(['step1', 'step2', 'step3', 'step4'] as const).map((step, idx) => (
                      <button
                        key={step}
                        type="button"
                        onClick={() => setSelectedStepId(step)}
                        className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all ${
                          selectedStepId === step
                            ? 'bg-blue-600 text-white shadow-md'
                            : 'text-slate-400 hover:text-white hover:bg-white/5'
                        }`}
                      >
                        Step 0{idx + 1}
                      </button>
                    ))}
                  </div>

                  {/* Edit Step Form */}
                  <div className="bg-black/30 p-5 border border-white/5 rounded-2xl space-y-4">
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                      Edit Process Step: <span className="text-blue-400 uppercase">{selectedStepId.toUpperCase()}</span>
                    </h4>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 uppercase font-semibold">Step Title</label>
                        <input
                          type="text"
                          value={stepTitle}
                          onChange={(e) => setStepTitle(e.target.value)}
                          placeholder="e.g., Purchase Account"
                          className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 uppercase font-semibold">Lucide Icon Name</label>
                        <select
                          value={stepIcon}
                          onChange={(e) => setStepIcon(e.target.value)}
                          className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white font-mono focus:outline-none"
                        >
                          <option value="ShoppingBag">ShoppingBag</option>
                          <option value="Award">Award</option>
                          <option value="Trophy">Trophy</option>
                          <option value="DollarSign">DollarSign</option>
                          <option value="TrendingUp">TrendingUp</option>
                          <option value="ShieldCheck">ShieldCheck</option>
                          <option value="Zap">Zap</option>
                          <option value="HelpCircle">HelpCircle</option>
                        </select>
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <label className="text-[10px] text-slate-400 uppercase font-semibold">Step Description</label>
                        <textarea
                          rows={3}
                          value={stepDescription}
                          onChange={(e) => setStepDescription(e.target.value)}
                          placeholder="Describe the step process details..."
                          className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>

                    <div className="flex justify-end pt-2">
                      <button
                        type="button"
                        onClick={async () => {
                          if (!stepTitle.trim() || !stepDescription.trim()) {
                            alert("Please fill in all fields!");
                            return;
                          }
                          setIsSavingCms(true);
                          try {
                            const stepNum = selectedStepId === 'step1' ? 1 : selectedStepId === 'step2' ? 2 : selectedStepId === 'step3' ? 3 : 4;
                            await setDoc(doc(db, 'how_it_works', selectedStepId), {
                              id: selectedStepId,
                              stepNumber: stepNum,
                              title: stepTitle.trim(),
                              description: stepDescription.trim(),
                              icon: stepIcon,
                              updatedAt: new Date().toISOString()
                            });
                            setCmsSaveMsg(`Step ${stepNum} updated successfully!`);
                            setTimeout(() => setCmsSaveMsg(''), 3000);
                          } catch (err) {
                            console.error(err);
                            setCmsSaveMsg("Error updating step.");
                          }
                          setIsSavingCms(false);
                        }}
                        disabled={isSavingCms}
                        className="px-6 h-10 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white font-bold rounded-xl text-xs transition-colors shadow-lg shadow-blue-500/10"
                      >
                        Save Step Details
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* SUB-TAB 5: WHY CHOOSE US CMS */}
              {cmsSubTab === 'why_choose' && (
                <div className="space-y-6">
                  {/* Add/Edit Feature Card Form */}
                  <div className="bg-black/30 p-5 border border-white/5 rounded-2xl space-y-4">
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                      {editingWhyChooseId ? 'Edit Feature Card' : 'Add New Feature Card'}
                    </h4>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 uppercase font-semibold">Feature Title</label>
                        <input
                          type="text"
                          value={whyChooseTitle}
                          onChange={(e) => setWhyChooseTitle(e.target.value)}
                          placeholder="e.g., Clear Guidelines"
                          className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 uppercase font-semibold">Lucide Icon Name</label>
                        <select
                          value={whyChooseIcon}
                          onChange={(e) => setWhyChooseIcon(e.target.value)}
                          className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white font-mono focus:outline-none"
                        >
                          <option value="Award">Award</option>
                          <option value="ShieldCheck">ShieldCheck</option>
                          <option value="Zap">Zap</option>
                          <option value="Trophy">Trophy</option>
                          <option value="DollarSign">DollarSign</option>
                          <option value="TrendingUp">TrendingUp</option>
                          <option value="HelpCircle">HelpCircle</option>
                          <option value="Play">Play</option>
                        </select>
                      </div>
                      <div className="space-y-1 sm:col-span-2">
                        <label className="text-[10px] text-slate-400 uppercase font-semibold">Feature Description</label>
                        <textarea
                          rows={3}
                          value={whyChooseDescription}
                          onChange={(e) => setWhyChooseDescription(e.target.value)}
                          placeholder="Write benefit explanations for traders..."
                          className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>

                    <div className="flex gap-2 justify-end pt-2">
                      {editingWhyChooseId && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingWhyChooseId(null);
                            setWhyChooseTitle('');
                            setWhyChooseDescription('');
                            setWhyChooseIcon('Award');
                          }}
                          className="px-4 h-9 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-lg text-xs transition-colors"
                        >
                          Cancel Edit
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={async () => {
                          if (!whyChooseTitle.trim() || !whyChooseDescription.trim()) {
                            alert("Please fill in all fields!");
                            return;
                          }
                          setIsSavingCms(true);
                          try {
                            if (editingWhyChooseId) {
                              await setDoc(doc(db, 'why_choose', editingWhyChooseId), {
                                title: whyChooseTitle.trim(),
                                description: whyChooseDescription.trim(),
                                icon: whyChooseIcon,
                                updatedAt: new Date().toISOString()
                              }, { merge: true });
                              setCmsSaveMsg("Feature card updated successfully!");
                            } else {
                              const newId = 'WC-' + Math.floor(100000 + Math.random() * 900000);
                              await setDoc(doc(db, 'why_choose', newId), {
                                id: newId,
                                title: whyChooseTitle.trim(),
                                description: whyChooseDescription.trim(),
                                icon: whyChooseIcon,
                                createdAt: new Date().toISOString()
                              });
                              setCmsSaveMsg("Feature card created successfully!");
                            }
                            setWhyChooseTitle('');
                            setWhyChooseDescription('');
                            setWhyChooseIcon('Award');
                            setEditingWhyChooseId(null);
                            setTimeout(() => setCmsSaveMsg(''), 3000);
                          } catch (err) {
                            console.error(err);
                            setCmsSaveMsg("Error saving feature card.");
                          }
                          setIsSavingCms(false);
                        }}
                        disabled={isSavingCms}
                        className="px-5 h-9 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white font-bold rounded-lg text-xs transition-colors"
                      >
                        {editingWhyChooseId ? 'Update Feature' : 'Create Feature'}
                      </button>
                    </div>
                  </div>

                  {/* List of features */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider">Active Why Choose Cards ({whyChooseList.length})</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {whyChooseList.map((wc, idx) => (
                        <div key={wc.id || idx} className="bg-black/20 border border-white/5 p-4 rounded-xl flex justify-between items-start gap-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] bg-blue-500/10 border border-blue-500/20 text-blue-400 px-2 py-0.5 rounded font-mono font-bold uppercase">{wc.icon}</span>
                              <h5 className="text-xs font-bold text-white">{wc.title}</h5>
                            </div>
                            <p className="text-[11px] text-slate-400 leading-relaxed mt-1">{wc.description}</p>
                          </div>
                          <div className="flex gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingWhyChooseId(wc.id);
                                setWhyChooseTitle(wc.title);
                                setWhyChooseDescription(wc.description);
                                setWhyChooseIcon(wc.icon || 'Award');
                              }}
                              className="px-2.5 py-1.5 bg-white/5 border border-white/10 text-slate-300 hover:text-white rounded-lg text-[10px] transition-colors"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                if (!confirm("Are you sure you want to delete this feature card?")) return;
                                setIsSavingCms(true);
                                try {
                                  await deleteDoc(doc(db, 'why_choose', wc.id));
                                  setCmsSaveMsg("Feature card deleted successfully!");
                                  setTimeout(() => setCmsSaveMsg(''), 3000);
                                } catch (err) {
                                  console.error(err);
                                }
                                setIsSavingCms(false);
                              }}
                              className="px-2.5 py-1.5 bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 rounded-lg text-[10px] transition-colors"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      ))}
                      {whyChooseList.length === 0 && (
                        <p className="col-span-full text-xs text-slate-500 italic">No features recorded. Use form above to add some.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 12: GENERAL SETTINGS */}
          {activeTab === 'settings' && (
            <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-sm shadow-xl space-y-6">
              <div>
                <h3 className="text-base font-bold text-white uppercase tracking-wider mb-1 flex items-center gap-2">
                  <Settings className="w-5 h-5 text-blue-400" />
                  <span>General & Administrative Settings</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Update administrative console login properties, official support addresses, and social community linkages.
                </p>
              </div>

              <form onSubmit={handleUpdateGeneralSettings} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  
                  {/* Console Login Credentials Group */}
                  <div className="p-4 bg-white/5 border border-white/10 rounded-2xl space-y-4">
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider border-b border-white/5 pb-2">Administrative Credentials</h4>
                    
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 uppercase font-semibold block">Authorized Admin Login Email</label>
                        <input
                          type="email"
                          required
                          placeholder="ATgrowfund@gmail.com"
                          value={adminEmailInput}
                          onChange={(e) => setAdminEmailInput(e.target.value)}
                          className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 font-mono"
                        />
                        <span className="text-[9px] text-slate-500 block">
                          Changing this will change the required administrator login email immediately.
                        </span>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 uppercase font-semibold block">Update Password (Leave blank to keep current)</label>
                        <input
                          type="password"
                          placeholder="Enter new administrator passkey"
                          value={adminPasswordInput}
                          onChange={(e) => setAdminPasswordInput(e.target.value)}
                          className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 font-mono"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Contact & Support Email Group */}
                  <div className="p-4 bg-white/5 border border-white/10 rounded-2xl space-y-4 font-sans">
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider border-b border-white/5 pb-2">Communication Links</h4>
                    
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 uppercase font-semibold block">Support Contact Email</label>
                        <input
                          type="email"
                          required
                          placeholder="atfundingsupport@gmail.com"
                          value={supportEmailInput}
                          onChange={(e) => setSupportEmailInput(e.target.value)}
                          className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500"
                        />
                        <span className="text-[9px] text-slate-500 block">
                          Official support email shown to traders throughout terminal screens.
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Social Media Links Group */}
                  <div className="p-4 bg-white/5 border border-white/10 rounded-2xl space-y-4 md:col-span-2">
                    <h4 className="text-xs font-bold text-white uppercase tracking-wider border-b border-white/5 pb-2">Social Community Linkages</h4>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 font-sans">
                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 uppercase font-semibold block">Facebook Page</label>
                        <input
                          type="url"
                          required
                          placeholder="Facebook profile/page URL"
                          value={facebookLinkInput}
                          onChange={(e) => setFacebookLinkInput(e.target.value)}
                          className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 font-mono text-[11px]"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 uppercase font-semibold block">Instagram Handle</label>
                        <input
                          type="url"
                          required
                          placeholder="Instagram profile URL"
                          value={instagramLinkInput}
                          onChange={(e) => setInstagramLinkInput(e.target.value)}
                          className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 font-mono text-[11px]"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] text-slate-400 uppercase font-semibold block">Telegram Channel</label>
                        <input
                          type="url"
                          required
                          placeholder="Telegram invite URL"
                          value={telegramLinkInput}
                          onChange={(e) => setTelegramLinkInput(e.target.value)}
                          className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-blue-500 font-mono text-[11px]"
                        />
                      </div>
                    </div>
                  </div>

                </div>

                {settingsMsg && (
                  <div className={`p-4 rounded-xl text-xs font-semibold ${
                    settingsMsg.includes('success') || settingsMsg.includes('successfully') ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'
                  }`}>
                    {settingsMsg}
                  </div>
                )}

                <div className="flex justify-end pt-2 border-t border-white/5">
                  <button
                    type="submit"
                    disabled={isSavingSettings}
                    className="h-11 px-8 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white font-bold rounded-xl text-xs transition-colors shadow-lg shadow-blue-500/15 cursor-pointer"
                  >
                    {isSavingSettings ? "Saving Settings..." : "Save General Settings"}
                  </button>
                </div>
              </form>

              {/* ADMINISTRATIVE DATABASE CLEANUP CENTER */}
              <div className="p-5 bg-rose-500/5 border border-rose-500/10 rounded-2xl space-y-4">
                <div>
                  <h4 className="text-xs font-black text-rose-400 uppercase tracking-wider flex items-center gap-1.5 font-mono">
                    <AlertTriangle className="w-4 h-4 text-rose-400 animate-pulse" />
                    <span>Database Purge & Demo Data Cleanup Center</span>
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Purge all system-initialized test users, purchases, demo accounts, old notifications, and mock wall-of-fame records. 
                    This operation only deletes fake/demo records while keeping your database structure intact.
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={async () => {
                      if (!confirm("CRITICAL WARNING: Are you sure you want to permanently purge all existing demo/test users, purchases, and simulated accounts? This cannot be undone!")) {
                        return;
                      }

                      setIsSavingSettings(true);
                      setSettingsMsg("Initializing database purge...");

                      try {
                        let usersDeleted = 0;
                        let ordersDeleted = 0;
                        let accountsDeleted = 0;
                        let payoutsDeleted = 0;
                        let violationsDeleted = 0;
                        let tradesDeleted = 0;
                        let affiliatesDeleted = 0;

                        // 1. Purge all non-admin users directly querying Firestore
                        const usersSnap = await getDocs(collection(db, 'users'));
                        for (const docSnap of usersSnap.docs) {
                          const data = docSnap.data();
                          if (data.role !== 'admin' && docSnap.id !== auth.currentUser?.uid) {
                            await deleteDoc(doc(db, 'users', docSnap.id));
                            usersDeleted++;
                          }
                        }

                        // 2. Purge all orders (purchases) directly querying Firestore
                        const ordersSnap = await getDocs(collection(db, 'orders'));
                        for (const docSnap of ordersSnap.docs) {
                          await deleteDoc(doc(db, 'orders', docSnap.id));
                          ordersDeleted++;
                        }

                        // 3. Purge all accounts directly querying Firestore
                        const accountsSnap = await getDocs(collection(db, 'accounts'));
                        for (const docSnap of accountsSnap.docs) {
                          await deleteDoc(doc(db, 'accounts', docSnap.id));
                          accountsDeleted++;
                        }

                        // 4. Purge all payouts directly querying Firestore
                        const payoutsSnap = await getDocs(collection(db, 'payouts'));
                        for (const docSnap of payoutsSnap.docs) {
                          await deleteDoc(doc(db, 'payouts', docSnap.id));
                          payoutsDeleted++;
                        }

                        // 5. Purge all rule violations directly querying Firestore
                        const violationsSnap = await getDocs(collection(db, 'ruleViolations'));
                        for (const docSnap of violationsSnap.docs) {
                          await deleteDoc(doc(db, 'ruleViolations', docSnap.id));
                          violationsDeleted++;
                        }

                        // 6. Purge all trades directly querying Firestore
                        const tradesSnap = await getDocs(collection(db, 'trades'));
                        for (const docSnap of tradesSnap.docs) {
                          await deleteDoc(doc(db, 'trades', docSnap.id));
                          tradesDeleted++;
                        }

                        // 7. Purge all affiliates directly querying Firestore
                        const affiliatesSnap = await getDocs(collection(db, 'affiliates'));
                        for (const docSnap of affiliatesSnap.docs) {
                          await deleteDoc(doc(db, 'affiliates', docSnap.id));
                          affiliatesDeleted++;
                        }

                        // 8. Purge all notifications
                        const notificationsSnap = await getDocs(collection(db, 'notifications'));
                        for (const docSnap of notificationsSnap.docs) {
                          await deleteDoc(doc(db, 'notifications', docSnap.id));
                        }

                        setSettingsMsg(`Purge Completed Successfully! Purged: ${usersDeleted} traders, ${ordersDeleted} orders, ${accountsDeleted} accounts, ${payoutsDeleted} payouts, ${violationsDeleted} violations, ${tradesDeleted} trades.`);
                      } catch (err) {
                        console.error("Purge Error:", err);
                        setSettingsMsg("Purge operation failed. See console logs for details.");
                      }
                      setIsSavingSettings(false);
                    }}
                    disabled={isSavingSettings}
                    className="h-10 px-5 bg-rose-600 hover:bg-rose-500 disabled:bg-slate-800 text-white font-bold rounded-xl text-xs transition-colors uppercase tracking-wider cursor-pointer"
                  >
                    Purge All Demo/Test Records
                  </button>
                </div>
                <p className="text-[10px] text-amber-300 font-medium leading-relaxed max-w-2xl pt-1">
                  <strong>Note on Authentication:</strong> Purging profiles from Firestore deletes user database data but keeps their login credentials in Firebase Auth. If a previously registered trader wants to log back in after a database purge, they should use the standard <strong>Log In</strong> screen with their original password. The app will automatically and seamlessly recreate their clean Firestore profile document on demand!
                </p>
              </div>
            </div>
          )}

          {/* TAB 14: SOCIAL MEDIA MANAGER */}
          {activeTab === 'social_links' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-fade-in">
              {/* Left Column: Add/Edit social profile */}
              <div className="lg:col-span-5 bg-white/5 border border-white/10 rounded-3xl p-6 space-y-4 backdrop-blur-sm shadow-xl">
                <div>
                  <h3 className="text-base font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <Share2 className="w-5 h-5 text-blue-400" />
                    <span>{editingSocialLink ? "Edit Social Platform" : "Add Social Platform"}</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Manage active social platforms shown to users in the terminal footer and side navigation.
                  </p>
                </div>

                {socialMsg && (
                  <div className={`p-3 rounded-xl text-xs font-bold ${socialMsg.includes('Error') ? 'bg-red-500/10 border border-red-500/25 text-red-300' : 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-300'}`}>
                    {socialMsg}
                  </div>
                )}

                <form onSubmit={handleSaveSocialLink} className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400 uppercase font-semibold">Platform Name</label>
                    <input
                      type="text"
                      placeholder="e.g. Telegram, Discord, X (Twitter)"
                      required
                      value={socialName}
                      onChange={(e) => setSocialName(e.target.value)}
                      className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 uppercase font-semibold">Platform Icon</label>
                      <select
                        value={socialIcon}
                        onChange={(e) => setSocialIcon(e.target.value)}
                        className="w-full h-10 bg-black/45 border border-white/10 rounded-xl px-2 text-xs text-slate-300 focus:outline-none focus:border-blue-500"
                      >
                        <option value="Send">Send (Telegram)</option>
                        <option value="MessageSquare">MessageSquare (Discord)</option>
                        <option value="Twitter">Twitter (X)</option>
                        <option value="Youtube">Youtube</option>
                        <option value="Instagram">Instagram</option>
                        <option value="Facebook">Facebook</option>
                        <option value="Linkedin">Linkedin</option>
                        <option value="Link">Generic Link</option>
                        <option value="Mail">Mail</option>
                        <option value="Bell">Bell</option>
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 uppercase font-semibold">Display Sort Order</label>
                      <input
                        type="number"
                        placeholder="e.g. 1"
                        required
                        value={socialSortOrder}
                        onChange={(e) => setSocialSortOrder(parseInt(e.target.value) || 0)}
                        className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400 uppercase font-semibold">Target Redirect URL</label>
                    <input
                      type="url"
                      placeholder="e.g. https://t.me/atfunding"
                      required
                      value={socialUrl}
                      onChange={(e) => setSocialUrl(e.target.value)}
                      className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-blue-500 font-mono"
                    />
                  </div>

                  <label className="flex items-center space-x-2 cursor-pointer py-1">
                    <input
                      type="checkbox"
                      checked={socialActive}
                      onChange={(e) => setSocialActive(e.target.checked)}
                      className="rounded border-white/20 bg-black/40 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                    />
                    <span className="text-xs text-slate-300 font-bold">Visible to Public Users</span>
                  </label>

                  <div className="flex gap-2.5 pt-2">
                    <button
                      type="submit"
                      className="flex-1 h-10 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs transition-colors"
                    >
                      {editingSocialLink ? "Update Link" : "Save Social Link"}
                    </button>
                    {editingSocialLink && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingSocialLink(null);
                          setSocialName('');
                          setSocialIcon('Send');
                          setSocialUrl('');
                          setSocialActive(true);
                          setSocialSortOrder(0);
                        }}
                        className="px-4 h-10 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 font-bold rounded-xl text-xs transition-colors"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </form>
              </div>

              {/* Right Column: Display list of configured social linkages */}
              <div className="lg:col-span-7 bg-white/5 border border-white/10 rounded-3xl p-6 space-y-4 backdrop-blur-sm shadow-xl">
                <h3 className="text-base font-bold text-white uppercase tracking-wider flex items-center justify-between">
                  <span>Configured Platforms ({socialLinks.length})</span>
                  <span className="text-[10px] font-mono text-slate-500 uppercase">Sort Order Active</span>
                </h3>

                <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                  {socialLinks
                    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
                    .map((link) => {
                      // Dynamically render Lucide Icon by name
                      const IconComponent = (LucideIcons as any)[link.icon] || LucideIcons.Link;
                      return (
                        <div key={link.id} className="p-4 bg-black/20 border border-white/5 hover:border-white/10 rounded-2xl flex items-center justify-between transition-all">
                          <div className="flex items-center gap-3.5">
                            <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/25 flex items-center justify-center text-blue-400">
                              <IconComponent className="w-5 h-5" />
                            </div>
                            <div>
                              <h4 className="text-sm font-bold text-white flex items-center gap-2">
                                <span>{link.name}</span>
                                <span className="text-[10px] font-mono text-slate-500 font-normal">Order: {link.sortOrder || 0}</span>
                                <span className={`px-1.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase ${link.active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                                  {link.active ? 'Active' : 'Disabled'}
                                </span>
                              </h4>
                              <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-400 hover:underline break-all font-mono mt-0.5 block">{link.url}</a>
                            </div>
                          </div>

                          <div className="flex gap-1.5 shrink-0">
                            <button
                              onClick={() => {
                                setEditingSocialLink(link);
                                setSocialName(link.name);
                                setSocialIcon(link.icon);
                                setSocialUrl(link.url);
                                setSocialActive(link.active);
                                setSocialSortOrder(link.sortOrder || 0);
                              }}
                              className="p-1.5 bg-white/5 hover:bg-blue-600/20 border border-white/10 hover:border-blue-500/30 text-slate-400 hover:text-blue-400 rounded-lg text-xs transition-colors"
                              title="Edit"
                            >
                              <Settings className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => handleToggleSocialActive(link.id, link.active)}
                              className={`p-1.5 border rounded-lg text-xs transition-colors ${link.active ? 'bg-amber-500/10 border-amber-500/20 text-amber-400 hover:bg-amber-500/20' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20'}`}
                              title={link.active ? 'Disable' : 'Enable'}
                            >
                              {link.active ? <X className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              onClick={() => handleDeleteSocialLink(link.id)}
                              className="p-1.5 bg-white/5 hover:bg-red-600/20 border border-white/10 hover:border-red-500/30 text-slate-400 hover:text-red-400 rounded-lg text-xs transition-colors"
                              title="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}

                  {socialLinks.length === 0 && (
                    <div className="text-center py-12 bg-black/10 rounded-2xl border border-white/5">
                      <p className="text-xs text-slate-500 font-medium">No custom social platform configurations found.</p>
                      <p className="text-[10px] text-slate-600 mt-1">Please use the form on the left to add Facebook, Telegram, etc.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 15: SUPPORT TICKETS REVOLVING PANEL */}
          {activeTab === 'support_tickets' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-fade-in h-[620px]">
              {/* Left: Support Ticket Registry */}
              <div className="lg:col-span-5 bg-white/5 border border-white/10 rounded-3xl p-5 flex flex-col backdrop-blur-sm shadow-xl h-full overflow-hidden">
                <div className="mb-4">
                  <h3 className="text-base font-bold text-white uppercase tracking-wider flex items-center justify-between">
                    <span>Trader Support Center</span>
                    <span className="text-[10px] font-mono bg-blue-500/10 text-blue-400 px-2 py-0.5 rounded-full border border-blue-500/20">
                      {supportTickets.filter(t => t.status !== 'closed').length} Pending
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Manage active support cases, technical difficulties, and checkout validation issues.
                  </p>
                </div>

                {/* Filter Controls */}
                <div className="flex gap-1 bg-black/20 p-1 rounded-xl border border-white/5 mb-3 text-[10px] font-bold text-slate-400">
                  <button className="flex-1 py-1.5 rounded-lg bg-blue-600 text-white font-black text-center">
                    All Enquiries
                  </button>
                </div>

                {/* Scrollable list of tickets */}
                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {supportTickets.map((ticket) => {
                    const isSelected = selectedTicket && selectedTicket.id === ticket.id;
                    const lastMessage = ticket.messages && ticket.messages.length > 0 
                      ? ticket.messages[ticket.messages.length - 1].message 
                      : ticket.description;
                    return (
                      <div
                        key={ticket.id}
                        onClick={() => setSelectedTicket(ticket)}
                        className={`p-3.5 rounded-2xl border text-left cursor-pointer transition-all ${
                          isSelected 
                            ? 'bg-blue-600/15 border-blue-500 shadow-lg' 
                            : 'bg-black/20 border-white/5 hover:border-white/10'
                        }`}
                      >
                        <div className="flex justify-between items-start gap-2">
                          <span className="text-[10px] text-slate-400 font-mono truncate select-none">
                            {ticket.userEmail}
                          </span>
                          <span className={`px-1.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase shrink-0 ${
                            ticket.status === 'open' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20 animate-pulse' :
                            ticket.status === 'replied' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                            'bg-slate-500/10 text-slate-400'
                          }`}>
                            {ticket.status}
                          </span>
                        </div>

                        <h4 className="text-xs font-bold text-white mt-1.5 truncate">{ticket.subject}</h4>
                        <p className="text-[11px] text-slate-500 mt-0.5 truncate">{lastMessage}</p>

                        <div className="flex justify-between items-center mt-2.5 pt-2 border-t border-white/5 text-[9px] text-slate-500 font-mono">
                          <span>Cat: {ticket.category}</span>
                          <span>{new Date(ticket.updatedAt || ticket.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    );
                  })}

                  {supportTickets.length === 0 && (
                    <div className="text-center py-16 text-slate-500">
                      <MessageSquare className="w-8 h-8 text-slate-600 mx-auto mb-2" />
                      <p className="text-xs font-medium">No incoming help tickets filed.</p>
                      <p className="text-[10px] text-slate-600 mt-1">Traders will generate cases from their Help Desk console.</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Right: Active Ticket Conversation Chat */}
              <div className="lg:col-span-7 bg-white/5 border border-white/10 rounded-3xl p-5 flex flex-col backdrop-blur-sm shadow-xl h-full overflow-hidden">
                {selectedTicket ? (
                  <div className="flex flex-col h-full">
                    {/* Header Controls */}
                    <div className="flex justify-between items-start border-b border-white/10 pb-3 mb-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-bold text-white uppercase tracking-wider">{selectedTicket.subject}</h3>
                          <span className="px-2 py-0.5 bg-blue-500/10 text-blue-400 border border-blue-500/20 rounded text-[9px] font-mono uppercase">
                            {selectedTicket.category}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5 font-mono select-all">Case #{selectedTicket.id} &bull; {selectedTicket.userEmail}</p>
                      </div>

                      {selectedTicket.status !== 'closed' && (
                        <button
                          onClick={() => handleCloseTicket(selectedTicket.id)}
                          className="px-3 py-1.5 bg-rose-600/10 hover:bg-rose-600 border border-rose-500/20 text-rose-400 hover:text-white font-bold rounded-xl text-[10px] uppercase tracking-wider transition-all cursor-pointer"
                        >
                          Close Ticket
                        </button>
                      )}
                    </div>

                    {/* Chat Messages Feed */}
                    <div className="flex-1 overflow-y-auto space-y-3.5 pr-1 mb-4">
                      {/* Ticket Initial Problem Description */}
                      <div className="p-4 rounded-2xl bg-black/40 border border-white/5 space-y-2">
                        <div className="flex justify-between text-[10px] font-mono text-slate-500">
                          <span className="font-bold text-slate-400">Trader Original Query</span>
                          <span>{new Date(selectedTicket.createdAt).toLocaleString()}</span>
                        </div>
                        <p className="text-xs text-slate-300 leading-relaxed font-sans">{selectedTicket.description}</p>
                      </div>

                      {/* Conversational timeline of messages */}
                      {selectedTicket.messages && selectedTicket.messages.map((msg) => {
                        const isAdmin = msg.senderRole === 'admin';
                        return (
                          <div key={msg.id} className={`flex flex-col ${isAdmin ? 'items-end' : 'items-start'}`}>
                            <div className={`p-3.5 rounded-2xl max-w-[85%] text-xs border ${
                              isAdmin 
                                ? 'bg-blue-600/10 border-blue-500/20 text-blue-200 rounded-tr-none' 
                                : 'bg-white/5 border-white/10 text-slate-200 rounded-tl-none'
                            }`}>
                              <p className="leading-relaxed font-sans">{msg.message}</p>
                              <span className="text-[8px] font-mono text-slate-500 mt-1.5 block text-right">
                                {isAdmin ? 'Support Staff' : 'Trader'} &bull; {new Date(msg.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Reply Form */}
                    {selectedTicket.status === 'closed' ? (
                      <div className="p-3 bg-white/5 rounded-2xl border border-white/5 text-center text-xs text-slate-500 font-mono">
                        This query is resolved & closed. Re-open from user terminal if required.
                      </div>
                    ) : (
                      <form onSubmit={handleReplyTicket} className="flex gap-2">
                        <input
                          type="text"
                          placeholder="Type official system response to trader..."
                          required
                          value={ticketReplyMsg}
                          onChange={(e) => setTicketReplyMsg(e.target.value)}
                          className="flex-1 h-11 bg-black/40 border border-white/10 rounded-xl px-4 text-xs text-white focus:outline-none focus:border-blue-500 placeholder-slate-500"
                        />
                        <button
                          type="submit"
                          className="h-11 px-5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs transition-colors shadow-lg cursor-pointer"
                        >
                          Send
                        </button>
                      </form>
                    )}
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col justify-center items-center text-center text-slate-500">
                    <MessageSquare className="w-12 h-12 text-slate-700 mb-2" />
                    <p className="text-xs font-semibold">No Enquiry Selected</p>
                    <p className="text-[10px] text-slate-600 mt-0.5">Choose a helpdesk ticket from the left panel to begin auditing chat.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 16: SYSTEM-WIDE BROADCAST ANNOUNCEMENTS */}
          {activeTab === 'announcements' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 animate-fade-in">
              {/* Left Column: Form to Write Broadcast */}
              <div className="lg:col-span-5 bg-white/5 border border-white/10 rounded-3xl p-6 space-y-4 backdrop-blur-sm shadow-xl">
                <div>
                  <h3 className="text-base font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <Bell className="w-5 h-5 text-blue-400" />
                    <span>{editingAnnouncement ? "Edit Announcement" : "Create Global Broadcast"}</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Deploy alerts, rules updates, holiday trading hours, or general prop news directly onto all users' dashboards in real-time.
                  </p>
                </div>

                {announceMsg && (
                  <div className={`p-3 rounded-xl text-xs font-bold ${announceMsg.includes('Error') ? 'bg-red-500/10 border border-red-500/25 text-red-300' : 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-300'}`}>
                    {announceMsg}
                  </div>
                )}

                <form onSubmit={handleSaveAnnouncement} className="space-y-4">
                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400 uppercase font-semibold">Announcement Title</label>
                    <input
                      type="text"
                      placeholder="e.g. BTC Payout Validation Delays Solved"
                      required
                      value={announceTitle}
                      onChange={(e) => setAnnounceTitle(e.target.value)}
                      className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[10px] text-slate-400 uppercase font-semibold">Detailed Notification Message</label>
                    <textarea
                      placeholder="Enter detailed notice shown to all logged in traders."
                      rows={4}
                      required
                      value={announceMessage}
                      onChange={(e) => setAnnounceMessage(e.target.value)}
                      className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-xs text-white focus:outline-none focus:border-blue-500 resize-none font-sans"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 uppercase font-semibold">Start Display Date</label>
                      <input
                        type="date"
                        required
                        value={announceStartDate}
                        onChange={(e) => setAnnounceStartDate(e.target.value)}
                        className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-slate-300 focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 uppercase font-semibold">End Expiration Date</label>
                      <input
                        type="date"
                        required
                        value={announceEndDate}
                        onChange={(e) => setAnnounceEndDate(e.target.value)}
                        className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-slate-300 focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>

                  <label className="flex items-center space-x-2 cursor-pointer py-1">
                    <input
                      type="checkbox"
                      checked={announceActive}
                      onChange={(e) => setAnnounceActive(e.target.checked)}
                      className="rounded border-white/20 bg-black/40 text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
                    />
                    <span className="text-xs text-slate-300 font-bold">Enabled & Broadcast Immediately</span>
                  </label>

                  <div className="flex gap-2.5 pt-2">
                    <button
                      type="submit"
                      className="flex-1 h-10 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs transition-colors"
                    >
                      {editingAnnouncement ? "Update Notice" : "Broadcast Now"}
                    </button>
                    {editingAnnouncement && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingAnnouncement(null);
                          setAnnounceTitle('');
                          setAnnounceMessage('');
                          setAnnounceStartDate('');
                          setAnnounceEndDate('');
                          setAnnounceActive(true);
                        }}
                        className="px-4 h-10 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 font-bold rounded-xl text-xs transition-colors"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </form>
              </div>

              {/* Right Column: Display list of published broadcasts */}
              <div className="lg:col-span-7 bg-white/5 border border-white/10 rounded-3xl p-6 space-y-4 backdrop-blur-sm shadow-xl">
                <h3 className="text-base font-bold text-white uppercase tracking-wider flex items-center justify-between">
                  <span>Published Alerts ({announcements.length})</span>
                  <span className="text-[10px] font-mono text-slate-500 uppercase">Live Sync</span>
                </h3>

                <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                  {announcements.map((ann) => (
                    <div key={ann.id} className="p-4 bg-black/20 border border-white/5 hover:border-white/10 rounded-2xl space-y-2.5 transition-colors">
                      <div className="flex justify-between items-start">
                        <div>
                          <h4 className="text-sm font-bold text-white flex items-center gap-2">
                            <span>{ann.title}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[8px] font-mono font-bold uppercase ${ann.active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                              {ann.active ? 'Active' : 'Disabled'}
                            </span>
                          </h4>
                          <span className="text-[9px] text-slate-500 font-mono block mt-0.5">
                            Duration: {new Date(ann.startDate).toLocaleDateString()} to {new Date(ann.endDate).toLocaleDateString()}
                          </span>
                        </div>

                        <div className="flex gap-1.5 shrink-0">
                          <button
                            onClick={() => {
                              setEditingAnnouncement(ann);
                              setAnnounceTitle(ann.title);
                              setAnnounceMessage(ann.message);
                              setAnnounceStartDate(ann.startDate);
                              setAnnounceEndDate(ann.endDate);
                              setAnnounceActive(ann.active);
                            }}
                            className="p-1.5 bg-white/5 hover:bg-blue-600/20 border border-white/10 hover:border-blue-500/30 text-slate-400 hover:text-blue-400 rounded-lg text-xs transition-colors"
                            title="Edit"
                          >
                            <Settings className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleToggleAnnouncementActive(ann.id, ann.active)}
                            className={`p-1.5 border rounded-lg text-xs transition-colors ${ann.active ? 'bg-amber-500/10 border-amber-500/20 text-amber-400 hover:bg-amber-500/20' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20'}`}
                            title={ann.active ? 'Disable' : 'Enable'}
                          >
                            {ann.active ? <X className="w-3.5 h-3.5" /> : <Check className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={() => handleDeleteAnnouncement(ann.id)}
                            className="p-1.5 bg-white/5 hover:bg-red-600/20 border border-white/10 hover:border-red-500/30 text-slate-400 hover:text-red-400 rounded-lg text-xs transition-colors"
                            title="Delete"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <p className="text-xs text-slate-300 leading-relaxed font-sans">{ann.message}</p>
                    </div>
                  ))}

                  {announcements.length === 0 && (
                    <div className="text-center py-12 bg-black/10 rounded-2xl border border-white/5">
                      <p className="text-xs text-slate-500 font-medium">No system broadcasts deployed yet.</p>
                      <p className="text-[10px] text-slate-600 mt-1">Deploy an announcement on the left panel to update your traders' boards.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 17: OFFERS & AVAILABILITY SYSTEMS */}
          {activeTab === 'offers_availability' && (
            <div className="space-y-8 animate-fade-in text-left">
              {/* Account Availability Manager */}
              <div className="bg-white/5 border border-white/10 rounded-3xl p-6 space-y-6 shadow-xl">
                <div>
                  <h3 className="text-base font-bold text-white uppercase tracking-wider flex items-center gap-2">
                    <Activity className="w-5 h-5 text-emerald-400" />
                    <span>Account Availability Manager</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Toggle active statuses of your challenge packages, set expected return dates, and view waitlist registrations.
                  </p>
                </div>

                {pkgConfigMsg && (
                  <div className={`p-3 rounded-xl text-xs font-bold ${pkgConfigMsg.includes('Error') ? 'bg-red-500/10 border border-red-500/25 text-red-300' : 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-300'}`}>
                    {pkgConfigMsg}
                  </div>
                )}

                <div className="overflow-x-auto border border-white/10 rounded-2xl bg-black/20">
                  <table className="w-full text-left border-collapse min-w-[600px]">
                    <thead>
                      <tr className="border-b border-white/10 text-[10px] text-slate-400 uppercase tracking-wider">
                        <th className="p-4">Account Name</th>
                        <th className="p-4">Status</th>
                        <th className="p-4">Expected Return Date</th>
                        <th className="p-4">Waiting Users</th>
                        <th className="p-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {CHALLENGE_PACKAGES.map((pkg) => {
                        const config = packagesConfig[pkg.id] || {};
                        const isDisabled = config.disabled || false;
                        const expectedReturnDate = config.expectedReturnDate || '';
                        const waitingCount = interestedUsers.filter(u => u.packageId === pkg.id).length;

                        return (
                          <tr key={pkg.id} className="hover:bg-white/5 transition-colors">
                            <td className="p-4">
                              <span className="text-xs font-bold text-white block">{pkg.name}</span>
                              <span className="text-[10px] text-slate-400 uppercase font-mono">{pkg.type.replace('_', ' ')}</span>
                            </td>
                            <td className="p-4">
                              <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold ${isDisabled ? 'bg-red-500/15 text-red-400 border border-red-500/20' : 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'}`}>
                                <span className={`w-1.5 h-1.5 rounded-full ${isDisabled ? 'bg-red-400' : 'bg-emerald-400'}`}></span>
                                {isDisabled ? 'Disabled' : 'Enabled'}
                              </span>
                            </td>
                            <td className="p-4">
                              <input
                                type="text"
                                placeholder="e.g. Next Monday"
                                defaultValue={expectedReturnDate}
                                onBlur={async (e) => {
                                  try {
                                    const updatedConfig = {
                                      ...packagesConfig,
                                      [pkg.id]: {
                                        ...packagesConfig[pkg.id],
                                        expectedReturnDate: e.target.value
                                      }
                                    };
                                    await setDoc(doc(db, 'settings', 'packages'), updatedConfig);
                                    setPkgConfigMsg(`Updated return date for ${pkg.name}.`);
                                  } catch (err: any) {
                                    setPkgConfigMsg('Error: ' + err.message);
                                  }
                                }}
                                className="h-8 bg-black/40 border border-white/10 rounded-lg px-2 text-xs text-white focus:outline-none focus:border-blue-500 w-36 font-mono text-center"
                              />
                            </td>
                            <td className="p-4">
                              <span className="text-xs font-mono font-bold text-blue-400">{waitingCount} Traders waiting</span>
                            </td>
                            <td className="p-4 text-right space-x-2">
                              <button
                                type="button"
                                onClick={async () => {
                                  try {
                                    const updatedConfig = {
                                      ...packagesConfig,
                                      [pkg.id]: {
                                        ...packagesConfig[pkg.id],
                                        disabled: !isDisabled
                                      }
                                    };
                                    await setDoc(doc(db, 'settings', 'packages'), updatedConfig);
                                    setPkgConfigMsg(`${pkg.name} has been ${!isDisabled ? 'disabled' : 'enabled'}.`);
                                  } catch (err: any) {
                                    setPkgConfigMsg('Error toggling status: ' + err.message);
                                  }
                                }}
                                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all border ${isDisabled ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20' : 'bg-red-500/10 border-red-500/20 text-red-400 hover:bg-red-500/20'}`}
                              >
                                {isDisabled ? 'Enable' : 'Disable'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setSelectedPkgWaitlistEmails(pkg.id)}
                                className="px-2.5 py-1 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-lg text-[10px] font-bold transition-all"
                              >
                                View Emails
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Buy 1 Get 1 Mapping Manager */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white/5 border border-white/10 rounded-3xl p-6 space-y-4 shadow-xl">
                  <div>
                    <h3 className="text-base font-bold text-white uppercase tracking-wider flex items-center gap-2">
                      <Tag className="w-5 h-5 text-blue-400" />
                      <span>Buy 1 Get 1 Mapping Manager</span>
                    </h3>
                    <p className="text-xs text-slate-400 mt-1">
                      Configure automatic BOGO credits. For example: Purchase 100K Two Step and get 25K Two Step automatically!
                    </p>
                  </div>

                  {bogoMsg && (
                    <div className={`p-3 rounded-xl text-xs font-bold ${bogoMsg.includes('Error') ? 'bg-red-500/10 border border-red-500/25 text-red-300' : 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-300'}`}>
                      {bogoMsg}
                    </div>
                  )}

                  <div className="bg-blue-950/20 border border-blue-500/25 rounded-2xl p-4 text-xs space-y-2 text-slate-300">
                    <p className="font-bold text-blue-300">💡 Standard Mapping Presets:</p>
                    <ul className="list-disc pl-4 space-y-1 font-mono text-[11px]">
                      <li>100K Two Step → 25K Two Step</li>
                      <li>50K Two Step → 10K Two Step</li>
                      <li>25K One Step → 5K One Step</li>
                    </ul>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 uppercase font-semibold">Main Account (Purchased)</label>
                      <select
                        value={bogoMainSelect}
                        onChange={(e) => setBogoMainSelect(e.target.value)}
                        className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none"
                      >
                        {CHALLENGE_PACKAGES.map(pkg => (
                          <option key={pkg.id} value={pkg.id} className="bg-slate-900">{pkg.name} ({pkg.type.replace('_', ' ')})</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] text-slate-400 uppercase font-semibold">Free Bonus Account (Automatically Added)</label>
                      <select
                        value={bogoFreeSelect}
                        onChange={(e) => setBogoFreeSelect(e.target.value)}
                        className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none"
                      >
                        {CHALLENGE_PACKAGES.map(pkg => (
                          <option key={pkg.id} value={pkg.id} className="bg-slate-900">{pkg.name} ({pkg.type.replace('_', ' ')})</option>
                        ))}
                      </select>
                    </div>

                    <button
                      type="button"
                      onClick={async () => {
                        setBogoMsg('Saving mapping...');
                        try {
                          const updatedMappings = {
                            ...bogoMappings,
                            [bogoMainSelect]: bogoFreeSelect
                          };
                          await setDoc(doc(db, 'settings', 'bogo_mappings'), { mappings: updatedMappings });
                          setBogoMsg('BOGO Mapping saved successfully!');
                        } catch (err: any) {
                          setBogoMsg('Error saving: ' + err.message);
                        }
                      }}
                      className="w-full h-10 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs transition-colors"
                    >
                      Save BOGO Mapping
                    </button>
                  </div>
                </div>

                <div className="bg-white/5 border border-white/10 rounded-3xl p-6 space-y-4 shadow-xl">
                  <h3 className="text-sm font-bold text-white uppercase tracking-wider">Active BOGO Mappings</h3>
                  <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
                    {Object.entries(bogoMappings).map(([mainId, freeId]) => {
                      const mainPkg = CHALLENGE_PACKAGES.find(p => p.id === mainId);
                      const freePkg = CHALLENGE_PACKAGES.find(p => p.id === freeId);

                      return (
                        <div key={mainId} className="p-3 bg-black/35 border border-white/5 rounded-xl flex items-center justify-between">
                          <div>
                            <p className="text-xs text-white font-bold">
                              {mainPkg?.name || mainId} <span className="text-[9px] text-slate-400 uppercase font-mono">({mainPkg?.type.replace('_', ' ')})</span>
                            </p>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="text-[10px] text-blue-400 uppercase tracking-widest font-bold">🎁 Free Bonus:</span>
                              <span className="text-xs text-slate-300 font-medium">{freePkg?.name || freeId}</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={async () => {
                              try {
                                const updatedMappings = { ...bogoMappings };
                                delete updatedMappings[mainId];
                                await setDoc(doc(db, 'settings', 'bogo_mappings'), { mappings: updatedMappings });
                                setBogoMsg('Mapping removed successfully.');
                              } catch (err: any) {
                                setBogoMsg('Error removing mapping: ' + err.message);
                              }
                            }}
                            className="p-2 bg-white/5 hover:bg-red-500/20 border border-white/10 hover:border-red-500/30 text-slate-400 hover:text-red-400 rounded-xl transition-all"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}

                    {Object.keys(bogoMappings).length === 0 && (
                      <p className="text-xs text-slate-500 text-center py-8">No active Buy 1 Get 1 mappings configured yet.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 18: TASKS & REWARDS CONSOLE */}
          {activeTab === 'tasks_rewards' && (
            <div className="space-y-8 animate-fade-in text-left">
              {/* Top Title */}
              <div>
                <h2 className="text-xl font-black text-white uppercase tracking-wider">
                  Task & Reward Center (Admin Console)
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Configure unlimited social tasks, approve screenshots proof, manage reward store, review redemptions, and adjust player ledger.
                </p>
              </div>

              {/* Analytics Header Row */}
              <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Total Active Tasks</span>
                  <p className="text-xl font-bold text-white mt-1 font-mono">{tasks.filter(t => t.active).length} / {tasks.length}</p>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Pending Task Proofs</span>
                  <p className="text-xl font-bold text-yellow-500 mt-1 font-mono">
                    {taskSubmissions.filter(s => s.status === 'Pending Review').length}
                  </p>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Approved Completions</span>
                  <p className="text-xl font-bold text-emerald-400 mt-1 font-mono">
                    {taskSubmissions.filter(s => s.status === 'Approved').length}
                  </p>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Pending Redemptions</span>
                  <p className="text-xl font-bold text-blue-400 mt-1 font-mono">
                    {rewardRedemptions.filter(r => r.status === 'Pending').length}
                  </p>
                </div>
                <div className="bg-white/5 border border-white/10 rounded-2xl p-4 col-span-2 lg:col-span-1">
                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Circulating Coins</span>
                  <p className="text-xl font-bold text-yellow-400 mt-1 font-mono">
                    {users.reduce((sum, u) => sum + (u.coins || 0), 0).toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Sub-Tabs Selector */}
              <div className="flex border-b border-white/10 pb-2 space-x-2 overflow-x-auto scrollbar-none">
                {[
                  { id: 'tasks', label: 'Tasks Manager', icon: LucideIcons.ListTodo || LucideIcons.CheckSquare },
                  { id: 'submissions', label: 'Proof Submissions', icon: LucideIcons.FileCheck || LucideIcons.CheckCircle, badge: taskSubmissions.filter(s => s.status === 'Pending Review').length },
                  { id: 'rewards', label: 'Rewards Store Builder', icon: LucideIcons.Gift },
                  { id: 'redemptions', label: 'Redemptions Hub', icon: LucideIcons.ShoppingBag, badge: rewardRedemptions.filter(r => r.status === 'Pending').length },
                  { id: 'custom_links', label: 'Custom Links Config', icon: LucideIcons.ExternalLink || LucideIcons.Link },
                  { id: 'ledgers', label: 'Trader Ledgers', icon: LucideIcons.Coins }
                ].map(sub => (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() => setTasksSubTab(sub.id as any)}
                    className={`px-4 py-2 rounded-xl text-xs font-bold whitespace-nowrap flex items-center space-x-1.5 transition-colors relative ${
                      tasksSubTab === sub.id ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <span>{sub.label}</span>
                    {sub.badge !== undefined && sub.badge > 0 && (
                      <span className="bg-red-500 text-white text-[9px] px-1.5 py-0.5 rounded-full font-mono font-bold animate-pulse">
                        {sub.badge}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* SUB TAB 1: TASKS MANAGER */}
              {tasksSubTab === 'tasks' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Task creation form */}
                  <div className="bg-white/5 border border-white/10 rounded-3xl p-6 space-y-4 h-fit">
                    <h3 className="text-sm font-black text-white uppercase tracking-wider">
                      {editingTask ? 'Edit Task Parameter' : 'Create Social Task'}
                    </h3>

                    {taskMsg && (
                      <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-blue-300 text-xs">
                        {taskMsg}
                      </div>
                    )}

                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        setTaskMsg('');
                        if (!taskName.trim() || !taskLink.trim()) {
                          setTaskMsg('Name and Link are required.');
                          return;
                        }
                        try {
                          const taskId = editingTask ? editingTask.id : 'TASK-' + Math.floor(100000 + Math.random() * 900000);
                          const taskData = {
                            id: taskId,
                            name: taskName.trim(),
                            description: taskDesc.trim(),
                            platform: taskPlatform,
                            link: taskLink.trim(),
                            rewardCoins: Number(taskRewardCoins) || 0,
                            rewardXP: Number(taskRewardXP) || 0,
                            startDate: taskStartDate || new Date().toISOString().split('T')[0],
                            endDate: taskEndDate || '2030-12-31',
                            active: taskActive,
                            createdAt: editingTask ? editingTask.createdAt : new Date().toISOString()
                          };
                          await setDoc(doc(db, 'tasks', taskId), taskData);
                          setTaskMsg(`Task successfully ${editingTask ? 'updated' : 'created'}!`);
                          
                          // Reset form
                          setEditingTask(null);
                          setTaskName('');
                          setTaskDesc('');
                          setTaskLink('');
                          setTaskRewardCoins(10);
                          setTaskRewardXP(50);
                          setTaskStartDate('');
                          setTaskEndDate('');
                          setTaskActive(true);
                          setTimeout(() => setTaskMsg(''), 5000);
                        } catch (err: any) {
                          setTaskMsg('Error saving task: ' + err.message);
                        }
                      }}
                      className="space-y-3.5"
                    >
                      <div>
                        <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Task Name *</label>
                        <input
                          type="text"
                          value={taskName}
                          onChange={e => setTaskName(e.target.value)}
                          placeholder="e.g. Subscribe to YouTube Channel"
                          className="w-full h-10 px-3 bg-black/40 border border-white/10 rounded-xl text-white text-xs font-medium focus:border-blue-500 focus:outline-none"
                          required
                        />
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Description</label>
                        <textarea
                          value={taskDesc}
                          onChange={e => setTaskDesc(e.target.value)}
                          placeholder="e.g. Subscribe and submit proof screenshot of subscribed status."
                          className="w-full min-h-[60px] p-3 bg-black/40 border border-white/10 rounded-xl text-white text-xs font-medium focus:border-blue-500 focus:outline-none"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Platform Type</label>
                          <select
                            value={taskPlatform}
                            onChange={e => setTaskPlatform(e.target.value)}
                            className="w-full h-10 px-2 bg-black/40 border border-white/10 rounded-xl text-white text-xs font-medium focus:border-blue-500 focus:outline-none"
                          >
                            <option value="YouTube Subscribe" className="bg-[#0b0f19]">YouTube Subscribe</option>
                            <option value="Telegram Join" className="bg-[#0b0f19]">Telegram Join</option>
                            <option value="Discord Join" className="bg-[#0b0f19]">Discord Join</option>
                            <option value="Instagram Follow" className="bg-[#0b0f19]">Instagram Follow</option>
                            <option value="X Follow" className="bg-[#0b0f19]">X (Twitter) Follow</option>
                            <option value="Facebook Follow" className="bg-[#0b0f19]">Facebook Follow</option>
                            <option value="TikTok Follow" className="bg-[#0b0f19]">TikTok Follow</option>
                            <option value="Website Visit" className="bg-[#0b0f19]">Website Visit</option>
                            <option value="Custom Task" className="bg-[#0b0f19]">Custom Task</option>
                          </select>
                        </div>

                        <div>
                          <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Task URL Link *</label>
                          <input
                            type="url"
                            value={taskLink}
                            onChange={e => setTaskLink(e.target.value)}
                            placeholder="https://..."
                            className="w-full h-10 px-3 bg-black/40 border border-white/10 rounded-xl text-white text-xs font-medium focus:border-blue-500 focus:outline-none"
                            required
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Reward Coins</label>
                          <input
                            type="number"
                            value={taskRewardCoins}
                            onChange={e => setTaskRewardCoins(Number(e.target.value))}
                            className="w-full h-10 px-3 bg-black/40 border border-white/10 rounded-xl text-white text-xs font-mono font-bold focus:border-blue-500 focus:outline-none"
                            required
                            min={0}
                          />
                        </div>

                        <div>
                          <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Reward XP</label>
                          <input
                            type="number"
                            value={taskRewardXP}
                            onChange={e => setTaskRewardXP(Number(e.target.value))}
                            className="w-full h-10 px-3 bg-black/40 border border-white/10 rounded-xl text-white text-xs font-mono font-bold focus:border-blue-500 focus:outline-none"
                            required
                            min={0}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Start Date</label>
                          <input
                            type="date"
                            value={taskStartDate}
                            onChange={e => setTaskStartDate(e.target.value)}
                            className="w-full h-10 px-3 bg-black/40 border border-white/10 rounded-xl text-white text-xs font-medium focus:border-blue-500 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">End Date</label>
                          <input
                            type="date"
                            value={taskEndDate}
                            onChange={e => setTaskEndDate(e.target.value)}
                            className="w-full h-10 px-3 bg-black/40 border border-white/10 rounded-xl text-white text-xs font-medium focus:border-blue-500 focus:outline-none"
                          />
                        </div>
                      </div>

                      <div className="flex items-center space-x-2 py-1">
                        <input
                          type="checkbox"
                          id="taskActive"
                          checked={taskActive}
                          onChange={e => setTaskActive(e.target.checked)}
                          className="rounded border-white/10 bg-black/40 text-blue-600 focus:ring-0 focus:ring-offset-0"
                        />
                        <label htmlFor="taskActive" className="text-xs text-slate-300 font-bold cursor-pointer">
                          Enable Task immediately
                        </label>
                      </div>

                      <div className="flex space-x-2.5 pt-2">
                        <button
                          type="submit"
                          className="flex-1 h-10 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs transition-colors shadow-lg shadow-blue-600/15"
                        >
                          {editingTask ? 'Update Task' : 'Create Task'}
                        </button>
                        {editingTask && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingTask(null);
                              setTaskName('');
                              setTaskDesc('');
                              setTaskLink('');
                              setTaskRewardCoins(10);
                              setTaskRewardXP(50);
                              setTaskStartDate('');
                              setTaskEndDate('');
                              setTaskActive(true);
                            }}
                            className="h-10 px-4 bg-white/5 hover:bg-white/10 text-slate-300 font-bold rounded-xl text-xs transition-colors border border-white/10"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </form>
                  </div>

                  {/* Tasks List Table */}
                  <div className="lg:col-span-2 space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="text-sm font-black text-white uppercase tracking-wider">
                        Existing Tasks ({tasks.length})
                      </h3>
                    </div>

                    <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                      {tasks.map(t => (
                        <div key={t.id} className="bg-white/5 border border-white/10 rounded-2xl p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:border-white/20 transition-all">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded-md bg-blue-500/15 border border-blue-500/25 text-[10px] font-bold text-blue-400 font-mono">
                                {t.platform}
                              </span>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase font-mono ${
                                t.active ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-400' : 'bg-slate-500/15 border border-slate-500/20 text-slate-400'
                              }`}>
                                {t.active ? 'Active' : 'Disabled'}
                              </span>
                            </div>
                            <h4 className="text-sm font-bold text-white tracking-tight">{t.name}</h4>
                            {t.description && <p className="text-[11px] text-slate-400 leading-normal max-w-md">{t.description}</p>}
                            <div className="flex items-center space-x-3 text-[10px] text-slate-500 font-mono">
                              <span className="text-yellow-400 font-bold">{t.rewardCoins} Coins</span>
                              <span>•</span>
                              <span className="text-purple-400 font-bold">{t.rewardXP} XP</span>
                              <span>•</span>
                              <span>Ends: {t.endDate || 'N/A'}</span>
                            </div>
                          </div>

                          <div className="flex items-center space-x-2 w-full md:w-auto justify-end border-t border-white/5 md:border-none pt-3 md:pt-0">
                            <a
                              href={t.link}
                              target="_blank"
                              rel="noreferrer"
                              className="p-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-slate-300 hover:text-white transition-colors"
                              title="Visit Link"
                            >
                              < LucideIcons.ExternalLink className="w-3.5 h-3.5" />
                            </a>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingTask(t);
                                setTaskName(t.name);
                                setTaskDesc(t.description || '');
                                setTaskPlatform(t.platform);
                                setTaskLink(t.link);
                                setTaskRewardCoins(t.rewardCoins);
                                setTaskRewardXP(t.rewardXP);
                                setTaskStartDate(t.startDate || '');
                                setTaskEndDate(t.endDate || '');
                                setTaskActive(t.active);
                              }}
                              className="p-2 bg-white/5 hover:bg-blue-600/25 border border-white/10 hover:border-blue-500/30 text-slate-300 hover:text-blue-400 rounded-xl transition-colors"
                              title="Edit Task"
                            >
                              <LucideIcons.Edit className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                if (confirm('Are you sure you want to disable/enable this task?')) {
                                  await updateDoc(doc(db, 'tasks', t.id), { active: !t.active });
                                }
                              }}
                              className={`p-2 border rounded-xl transition-colors ${
                                t.active ? 'bg-amber-500/10 border-amber-500/20 text-amber-400 hover:bg-amber-500/20' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20'
                              }`}
                              title={t.active ? 'Disable' : 'Enable'}
                            >
                              {t.active ? <LucideIcons.Lock className="w-3.5 h-3.5" /> : <LucideIcons.Unlock className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                if (confirm('Are you sure you want to PERMANENTLY delete this task from Firestore?')) {
                                  await deleteDoc(doc(db, 'tasks', t.id));
                                }
                              }}
                              className="p-2 bg-white/5 hover:bg-red-500/20 border border-white/10 hover:border-red-500/30 text-slate-400 hover:text-red-400 rounded-xl transition-colors"
                              title="Delete Task"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}

                      {tasks.length === 0 && (
                        <p className="text-xs text-slate-500 text-center py-12 bg-black/10 rounded-2xl border border-dashed border-white/10">No tasks created yet.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* SUB TAB 2: PROOF SUBMISSIONS */}
              {tasksSubTab === 'submissions' && (
                <div className="space-y-4">
                  <h3 className="text-sm font-black text-white uppercase tracking-wider">
                    Task Submissions Proof Review
                  </h3>

                  <div className="bg-[#0b0f19] border border-white/10 rounded-3xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs font-medium text-slate-300">
                        <thead className="bg-white/5 text-[10px] text-slate-400 font-bold uppercase tracking-wider border-b border-white/10">
                          <tr>
                            <th className="p-4">Trader User</th>
                            <th className="p-4">Task Link</th>
                            <th className="p-4">Platform</th>
                            <th className="p-4">Rewards</th>
                            <th className="p-4">Date Submitted</th>
                            <th className="p-4">Status</th>
                            <th className="p-4 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {taskSubmissions.map(s => (
                            <tr key={s.id} className="hover:bg-white/5 transition-colors">
                              <td className="p-4">
                                <div className="font-bold text-white">{s.userName || 'Unnamed Trader'}</div>
                                <div className="text-[10px] text-slate-500 font-mono select-all">{s.userEmail}</div>
                              </td>
                              <td className="p-4 font-bold text-slate-300">
                                {s.taskName}
                              </td>
                              <td className="p-4">
                                <span className="px-2 py-0.5 rounded-md bg-blue-500/10 border border-blue-500/20 text-[10px] font-bold text-blue-400 font-mono">
                                  {s.taskPlatform}
                                </span>
                              </td>
                              <td className="p-4 font-mono text-xs">
                                <div className="text-yellow-400 font-bold">+{s.rewardCoins} Coins</div>
                                <div className="text-purple-400">+{s.rewardXP} XP</div>
                              </td>
                              <td className="p-4 text-slate-400 font-mono text-[11px]">
                                {new Date(s.createdAt).toLocaleString()}
                              </td>
                              <td className="p-4">
                                <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase font-mono border ${
                                  s.status === 'Approved' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                                  s.status === 'Rejected' ? 'bg-red-500/10 border-red-500/20 text-red-400' :
                                  'bg-yellow-500/15 border-yellow-500/20 text-yellow-500 animate-pulse'
                                }`}>
                                  {s.status}
                                </span>
                              </td>
                              <td className="p-4 text-right">
                                {s.status === 'Pending Review' ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setReviewingSubmission(s);
                                      setRejectionReasonText('');
                                      setSubmissionMsg('');
                                    }}
                                    className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg text-[10px] transition-colors shadow-md shadow-blue-600/10"
                                  >
                                    Verify Proof
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setReviewingSubmission(s);
                                      setRejectionReasonText(s.rejectionReason || '');
                                      setSubmissionMsg('This submission is already closed.');
                                    }}
                                    className="px-3.5 py-1.5 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white font-bold rounded-lg text-[10px] border border-white/5 transition-colors"
                                  >
                                    Inspect Log
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}

                          {taskSubmissions.length === 0 && (
                            <tr>
                              <td colSpan={7} className="p-10 text-center text-slate-500">
                                No task submissions proofs have been logged in the system.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* SUB TAB 3: REWARDS STORE BUILDER */}
              {tasksSubTab === 'rewards' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Reward Creation Form */}
                  <div className="bg-white/5 border border-white/10 rounded-3xl p-6 space-y-4 h-fit">
                    <h3 className="text-sm font-black text-white uppercase tracking-wider">
                      {editingRewardItem ? 'Edit Store Item' : 'Add Store Reward'}
                    </h3>

                    {rewardMsg && (
                      <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-blue-300 text-xs">
                        {rewardMsg}
                      </div>
                    )}

                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        setRewardMsg('');
                        if (!rewardName.trim()) {
                          setRewardMsg('Name is required.');
                          return;
                        }
                        try {
                          const itemId = editingRewardItem ? editingRewardItem.id : 'REWARD-' + Math.floor(100000 + Math.random() * 900000);
                          const rewardData = {
                            id: itemId,
                            name: rewardName.trim(),
                            coinCost: Number(rewardCoinCost) || 0,
                            quantity: Number(rewardQuantity) || 0,
                            active: rewardActive,
                            type: rewardType,
                            createdAt: editingRewardItem ? editingRewardItem.createdAt : new Date().toISOString()
                          };
                          await setDoc(doc(db, 'reward_store', itemId), rewardData);
                          setRewardMsg(`Reward item successfully ${editingRewardItem ? 'updated' : 'created'}!`);
                          
                          // Reset form
                          setEditingRewardItem(null);
                          setRewardName('');
                          setRewardCoinCost(100);
                          setRewardQuantity(10);
                          setRewardType('trial_account');
                          setRewardActive(true);
                          setTimeout(() => setRewardMsg(''), 5000);
                        } catch (err: any) {
                          setRewardMsg('Error saving reward: ' + err.message);
                        }
                      }}
                      className="space-y-3.5"
                    >
                      <div>
                        <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Reward Name *</label>
                        <input
                          type="text"
                          value={rewardName}
                          onChange={e => setRewardName(e.target.value)}
                          placeholder="e.g. 10K One-Step Challenge Account"
                          className="w-full h-10 px-3 bg-black/40 border border-white/10 rounded-xl text-white text-xs font-medium focus:border-blue-500 focus:outline-none"
                          required
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Coin Cost</label>
                          <input
                            type="number"
                            value={rewardCoinCost}
                            onChange={e => setRewardCoinCost(Number(e.target.value))}
                            className="w-full h-10 px-3 bg-black/40 border border-white/10 rounded-xl text-white text-xs font-mono font-bold focus:border-blue-500 focus:outline-none"
                            required
                            min={1}
                          />
                        </div>

                        <div>
                          <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Stock Quantity</label>
                          <input
                            type="number"
                            value={rewardQuantity}
                            onChange={e => setRewardQuantity(Number(e.target.value))}
                            className="w-full h-10 px-3 bg-black/40 border border-white/10 rounded-xl text-white text-xs font-mono font-bold focus:border-blue-500 focus:outline-none"
                            required
                            min={0}
                          />
                        </div>
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Reward Type (Automation Target)</label>
                        <select
                          value={rewardType}
                          onChange={e => setRewardType(e.target.value)}
                          className="w-full h-10 px-2 bg-black/40 border border-white/10 rounded-xl text-white text-xs font-medium focus:border-blue-500 focus:outline-none"
                        >
                          <option value="trial_account">AT Trial Account (1K Challenge)</option>
                          <option value="five_k_one_step">5K One Step Challenge Account</option>
                          <option value="ten_k_one_step">10K One Step Challenge Account</option>
                          <option value="twenty_five_k_one_step">25K One Step Challenge Account</option>
                          <option value="discount_coupon">10% / 20% Discount Coupon</option>
                          <option value="giveaway">Giveaway Entry</option>
                          <option value="custom_reward">Custom Reward (Manual Fulfilment)</option>
                        </select>
                        <p className="text-[10px] text-slate-500 mt-1 leading-normal">
                          For challenge account options, the system will automatically provision MT5 credentials and push the account to user's dashboard once approved!
                        </p>
                      </div>

                      <div className="flex items-center space-x-2 py-1">
                        <input
                          type="checkbox"
                          id="rewardActive"
                          checked={rewardActive}
                          onChange={e => setRewardActive(e.target.checked)}
                          className="rounded border-white/10 bg-black/40 text-blue-600 focus:ring-0 focus:ring-offset-0"
                        />
                        <label htmlFor="rewardActive" className="text-xs text-slate-300 font-bold cursor-pointer">
                          Publish in Reward Store immediately
                        </label>
                      </div>

                      <div className="flex space-x-2.5 pt-2">
                        <button
                          type="submit"
                          className="flex-1 h-10 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs transition-colors shadow-lg shadow-blue-600/15"
                        >
                          {editingRewardItem ? 'Update Reward' : 'Add Reward'}
                        </button>
                        {editingRewardItem && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingRewardItem(null);
                              setRewardName('');
                              setRewardCoinCost(100);
                              setRewardQuantity(10);
                              setRewardType('trial_account');
                              setRewardActive(true);
                            }}
                            className="h-10 px-4 bg-white/5 hover:bg-white/10 text-slate-300 font-bold rounded-xl text-xs transition-colors border border-white/10"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </form>
                  </div>

                  {/* Rewards Stock View */}
                  <div className="lg:col-span-2 space-y-4">
                    <h3 className="text-sm font-black text-white uppercase tracking-wider">
                      Store Listings ({rewardStoreItems.length})
                    </h3>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[600px] overflow-y-auto pr-1">
                      {rewardStoreItems.map(item => (
                        <div key={item.id} className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3 hover:border-white/20 transition-all flex flex-col justify-between">
                          <div>
                            <div className="flex justify-between items-start gap-2">
                              <span className="text-[10px] text-blue-400 font-bold uppercase font-mono tracking-wide">
                                {item.type.replace(/_/g, ' ')}
                              </span>
                              <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase font-mono ${
                                item.active ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-400' : 'bg-slate-500/15 border border-slate-500/20 text-slate-400'
                              }`}>
                                {item.active ? 'Active' : 'Draft'}
                              </span>
                            </div>
                            <h4 className="text-sm font-bold text-white tracking-tight mt-1">{item.name}</h4>
                            <div className="flex justify-between items-center text-xs mt-3 bg-black/45 border border-white/5 rounded-xl p-2 font-mono">
                              <span className="text-slate-400">Cost:</span>
                              <span className="text-yellow-400 font-bold">{item.coinCost} Coins</span>
                            </div>
                            <div className="flex justify-between items-center text-[11px] mt-1 p-2 font-mono text-slate-500">
                              <span>In Stock:</span>
                              <span className={`font-bold ${item.quantity <= 3 ? 'text-red-400 animate-pulse' : 'text-slate-300'}`}>
                                {item.quantity} Units
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center space-x-2 pt-3 border-t border-white/5">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingRewardItem(item);
                                setRewardName(item.name);
                                setRewardCoinCost(item.coinCost);
                                setRewardQuantity(item.quantity);
                                setRewardType(item.type);
                                setRewardActive(item.active);
                              }}
                              className="flex-1 h-8 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-blue-500/20 text-[10px] text-slate-300 hover:text-blue-400 font-bold rounded-lg transition-colors flex items-center justify-center space-x-1"
                            >
                              <LucideIcons.Edit className="w-3 h-3" />
                              <span>Edit</span>
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                if (confirm(`Toggle activation status of "${item.name}"?`)) {
                                  await updateDoc(doc(db, 'reward_store', item.id), { active: !item.active });
                                }
                              }}
                              className={`h-8 px-2 border rounded-lg transition-colors ${
                                item.active ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
                              }`}
                            >
                              {item.active ? <LucideIcons.EyeOff className="w-3.5 h-3.5" /> : <LucideIcons.Eye className="w-3.5 h-3.5" />}
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                if (confirm('Are you sure you want to PERMANENTLY delete this reward from Firestore Store Catalog?')) {
                                  await deleteDoc(doc(db, 'reward_store', item.id));
                                }
                              }}
                              className="h-8 px-2 bg-white/5 hover:bg-red-500/20 border border-white/10 hover:border-red-500/30 text-slate-400 hover:text-red-400 rounded-lg transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}

                      {rewardStoreItems.length === 0 && (
                        <p className="text-xs text-slate-500 text-center py-12 bg-black/10 rounded-2xl border border-dashed border-white/10 col-span-2">No store rewards designed yet.</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* SUB TAB 4: REDEMPTIONS HUB */}
              {tasksSubTab === 'redemptions' && (
                <div className="space-y-4">
                  <h3 className="text-sm font-black text-white uppercase tracking-wider">
                    Redemption Claim Approvals
                  </h3>

                  <div className="bg-[#0b0f19] border border-white/10 rounded-3xl overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs font-medium text-slate-300">
                        <thead className="bg-white/5 text-[10px] text-slate-400 font-bold uppercase tracking-wider border-b border-white/10">
                          <tr>
                            <th className="p-4">Trader User</th>
                            <th className="p-4">Claimed Reward</th>
                            <th className="p-4">Reward Class</th>
                            <th className="p-4">Cost Paid</th>
                            <th className="p-4">Date Claimed</th>
                            <th className="p-4">Status</th>
                            <th className="p-4 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {rewardRedemptions.map(r => (
                            <tr key={r.id} className="hover:bg-white/5 transition-colors">
                              <td className="p-4">
                                <div className="font-bold text-white">{r.userName || 'Unnamed Trader'}</div>
                                <div className="text-[10px] text-slate-500 font-mono select-all">{r.userEmail}</div>
                              </td>
                              <td className="p-4 font-bold text-white">
                                {r.itemName}
                              </td>
                              <td className="p-4">
                                <span className="px-2 py-0.5 rounded-md bg-blue-500/15 border border-blue-500/20 text-[10px] font-bold text-blue-400 font-mono capitalize">
                                  {r.itemType.replace(/_/g, ' ')}
                                </span>
                              </td>
                              <td className="p-4 font-mono font-bold text-yellow-400">
                                {r.coinCost} Coins
                              </td>
                              <td className="p-4 text-slate-400 font-mono text-[11px]">
                                {new Date(r.createdAt).toLocaleString()}
                              </td>
                              <td className="p-4">
                                <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase font-mono border ${
                                  r.status === 'Approved' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                                  r.status === 'Rejected' ? 'bg-red-500/10 border-red-500/20 text-red-400' :
                                  'bg-blue-500/15 border-blue-500/20 text-blue-400 animate-pulse'
                                }`}>
                                  {r.status}
                                </span>
                              </td>
                              <td className="p-4 text-right">
                                {r.status === 'Pending' ? (
                                  <div className="flex justify-end space-x-2">
                                    <button
                                      type="button"
                                      onClick={async () => {
                                        if (confirm(`Approve redemption of "${r.itemName}"? This will automatically provision the item!`)) {
                                          try {
                                            // 1. Mark Approved
                                            await updateDoc(doc(db, 'reward_redemptions', r.id), {
                                              status: 'Approved',
                                              processedAt: new Date().toISOString()
                                            });

                                            // 2. Automated Action for Account Challenge Rewards
                                            const type = r.itemType;
                                            if (type === 'trial_account' || type === 'five_k_one_step' || type === 'ten_k_one_step' || type === 'twenty_five_k_one_step') {
                                              let sizeVal = 1000;
                                              if (type === 'five_k_one_step') sizeVal = 5000;
                                              if (type === 'ten_k_one_step') sizeVal = 10000;
                                              if (type === 'twenty_five_k_one_step') sizeVal = 25000;

                                              const accountId = 'ACC-' + Math.floor(100000 + Math.random() * 900000);
                                              const randomLogin = String(Math.floor(4000000 + Math.random() * 999999));
                                              const randomPassword = 'REDEEMED-' + Math.random().toString(36).substring(2, 7).toUpperCase();

                                              const newAccount = {
                                                id: accountId,
                                                userId: r.userId,
                                                userEmail: r.userEmail,
                                                accountType: type === 'trial_account' ? 'trial' : 'one_step',
                                                size: sizeVal,
                                                balance: sizeVal,
                                                startingBalance: sizeVal,
                                                equity: sizeVal,
                                                dailyStartingBalance: sizeVal,
                                                dailyStartingEquity: sizeVal,
                                                phase: type === 'trial_account' ? 1 : 3, // funded is phase 3
                                                status: 'active',
                                                login: randomLogin,
                                                password: randomPassword,
                                                platform: 'ATTerminal',
                                                server: 'ATFunding-LiveServer',
                                                profitTarget: type === 'trial_account' ? 0 : sizeVal * 0.10,
                                                dailyDrawdownLimit: sizeVal * 0.05,
                                                maxDrawdownLimit: sizeVal * 0.10,
                                                createdAt: new Date().toISOString()
                                              };
                                              await setDoc(doc(db, 'accounts', accountId), newAccount);

                                              // Create Dashboard Notification for account
                                              const notifId = 'NOTIF-' + Math.floor(100000 + Math.random() * 900000);
                                              await setDoc(doc(db, 'notifications', notifId), {
                                                id: notifId,
                                                userId: r.userId,
                                                title: 'Reward Account Claimed!',
                                                message: `Your reward account ${r.itemName} has been automatically provisioned! MT5 Login: ${randomLogin}, Password: ${randomPassword}.`,
                                                type: 'success',
                                                read: false,
                                                createdAt: new Date().toISOString()
                                              });
                                            } else if (type === 'discount_coupon') {
                                              // Create discount coupon automatically
                                              const randomCode = 'COUPON-' + Math.random().toString(36).substring(2, 8).toUpperCase();
                                              await setDoc(doc(db, 'coupons', randomCode), {
                                                code: randomCode,
                                                discountPercent: 20,
                                                active: true,
                                                createdBy: 'Automated Coin Redemption'
                                              });

                                              // Create Dashboard Notification
                                              const notifId = 'NOTIF-' + Math.floor(100000 + Math.random() * 900000);
                                              await setDoc(doc(db, 'notifications', notifId), {
                                                id: notifId,
                                                userId: r.userId,
                                                title: 'Discount Code Provisioned!',
                                                message: `Your 20% discount coupon code has been generated! Use code: ${randomCode} at checkout.`,
                                                type: 'success',
                                                read: false,
                                                createdAt: new Date().toISOString()
                                              });
                                            } else {
                                              // For custom, send a notice to look into it
                                              const notifId = 'NOTIF-' + Math.floor(100000 + Math.random() * 900000);
                                              await setDoc(doc(db, 'notifications', notifId), {
                                                id: notifId,
                                                userId: r.userId,
                                                title: 'Redemption Approved!',
                                                message: `Your claim for "${r.itemName}" has been approved! The administration team will deliver your reward details.`,
                                                type: 'success',
                                                read: false,
                                                createdAt: new Date().toISOString()
                                              });
                                            }

                                            alert('Redemption request successfully approved!');
                                          } catch (err: any) {
                                            alert('Error approving redemption: ' + err.message);
                                          }
                                        }
                                      }}
                                      className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-lg text-[10px] transition-colors"
                                    >
                                      Approve
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setReviewingRedemption(r);
                                        setRedemptionRejectionText('');
                                        setRedemptionMsg('');
                                      }}
                                      className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white font-bold rounded-lg text-[10px] transition-colors"
                                    >
                                      Reject
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setReviewingRedemption(r);
                                      setRedemptionRejectionText(r.rejectionReason || '');
                                      setRedemptionMsg('This redemption is already closed.');
                                    }}
                                    className="px-3.5 py-1.5 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white font-bold rounded-lg text-[10px] border border-white/5 transition-colors"
                                  >
                                    Inspect Log
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}

                          {rewardRedemptions.length === 0 && (
                            <tr>
                              <td colSpan={7} className="p-10 text-center text-slate-500">
                                No claims/redemptions registered in the system.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* SUB TAB 5: CUSTOM LINKS CONFIG */}
              {tasksSubTab === 'custom_links' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Form */}
                  <div className="bg-white/5 border border-white/10 rounded-3xl p-6 space-y-4 h-fit">
                    <h3 className="text-sm font-black text-white uppercase tracking-wider">
                      {editingCustomLink ? 'Edit Platform Link' : 'Register Custom Link'}
                    </h3>

                    {customLinkMsg && (
                      <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-blue-300 text-xs">
                        {customLinkMsg}
                      </div>
                    )}

                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        setCustomLinkMsg('');
                        if (!customLinkName.trim() || !customLinkUrl.trim()) {
                          setCustomLinkMsg('Name and URL are required.');
                          return;
                        }
                        try {
                          const linkId = editingCustomLink ? editingCustomLink.id : 'LINK-' + Math.floor(100000 + Math.random() * 900000);
                          const linkData = {
                            id: linkId,
                            name: customLinkName.trim(),
                            url: customLinkUrl.trim(),
                            platform: customLinkPlatform,
                            active: customLinkActive,
                            createdAt: editingCustomLink ? editingCustomLink.createdAt : new Date().toISOString()
                          };
                          await setDoc(doc(db, 'custom_links', linkId), linkData);
                          setCustomLinkMsg(`Platform link ${editingCustomLink ? 'updated' : 'registered'}!`);
                          
                          // Reset
                          setEditingCustomLink(null);
                          setCustomLinkName('');
                          setCustomLinkUrl('');
                          setCustomLinkPlatform('YouTube');
                          setCustomLinkActive(true);
                          setTimeout(() => setCustomLinkMsg(''), 5000);
                        } catch (err: any) {
                          setCustomLinkMsg('Error: ' + err.message);
                        }
                      }}
                      className="space-y-3.5"
                    >
                      <div>
                        <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Display Title *</label>
                        <input
                          type="text"
                          value={customLinkName}
                          onChange={e => setCustomLinkName(e.target.value)}
                          placeholder="e.g. Subscribe to Official YT"
                          className="w-full h-10 px-3 bg-black/40 border border-white/10 rounded-xl text-white text-xs font-medium focus:border-blue-500 focus:outline-none"
                          required
                        />
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Destination URL *</label>
                        <input
                          type="url"
                          value={customLinkUrl}
                          onChange={e => setCustomLinkUrl(e.target.value)}
                          placeholder="https://youtube.com/..."
                          className="w-full h-10 px-3 bg-black/40 border border-white/10 rounded-xl text-white text-xs font-medium focus:border-blue-500 focus:outline-none"
                          required
                        />
                      </div>

                      <div>
                        <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Platform Category</label>
                        <select
                          value={customLinkPlatform}
                          onChange={e => setCustomLinkPlatform(e.target.value)}
                          className="w-full h-10 px-2 bg-black/40 border border-white/10 rounded-xl text-white text-xs font-medium focus:border-blue-500 focus:outline-none"
                        >
                          <option value="YouTube">YouTube</option>
                          <option value="Telegram">Telegram</option>
                          <option value="Instagram">Instagram</option>
                          <option value="Discord">Discord</option>
                          <option value="Facebook">Facebook</option>
                          <option value="X">X (Twitter)</option>
                          <option value="TikTok">TikTok</option>
                          <option value="Website">Website</option>
                          <option value="Custom">Custom Link</option>
                        </select>
                      </div>

                      <div className="flex items-center space-x-2 py-1">
                        <input
                          type="checkbox"
                          id="linkActive"
                          checked={customLinkActive}
                          onChange={e => setCustomLinkActive(e.target.checked)}
                          className="rounded border-white/10 bg-black/40 text-blue-600 focus:ring-0 focus:ring-offset-0"
                        />
                        <label htmlFor="linkActive" className="text-xs text-slate-300 font-bold cursor-pointer">
                          Link Active & Visible
                        </label>
                      </div>

                      <div className="flex space-x-2.5 pt-2">
                        <button
                          type="submit"
                          className="flex-1 h-10 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs transition-colors"
                        >
                          {editingCustomLink ? 'Update Link' : 'Save Link'}
                        </button>
                        {editingCustomLink && (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingCustomLink(null);
                              setCustomLinkName('');
                              setCustomLinkUrl('');
                              setCustomLinkPlatform('YouTube');
                              setCustomLinkActive(true);
                            }}
                            className="h-10 px-4 bg-white/5 hover:bg-white/10 text-slate-300 font-bold rounded-xl text-xs border border-white/10"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </form>
                  </div>

                  {/* Registered Links Table */}
                  <div className="lg:col-span-2 space-y-4">
                    <h3 className="text-sm font-black text-white uppercase tracking-wider">
                      Registered System Links ({customLinks.length})
                    </h3>

                    <div className="bg-[#0b0f19] border border-white/10 rounded-3xl overflow-hidden">
                      <table className="w-full text-left text-xs text-slate-300">
                        <thead className="bg-white/5 font-bold text-slate-400 uppercase tracking-wider text-[10px]">
                          <tr>
                            <th className="p-4">Platform</th>
                            <th className="p-4">Display Label</th>
                            <th className="p-4">Destination Link</th>
                            <th className="p-4">Status</th>
                            <th className="p-4 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                          {customLinks.map(link => (
                            <tr key={link.id} className="hover:bg-white/5">
                              <td className="p-4 font-mono font-bold text-blue-400">{link.platform}</td>
                              <td className="p-4 font-bold text-white">{link.name}</td>
                              <td className="p-4 font-mono text-[11px] max-w-[200px] truncate text-slate-400 select-all" title={link.url}>
                                {link.url}
                              </td>
                              <td className="p-4">
                                <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold uppercase font-mono ${
                                  link.active ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-400' : 'bg-slate-500/15 border border-slate-500/20 text-slate-400'
                                }`}>
                                  {link.active ? 'Active' : 'Disabled'}
                                </span>
                              </td>
                              <td className="p-4 text-right space-x-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingCustomLink(link);
                                    setCustomLinkName(link.name);
                                    setCustomLinkUrl(link.url);
                                    setCustomLinkPlatform(link.platform);
                                    setCustomLinkActive(link.active);
                                  }}
                                  className="text-slate-400 hover:text-white"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    if (confirm('Delete this platform link?')) {
                                      await deleteDoc(doc(db, 'custom_links', link.id));
                                    }
                                  }}
                                  className="text-red-400 hover:text-red-300 font-bold"
                                >
                                  ✕
                                </button>
                              </td>
                            </tr>
                          ))}

                          {customLinks.length === 0 && (
                            <tr>
                              <td colSpan={5} className="p-8 text-center text-slate-500">
                                No platforms links registered.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* SUB TAB 6: TRADER LEDGERS */}
              {tasksSubTab === 'ledgers' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Selector card */}
                  <div className="bg-white/5 border border-white/10 rounded-3xl p-6 space-y-4">
                    <h3 className="text-sm font-black text-white uppercase tracking-wider">
                      Select Player Ledger
                    </h3>

                    <div>
                      <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Select Trader User</label>
                      <select
                        value={selectedUserForCoinsXP}
                        onChange={e => {
                          setSelectedUserForCoinsXP(e.target.value);
                          setManualActionMsg('');
                        }}
                        className="w-full h-10 px-2 bg-black/40 border border-white/10 rounded-xl text-white text-xs font-medium focus:border-blue-500 focus:outline-none"
                      >
                        <option value="" className="bg-[#0b0f19]">-- Choose Trader --</option>
                        {users.filter(u => u.role !== 'admin').map(u => (
                          <option key={u.uid} value={u.uid} className="bg-[#0b0f19]">
                            {u.displayName || u.name || 'Unnamed'} ({u.email})
                          </option>
                        ))}
                      </select>
                    </div>

                    {selectedUserForCoinsXP && (() => {
                      const selUser = users.find(u => u.uid === selectedUserForCoinsXP);
                      if (!selUser) return null;
                      return (
                        <div className="bg-black/35 border border-white/5 rounded-2xl p-4 space-y-3 font-mono text-xs text-slate-300">
                          <p className="font-sans font-bold text-white text-sm">{selUser.displayName || selUser.name || 'Unnamed'}</p>
                          <div className="flex justify-between border-b border-white/5 pb-2">
                            <span>UID:</span>
                            <span className="text-[10px] text-slate-400 select-all">{selUser.uid}</span>
                          </div>
                          <div className="flex justify-between border-b border-white/5 pb-2">
                            <span>Current Balance:</span>
                            <span className="text-yellow-400 font-bold">{(selUser.coins || 0).toLocaleString()} Coins</span>
                          </div>
                          <div className="flex justify-between">
                            <span>Current Level XP:</span>
                            <span className="text-purple-400 font-bold">{(selUser.xp || 0).toLocaleString()} XP</span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Adjustment Terminal */}
                  <div className="lg:col-span-2 bg-white/5 border border-white/10 rounded-3xl p-6 space-y-6">
                    <h3 className="text-sm font-black text-white uppercase tracking-wider">
                      Manual Ledger Adjustment Terminal
                    </h3>

                    {!selectedUserForCoinsXP ? (
                      <div className="text-center py-20 text-slate-500 text-xs">
                        Please choose a trader user from the sidebar ledger panel.
                      </div>
                    ) : (
                      <div className="space-y-6">
                        {manualActionMsg && (
                          <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-blue-300 text-xs">
                            {manualActionMsg}
                          </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          {/* COIN ADJUSTER */}
                          <div className="bg-black/25 border border-white/5 rounded-2xl p-5 space-y-4">
                            <h4 className="text-xs font-black text-yellow-400 uppercase tracking-wider flex items-center gap-1.5">
                              <LucideIcons.Coins className="w-4 h-4" />
                              <span>Coin Adjuster</span>
                            </h4>

                            <div className="space-y-3">
                              <div>
                                <label className="text-[9px] text-slate-400 font-bold uppercase block mb-1">Amount (Use negative to remove)</label>
                                <input
                                  type="number"
                                  value={manualAmount}
                                  onChange={e => setManualAmount(Number(e.target.value))}
                                  className="w-full h-10 px-3 bg-black/40 border border-white/10 rounded-xl text-white text-xs font-mono font-bold focus:border-blue-500 focus:outline-none"
                                />
                              </div>

                              <div>
                                <label className="text-[9px] text-slate-400 font-bold uppercase block mb-1">Transaction Description / Reason</label>
                                <input
                                  type="text"
                                  value={manualDescription}
                                  onChange={e => setManualDescription(e.target.value)}
                                  placeholder="e.g. Administrative Adjustment / Bonus Coins"
                                  className="w-full h-10 px-3 bg-black/40 border border-white/10 rounded-xl text-white text-xs focus:border-blue-500 focus:outline-none"
                                />
                              </div>

                              <div className="flex space-x-2 pt-2">
                                <button
                                  type="button"
                                  onClick={async () => {
                                    setManualActionMsg('');
                                    const trader = users.find(u => u.uid === selectedUserForCoinsXP);
                                    if (!trader) return;
                                    try {
                                      const currentCoins = trader.coins || 0;
                                      const updatedCoins = currentCoins + manualAmount;
                                      await updateDoc(doc(db, 'users', trader.uid), { coins: updatedCoins });

                                      // Ledger log
                                      const coinLogId = 'COIN-LOG-' + Math.floor(100000 + Math.random() * 900000);
                                      await setDoc(doc(db, 'coins', coinLogId), {
                                        id: coinLogId,
                                        userId: trader.uid,
                                        userEmail: trader.email,
                                        amount: manualAmount,
                                        type: manualAmount >= 0 ? 'manual_add' : 'manual_remove',
                                        description: manualDescription || 'Administrative Adjustment',
                                        createdAt: new Date().toISOString()
                                      });

                                      // Notification
                                      const notifId = 'NOTIF-' + Math.floor(100000 + Math.random() * 900000);
                                      await setDoc(doc(db, 'notifications', notifId), {
                                        id: notifId,
                                        userId: trader.uid,
                                        title: 'Ledger Coins Updated',
                                        message: `Your wallet coin balance was adjusted by administration by ${manualAmount >= 0 ? '+' : ''}${manualAmount} Coins. Reason: ${manualDescription || 'Administrative Adjustment'}.`,
                                        type: manualAmount >= 0 ? 'success' : 'alert',
                                        read: false,
                                        createdAt: new Date().toISOString()
                                      });

                                      setManualActionMsg(`Successfully adjusted Coins for ${trader.email}!`);
                                    } catch (err: any) {
                                      setManualActionMsg('Error adjusting coins: ' + err.message);
                                    }
                                  }}
                                  className="w-full h-10 bg-yellow-600 hover:bg-yellow-500 text-white font-bold rounded-xl text-xs transition-colors"
                                >
                                  Submit Coins Adjustment
                                </button>
                              </div>
                            </div>
                          </div>

                          {/* XP ADJUSTER */}
                          <div className="bg-black/25 border border-white/5 rounded-2xl p-5 space-y-4">
                            <h4 className="text-xs font-black text-purple-400 uppercase tracking-wider flex items-center gap-1.5">
                              <LucideIcons.Award className="w-4 h-4" />
                              <span>XP Level Adjuster</span>
                            </h4>

                            <div className="space-y-3">
                              <div>
                                <label className="text-[9px] text-slate-400 font-bold uppercase block mb-1">Amount (Use negative to remove)</label>
                                <input
                                  type="number"
                                  value={manualAmount}
                                  onChange={e => setManualAmount(Number(e.target.value))}
                                  className="w-full h-10 px-3 bg-black/40 border border-white/10 rounded-xl text-white text-xs font-mono font-bold focus:border-blue-500 focus:outline-none"
                                />
                              </div>

                              <div>
                                <label className="text-[9px] text-slate-400 font-bold uppercase block mb-1">Transaction Description / Reason</label>
                                <input
                                  type="text"
                                  value={manualDescription}
                                  onChange={e => setManualDescription(e.target.value)}
                                  placeholder="e.g. Administrative Adjustment / Task compensation"
                                  className="w-full h-10 px-3 bg-black/40 border border-white/10 rounded-xl text-white text-xs focus:border-blue-500 focus:outline-none"
                                />
                              </div>

                              <div className="flex space-x-2 pt-2">
                                <button
                                  type="button"
                                  onClick={async () => {
                                    setManualActionMsg('');
                                    const trader = users.find(u => u.uid === selectedUserForCoinsXP);
                                    if (!trader) return;
                                    try {
                                      const currentXP = trader.xp || 0;
                                      const updatedXP = currentXP + manualAmount;
                                      await updateDoc(doc(db, 'users', trader.uid), { xp: updatedXP });

                                      // Ledger log
                                      const xpLogId = 'XP-LOG-' + Math.floor(100000 + Math.random() * 900000);
                                      await setDoc(doc(db, 'xp_history', xpLogId), {
                                        id: xpLogId,
                                        userId: trader.uid,
                                        userEmail: trader.email,
                                        amount: manualAmount,
                                        type: manualAmount >= 0 ? 'manual_add' : 'manual_remove',
                                        description: manualDescription || 'Administrative Adjustment',
                                        createdAt: new Date().toISOString()
                                      });

                                      // Notification
                                      const notifId = 'NOTIF-' + Math.floor(100000 + Math.random() * 900000);
                                      await setDoc(doc(db, 'notifications', notifId), {
                                        id: notifId,
                                        userId: trader.uid,
                                        title: 'XP Level Updated',
                                        message: `Your XP experience points was adjusted by administration by ${manualAmount >= 0 ? '+' : ''}${manualAmount} XP. Reason: ${manualDescription || 'Administrative Adjustment'}.`,
                                        type: 'info',
                                        read: false,
                                        createdAt: new Date().toISOString()
                                      });

                                      setManualActionMsg(`Successfully adjusted XP for ${trader.email}!`);
                                    } catch (err: any) {
                                      setManualActionMsg('Error adjusting XP: ' + err.message);
                                    }
                                  }}
                                  className="w-full h-10 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl text-xs transition-colors"
                                >
                                  Submit XP Adjustment
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === 'email_center' && (
            <div className="space-y-6 animate-fade-in text-left">
              <div>
                <h2 className="text-xl font-black text-white uppercase tracking-wider">
                  Email Automation & Campaign Center
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Manage real-time transactional templates, dispatch bulk announcement campaigns, and monitor outbound SMTP logs.
                </p>
              </div>
              <EmailCenter users={users} />
            </div>
          )}

          {/* 27. DATABASE BACKUPS & RESTORE TAB */}
          {activeTab === 'database_backups' && (
            <div className="space-y-6 animate-fade-in text-left">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <div className="flex items-center space-x-2">
                    <Database className="w-6 h-6 text-emerald-400" />
                    <h2 className="text-xl font-black text-white uppercase tracking-wider font-mono">
                      Firestore Snapshot & Backup Manager
                    </h2>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Automatic daily Firestore backup exports for Users, Accounts, Trades, Payouts, and Coupons. Guaranteed persistence to ensure no trader data is lost.
                  </p>
                </div>
                <button
                  onClick={handleManualBackup}
                  disabled={isCreatingBackup}
                  className="px-5 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-bold rounded-xl text-xs shadow-lg shadow-emerald-500/20 transition-all flex items-center space-x-2 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 ${isCreatingBackup ? 'animate-spin' : ''}`} />
                  <span>{isCreatingBackup ? 'Creating Backup...' : 'Create Immediate Snapshot Backup'}</span>
                </button>
              </div>

              {backupNoticeMsg && (
                <div className={`p-4 rounded-2xl border text-xs font-mono font-bold flex items-center justify-between ${
                  backupNoticeMsg.includes('Failed') || backupNoticeMsg.includes('Error')
                    ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                    : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                }`}>
                  <span>{backupNoticeMsg}</span>
                  <button onClick={() => setBackupNoticeMsg('')} className="text-slate-400 hover:text-white">✕</button>
                </div>
              )}

              {/* Status Overview Banner */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="bg-[#0b0f19] border border-white/5 rounded-2xl p-4 space-y-1">
                  <div className="text-[10px] text-slate-400 uppercase tracking-widest font-mono font-bold">Auto-Backup Engine</div>
                  <div className="text-sm font-black text-emerald-400 flex items-center space-x-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
                    <span>ACTIVE (Every 24 Hours)</span>
                  </div>
                </div>
                <div className="bg-[#0b0f19] border border-white/5 rounded-2xl p-4 space-y-1">
                  <div className="text-[10px] text-slate-400 uppercase tracking-widest font-mono font-bold">Total Backups Archived</div>
                  <div className="text-lg font-black text-white font-mono">{backupsList.length} Snapshots</div>
                </div>
                <div className="bg-[#0b0f19] border border-white/5 rounded-2xl p-4 space-y-1">
                  <div className="text-[10px] text-slate-400 uppercase tracking-widest font-mono font-bold">Latest Backup Date</div>
                  <div className="text-xs font-bold text-slate-300 font-mono">
                    {backupsList.length > 0 ? new Date(backupsList[0].timestamp).toLocaleString() : 'No backups yet'}
                  </div>
                </div>
                <div className="bg-[#0b0f19] border border-white/5 rounded-2xl p-4 space-y-1">
                  <div className="text-[10px] text-slate-400 uppercase tracking-widest font-mono font-bold">Protected Collections</div>
                  <div className="text-xs font-bold text-blue-400 font-mono">users, accounts, trades, payouts, coupons</div>
                </div>
              </div>

              {/* Backup History Records */}
              <div className="bg-[#0b0f19] border border-white/5 rounded-2xl p-5 space-y-4 shadow-xl">
                <h3 className="text-xs font-extrabold text-slate-300 uppercase tracking-wider font-mono">
                  Available Snapshot Backups
                </h3>

                {backupsList.length === 0 ? (
                  <div className="py-12 text-center text-xs text-slate-500 font-mono">
                    No backup snapshots found. Click "Create Immediate Snapshot Backup" above to generate your first complete backup.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left min-w-[800px] font-mono text-xs">
                      <thead>
                        <tr className="text-slate-500 border-b border-white/10 pb-2 uppercase text-[10px] tracking-wider">
                          <th className="py-3 px-2">Snapshot ID</th>
                          <th className="py-3 px-2">Timestamp</th>
                          <th className="py-3 px-2">Source</th>
                          <th className="py-3 px-2">Total Records</th>
                          <th className="py-3 px-2">Collection Breakdown</th>
                          <th className="py-3 px-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 text-slate-300">
                        {backupsList.map((bk) => (
                          <tr key={bk.id} className="hover:bg-white/[0.02] transition-colors">
                            <td className="py-3 px-2 font-bold text-white">{bk.id}</td>
                            <td className="py-3 px-2 text-slate-400">{new Date(bk.timestamp).toLocaleString()}</td>
                            <td className="py-3 px-2">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                bk.type === 'AUTO_DAILY' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                              }`}>
                                {bk.type || 'MANUAL'}
                              </span>
                            </td>
                            <td className="py-3 px-2 font-bold text-emerald-400">{bk.counts?.total || 0}</td>
                            <td className="py-3 px-2 text-[11px] text-slate-400">
                              U: {bk.counts?.users || 0} | A: {bk.counts?.accounts || 0} | T: {bk.counts?.trades || 0} | P: {bk.counts?.payouts || 0} | C: {bk.counts?.coupons || 0}
                            </td>
                            <td className="py-3 px-2 text-right">
                              <button
                                onClick={() => setSelectedBackupToRestore(bk)}
                                disabled={isRestoringBackup}
                                className="px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500 text-amber-300 hover:text-white border border-amber-500/30 rounded-lg text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
                              >
                                Restore
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* RESTORE CONFIRMATION MODAL */}
          {selectedBackupToRestore && (
            <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-[#0b0f19] border border-amber-500/30 rounded-3xl w-full max-w-lg p-6 space-y-4 animate-fade-in relative text-left shadow-2xl">
                <div className="flex items-center space-x-2 text-amber-400">
                  <AlertTriangle className="w-6 h-6" />
                  <h3 className="text-base font-black uppercase tracking-wider">
                    Confirm Database Restoration
                  </h3>
                </div>

                <p className="text-xs text-slate-300 leading-relaxed">
                  You are about to restore Firestore database state from backup snapshot <strong className="text-white">{selectedBackupToRestore.id}</strong> (created on {new Date(selectedBackupToRestore.timestamp).toLocaleString()}).
                </p>

                <div className="bg-black/40 border border-white/5 rounded-xl p-3 font-mono text-xs text-slate-300 space-y-1">
                  <div>• Total Records to Restore: <strong className="text-emerald-400">{selectedBackupToRestore.counts?.total || 0}</strong></div>
                  <div>• Users: {selectedBackupToRestore.counts?.users || 0}</div>
                  <div>• Accounts: {selectedBackupToRestore.counts?.accounts || 0}</div>
                  <div>• Trades: {selectedBackupToRestore.counts?.trades || 0}</div>
                  <div>• Payouts: {selectedBackupToRestore.counts?.payouts || 0}</div>
                  <div>• Coupons: {selectedBackupToRestore.counts?.coupons || 0}</div>
                </div>

                <p className="text-[11px] text-amber-300/80 italic">
                  Note: This operation will write all archived documents back to Firestore and invalidate all local memory caches to guarantee exact account balances and trade persistence.
                </p>

                <div className="flex justify-end space-x-3 pt-2">
                  <button
                    onClick={() => setSelectedBackupToRestore(null)}
                    disabled={isRestoringBackup}
                    className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl text-xs transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleRestoreBackup(selectedBackupToRestore)}
                    disabled={isRestoringBackup}
                    className="px-5 py-2 bg-amber-500 hover:bg-amber-400 text-black font-extrabold rounded-xl text-xs shadow-lg shadow-amber-500/25 transition-all flex items-center space-x-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {isRestoringBackup ? <RefreshCw className="w-4 h-4 animate-spin" /> : null}
                    <span>{isRestoringBackup ? 'Restoring Snapshot...' : 'Confirm & Restore Backup'}</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 28. AUTO CLOSE DEBUG TAB */}
          {activeTab === 'auto_close_debug' && (
            <div className="space-y-6 animate-fade-in text-left">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <div className="flex items-center space-x-2">
                    <ShieldAlert className="w-6 h-6 text-rose-400" />
                    <h2 className="text-xl font-black text-white uppercase tracking-wider font-mono">
                      Auto-Close Debug Log & Monitoring Engine
                    </h2>
                  </div>
                  <p className="text-xs text-slate-400 mt-1">
                    Real-time audit log of every system force-closed trade with complete details including Account ID, Trade ID, Entry/Exit Prices, Close Reason, and Triggered Rules.
                  </p>
                </div>

                <div className="flex items-center space-x-3">
                  <button
                    onClick={() => {
                      const nextMode = !autoCloseDebugMode;
                      setAutoCloseDebugState(nextMode);
                      setAutoCloseDebugMode(nextMode);
                    }}
                    className={`px-4 py-2 rounded-xl text-xs font-bold font-mono transition-all flex items-center space-x-2 border cursor-pointer ${
                      autoCloseDebugMode 
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' 
                        : 'bg-slate-800 border-white/10 text-slate-400'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${autoCloseDebugMode ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'}`}></span>
                    <span>AUTO CLOSE DEBUG MODE: {autoCloseDebugMode ? 'ENABLED' : 'DISABLED'}</span>
                  </button>

                  <button
                    onClick={fetchAutoCloseDebugLogs}
                    disabled={isLoadingAutoCloseLogs}
                    className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-xl text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isLoadingAutoCloseLogs ? 'animate-spin' : ''}`} />
                    <span>Refresh Logs</span>
                  </button>
                </div>
              </div>

              {/* Search & Filter */}
              <div className="flex items-center space-x-3 bg-[#0b0f19] border border-white/5 rounded-2xl p-3">
                <Search className="w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Filter logs by Account ID, Trade ID, Symbol, or Reason..."
                  value={autoCloseFilterQuery}
                  onChange={(e) => setAutoCloseFilterQuery(e.target.value)}
                  className="bg-transparent text-xs text-white placeholder-slate-500 outline-none w-full font-mono"
                />
              </div>

              {/* Auto Close Debug Logs Table */}
              <div className="bg-[#0b0f19] border border-white/5 rounded-2xl p-5 space-y-4 shadow-xl">
                <div className="flex justify-between items-center">
                  <h3 className="text-xs font-extrabold text-slate-300 uppercase tracking-wider font-mono">
                    Recorded Auto-Close Debug Events ({autoCloseDebugLogs.length})
                  </h3>
                </div>

                {isLoadingAutoCloseLogs ? (
                  <div className="py-12 text-center text-xs text-slate-400 font-mono">
                    Loading auto-close debug records...
                  </div>
                ) : autoCloseDebugLogs.length === 0 ? (
                  <div className="py-12 text-center text-xs text-slate-500 font-mono">
                    No auto-close debug logs recorded yet. All force-closed positions will be automatically captured here.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left min-w-[900px] font-mono text-xs">
                      <thead>
                        <tr className="text-slate-500 border-b border-white/10 pb-2 uppercase text-[10px] tracking-wider">
                          <th className="py-3 px-2">Timestamp</th>
                          <th className="py-3 px-2">Account ID</th>
                          <th className="py-3 px-2">Trade ID</th>
                          <th className="py-3 px-2">Symbol</th>
                          <th className="py-3 px-2">Entry Price</th>
                          <th className="py-3 px-2">Exit Price</th>
                          <th className="py-3 px-2">Close Reason</th>
                          <th className="py-3 px-2">Triggered Rule</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 text-slate-300">
                        {autoCloseDebugLogs
                          .filter((log) => {
                            if (!autoCloseFilterQuery.trim()) return true;
                            const q = autoCloseFilterQuery.toLowerCase();
                            return (
                              log.accountId?.toLowerCase().includes(q) ||
                              log.accountNumber?.toLowerCase().includes(q) ||
                              log.tradeId?.toLowerCase().includes(q) ||
                              log.symbol?.toLowerCase().includes(q) ||
                              log.closeReason?.toLowerCase().includes(q) ||
                              log.triggeredRule?.toLowerCase().includes(q)
                            );
                          })
                          .map((log) => (
                            <tr key={log.id} className="hover:bg-white/[0.02] transition-colors">
                              <td className="py-3 px-2 text-slate-400 whitespace-nowrap">
                                {new Date(log.timestamp).toLocaleString()}
                              </td>
                              <td className="py-3 px-2 font-bold text-white">{log.accountNumber || log.accountId}</td>
                              <td className="py-3 px-2 text-blue-400 font-bold">#{log.tradeId}</td>
                              <td className="py-3 px-2 font-bold text-amber-300">{log.symbol}</td>
                              <td className="py-3 px-2">${log.entryPrice}</td>
                              <td className="py-3 px-2 font-bold text-white">${log.exitPrice}</td>
                              <td className="py-3 px-2">
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/10 text-rose-300 border border-rose-500/20">
                                  {log.closeReason}
                                </span>
                              </td>
                              <td className="py-3 px-2 text-slate-400 text-[11px]">{log.triggeredRule}</td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* SUBMISSIONS SCREENSHOT PROOF VERIFY MODAL */}
      {reviewingSubmission && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0b0f19] border border-white/15 rounded-3xl w-full max-w-2xl p-6 space-y-4 animate-fade-in relative text-left">
            <button
              type="button"
              onClick={() => setReviewingSubmission(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white font-sans text-sm bg-white/5 hover:bg-white/10 w-8 h-8 rounded-full flex items-center justify-center transition-colors"
            >
              ✕
            </button>
            
            <div>
              <span className="text-[10px] bg-blue-500/10 text-blue-400 font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-blue-500/25">
                Proof Screenshot Inspection
              </span>
              <h3 className="text-base font-black text-white uppercase tracking-wider mt-1.5">
                Task: {reviewingSubmission.taskName}
              </h3>
              <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                Submitted by {reviewingSubmission.userEmail} on {new Date(reviewingSubmission.createdAt).toLocaleString()}
              </p>
            </div>

            {submissionMsg && (
              <div className="p-3 bg-blue-500/15 border border-blue-500/20 rounded-xl text-blue-300 text-xs font-medium">
                {submissionMsg}
              </div>
            )}

            {/* Proof Image Wrapper */}
            <div className="border border-white/10 rounded-2xl bg-black/50 overflow-hidden max-h-[300px] flex items-center justify-center">
              {reviewingSubmission.screenshotUrl ? (
                <img
                  src={reviewingSubmission.screenshotUrl}
                  alt="Proof Screenshot Submitted by User"
                  referrerPolicy="no-referrer"
                  className="max-h-[300px] object-contain"
                />
              ) : (
                <div className="text-center py-20 text-slate-500 text-xs">
                  No screenshot proof link available.
                </div>
              )}
            </div>

            {reviewingSubmission.status === 'Pending Review' ? (
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Rejection Reason (Only if rejecting)</label>
                  <input
                    type="text"
                    value={rejectionReasonText}
                    onChange={e => setRejectionReasonText(e.target.value)}
                    placeholder="e.g. Incomplete subscriber verification screenshot."
                    className="w-full h-10 px-3 bg-black/40 border border-white/10 rounded-xl text-white text-xs focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        setSubmissionMsg('');
                        const traderRef = doc(db, 'users', reviewingSubmission.userId);
                        const traderSnap = await getDoc(traderRef);
                        const traderData = traderSnap.data() || {};
                        const currentCoins = traderData.coins || 0;
                        const currentXP = traderData.xp || 0;

                        // 1. Credit rewards
                        await updateDoc(traderRef, {
                          coins: currentCoins + reviewingSubmission.rewardCoins,
                          xp: currentXP + reviewingSubmission.rewardXP
                        });

                        // 2. Ledger Entries
                        const coinTxId = 'TX-COIN-' + Math.floor(100000 + Math.random() * 900000);
                        await setDoc(doc(db, 'coins', coinTxId), {
                          id: coinTxId,
                          userId: reviewingSubmission.userId,
                          userEmail: reviewingSubmission.userEmail,
                          amount: reviewingSubmission.rewardCoins,
                          type: 'task_completion',
                          description: `Completed Task: ${reviewingSubmission.taskName}`,
                          createdAt: new Date().toISOString()
                        });

                        const xpTxId = 'TX-XP-' + Math.floor(100000 + Math.random() * 900000);
                        await setDoc(doc(db, 'xp_history', xpTxId), {
                          id: xpTxId,
                          userId: reviewingSubmission.userId,
                          userEmail: reviewingSubmission.userEmail,
                          amount: reviewingSubmission.rewardXP,
                          type: 'task_completion',
                          description: `Completed Task: ${reviewingSubmission.taskName}`,
                          createdAt: new Date().toISOString()
                        });

                        // 3. Mark approved
                        await updateDoc(doc(db, 'task_submissions', reviewingSubmission.id), {
                          status: 'Approved',
                          processedAt: new Date().toISOString()
                        });

                        // 4. Notification
                        const notifId = 'NOTIF-' + Math.floor(100000 + Math.random() * 900000);
                        await setDoc(doc(db, 'notifications', notifId), {
                          id: notifId,
                          userId: reviewingSubmission.userId,
                          title: 'Social Task Approved!',
                          message: `Your submission for task "${reviewingSubmission.taskName}" was verified! Credited +${reviewingSubmission.rewardCoins} Coins and +${reviewingSubmission.rewardXP} XP to your balance!`,
                          type: 'success',
                          read: false,
                          createdAt: new Date().toISOString()
                        });

                        alert('Proof approved successfully!');
                        setReviewingSubmission(null);
                      } catch (err: any) {
                        setSubmissionMsg('Error approving submission: ' + err.message);
                      }
                    }}
                    className="h-10 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs transition-colors"
                  >
                    Approve & Issue Credits
                  </button>

                  <button
                    type="button"
                    onClick={async () => {
                      if (!rejectionReasonText.trim()) {
                        setSubmissionMsg('Please specify a rejection reason before rejecting.');
                        return;
                      }
                      try {
                        setSubmissionMsg('');
                        
                        // 1. Mark Rejected
                        await updateDoc(doc(db, 'task_submissions', reviewingSubmission.id), {
                          status: 'Rejected',
                          rejectionReason: rejectionReasonText.trim(),
                          processedAt: new Date().toISOString()
                        });

                        // 2. Notification
                        const notifId = 'NOTIF-' + Math.floor(100000 + Math.random() * 900000);
                        await setDoc(doc(db, 'notifications', notifId), {
                          id: notifId,
                          userId: reviewingSubmission.userId,
                          title: 'Social Task Disapproved',
                          message: `Your submission for task "${reviewingSubmission.taskName}" was rejected. Reason: ${rejectionReasonText}. You can re-submit the task.`,
                          type: 'alert',
                          read: false,
                          createdAt: new Date().toISOString()
                        });

                        alert('Proof rejected successfully.');
                        setReviewingSubmission(null);
                      } catch (err: any) {
                        setSubmissionMsg('Error: ' + err.message);
                      }
                    }}
                    className="h-10 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl text-xs transition-colors"
                  >
                    Reject (Allow Resubmit)
                  </button>
                </div>
              </div>
            ) : (
              <div className="pt-2 flex flex-col space-y-2 bg-black/25 border border-white/5 rounded-xl p-3 font-mono text-[11px] text-slate-400">
                <p><strong>Processed:</strong> {reviewingSubmission.processedAt ? new Date(reviewingSubmission.processedAt).toLocaleString() : 'N/A'}</p>
                {reviewingSubmission.status === 'Rejected' && (
                  <p className="text-red-400"><strong>Rejection Reason:</strong> {reviewingSubmission.rejectionReason}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* REDEMPTION REJECTION INPUT MODAL */}
      {reviewingRedemption && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0b0f19] border border-white/15 rounded-3xl w-full max-w-lg p-6 space-y-4 animate-fade-in relative text-left">
            <button
              type="button"
              onClick={() => setReviewingRedemption(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white font-sans text-sm bg-white/5 hover:bg-white/10 w-8 h-8 rounded-full flex items-center justify-center transition-colors"
            >
              ✕
            </button>

            <div>
              <span className="text-[10px] bg-red-500/10 text-red-400 font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-red-500/25">
                Reject Redemption Claim
              </span>
              <h3 className="text-base font-black text-white uppercase tracking-wider mt-1.5">
                Claim: {reviewingRedemption.itemName}
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Claimed by {reviewingRedemption.userEmail} for {reviewingRedemption.coinCost} Coins
              </p>
            </div>

            {redemptionMsg && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-300 text-xs">
                {redemptionMsg}
              </div>
            )}

            {reviewingRedemption.status === 'Pending' ? (
              <div className="space-y-4">
                <div>
                  <label className="text-[10px] text-slate-400 font-bold uppercase block mb-1">Reason for Rejection *</label>
                  <input
                    type="text"
                    value={redemptionRejectionText}
                    onChange={e => setRedemptionRejectionText(e.target.value)}
                    placeholder="e.g. Stock out / Account already claimed."
                    className="w-full h-10 px-3 bg-black/40 border border-white/10 rounded-xl text-white text-xs focus:border-blue-500 focus:outline-none"
                    required
                  />
                  <p className="text-[10px] text-slate-500 mt-1 leading-normal">
                    This rejection will automatically refund the cost of {reviewingRedemption.coinCost} Coins back to the trader's coin wallet balance!
                  </p>
                </div>

                <button
                  type="button"
                  onClick={async () => {
                    if (!redemptionRejectionText.trim()) {
                      setRedemptionMsg('Rejection reason is required.');
                      return;
                    }
                    try {
                      setRedemptionMsg('');
                      // 1. Get Trader Profile
                      const traderRef = doc(db, 'users', reviewingRedemption.userId);
                      const traderSnap = await getDoc(traderRef);
                      const traderData = traderSnap.data() || {};
                      const currentCoins = traderData.coins || 0;

                      // 2. Refund Coins
                      await updateDoc(traderRef, { coins: currentCoins + reviewingRedemption.coinCost });

                      // 3. Log Refund
                      const refundTxId = 'REFUND-' + Math.floor(100000 + Math.random() * 900000);
                      await setDoc(doc(db, 'coins', refundTxId), {
                        id: refundTxId,
                        userId: reviewingRedemption.userId,
                        userEmail: reviewingRedemption.userEmail,
                        amount: reviewingRedemption.coinCost,
                        type: 'reward_refund',
                        description: `Refund for rejected redemption claim: ${reviewingRedemption.itemName}`,
                        createdAt: new Date().toISOString()
                      });

                      // 4. Mark Rejected
                      await updateDoc(doc(db, 'reward_redemptions', reviewingRedemption.id), {
                        status: 'Rejected',
                        rejectionReason: redemptionRejectionText.trim(),
                        processedAt: new Date().toISOString()
                      });

                      // 5. Notification
                      const notifId = 'NOTIF-' + Math.floor(100000 + Math.random() * 900000);
                      await setDoc(doc(db, 'notifications', notifId), {
                        id: notifId,
                        userId: reviewingRedemption.userId,
                        title: 'Redemption Rejected & Refunded',
                        message: `Your claim for "${reviewingRedemption.itemName}" was rejected. Reason: ${redemptionRejectionText}. Stated coins amount (${reviewingRedemption.coinCost} Coins) was refunded back to your wallet.`,
                        type: 'alert',
                        read: false,
                        createdAt: new Date().toISOString()
                      });

                      alert('Redemption successfully rejected and coins refunded!');
                      setReviewingRedemption(null);
                    } catch (err: any) {
                      setRedemptionMsg('Error rejecting redemption: ' + err.message);
                    }
                  }}
                  className="w-full h-10 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl text-xs transition-colors"
                >
                  Confirm Rejection & Refund Coins
                </button>
              </div>
            ) : (
              <div className="pt-2 flex flex-col space-y-2 bg-black/25 border border-white/5 rounded-xl p-3 font-mono text-[11px] text-slate-400">
                <p><strong>Processed:</strong> {reviewingRedemption.processedAt ? new Date(reviewingRedemption.processedAt).toLocaleString() : 'N/A'}</p>
                {reviewingRedemption.status === 'Rejected' && (
                  <p className="text-red-400"><strong>Rejection Reason:</strong> {reviewingRedemption.rejectionReason}</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ORDER DETAILS MODAL FOR DEEP INSPECTION */}
      {selectedOrderForModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-[#0b0f19] border border-white/15 rounded-3xl w-full max-w-4xl max-h-[90vh] overflow-y-auto shadow-2xl p-6 md:p-8 space-y-6 animate-fade-in relative">
            
            {/* Header */}
            <div className="flex justify-between items-start border-b border-white/10 pb-4">
              <div>
                <span className="text-[10px] bg-blue-500/10 text-blue-400 font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border border-blue-500/25">
                  Deep Audit
                </span>
                <h3 className="text-xl font-black text-white mt-1.5 flex items-center gap-2">
                  <span>Order Reference #{selectedOrderForModal.orderId}</span>
                </h3>
                <p className="text-xs text-slate-400 font-mono mt-0.5">
                  Submitted: {new Date(selectedOrderForModal.createdAt).toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrderForModal(null)}
                className="w-10 h-10 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 text-white flex items-center justify-center transition-colors font-sans text-xs"
              >
                ✕
              </button>
            </div>

            {/* Grid for details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              
              {/* Section 1: Trader Info */}
              <div className="bg-white/5 border border-white/5 rounded-2xl p-5 space-y-3">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-white/5 pb-2">
                  Customer & Billing Identity
                </h4>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between"><span className="text-slate-400">Full Name:</span><span className="text-white font-semibold">{selectedOrderForModal.firstName} {selectedOrderForModal.lastName}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Email Address:</span><span className="text-blue-400 font-mono select-all">{selectedOrderForModal.email}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Phone:</span><span className="text-white">{selectedOrderForModal.phone || 'N/A'}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Country:</span><span className="text-white">{selectedOrderForModal.country}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">City & Postal:</span><span className="text-white">{selectedOrderForModal.city}, {selectedOrderForModal.postalCode}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Full Address:</span><span className="text-white text-right max-w-[200px] break-words">{selectedOrderForModal.address}</span></div>
                </div>
              </div>

              {/* Section 2: Challenge Spec & Billing Breakdown */}
              <div className="bg-white/5 border border-white/5 rounded-2xl p-5 space-y-3">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-white/5 pb-2">
                  Challenge Spec & Price breakdown
                </h4>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between"><span className="text-slate-400">Account Size:</span><span className="text-white font-black">{selectedOrderForModal.accountSize}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Program Type:</span><span className="text-white font-semibold uppercase">{selectedOrderForModal.accountType.replace('_', ' ')}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Trading Platform:</span><span className="text-blue-400 font-bold uppercase">ATTerminal</span></div>
                  <div className="border-t border-white/5 my-1" />
                  <div className="flex justify-between"><span className="text-slate-400">Base Challenge Price:</span><span className="text-slate-300">${selectedOrderForModal.price.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-slate-400">Coupon Used:</span><span className="text-slate-300 font-mono">{selectedOrderForModal.couponCode ? `"${selectedOrderForModal.couponCode}"` : 'None'}</span></div>
                  <div className="flex justify-between"><span className="text-rose-400">Discounts Deducted:</span><span className="text-rose-400">-${selectedOrderForModal.discount.toFixed(2)}</span></div>
                  <div className="flex justify-between border-t border-white/10 pt-2 text-sm"><span className="text-white font-bold">Grand Total Paid:</span><span className="text-emerald-400 font-black">${selectedOrderForModal.finalPrice.toFixed(2)}</span></div>
                </div>
              </div>

              {/* Section 3: Crypto Payment & Transaction details */}
              <div className="bg-white/5 border border-white/5 rounded-2xl p-5 space-y-3 md:col-span-2">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-white/5 pb-2">
                  Blockchain Transaction Verification
                </h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                  <div className="space-y-2">
                    <div className="flex justify-between"><span className="text-slate-400">Paid Cryptocurrency:</span><span className="text-white font-bold">{selectedOrderForModal.paymentMethod}</span></div>
                    <div className="flex flex-col gap-1">
                      <span className="text-slate-400">Receiving Wallet Address:</span>
                      <input 
                        type="text" 
                        readOnly 
                        value={selectedOrderForModal.walletAddress} 
                        className="w-full bg-black/40 border border-white/10 rounded-lg p-2 font-mono text-[11px] text-slate-300 select-all" 
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="flex flex-col gap-1">
                      <span className="text-slate-400">Submitted Transaction Hash (TxHash):</span>
                      <input 
                        type="text" 
                        readOnly 
                        value={selectedOrderForModal.transactionHash || 'Not Provided'} 
                        className="w-full bg-black/40 border border-white/10 rounded-lg p-2 font-mono text-[11px] text-white select-all placeholder-slate-600" 
                        placeholder="No TxHash submitted"
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <span className="text-slate-400">Submitted Transaction ID (TxID):</span>
                      <input 
                        type="text" 
                        readOnly 
                        value={selectedOrderForModal.transactionId || 'Not Provided'} 
                        className="w-full bg-black/40 border border-white/10 rounded-lg p-2 font-mono text-[11px] text-white select-all placeholder-slate-600" 
                        placeholder="No TxID submitted"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Section 4: KYC Uploads Audit */}
              {(() => {
                const { docs: kycDocs, status: kycStatus } = getAssociatedKycDetails(selectedOrderForModal);
                return (
                  <div className="bg-white/5 border border-white/5 rounded-2xl p-5 space-y-4 md:col-span-2">
                    <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-white/5 pb-2 flex justify-between items-center">
                      <span>KYC Documents Verification</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase ${
                        kycStatus === 'Approved' || kycStatus === 'approved' ? 'bg-emerald-500/10 text-emerald-400' :
                        kycStatus === 'Rejected' || kycStatus === 'rejected' ? 'bg-rose-500/10 text-rose-400' :
                        kycStatus === 'Pending' || kycStatus === 'pending' ? 'bg-yellow-500/10 text-yellow-400 animate-pulse' :
                        'bg-slate-500/10 text-slate-400'
                      }`}>
                        KYC Status: {kycStatus || 'N/A'}
                      </span>
                    </h4>
                    
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                      {/* Passport */}
                      <div className="bg-black/30 border border-white/5 rounded-xl p-3 flex flex-col justify-between h-52">
                        <div>
                          <p className="text-[10px] text-slate-500 uppercase font-semibold">Passport Document</p>
                          <p className="text-[11px] text-white mt-1 font-medium truncate">
                            {kycDocs?.passport ? "Passport Uploaded" : "Not Provided"}
                          </p>
                        </div>
                        {kycDocs?.passport ? (
                          <div className="space-y-1.5 mt-1.5 flex flex-col justify-end">
                            <button 
                              type="button"
                              onClick={() => setLightboxImage({ 
                                src: kycDocs.passport || "", 
                                title: `${selectedOrderForModal.firstName} ${selectedOrderForModal.lastName}'s Passport` 
                              })}
                              className="text-[10px] text-blue-400 hover:underline flex items-center gap-1"
                            >
                              <ImageIcon className="w-3 h-3" />
                              <span>Inspect File ↗</span>
                            </button>
                            <img 
                              src={kycDocs.passport} 
                              alt="Passport preview" 
                              onClick={() => setLightboxImage({ 
                                src: kycDocs.passport || "", 
                                title: `${selectedOrderForModal.firstName} ${selectedOrderForModal.lastName}'s Passport` 
                              })}
                              className="h-24 w-full object-contain bg-slate-950/60 p-1 rounded border border-white/10 hover:scale-[1.03] transition-transform duration-200 cursor-zoom-in"
                              referrerPolicy="no-referrer"
                            />
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-600">Not Uploaded</span>
                        )}
                      </div>

                      {/* ID Card */}
                      <div className="bg-black/30 border border-white/5 rounded-xl p-3 flex flex-col justify-between h-52">
                        <div>
                          <p className="text-[10px] text-slate-500 uppercase font-semibold">National ID card</p>
                          <p className="text-[11px] text-white mt-1 font-medium truncate">
                            {kycDocs?.idCard || kycDocs?.docFront ? "ID Document Uploaded" : "Not Provided"}
                          </p>
                        </div>
                        {(kycDocs?.idCard || kycDocs?.docFront) ? (
                          <div className="space-y-1.5 mt-1.5 flex flex-col justify-end">
                            <button 
                              type="button"
                              onClick={() => setLightboxImage({ 
                                src: kycDocs.idCard || kycDocs?.docFront || "", 
                                title: `${selectedOrderForModal.firstName} ${selectedOrderForModal.lastName}'s ID Card` 
                              })}
                              className="text-[10px] text-blue-400 hover:underline flex items-center gap-1"
                            >
                              <ImageIcon className="w-3 h-3" />
                              <span>Inspect File ↗</span>
                            </button>
                            <img 
                              src={kycDocs.idCard || kycDocs?.docFront} 
                              alt="ID Document preview" 
                              onClick={() => setLightboxImage({ 
                                src: kycDocs.idCard || kycDocs?.docFront || "", 
                                title: `${selectedOrderForModal.firstName} ${selectedOrderForModal.lastName}'s ID Card` 
                              })}
                              className="h-24 w-full object-contain bg-slate-950/60 p-1 rounded border border-white/10 hover:scale-[1.03] transition-transform duration-200 cursor-zoom-in"
                              referrerPolicy="no-referrer"
                            />
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-600">Not Uploaded</span>
                        )}
                      </div>

                      {/* Verification Selfie */}
                      <div className="bg-black/30 border border-white/5 rounded-xl p-3 flex flex-col justify-between h-52">
                        <div>
                          <p className="text-[10px] text-slate-500 uppercase font-semibold">Verification Selfie</p>
                          <p className="text-[11px] text-white mt-1 font-medium truncate">
                            {kycDocs?.selfie ? "Selfie Uploaded" : "Not Provided"}
                          </p>
                        </div>
                        {kycDocs?.selfie ? (
                          <div className="space-y-1.5 mt-1.5 flex flex-col justify-end">
                            <button 
                              type="button"
                              onClick={() => setLightboxImage({ 
                                src: kycDocs.selfie || "", 
                                title: `${selectedOrderForModal.firstName} ${selectedOrderForModal.lastName}'s Selfie` 
                              })}
                              className="text-[10px] text-blue-400 hover:underline flex items-center gap-1"
                            >
                              <ImageIcon className="w-3 h-3" />
                              <span>Inspect File ↗</span>
                            </button>
                            <img 
                              src={kycDocs.selfie} 
                              alt="Selfie preview" 
                              onClick={() => setLightboxImage({ 
                                src: kycDocs.selfie || "", 
                                title: `${selectedOrderForModal.firstName} ${selectedOrderForModal.lastName}'s Selfie` 
                              })}
                              className="h-24 w-full object-contain bg-slate-950/60 p-1 rounded border border-white/10 hover:scale-[1.03] transition-transform duration-200 cursor-zoom-in"
                              referrerPolicy="no-referrer"
                            />
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-600">Not Uploaded</span>
                        )}
                      </div>

                      {/* Address Proof */}
                      <div className="bg-black/30 border border-white/5 rounded-xl p-3 flex flex-col justify-between h-52">
                        <div>
                          <p className="text-[10px] text-slate-500 uppercase font-semibold">Proof of Residence / Back</p>
                          <p className="text-[11px] text-white mt-1 font-medium truncate">
                            {kycDocs?.addressProof && kycDocs.addressProof !== 'N/A' ? "Proof Uploaded" : kycDocs?.docBack ? "Document Back Uploaded" : "Not Provided"}
                          </p>
                        </div>
                        {(kycDocs?.addressProof && kycDocs.addressProof !== 'N/A') || kycDocs?.docBack ? (
                          <div className="space-y-1.5 mt-1.5 flex flex-col justify-end">
                            <button 
                              type="button"
                              onClick={() => setLightboxImage({ 
                                src: kycDocs.docBack || kycDocs.addressProof || "", 
                                title: `${selectedOrderForModal.firstName} ${selectedOrderForModal.lastName}'s Address Proof / Document Back` 
                              })}
                              className="text-[10px] text-blue-400 hover:underline flex items-center gap-1"
                            >
                              <ImageIcon className="w-3 h-3" />
                              <span>Inspect File ↗</span>
                            </button>
                            <img 
                              src={kycDocs.docBack || kycDocs.addressProof} 
                              alt="Back / Proof preview" 
                              onClick={() => setLightboxImage({ 
                                src: kycDocs.docBack || kycDocs.addressProof || "", 
                                title: `${selectedOrderForModal.firstName} ${selectedOrderForModal.lastName}'s Address Proof / Document Back` 
                              })}
                              className="h-24 w-full object-contain bg-slate-950/60 p-1 rounded border border-white/10 hover:scale-[1.03] transition-transform duration-200 cursor-zoom-in"
                              referrerPolicy="no-referrer"
                            />
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-600">Not Uploaded</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Section 5: Payment Proof Screenshot View */}
              <div className="bg-white/5 border border-white/5 rounded-2xl p-5 space-y-3 md:col-span-2">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider border-b border-white/5 pb-2">
                  Uploaded Payment Proof Screenshot
                </h4>
                {selectedOrderForModal.paymentScreenshot ? (
                  <div className="space-y-3">
                    <div className="max-h-96 overflow-auto border border-white/10 rounded-xl bg-black/40 flex items-center justify-center p-2">
                      <img 
                        src={selectedOrderForModal.paymentScreenshot} 
                        alt="Proof of Payment" 
                        onClick={() => setLightboxImage({ 
                          src: selectedOrderForModal.paymentScreenshot || "", 
                          title: `Payment Proof - Order #${selectedOrderForModal.id || selectedOrderForModal.orderId || "Details"}` 
                        })}
                        className="max-h-80 object-contain rounded-lg hover:scale-[1.01] transition-transform duration-200 cursor-zoom-in"
                        referrerPolicy="no-referrer"
                      />
                    </div>
                    <div className="text-center flex justify-center gap-4">
                      <button 
                        type="button"
                        onClick={() => setLightboxImage({ 
                          src: selectedOrderForModal.paymentScreenshot || "", 
                          title: `Payment Proof - Order #${selectedOrderForModal.id || selectedOrderForModal.orderId || "Details"}` 
                        })}
                        className="text-xs text-blue-400 hover:underline inline-flex items-center gap-1 font-bold"
                      >
                        <ImageIcon className="w-3.5 h-3.5" />
                        <span>Inspect Full HD ↗</span>
                      </button>
                      <a 
                        href={selectedOrderForModal.paymentScreenshot} 
                        target="_blank" 
                        rel="noreferrer" 
                        className="text-xs text-blue-400 hover:underline inline-flex items-center gap-1 font-bold border-l border-white/10 pl-4"
                      >
                        <span>Open original window ↗</span>
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className="py-8 text-center text-xs text-slate-500 bg-black/20 rounded-xl">No screenshot provided</div>
                )}
              </div>

            </div>

            {/* Rejection Form inside Modal */}
            {rejectingOrderId === selectedOrderForModal.orderId && (
              <div className="p-5 bg-rose-500/10 border border-rose-500/20 rounded-2xl space-y-3">
                <div className="flex gap-2 text-rose-400">
                  <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                  <div>
                    <h5 className="text-xs font-bold uppercase">Provide Rejection Reason</h5>
                    <p className="text-[11px] text-slate-400 mt-0.5">Please explain why you are rejecting this proof of payment. This message is pushed directly into the trader's terminal notification hub.</p>
                  </div>
                </div>
                <textarea
                  required
                  rows={2}
                  placeholder="e.g., The payment was not received on the Litecoin blockchain address. Please upload your transaction receipt again."
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-rose-500"
                />
                {rejectionError && <p className="text-xs text-rose-400 font-bold">{rejectionError}</p>}
                <div className="flex justify-end gap-2">
                  <button 
                    type="button" 
                    onClick={() => {
                      setRejectingOrderId(null);
                      setRejectionReason('');
                    }}
                    className="px-3 h-8 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-bold rounded-lg text-[10px]"
                  >
                    Cancel
                  </button>
                  <button 
                    type="button" 
                    onClick={async (e) => {
                      await handleRejectOrder(e);
                      // Close modal upon rejection
                      setSelectedOrderForModal(null);
                    }}
                    className="px-4 h-8 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-lg text-[10px]"
                  >
                    Disapprove & Reject
                  </button>
                </div>
              </div>
            )}

            {/* Actions Footer */}
            <div className="flex justify-between items-center pt-4 border-t border-white/10">
              <span className="text-xs text-slate-400 font-medium">
                Current Order Status: <span className={`font-black uppercase ${
                  selectedOrderForModal.status === 'Approved' ? 'text-emerald-400' :
                  selectedOrderForModal.status === 'Rejected' ? 'text-rose-400' :
                  'text-yellow-400'
                }`}>{selectedOrderForModal.status}</span>
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedOrderForModal(null)}
                  className="px-5 h-11 bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 font-bold rounded-xl text-xs transition-colors"
                >
                  Close
                </button>
                
                {(selectedOrderForModal.status === 'Pending Payment Review' || selectedOrderForModal.status === 'Rejected') && !rejectingOrderId && (
                  <>
                    {selectedOrderForModal.status === 'Pending Payment Review' && (
                      <button
                        type="button"
                        onClick={() => setRejectingOrderId(selectedOrderForModal.orderId)}
                        className="px-5 h-11 bg-rose-600/10 border border-rose-500/20 hover:bg-rose-600 text-rose-300 hover:text-white font-bold rounded-xl text-xs transition-colors"
                      >
                        Reject Order
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={async () => {
                        await handleApproveOrder(selectedOrderForModal);
                        // Update local modal state immediately
                        setSelectedOrderForModal(prev => prev ? { ...prev, status: 'Approved' } : null);
                      }}
                      className="px-6 h-11 bg-emerald-600 hover:bg-emerald-500 text-white font-black rounded-xl text-xs transition-colors shadow-lg shadow-emerald-600/15"
                    >
                      Approve Payment & Account
                    </button>
                  </>
                )}
              </div>
            </div>

          </div>
        </div>
      )}

      {/* Lightbox for high-resolution image viewing */}
      {lightboxImage && (
        <div 
          className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/95 backdrop-blur-sm p-4 select-none animate-in fade-in duration-200"
          onClick={() => setLightboxImage(null)}
        >
          {/* Top Bar with actions */}
          <div className="absolute top-4 left-4 right-4 flex items-center justify-between text-white z-50">
            <span className="text-xs sm:text-sm font-semibold truncate bg-black/40 px-3 py-1.5 rounded-lg border border-white/5">
              {lightboxImage.title}
            </span>
            <div className="flex items-center gap-2">
              <a
                href={lightboxImage.src}
                target="_blank"
                rel="noreferrer"
                className="p-2 bg-white/10 hover:bg-white/20 active:bg-white/30 rounded-lg transition-colors text-white flex items-center gap-1.5 text-xs font-bold border border-white/10 shadow-lg"
                onClick={(e) => e.stopPropagation()}
              >
                <span>Open Original ↗</span>
              </a>
              <button
                type="button"
                onClick={() => setLightboxImage(null)}
                className="p-2 bg-white/10 hover:bg-rose-600 rounded-lg transition-colors text-white font-bold text-xs flex items-center justify-center w-8 h-8 border border-white/10 shadow-lg"
                aria-label="Close Lightbox"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Main Image Viewport */}
          <div 
            className="relative max-w-full max-h-[85vh] flex items-center justify-center overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <img 
              src={lightboxImage.src} 
              alt={lightboxImage.title} 
              className="max-w-full max-h-[80vh] md:max-h-[85vh] object-contain rounded-lg border border-white/10 shadow-2xl transition-transform duration-300"
              style={{ imageRendering: 'auto' }}
              referrerPolicy="no-referrer"
            />
          </div>

          {/* Bottom Help Text */}
          <div className="absolute bottom-4 text-center text-[11px] text-slate-400 bg-black/40 px-3 py-1 rounded-full border border-white/5 pointer-events-none">
            Click anywhere outside or the close button to exit fullscreen view
          </div>
        </div>
      )}

      {/* Waitlist Emails Modal */}
      {selectedPkgWaitlistEmails && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0b0f19] border border-white/15 rounded-3xl w-full max-w-lg p-6 space-y-4 animate-fade-in relative text-left">
            <button
              type="button"
              onClick={() => setSelectedPkgWaitlistEmails(null)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white font-sans text-sm bg-white/5 hover:bg-white/10 w-8 h-8 rounded-full flex items-center justify-center transition-colors"
            >
              ✕
            </button>
            <div>
              <h3 className="text-base font-black text-white uppercase tracking-wider">
                Availability Waitlist Emails
              </h3>
              <p className="text-xs text-blue-400 font-bold font-mono mt-1">
                {CHALLENGE_PACKAGES.find(p => p.id === selectedPkgWaitlistEmails)?.name || selectedPkgWaitlistEmails}
              </p>
            </div>
            
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
              {interestedUsers.filter(u => u.packageId === selectedPkgWaitlistEmails).map((u, i) => (
                <div key={u.id || i} className="flex justify-between items-center p-3 bg-black/35 border border-white/5 rounded-xl">
                  <span className="text-xs text-white font-mono select-all font-semibold">{u.email}</span>
                  <span className="text-[10px] text-slate-400 font-mono">{new Date(u.createdAt).toLocaleDateString()}</span>
                </div>
              ))}
              {interestedUsers.filter(u => u.packageId === selectedPkgWaitlistEmails).length === 0 && (
                <div className="text-center py-10 bg-black/10 rounded-xl border border-dashed border-white/10 text-slate-500 text-xs font-medium">
                  No waiting users registered for this account size.
                </div>
              )}
            </div>

            {interestedUsers.filter(u => u.packageId === selectedPkgWaitlistEmails).length > 0 && (
              <button
                type="button"
                onClick={async () => {
                  try {
                    const matchedUsers = interestedUsers.filter(u => u.packageId === selectedPkgWaitlistEmails);
                    const batchPromises = matchedUsers.map(u => {
                      return updateDoc(doc(db, 'availability_waitlist', u.id), {
                        status: 'Notified',
                        notifiedAt: new Date().toISOString()
                      });
                    });
                    await Promise.all(batchPromises);
                    alert(`Successfully updated status to "Notified" for ${matchedUsers.length} waiting users!`);
                    setSelectedPkgWaitlistEmails(null);
                  } catch (err: any) {
                    alert('Error notifying waitlist users: ' + err.message);
                  }
                }}
                className="w-full h-10 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs transition-colors shadow-lg shadow-blue-600/15"
              >
                Notify All For This Account
              </button>
            )}
          </div>
        </div>
      )}

      {/* Viewing KYC Documents Modal */}
      {viewingKycUser && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#0b0f19] border border-white/10 rounded-3xl p-6 max-w-2xl w-full space-y-6 shadow-2xl relative max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center border-b border-white/10 pb-4">
              <div>
                <h3 className="text-lg font-bold text-white">KYC Documents Verification</h3>
                <p className="text-xs text-slate-400">{viewingKycUser.displayName || viewingKycUser.name || 'Trader'} ({viewingKycUser.email})</p>
              </div>
              <button
                type="button"
                onClick={() => setViewingKycUser(null)}
                className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Front ID */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-3 space-y-2 text-center">
                <p className="text-xs font-bold text-slate-300">Front ID / Passport</p>
                {viewingKycUser.kycDocuments?.docFront || viewingKycUser.kycDocuments?.passport || viewingKycUser.kycDocuments?.idCard ? (
                  <div className="space-y-1.5">
                    <button
                      type="button"
                      onClick={() => setLightboxImage({
                        src: viewingKycUser.kycDocuments?.docFront || viewingKycUser.kycDocuments?.passport || viewingKycUser.kycDocuments?.idCard || "",
                        title: `${viewingKycUser.displayName || viewingKycUser.name || 'Trader'}'s Front ID`
                      })}
                      className="text-[10px] text-blue-400 hover:underline flex items-center justify-center gap-1 mx-auto cursor-pointer"
                    >
                      <ImageIcon className="w-3 h-3" />
                      <span>Inspect Fullscreen ↗</span>
                    </button>
                    <img
                      src={viewingKycUser.kycDocuments?.docFront || viewingKycUser.kycDocuments?.passport || viewingKycUser.kycDocuments?.idCard}
                      alt="Front ID"
                      onClick={() => setLightboxImage({
                        src: viewingKycUser.kycDocuments?.docFront || viewingKycUser.kycDocuments?.passport || viewingKycUser.kycDocuments?.idCard || "",
                        title: `${viewingKycUser.displayName || viewingKycUser.name || 'Trader'}'s Front ID`
                      })}
                      className="w-full h-44 object-contain bg-black/60 p-1.5 rounded-xl border border-white/10 hover:scale-[1.02] transition-transform cursor-zoom-in"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                ) : (
                  <div className="h-44 bg-black/30 rounded-xl flex items-center justify-center text-[10px] text-slate-500 font-mono">Not Uploaded</div>
                )}
              </div>

              {/* Back ID */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-3 space-y-2 text-center">
                <p className="text-xs font-bold text-slate-300">Back ID</p>
                {viewingKycUser.kycDocuments?.docBack ? (
                  <div className="space-y-1.5">
                    <button
                      type="button"
                      onClick={() => setLightboxImage({
                        src: viewingKycUser.kycDocuments?.docBack || "",
                        title: `${viewingKycUser.displayName || viewingKycUser.name || 'Trader'}'s Back ID`
                      })}
                      className="text-[10px] text-blue-400 hover:underline flex items-center justify-center gap-1 mx-auto cursor-pointer"
                    >
                      <ImageIcon className="w-3 h-3" />
                      <span>Inspect Fullscreen ↗</span>
                    </button>
                    <img
                      src={viewingKycUser.kycDocuments?.docBack}
                      alt="Back ID"
                      onClick={() => setLightboxImage({
                        src: viewingKycUser.kycDocuments?.docBack || "",
                        title: `${viewingKycUser.displayName || viewingKycUser.name || 'Trader'}'s Back ID`
                      })}
                      className="w-full h-44 object-contain bg-black/60 p-1.5 rounded-xl border border-white/10 hover:scale-[1.02] transition-transform cursor-zoom-in"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                ) : (
                  <div className="h-44 bg-black/30 rounded-xl flex items-center justify-center text-[10px] text-slate-500 font-mono">Not Uploaded</div>
                )}
              </div>

              {/* Selfie */}
              <div className="bg-white/5 border border-white/10 rounded-2xl p-3 space-y-2 text-center">
                <p className="text-xs font-bold text-slate-300">Selfie Proof</p>
                {viewingKycUser.kycDocuments?.selfie ? (
                  <div className="space-y-1.5">
                    <button
                      type="button"
                      onClick={() => setLightboxImage({
                        src: viewingKycUser.kycDocuments?.selfie || "",
                        title: `${viewingKycUser.displayName || viewingKycUser.name || 'Trader'}'s Face Selfie`
                      })}
                      className="text-[10px] text-blue-400 hover:underline flex items-center justify-center gap-1 mx-auto cursor-pointer"
                    >
                      <ImageIcon className="w-3 h-3" />
                      <span>Inspect Fullscreen ↗</span>
                    </button>
                    <img
                      src={viewingKycUser.kycDocuments?.selfie}
                      alt="Selfie"
                      onClick={() => setLightboxImage({
                        src: viewingKycUser.kycDocuments?.selfie || "",
                        title: `${viewingKycUser.displayName || viewingKycUser.name || 'Trader'}'s Face Selfie`
                      })}
                      className="w-full h-44 object-contain bg-black/60 p-1.5 rounded-xl border border-white/10 hover:scale-[1.02] transition-transform cursor-zoom-in"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                ) : (
                  <div className="h-44 bg-black/30 rounded-xl flex items-center justify-center text-[10px] text-slate-500 font-mono">Not Uploaded</div>
                )}
              </div>
            </div>

            <div className="flex justify-end space-x-3 pt-4 border-t border-white/10">
              <button
                type="button"
                onClick={async () => {
                  await updateDoc(doc(db, 'users', viewingKycUser.uid), { kycStatus: 'rejected' });
                  setViewingKycUser(prev => prev ? { ...prev, kycStatus: 'rejected' } : null);
                }}
                className="px-4 py-2 bg-red-600/10 hover:bg-red-600 border border-red-600/20 text-red-400 hover:text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                Reject KYC
              </button>
              <button
                type="button"
                onClick={async () => {
                  await updateDoc(doc(db, 'users', viewingKycUser.uid), { kycStatus: 'approved' });
                  setViewingKycUser(prev => prev ? { ...prev, kycStatus: 'approved' } : null);
                }}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-lg shadow-emerald-600/20"
              >
                Approve KYC
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Editing Coupon Modal */}
      {editingCoupon && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="bg-[#0b0f19] border border-white/10 rounded-3xl p-6 max-w-lg w-full space-y-5 shadow-2xl relative">
            <div className="flex justify-between items-center border-b border-white/10 pb-4">
              <div>
                <h3 className="text-base font-bold text-white">Edit Coupon Code ({editingCoupon.code})</h3>
                <p className="text-xs text-slate-400">Configure discount percentage and applicable accounts</p>
              </div>
              <button
                type="button"
                onClick={() => setEditingCoupon(null)}
                className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white flex items-center justify-center cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-400">Discount Type</label>
                  <select
                    value={editingCoupon.discountType || 'percent'}
                    onChange={(e) => setEditingCoupon({ ...editingCoupon, discountType: e.target.value as 'percent' | 'fixed' })}
                    className="w-full h-10 glass-input rounded-xl px-3 text-xs text-white font-mono bg-slate-900 border border-white/10"
                  >
                    <option value="percent">% Percentage</option>
                    <option value="fixed">$ Fixed Amount</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-400">
                    {editingCoupon.discountType === 'fixed' ? 'Discount ($)' : 'Discount Percent (%)'}
                  </label>
                  <input
                    type="number"
                    min="1"
                    value={editingCoupon.discountType === 'fixed' ? (editingCoupon.discountAmount || editingCoupon.discountPercent) : editingCoupon.discountPercent}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (editingCoupon.discountType === 'fixed') {
                        setEditingCoupon({ ...editingCoupon, discountAmount: v, discountPercent: 0 });
                      } else {
                        setEditingCoupon({ ...editingCoupon, discountPercent: v, discountAmount: 0 });
                      }
                    }}
                    className="w-full h-10 glass-input rounded-xl px-3 text-xs text-white font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-400">Max Usage Limit</label>
                  <input
                    type="number"
                    placeholder="Unlimited"
                    value={editingCoupon.maxUses || ''}
                    onChange={(e) => setEditingCoupon({ ...editingCoupon, maxUses: e.target.value ? Number(e.target.value) : undefined })}
                    className="w-full h-10 glass-input rounded-xl px-3 text-xs text-white font-mono"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-bold text-slate-400">Expiry Date</label>
                  <input
                    type="date"
                    value={editingCoupon.expiresAt || ''}
                    onChange={(e) => setEditingCoupon({ ...editingCoupon, expiresAt: e.target.value })}
                    className="w-full h-10 glass-input rounded-xl px-3 text-xs text-white font-mono bg-slate-900 border border-white/10"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <label className="text-xs font-bold text-slate-300">Applicable Account Types</label>
                  <div className="flex space-x-2">
                    <button
                      type="button"
                      onClick={() => setEditingCoupon({ ...editingCoupon, applicableAccountTypes: ['one_step', 'two_step', 'payout_later', 'instant_bolt', 'trial'] })}
                      className="text-[10px] text-blue-400 hover:underline font-semibold cursor-pointer"
                    >
                      Select All
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingCoupon({ ...editingCoupon, applicableAccountTypes: [] })}
                      className="text-[10px] text-slate-400 hover:underline cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-2 bg-black/40 border border-white/10 rounded-2xl p-3">
                  {[
                    { id: 'one_step', label: 'One Step Challenge', icon: '⚡' },
                    { id: 'two_step', label: 'Two Step Challenge', icon: '🚀' },
                    { id: 'payout_later', label: 'Payout Later Challenge', icon: '⏳' },
                    { id: 'instant_bolt', label: 'Instant Bolt Account', icon: '⚡' },
                    { id: 'trial', label: 'AT Trial Account', icon: '🎁' },
                  ].map(opt => {
                    const rawTypes = editingCoupon.applicableAccountTypes || ['all'];
                    const isAll = rawTypes.includes('all');
                    const currentList = isAll ? ['one_step', 'two_step', 'payout_later', 'instant_bolt', 'trial'] : rawTypes;
                    const isChecked = currentList.includes(opt.id);

                    const toggleType = () => {
                      let updated: string[];
                      if (isChecked) {
                        updated = currentList.filter(t => t !== opt.id);
                      } else {
                        updated = [...currentList, opt.id];
                      }
                      setEditingCoupon({ ...editingCoupon, applicableAccountTypes: updated });
                    };

                    return (
                      <label key={opt.id} className="flex items-center space-x-3 cursor-pointer p-1.5 hover:bg-white/5 rounded-xl transition-colors select-none">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={toggleType}
                          className="w-4 h-4 rounded border-white/20 bg-black text-blue-600 focus:ring-0 cursor-pointer"
                        />
                        <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                          <span>{opt.icon}</span>
                          <span>{opt.label}</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-3 pt-4 border-t border-white/10">
              <button
                type="button"
                onClick={() => setEditingCoupon(null)}
                className="px-4 py-2 bg-white/5 hover:bg-white/10 text-slate-300 rounded-xl text-xs font-bold transition-all cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  try {
                    const rawList = editingCoupon.applicableAccountTypes || [];
                    const isAllSelected = rawList.length === 5 || rawList.includes('all') || rawList.length === 0;
                    const finalTypes = isAllSelected ? ['all'] : rawList;

                    const docId = editingCoupon.id || editingCoupon.code;
                    const isFixed = editingCoupon.discountType === 'fixed';
                    const val = Number(isFixed ? editingCoupon.discountAmount : editingCoupon.discountPercent) || 0;

                    const payload: any = {
                      discountType: editingCoupon.discountType || 'percent',
                      discountPercent: isFixed ? 0 : val,
                      discountAmount: isFixed ? val : 0,
                      applicableAccountTypes: finalTypes
                    };

                    if (editingCoupon.expiresAt !== undefined) {
                      payload.expiresAt = editingCoupon.expiresAt;
                    }
                    if (editingCoupon.maxUses !== undefined) {
                      payload.maxUses = Number(editingCoupon.maxUses) || 0;
                    }

                    // Optimistic state update
                    setCoupons(prev => prev.map(c => (c.code === editingCoupon.code || c.id === docId) ? { ...c, ...payload } : c));
                    setEditingCoupon(null);

                    try {
                      await updateDoc(doc(db, 'coupons', docId), payload);
                      invalidateCache('admin_coupons');
                    } catch (err) {
                      await updateDoc(doc(db, 'coupons', editingCoupon.code), payload);
                      invalidateCache('admin_coupons');
                    }
                  } catch (err) {
                    console.error("Error updating coupon:", err);
                    invalidateCache('admin_coupons');
                  }
                }}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-lg shadow-blue-600/20"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
