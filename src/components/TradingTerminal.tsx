import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, Square, TrendingUp, TrendingDown, RefreshCw, AlertCircle, CheckCircle, 
  Info, ShieldAlert, Sparkles, Trophy, Percent, Wallet, Maximize2, Minimize2, Coins, Lock, Clock, Award, AlertTriangle,
  Edit3, Sliders, FileText, Copy, Check
} from 'lucide-react';
import { TradingAccount, Trade, LivePrice } from '../types';
import { db } from '../firebase';
import { 
  collection, doc, setDoc, updateDoc, getDoc, query, where, 
  onSnapshot, addDoc, deleteDoc 
} from 'firebase/firestore';
import AdvancedChart from './AdvancedChart';

// Centralized core engine imports
import { subscribeToPrices, startPriceEngine, DECIMAL_PLACES, priceEngineState as priceEngine, symbolTrendState } from '../core/priceEngine';
import { RichTrade, subscribeToPositions, executeClosePosition } from '../core/positionEngine';
import { executeOrder } from '../core/orderEngine';
import { recalculateAccountMetrics, calculatePositionMargin } from '../core/accountEngine';
import { evaluateAccountRisk, getMaxLotSize, calculateDynamicAccountMetrics, calculateAccountRiskScore } from '../core/riskEngine';
import { calculateTradePnL, getContractSize } from '../core/pnlEngine';
import { getCandles, purgeAndRebuildAllCandles, getTimeframeStatus, getCandleEngineMetrics } from '../core/candleEngine';

interface TradingTerminalProps {
  userId: string;
  selectedAccount: TradingAccount | null;
  onRefreshAccount: () => void;
}

// 1. Centralized base prices and specifications
const BASE_PRICES: { [key: string]: { name: string, price: number, spread: number } } = {
  // Forex
  EURUSD: { name: 'Euro vs US Dollar', price: 1.08500, spread: 0.00018 },
  GBPUSD: { name: 'Great Britain Pound vs US Dollar', price: 1.27500, spread: 0.00022 },
  USDJPY: { name: 'US Dollar vs Japanese Yen', price: 155.200, spread: 0.020 },
  AUDUSD: { name: 'Australian Dollar vs US Dollar', price: 0.66500, spread: 0.00018 },
  NZDUSD: { name: 'New Zealand Dollar vs US Dollar', price: 0.61200, spread: 0.00020 },
  USDCAD: { name: 'US Dollar vs Canadian Dollar', price: 1.36800, spread: 0.00020 },
  USDCHF: { name: 'US Dollar vs Swiss Franc', price: 0.89500, spread: 0.00020 },
  EURGBP: { name: 'Euro vs Great Britain Pound', price: 0.85100, spread: 0.00020 },
  EURJPY: { name: 'Euro vs Japanese Yen', price: 168.400, spread: 0.022 },
  GBPJPY: { name: 'Great Britain Pound vs Japanese Yen', price: 197.800, spread: 0.025 },
  // Metals
  XAUUSD: { name: 'Gold vs US Dollar', price: 2380.50, spread: 0.35 },
  XAGUSD: { name: 'Silver vs US Dollar', price: 30.50, spread: 0.025 },
  // Energy
  USOIL:  { name: 'US Crude Oil', price: 81.50, spread: 0.04 },
  UKOIL:  { name: 'Brent Crude Oil', price: 85.20, spread: 0.04 },
  // Indices
  NAS100: { name: 'NASDAQ 100 Index', price: 19850.00, spread: 1.50 },
  US30:   { name: 'Dow Jones Industrial Average', price: 40250.00, spread: 2.50 },
  SPX500: { name: 'S&P 500 Index', price: 5580.00, spread: 0.50 },
  // Crypto
  BTCUSD: { name: 'Bitcoin vs US Dollar', price: 66500.00, spread: 18.00 },
  ETHUSD: { name: 'Ethereum vs US Dollar', price: 3480.00, spread: 1.80 },
};

export default function TradingTerminal({ userId, selectedAccount, onRefreshAccount }: TradingTerminalProps) {
  // Centralized price states
  const [symbols, setSymbols] = useState<(LivePrice & { bid: number; ask: number; spread: number })[]>(() => {
    return Object.entries(BASE_PRICES).map(([symbol, data]) => {
      const bid = Number((data.price - data.spread / 2).toFixed(DECIMAL_PLACES[symbol]));
      const ask = Number((data.price + data.spread / 2).toFixed(DECIMAL_PLACES[symbol]));
      return {
        symbol,
        name: data.name,
        price: data.price,
        bid,
        ask,
        spread: data.spread,
        change24h: Number(((Math.random() * 2) - 1).toFixed(2)) // Initial mock daily change
      };
    });
  });

  const [selectedSymbol, setSelectedSymbol] = useState<LivePrice & { bid: number; ask: number; spread: number }>(() => {
    const defaultData = BASE_PRICES['EURUSD'];
    const bid = Number((defaultData.price - defaultData.spread / 2).toFixed(5));
    const ask = Number((defaultData.price + defaultData.spread / 2).toFixed(5));
    return {
      symbol: 'EURUSD',
      name: defaultData.name,
      price: defaultData.price,
      bid,
      ask,
      spread: defaultData.spread,
      change24h: 0.15
    };
  });

  // Chart customization states
  const [timeframe, setTimeframe] = useState<string>('D');
  const [indicators, setIndicators] = useState({
    ema: true,
    sma: false,
    rsi: true,
    macd: false,
    bb: false
  });
  const [isChartFullscreen, setIsChartFullscreen] = useState(false);

  // Order configuration states
  const [tradeType, setTradeType] = useState<'buy' | 'sell'>('buy');
  const [lots, setLots] = useState<number>(0.1);
  const [tp, setTp] = useState<string>('');
  const [sl, setSl] = useState<string>('');
  
  const [isExecuting, setIsExecuting] = useState(false);
  const isSubmittingRef = useRef(false);
  const [openTrades, setOpenTrades] = useState<Trade[]>([]);
  const [closedTrades, setClosedTrades] = useState<Trade[]>([]);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [lastExecutionPrice, setLastExecutionPrice] = useState<number | null>(null);

  // Partial close modal states
  const [partialCloseTrade, setPartialCloseTrade] = useState<Trade | null>(null);
  const [partialLots, setPartialLots] = useState<number>(0.1);
  const [partialCloseError, setPartialCloseError] = useState('');

  // Modify SL/TP modal states
  const [modifyingSlTpTrade, setModifyingSlTpTrade] = useState<Trade | null>(null);
  const [editSlInput, setEditSlInput] = useState<string>('');
  const [editTpInput, setEditTpInput] = useState<string>('');
  const [editSlTpError, setEditSlTpError] = useState<string>('');
  const [isSavingSlTp, setIsSavingSlTp] = useState<boolean>(false);

  // System Force-Closed Notification Modal State
  const [forceCloseNotifModal, setForceCloseNotifModal] = useState<{
    isOpen: boolean;
    tradeId: string;
    symbol: string;
    type: string;
    lots: number;
    closePrice: number;
    profit: number;
    closeReason: string;
    triggeredRule: string;
    closeTime: string;
    accountId: string;
  } | null>(null);

  // Auto-Close Audit Report Modal state
  const [showAuditReportModal, setShowAuditReportModal] = useState<boolean>(false);
  const [copiedReport, setCopiedReport] = useState<boolean>(false);

  // Live rule settings, profile, and violations states from Firestore
  const [userProfile, setUserProfile] = useState<any>(null);
  const [ruleSettings, setRuleSettings] = useState<any>(null);
  const [violations, setViolations] = useState<any[]>([]);

  // Real-time calculated account metrics state
  const [metrics, setMetrics] = useState({
    balance: selectedAccount?.balance || 0,
    equity: selectedAccount?.balance || 0,
    marginUsed: 0,
    freeMargin: selectedAccount?.balance || 0,
    floatingPnL: 0
  });

  const [tickTimer, setTickTimer] = useState<number>(0);

  // 1-second ticker for Validation Panel countdowns
  useEffect(() => {
    const timer = setInterval(() => {
      setTickTimer(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 1. Fetch live API prices and sync selected Symbol via subscribeToPrices
  useEffect(() => {
    startPriceEngine();

    const unsubscribePrices = subscribeToPrices((prices) => {
      const updatedSymbols = Object.entries(prices).map(([symbol, item]) => {
        return {
          symbol,
          name: BASE_PRICES[symbol]?.name || symbol,
          price: item.last,
          bid: item.bid,
          ask: item.ask,
          spread: item.spread,
          change24h: item.changePercent
        };
      });

      setSymbols(updatedSymbols);

      const activeSelected = updatedSymbols.find(s => s.symbol === selectedSymbol.symbol);
      if (activeSelected) {
        setSelectedSymbol(activeSelected);
      }
    });

    return () => {
      unsubscribePrices();
    };
  }, [selectedSymbol.symbol]);

  // 2. Subscribe to centralized positions engine
  useEffect(() => {
    if (!selectedAccount?.id || !userId) {
      setOpenTrades([]);
      setClosedTrades([]);
      return;
    }

    const unsubscribePositions = subscribeToPositions(selectedAccount.id, userId, (open, closed) => {
      setOpenTrades(open);
      setClosedTrades(closed);
    });

    return () => {
      unsubscribePositions();
    };
  }, [selectedAccount?.id, userId]);

  // 3. Real-time metrics synchronization on price ticks and position updates
  useEffect(() => {
    if (!selectedAccount) return;

    const unsubscribePrices = subscribeToPrices((prices) => {
      const activeMetrics = recalculateAccountMetrics(selectedAccount, openTrades, prices);
      setMetrics(activeMetrics);
    });

    return () => {
      unsubscribePrices();
    };
  }, [selectedAccount, openTrades]);

  const getPipValue = (sym: string): number => {
    if (sym.includes('JPY')) return 0.01;
    if (sym === 'XAUUSD') return 0.10;
    if (sym === 'BTCUSD') return 1.00;
    if (sym === 'ETHUSD') return 0.10;
    if (sym === 'SOLUSD') return 0.01;
    return 0.0001; // default forex
  };

  // Real-time 10-Minute Cooldown Ticker for Bolt / Instant Accounts
  const [cooldownRemainingSec, setCooldownRemainingSec] = useState<number>(0);

  // Popup warning modal state for rule breaches, cooldowns, and phase passes
  const [ruleBreachModal, setRuleBreachModal] = useState<{
    isOpen: boolean;
    title: string;
    subtitle?: string;
    message: string;
    details?: string;
    type?: 'warning' | 'cooldown' | 'success';
  } | null>(null);

  useEffect(() => {
    if (selectedAccount?.accountType === 'instant_bolt' && (selectedAccount?.lastTradeClosedAt || selectedAccount?.cooldownUntil)) {
      const updateCooldown = () => {
        const cooldownUntilTime = selectedAccount.cooldownUntil ? new Date(selectedAccount.cooldownUntil).getTime() : 0;
        const lastClose = selectedAccount.lastTradeClosedAt ? new Date(selectedAccount.lastTradeClosedAt).getTime() : 0;
        const now = Date.now();

        let rem = 0;
        if (cooldownUntilTime > now) {
          rem = cooldownUntilTime - now;
        } else if (lastClose > 0) {
          const totalCooldown = 10 * 60 * 1000;
          rem = totalCooldown - (now - lastClose);
        }

        if (rem > 0) {
          setCooldownRemainingSec(Math.ceil(rem / 1000));
        } else {
          setCooldownRemainingSec(0);
        }
      };

      updateCooldown();
      const interval = setInterval(updateCooldown, 1000);
      return () => clearInterval(interval);
    } else {
      setCooldownRemainingSec(0);
    }
  }, [selectedAccount?.id, selectedAccount?.lastTradeClosedAt, selectedAccount?.cooldownUntil, selectedAccount?.accountType]);

  const formatCooldownTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
  };

  // Centralized reference to selected symbol price from global priceEngine
  const activeSelectedSymbol = priceEngine[selectedSymbol.symbol] || selectedSymbol;

  // Track trades and risk conditions that have triggered warnings
  const warned2MinTradesRef = useRef<Set<string>>(new Set());
  const warnedRiskRef = useRef<Set<string>>(new Set());
  const warned10MinTradesRef = useRef<Set<string>>(new Set());

  // 3. Automated real-time evaluation risk checks -> Send Warning ⚠️ to Admin Panel (NO AUTO-BREACH)
  useEffect(() => {
    if (!selectedAccount || selectedAccount.status !== 'active') return;

    const risk = evaluateAccountRisk(selectedAccount, metrics, closedTrades);
    if (risk.isDailyBreached || risk.isMaxBreached) {
      const warnKey = `${selectedAccount.id}-${risk.breachReason}`;
      if (!warnedRiskRef.current.has(warnKey)) {
        warnedRiskRef.current.add(warnKey);
        console.warn("Drawdown limit reached, logging warning to Admin Panel:", risk.breachReason);
        handleBreachAccount(risk.breachReason);
      }
    }
  }, [metrics, selectedAccount?.id]);

  // Automated real-time holding duration monitor (2-min warning popup, 10-min duration warning to Admin Panel)
  useEffect(() => {
    if (!selectedAccount || selectedAccount.status !== 'active' || openTrades.length === 0) return;

    const interval = setInterval(() => {
      const now = Date.now();
      openTrades.forEach((trade) => {
        if (!trade.openTime) return;
        const openTime = new Date(trade.openTime).getTime();
        const durationSec = Math.floor((now - openTime) / 1000);

        if (durationSec >= 600) {
          // 10 minutes exceeded: Send Warning ⚠️ to Admin Panel (NO AUTO-BREACH)
          if (!warned10MinTradesRef.current.has(trade.id)) {
            warned10MinTradesRef.current.add(trade.id);
            console.warn(`Position duration exceeded 10 mins (${durationSec}s) on trade #${trade.id}. Logging warning to Admin Panel.`);
            handleBreachAccount('10 Minute Rule Warning');
          }
        } else if (durationSec >= 120) {
          // 2 minutes exceeded: Show warning popup!
          if (!warned2MinTradesRef.current.has(trade.id)) {
            warned2MinTradesRef.current.add(trade.id);
            setRuleBreachModal({
              isOpen: true,
              title: '⚠️ Rule Violation Warning',
              subtitle: 'Position Duration Warning',
              type: 'warning',
              message: 'Warning: Positions must not exceed 2 minutes.',
              details: `Trade #${trade.id} on ${trade.symbol} (${trade.lots} lots) has been open for ${Math.floor(durationSec / 60)}m ${durationSec % 60}s. A warning ⚠️ notice has been sent to the Admin Panel.`
            });
          }
        }
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [openTrades, selectedAccount?.id, selectedAccount?.status]);

  // Automated Real-time TP/SL engine (reading strictly from centralized priceEngine)
  useEffect(() => {
    if (openTrades.length === 0 || !selectedAccount || selectedAccount.status !== 'active') return;

    openTrades.forEach(async (trade) => {
      const symData = priceEngine[trade.symbol];
      if (!symData) return;

      const currentPrice = trade.type === 'buy' ? symData.bid : symData.ask;
      let hitTP = false;
      let hitSL = false;

      const numericTp = trade.takeProfit != null ? Number(trade.takeProfit) : (trade.tp && !isNaN(Number(trade.tp)) ? Number(trade.tp) : null);
      const numericSl = trade.stopLoss != null ? Number(trade.stopLoss) : (trade.sl && !isNaN(Number(trade.sl)) ? Number(trade.sl) : null);

      if (numericTp !== null && numericTp > 0) {
        if (trade.type === 'buy' && currentPrice >= numericTp) hitTP = true;
        if (trade.type === 'sell' && currentPrice <= numericTp) hitTP = true;
      }

      if (numericSl !== null && numericSl > 0) {
        if (trade.type === 'buy' && currentPrice <= numericSl) hitSL = true;
        if (trade.type === 'sell' && currentPrice >= numericSl) hitSL = true;
      }

      if (hitTP || hitSL) {
        const triggerPrice = hitTP ? (numericTp || currentPrice) : (numericSl || currentPrice);
        const reason = hitTP ? 'Take Profit Hit' : 'Stop Loss Hit';
        const rule = hitTP ? 'Take Profit Target Price Triggered' : 'Stop Loss Risk Boundary Triggered';
        console.log(`Auto-closing trade ${trade.id} on ${trade.symbol}: ${reason} at ${triggerPrice}`);
        await executeDirectClose(trade, triggerPrice, reason, reason, rule, true);
      }
    });
  }, [symbols, openTrades]);

  // Automated Real-time Protection Monitors (Daily Drawdown, Max Drawdown, Margin Protection, Account Breach)
  useEffect(() => {
    if (openTrades.length === 0 || !selectedAccount || selectedAccount.status !== 'active') return;

    // Daily Drawdown Protection Check
    const dailyLimit = selectedAccount.dailyDrawdownLimit || (selectedAccount.startingBalance * 0.05);
    const dailyStarting = selectedAccount.dailyStartingBalance || selectedAccount.startingBalance;
    const currentDailyLoss = dailyStarting - metrics.equity;

    if (currentDailyLoss >= dailyLimit) {
      openTrades.forEach(async (trade) => {
        const symData = priceEngine[trade.symbol];
        const currentPrice = symData ? (trade.type === 'buy' ? symData.bid : symData.ask) : trade.openPrice;
        console.warn(`Daily drawdown breached! Force-closing trade ${trade.id} under Daily Drawdown Protection.`);
        await executeDirectClose(
          trade,
          currentPrice,
          'Daily Drawdown Protection',
          'Daily Drawdown Protection',
          'Daily Loss Limit Exceeded',
          true
        );
      });
      handleBreachAccount('Daily Loss Limit Exceeded');
      return;
    }

    // Max Drawdown Protection Check
    const maxLimit = selectedAccount.maxDrawdownLimit || (selectedAccount.startingBalance * 0.10);
    const currentOverallLoss = selectedAccount.startingBalance - metrics.equity;

    if (currentOverallLoss >= maxLimit) {
      openTrades.forEach(async (trade) => {
        const symData = priceEngine[trade.symbol];
        const currentPrice = symData ? (trade.type === 'buy' ? symData.bid : symData.ask) : trade.openPrice;
        console.warn(`Max drawdown breached! Force-closing trade ${trade.id} under Max Drawdown Protection.`);
        await executeDirectClose(
          trade,
          currentPrice,
          'Max Drawdown Protection',
          'Max Drawdown Protection',
          'Max Drawdown Limit Exceeded',
          true
        );
      });
      handleBreachAccount('Max Drawdown Limit Exceeded');
      return;
    }

    // Margin Protection Check (Insufficient Margin / Stop Out)
    if (metrics.freeMargin < 0) {
      openTrades.forEach(async (trade) => {
        const symData = priceEngine[trade.symbol];
        const currentPrice = symData ? (trade.type === 'buy' ? symData.bid : symData.ask) : trade.openPrice;
        console.warn(`Insufficient margin! Force-closing trade ${trade.id} under Margin Protection.`);
        await executeDirectClose(
          trade,
          currentPrice,
          'Margin Protection',
          'Margin Protection',
          'Insufficient Free Margin / Stop Out',
          true
        );
      });
    }
  }, [metrics.equity, metrics.freeMargin, openTrades, selectedAccount]);

  // Execute direct close with designated price (TP/SL/Protection/Manual)
  const executeDirectClose = async (
    trade: Trade, 
    closePrice: number, 
    comment?: string, 
    closeReason?: string,
    triggeredRule?: string,
    isSystemForceClose = false
  ) => {
    if (!selectedAccount) return;
    try {
      // Pass closePrice for both bid and ask to resolve to closePrice under buy/sell PnL formula
      const finalProfit = calculateTradePnL(trade.symbol, trade.type, trade.openPrice, trade.lots, closePrice, closePrice);
      const now = new Date().toISOString();

      const actualReason = closeReason || comment || 'Manual Close';
      const actualRule = triggeredRule || (actualReason.includes('Protection') ? actualReason : 'Manual Market Execution');

      const tradePayload = {
        status: 'closed',
        statusUpper: 'CLOSED',
        closePrice,
        closeTime: now,
        profit: finalProfit,
        comment: comment || actualReason,
        closeReason: actualReason,
        triggeredRule: actualRule
      };

      // 1. Mark trade as closed in Firestore
      try {
        await updateDoc(doc(db, 'trades', trade.id), tradePayload);
      } catch (err) {
        await setDoc(doc(db, 'trades', trade.id), {
          ...trade,
          ...tradePayload
        }, { merge: true });
      }

      // If system force-closed position, show pop-up notification modal & log in Firestore notifications
      if (isSystemForceClose) {
        setForceCloseNotifModal({
          isOpen: true,
          tradeId: trade.id,
          symbol: trade.symbol,
          type: trade.type,
          lots: trade.lots,
          closePrice,
          profit: finalProfit,
          closeReason: actualReason,
          triggeredRule: actualRule,
          closeTime: now,
          accountId: selectedAccount.login || selectedAccount.id
        });

        try {
          const notifId = 'NOTIF-' + Math.floor(100000 + Math.random() * 900000);
          await setDoc(doc(db, 'notifications', notifId), {
            id: notifId,
            userId: selectedAccount.userId || userId,
            title: `Position Force Closed: ${actualReason}`,
            message: `Position #${trade.id} (${trade.type.toUpperCase()} ${trade.symbol} ${trade.lots} Lots) was closed at $${closePrice} due to ${actualReason}. Realized PnL: $${finalProfit.toFixed(2)}.`,
            type: 'warning',
            read: false,
            createdAt: now
          });
        } catch (nErr) {
          console.warn("Could not save notification log:", nErr);
        }
      }

      // 2. Fetch the latest account document safely to apply balance update
      const accountRef = doc(db, 'accounts', selectedAccount.id);
      const accountSnap = await getDoc(accountRef);
      if (accountSnap.exists()) {
        const accData = accountSnap.data() as TradingAccount;
        const newBalance = Number((accData.balance + finalProfit).toFixed(2));
        const newEquity = Number((accData.equity + finalProfit).toFixed(2));

        let currentStatus = accData.status;
        let currentPhase = accData.phase;

        // Perform active rule checks & save violations to firestore
        await checkRuleViolations(trade, now, finalProfit, newBalance, accData);

        // Profit Target Validation (Only for active evaluated challenges)
        const effectiveTarget = accData.accountType === 'payout_later' ? accData.startingBalance * 0.08 : accData.profitTarget;
        if (currentStatus === 'active' && effectiveTarget > 0) {
          const currentProfit = newBalance - accData.startingBalance;
          if (currentProfit >= effectiveTarget) {
            const userEmail = accData.userEmail || userProfile?.email || '';
            const passedIso = new Date().toISOString();

            if (accData.accountType === 'one_step') {
              currentStatus = 'PHASE2_PENDING';
              await updateDoc(accountRef, {
                balance: newBalance,
                equity: newEquity,
                status: 'PHASE2_PENDING',
                phaseStatus: 'phase2_pending',
                passedAt: passedIso
              });

              // Create user notification
              const notifId = 'NOTIF-' + Math.floor(100000 + Math.random() * 900000);
              await setDoc(doc(db, 'notifications', notifId), {
                id: notifId,
                userId: accData.userId,
                title: '1-Step Challenge Passed! 🚀',
                message: `Congratulations! Your account has successfully passed Phase 1 on Account #${accData.login || accData.id}. Please wait for admin review and activation.`,
                type: 'info',
                read: false,
                createdAt: passedIso
              });

              // Queue review email
              if (userEmail) {
                const queueId = `queue-rev-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                await setDoc(doc(db, 'email_queue', queueId), {
                  id: queueId,
                  recipient: userEmail,
                  subject: 'ATFunding: 1-Step Challenge Passed - PHASE 2 PENDING',
                  message: `Hello Trader,\n\nCongratulations! Your account has successfully passed Phase 1 on Account #${accData.login || accData.id}.\n\nPlease wait for admin review and activation.\n\nATFunding Compliance Team`,
                  createdAt: passedIso,
                  status: 'pending'
                });
              }

              setSuccessMsg("CONGRATULATIONS! Your account has successfully passed Phase 1. Please wait for admin review and activation.");
              setRuleBreachModal({
                isOpen: true,
                title: '🟡 PHASE 2 PENDING',
                subtitle: 'Phase 1 Passed Successfully',
                type: 'success',
                message: `Your account has successfully passed Phase 1.`,
                details: `Please wait for admin review and activation. Trading on this account is disabled until admin review and activation.`
              });
              onRefreshAccount();
              return;

            } else if (accData.accountType === 'two_step') {
              if (accData.phase === 1) {
                currentStatus = 'PHASE2_PENDING';
                await updateDoc(accountRef, {
                  balance: newBalance,
                  equity: newEquity,
                  status: 'PHASE2_PENDING',
                  phaseStatus: 'phase2_pending',
                  passedAt: passedIso
                });

                // Create user notification
                const notifId = 'NOTIF-' + Math.floor(100000 + Math.random() * 900000);
                await setDoc(doc(db, 'notifications', notifId), {
                  id: notifId,
                  userId: accData.userId,
                  title: 'Phase 1 Passed! 🚀',
                  message: `Your account has successfully passed Phase 1 on Account #${accData.login || accData.id}. Please wait for admin review and activation.`,
                  type: 'info',
                  read: false,
                  createdAt: passedIso
                });

                // Queue review email
                if (userEmail) {
                  const queueId = `queue-rev-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                  await setDoc(doc(db, 'email_queue', queueId), {
                    id: queueId,
                    recipient: userEmail,
                    subject: 'ATFunding: Phase 1 Passed - PHASE 2 PENDING',
                    message: `Hello Trader,\n\nYour account has successfully passed Phase 1 on Account #${accData.login || accData.id}.\n\nPlease wait for admin review and activation.\n\nATFunding Compliance Team`,
                    createdAt: passedIso,
                    status: 'pending'
                  });
                }

                setSuccessMsg("CONGRATULATIONS! Your account has successfully passed Phase 1. Please wait for admin review and activation.");
                setRuleBreachModal({
                  isOpen: true,
                  title: '🟡 PHASE 2 PENDING',
                  subtitle: 'Phase 1 Passed Successfully',
                  type: 'success',
                  message: `Your account has successfully passed Phase 1.`,
                  details: `Please wait for admin review and activation.`
                });
                onRefreshAccount();
                return;
              } else if (accData.phase === 2) {
                currentStatus = 'FUNDED_PENDING';
                await updateDoc(accountRef, {
                  balance: newBalance,
                  equity: newEquity,
                  status: 'FUNDED_PENDING',
                  phaseStatus: 'funded_pending',
                  passedAt: passedIso
                });

                // Create user notification
                const notifId = 'NOTIF-' + Math.floor(100000 + Math.random() * 900000);
                await setDoc(doc(db, 'notifications', notifId), {
                  id: notifId,
                  userId: accData.userId,
                  title: 'Phase 2 Passed! 🏆',
                  message: `Congratulations! Your account has successfully passed Phase 2 on Account #${accData.login || accData.id}. Please wait for admin approval and funded account activation.`,
                  type: 'info',
                  read: false,
                  createdAt: passedIso
                });

                // Queue review email
                if (userEmail) {
                  const queueId = `queue-rev-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                  await setDoc(doc(db, 'email_queue', queueId), {
                    id: queueId,
                    recipient: userEmail,
                    subject: 'ATFunding: Phase 2 Passed - FUNDED PENDING',
                    message: `Hello Trader,\n\nCongratulations! Your account has successfully passed Phase 2 on Account #${accData.login || accData.id}.\n\nPlease wait for admin approval and funded account activation.\n\nATFunding Compliance Team`,
                    createdAt: passedIso,
                    status: 'pending'
                  });
                }

                setSuccessMsg("CONGRATULATIONS! Your account has successfully passed Phase 2. Please wait for admin approval and funded account activation.");
                setRuleBreachModal({
                  isOpen: true,
                  title: '🟢 FUNDED PENDING',
                  subtitle: 'Phase 2 Passed Successfully',
                  type: 'success',
                  message: `Congratulations! Your account has successfully passed Phase 2.`,
                  details: `Please wait for admin approval and funded account activation.`
                });
                onRefreshAccount();
                return;
              }
            } else if (accData.accountType === 'payout_later') {
              currentStatus = 'pending_review';
              await updateDoc(accountRef, {
                balance: newBalance,
                equity: newEquity,
                status: 'pending_review',
                phaseStatus: 'pending_review',
                passedAt: passedIso
              });

              // Create user notification
              const notifId = 'NOTIF-' + Math.floor(100000 + Math.random() * 900000);
              await setDoc(doc(db, 'notifications', notifId), {
                id: notifId,
                userId: accData.userId,
                title: 'Payout Later Challenge Passed! Review Started 🚀',
                message: `Congratulations! Account #${accData.login || accData.id} completed the Payout Later challenge. Account is now in PENDING REVIEW.`,
                type: 'info',
                read: false,
                createdAt: passedIso
              });

              // Queue review email
              if (userEmail) {
                const queueId = `queue-rev-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
                await setDoc(doc(db, 'email_queue', queueId), {
                  id: queueId,
                  recipient: userEmail,
                  subject: 'ATFunding: Payout Later Challenge Passed - Pending Review',
                  message: `Hello Trader,\n\nCongratulations! You completed the Payout Later Challenge on Account #${accData.login || accData.id}.\n\nYour account is now undergoing manual review. Upon admin approval, your payout account will be activated.\n\nATFunding Compliance Team`,
                  createdAt: passedIso,
                  status: 'pending'
                });
              }

              setSuccessMsg("CONGRATULATIONS! You completed your Payout Later challenge. Account is in Pending Review!");
              setRuleBreachModal({
                isOpen: true,
                title: '🎉 Payout Later Challenge Complete!',
                subtitle: 'Account Status: Pending Review',
                type: 'success',
                message: `Outstanding job! You completed the Payout Later challenge on Account #${accData.login || accData.id}.`,
                details: `Your account is now in Pending Review. Once approved by our team, your payout account will be activated immediately.`
              });
              onRefreshAccount();
              return;
            }
          }
        }

        await updateDoc(accountRef, {
          balance: newBalance,
          equity: newEquity,
          status: currentStatus,
          phase: currentPhase,
          passedAt: currentStatus === 'passed' ? now : accData.passedAt || null,
          ...(accData.accountType === 'instant_bolt' ? { lastTradeClosedAt: now } : {})
        });

        if (currentStatus === 'passed') {
          setSuccessMsg("CONGRATULATIONS! You passed your prop firm evaluation challenge and achieved Funded Status!");
        }
      }
      onRefreshAccount();
    } catch (e) {
      console.error("Error executing direct close:", e);
    }
  };

  // Send warning notice ⚠️ to Admin Panel (Account remains active, no liquidation)
  const handleBreachAccount = async (reason: string) => {
    if (!selectedAccount) return;
    try {
      const violationId = 'VIO-' + Math.floor(100000 + Math.random() * 900000);
      const uEmail = selectedAccount.userEmail || userProfile?.email || 'trader@atfunding.io';
      const uName = userProfile?.name || userProfile?.displayName || 'Elite Trader';

      // Insert record in 'ruleViolations' collection for Admin Panel
      await setDoc(doc(db, 'ruleViolations', violationId), {
        id: violationId,
        accountId: selectedAccount.id,
        accountNumber: selectedAccount.login || selectedAccount.id,
        userId: selectedAccount.userId || userId,
        userName: uName,
        userEmail: uEmail,
        violationType: reason.includes('⚠️') ? reason : `${reason} ⚠️`,
        description: `Risk threshold alert detected: ${reason}. Warning ⚠️ logged in Admin Panel for review. Account remains ACTIVE.`,
        status: 'Warning',
        timestamp: new Date().toISOString()
      });

      // Show warning popup modal to trader (Account is NOT breached and NOT liquidated)
      setRuleBreachModal({
        isOpen: true,
        title: '⚠️ Risk & Rule Warning Notice',
        subtitle: reason,
        type: 'warning',
        message: `Rule / Risk Alert: ${reason}.`,
        details: `Your account remains ACTIVE. A warning notice ⚠️ has been logged in the Admin Panel for manual administrative review.`
      });

      setErrorMsg(`WARNING ⚠️: ${reason}. Notice logged in Admin Panel.`);
      onRefreshAccount();
    } catch (e) {
      console.error("Error logging warning notice:", e);
    }
  };

  // Evaluate rule violations
  const checkRuleViolations = async (trade: Trade, closeTimeStr: string, finalProfit: number, updatedBalance: number, accData: TradingAccount) => {
    const isOneStep = accData.accountType === 'one_step';
    const isTwoStep = accData.accountType === 'two_step';
    const isPayoutLater = accData.accountType === 'payout_later';
    
    let dailyLossPctLimit = isOneStep ? 4 : isTwoStep ? 5 : 3;
    let maxLossPctLimit = isOneStep ? 8 : isTwoStep ? 10 : 6;
    let tenMinuteRuleEnabled = true;
    
    if (ruleSettings) {
      if (isOneStep) {
        dailyLossPctLimit = ruleSettings.oneStepDailyLoss ?? 4;
        maxLossPctLimit = ruleSettings.oneStepMaxLoss ?? 8;
        tenMinuteRuleEnabled = ruleSettings.oneStepTenMinuteRule ?? true;
      } else if (isTwoStep) {
        dailyLossPctLimit = ruleSettings.twoStepDailyLoss ?? 5;
        maxLossPctLimit = ruleSettings.twoStepMaxLoss ?? 10;
        tenMinuteRuleEnabled = ruleSettings.twoStepTenMinuteRule ?? true;
      } else if (isPayoutLater) {
        dailyLossPctLimit = ruleSettings.payoutLaterDailyLoss ?? 3;
        maxLossPctLimit = ruleSettings.payoutLaterMaxLoss ?? 6;
        tenMinuteRuleEnabled = ruleSettings.payoutLaterTenMinuteRule ?? true;
      }
    }
    
    const dailyStarting = accData.dailyStartingBalance || accData.startingBalance;
    const dailyLossAmount = dailyStarting - updatedBalance;
    const maxLossAmount = accData.startingBalance - updatedBalance;
    
    const currentDailyLossPct = (dailyLossAmount / dailyStarting) * 100;
    const currentMaxLossPct = (maxLossAmount / accData.startingBalance) * 100;
    
    const vId = () => 'VIO-' + Math.floor(100000 + Math.random() * 900000);
    const uName = userProfile?.name || userProfile?.displayName || 'Elite Trader';
    const uEmail = userProfile?.email || 'trader@atfunding.io';
    
    // Check 2-Minute Hold Rule for ATF Instant Accounts
    if (accData.accountType === 'instant_bolt' && accData.holdRuleEnabled !== false && accData.remove2MinuteRule !== true && accData.holdRuleUpgradePurchased !== true) {
      const openTime = new Date(trade.openTime).getTime();
      const closeTime = new Date(closeTimeStr).getTime();
      const durationSeconds = Math.round((closeTime - openTime) / 1000);
      
      if (durationSeconds < 120) {
        const violationId = vId();
        const cooldownIso = new Date(Date.now() + 10 * 60 * 1000).toISOString();

        await setDoc(doc(db, 'ruleViolations', violationId), {
          id: violationId,
          accountId: accData.id,
          accountNumber: accData.login,
          userId: accData.userId,
          userName: uName,
          userEmail: uEmail,
          tradeId: trade.id,
          symbol: trade.symbol,
          type: trade.type,
          lots: trade.lots,
          openTime: trade.openTime,
          closeTime: closeTimeStr,
          durationSeconds: durationSeconds,
          violationType: '2 Minute Hold Rule',
          description: `Trade ${trade.id} on ${trade.symbol} (${trade.lots} lots) closed in ${durationSeconds}s (less than 2 minutes / 120s). 10-minute calm down cooldown activated.`,
          status: 'Warning',
          timestamp: new Date().toISOString()
        });

        // Set cooldown on account document in Firestore
        await updateDoc(doc(db, 'accounts', accData.id), {
          lastTradeClosedAt: closeTimeStr,
          cooldownUntil: cooldownIso
        });

        // Show prominent warning popup modal to trader
        setRuleBreachModal({
          isOpen: true,
          title: '⚠️ Rule Violation Warning: 2-Minute Rule Breached!',
          subtitle: '👇 Instant Account 10-Minute Calm Down Cooldown Active',
          type: 'warning',
          message: `You closed Trade #${trade.id} on ${trade.symbol} (${trade.lots} lots) in ${durationSeconds} seconds, which is less than the required 2 minutes (120 seconds).`,
          details: `As per Instant Account trading rules, closing trades under 2 minutes is strictly prohibited. A 10-minute calm down cooldown period has been placed on your account. You will not be able to place new trades for the next 10 minutes. This violation has been logged to the Admin Panel.`
        });

        setErrorMsg(`WARNING: Trade closed in ${durationSeconds}s (<2 minutes). 10-Minute Calm Down Cooldown Activated.`);
      }
    }

    // Check 10-Minute Pacing Rule Violation
    if (tenMinuteRuleEnabled) {
      const openTime = new Date(trade.openTime).getTime();
      const closeTime = new Date(closeTimeStr).getTime();
      const differenceMs = closeTime - openTime;
      const tenMinutesMs = 10 * 60 * 1000;
      
      if (differenceMs < tenMinutesMs) {
        const violationId = vId();
        await setDoc(doc(db, 'ruleViolations', violationId), {
          id: violationId,
          accountId: accData.id,
          userId: accData.userId,
          userName: uName,
          userEmail: uEmail,
          violationType: '10-Minute Pacing Rule',
          description: `Trade ${trade.id} on ${trade.symbol} was opened and closed in ${Math.round(differenceMs / 1000)} seconds, violating the 10-minute minimum duration rule.`,
          tradeId: trade.id,
          status: 'Warning',
          timestamp: new Date().toISOString()
        });
      }
    }
    
    // Daily Loss Limit Violation -> Send Warning ⚠️ to Admin Panel
    if (currentDailyLossPct >= dailyLossPctLimit) {
      const violationId = vId();
      await setDoc(doc(db, 'ruleViolations', violationId), {
        id: violationId,
        accountId: accData.id,
        accountNumber: accData.login || accData.id,
        userId: accData.userId,
        userName: uName,
        userEmail: uEmail,
        violationType: 'Daily Drawdown Limit Exceeded ⚠️',
        description: `Daily loss of ${currentDailyLossPct.toFixed(2)}% exceeded allowed limit of ${dailyLossPctLimit}%. Warning notice ⚠️ logged in Admin Panel for review. Account remains ACTIVE.`,
        tradeId: trade.id,
        status: 'Warning',
        timestamp: new Date().toISOString()
      });
    }
    
    // Max Loss Limit Violation -> Send Warning ⚠️ to Admin Panel
    if (currentMaxLossPct >= maxLossPctLimit) {
      const violationId = vId();
      await setDoc(doc(db, 'ruleViolations', violationId), {
        id: violationId,
        accountId: accData.id,
        accountNumber: accData.login || accData.id,
        userId: accData.userId,
        userName: uName,
        userEmail: uEmail,
        violationType: 'Max Drawdown Limit Exceeded ⚠️',
        description: `Overall max loss of ${currentMaxLossPct.toFixed(2)}% exceeded allowed limit of ${maxLossPctLimit}%. Warning notice ⚠️ logged in Admin Panel for review. Account remains ACTIVE.`,
        tradeId: trade.id,
        status: 'Warning',
        timestamp: new Date().toISOString()
      });
    }
  };

  // 4. Open Trade Position Execution Handler
  const handleExecuteTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current || isExecuting) return;

    if (!selectedAccount) {
      setErrorMsg("Please select an active trading account first.");
      return;
    }

    const isExpired = selectedAccount.accountType === 'trial' && selectedAccount.expiresAt && new Date(selectedAccount.expiresAt).getTime() < Date.now();
    if (selectedAccount.status !== 'active' || isExpired) {
      setErrorMsg(isExpired ? "AT Trial account has expired after 15 days." : "This account is not active. Execution disabled.");
      return;
    }

    if (lots <= 0) {
      setErrorMsg("Position lots volume must be greater than zero.");
      return;
    }

    // 10-Minute Calm Down Cooldown Check for Instant Accounts
    if (selectedAccount.accountType === 'instant_bolt' && (selectedAccount.lastTradeClosedAt || selectedAccount.cooldownUntil)) {
      const cooldownUntilTime = selectedAccount.cooldownUntil ? new Date(selectedAccount.cooldownUntil).getTime() : 0;
      const lastCloseTime = selectedAccount.lastTradeClosedAt ? new Date(selectedAccount.lastTradeClosedAt).getTime() : 0;
      const now = Date.now();

      let remainingMs = 0;
      if (cooldownUntilTime > now) {
        remainingMs = cooldownUntilTime - now;
      } else if (lastCloseTime > 0) {
        const cooldownMs = 10 * 60 * 1000;
        const elapsedMs = now - lastCloseTime;
        if (elapsedMs < cooldownMs) {
          remainingMs = cooldownMs - elapsedMs;
        }
      }

      if (remainingMs > 0) {
        const remainingSec = Math.ceil(remainingMs / 1000);
        const remainingMin = Math.floor(remainingSec / 60);
        const remSecFormatted = remainingSec % 60;
        const cooldownStr = remainingMin > 0 ? `${remainingMin}m ${remSecFormatted}s` : `${remainingSec}s`;

        setErrorMsg(`🚫 10-Minute Calm Down Cooldown Active. Please wait ${cooldownStr} before opening a new trade.`);

        setRuleBreachModal({
          isOpen: true,
          title: '🚫 Trade Blocked: 10-Minute Cooldown Active',
          subtitle: `👇 Calm Down Timer Remaining: ${cooldownStr}`,
          type: 'cooldown',
          message: `Your account is currently in a 10-minute calm down cooldown.`,
          details: `This cooldown period is active on your Instant Account following a 2-minute hold rule violation or trade closure. Please wait ${cooldownStr} before attempting to execute another trade.`
        });

        // Record warning log in Firestore ruleViolations
        const violationId = 'VIO-' + Math.floor(100000 + Math.random() * 900000);
        const uName = userProfile?.name || userProfile?.displayName || 'Trader';
        const uEmail = userProfile?.email || 'trader@atfunding.io';
        await setDoc(doc(db, 'ruleViolations', violationId), {
          id: violationId,
          accountId: selectedAccount.id,
          accountNumber: selectedAccount.login,
          userId: selectedAccount.userId,
          userName: uName,
          userEmail: uEmail,
          symbol: selectedSymbol.symbol,
          type: tradeType,
          lots: Number(lots),
          violationType: '10 Minute Cooldown',
          description: `Attempted trade placement on ${selectedSymbol.symbol} during 10-minute cooldown period (${cooldownStr} remaining).`,
          status: 'Warning',
          timestamp: new Date().toISOString()
        });

        return;
      }
    }

    // Maximum Position Size Rule Enforcement
    const accountSizeVal = selectedAccount.size || selectedAccount.startingBalance || 10000;
    const maxLotAllowed = getMaxLotSize(accountSizeVal);
    if (Number(lots) > maxLotAllowed + 0.001) {
      setErrorMsg(`🚫 Max Lot Limit Exceeded: Maximum allowed position size for a $${accountSizeVal.toLocaleString()} account is ${maxLotAllowed} Lots (Attempted: ${lots} Lots).`);

      setRuleBreachModal({
        isOpen: true,
        title: '🚫 Order Blocked: Oversized Position',
        subtitle: `Maximum Position Size Allowed: ${maxLotAllowed} Lots | Attempted: ${lots} Lots`,
        type: 'rule',
        message: `Your position size of ${lots} Lots exceeds the max lot limit of ${maxLotAllowed} Lots for your $${accountSizeVal.toLocaleString()} account size.`,
        details: `Maximum Lot Limits: $10k Account = 0.20 Lots max; $25k Account = 0.50 Lots max; $50k Account = 1.00 Lot max; $100k Account = 2.00 Lots max.`
      });

      // Record rule violation in Firestore
      const violationId = 'VIO-LOT-' + Math.floor(100000 + Math.random() * 900000);
      const uName = userProfile?.name || userProfile?.displayName || 'Trader';
      const uEmail = userProfile?.email || 'trader@atfunding.io';
      await setDoc(doc(db, 'ruleViolations', violationId), {
        id: violationId,
        accountId: selectedAccount.id,
        accountNumber: selectedAccount.login || selectedAccount.id,
        userId: selectedAccount.userId,
        userName: uName,
        userEmail: uEmail,
        symbol: selectedSymbol.symbol,
        type: tradeType,
        lots: Number(lots),
        violationType: 'Oversized Position Size Blocked',
        description: `Attempted ${lots} Lots on $${accountSizeVal.toLocaleString()} account (Max allowed: ${maxLotAllowed} Lots).`,
        status: 'Blocked',
        timestamp: new Date().toISOString()
      });
      return;
    }

    // Check Free Margin before order execution
    const activePrice = tradeType === 'buy' ? activeSelectedSymbol.ask : activeSelectedSymbol.bid;
    const requiredMargin = calculatePositionMargin(selectedSymbol.symbol, Number(lots), activePrice, selectedAccount.accountType);

    if (requiredMargin > metrics.freeMargin) {
      const formattedReq = requiredMargin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const formattedFree = metrics.freeMargin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      setErrorMsg(`🚫 Order Rejected: Insufficient Free Margin. Required: $${formattedReq}, Free Margin: $${formattedFree}.`);

      setRuleBreachModal({
        isOpen: true,
        title: '🚫 Order Blocked: Insufficient Free Margin',
        subtitle: `Required Margin: $${formattedReq} | Available Free Margin: $${formattedFree}`,
        type: 'margin',
        message: `You do not have enough free margin to open ${lots} lot(s) on ${selectedSymbol.symbol}.`,
        details: `Your current Free Margin is $${formattedFree}. Opening ${lots} lot(s) on ${selectedSymbol.symbol} at $${activePrice} requires $${formattedReq} in margin.`
      });
      return;
    }

    isSubmittingRef.current = true;
    setIsExecuting(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const result = await executeOrder({
        accountId: selectedAccount.id,
        userId,
        symbol: selectedSymbol.symbol,
        direction: tradeType,
        volume: Number(lots),
        tp,
        sl,
        accountType: selectedAccount.accountType,
        freeMargin: metrics.freeMargin
      });

      if (result.success) {
        setSuccessMsg(result.message);
        setTp('');
        setSl('');
        if (result.entryPrice !== undefined) {
          setLastExecutionPrice(result.entryPrice);
        }
      } else {
        setErrorMsg(result.message);
      }
    } catch (error) {
      console.error("Error creating trade:", error);
      setErrorMsg("Could not process order.");
    } finally {
      isSubmittingRef.current = false;
      setIsExecuting(false);
    }
  };

  // Close complete position (reading strictly from centralized priceEngine)
  const handleCloseTrade = async (trade: Trade) => {
    const symData = priceEngine[trade.symbol];
    const exitPrice = symData ? (trade.type === 'buy' ? symData.bid : symData.ask) : trade.openPrice;
    setLastExecutionPrice(exitPrice);
    await executeDirectClose(trade, exitPrice, 'Manual Market Close');
  };

  // 5. Partial Close Implementation
  const handleOpenPartialModal = (trade: Trade) => {
    setPartialCloseTrade(trade);
    setPartialLots(Number((trade.lots / 2).toFixed(2)) || 0.01);
    setPartialCloseError('');
  };

  const handleExecutePartialClose = async () => {
    if (!partialCloseTrade || !selectedAccount) return;

    if (partialLots <= 0 || partialLots >= partialCloseTrade.lots) {
      setPartialCloseError(`Volume must be between 0.01 and ${Number((partialCloseTrade.lots - 0.01).toFixed(2))} Lots.`);
      return;
    }

    try {
      const symData = priceEngine[partialCloseTrade.symbol];
      const exitPrice = symData ? (partialCloseTrade.type === 'buy' ? symData.bid : symData.ask) : partialCloseTrade.openPrice;
      
      const totalFloatingPnL = calculateTradePnL(
        partialCloseTrade.symbol,
        partialCloseTrade.type,
        partialCloseTrade.openPrice,
        partialCloseTrade.lots,
        symData?.bid ?? partialCloseTrade.openPrice,
        symData?.ask ?? partialCloseTrade.openPrice
      );
      const closedProfit = Number((totalFloatingPnL * (partialLots / partialCloseTrade.lots)).toFixed(2));
      const now = new Date().toISOString();

      // 1. Log the closed partial portion as a finalized historic trade
      const historyId = 'TR-' + Math.floor(100000 + Math.random() * 900000);
      await setDoc(doc(db, 'trades', historyId), {
        ...partialCloseTrade,
        id: historyId,
        lots: Number(partialLots.toFixed(2)),
        status: 'closed',
        closePrice: exitPrice,
        closeTime: now,
        profit: closedProfit,
        comment: `Partial Close (${partialLots} of ${partialCloseTrade.lots} Lots)`
      });

      // 2. Update remaining volume of the active position
      const remainingLots = Number((partialCloseTrade.lots - partialLots).toFixed(2));
      await updateDoc(doc(db, 'trades', partialCloseTrade.id), {
        lots: remainingLots
      });

      // 3. Update account balance with realized portion
      const accountRef = doc(db, 'accounts', selectedAccount.id);
      const accountSnap = await getDoc(accountRef);
      if (accountSnap.exists()) {
        const accData = accountSnap.data() as TradingAccount;
        const newBalance = Number((accData.balance + closedProfit).toFixed(2));
        const newEquity = Number((accData.equity + closedProfit).toFixed(2));

        // Evaluate rules with this realized partial gain/loss
        await checkRuleViolations(partialCloseTrade, now, closedProfit, newBalance, accData);

        await updateDoc(accountRef, {
          balance: newBalance,
          equity: newEquity
        });
      }

      setLastExecutionPrice(exitPrice);
      setSuccessMsg(`Partially closed ${partialLots} Lots on ${partialCloseTrade.symbol}. Realized $${closedProfit}`);
      setPartialCloseTrade(null);
      onRefreshAccount();
    } catch (err) {
      console.error("Error executing partial close:", err);
      setPartialCloseError("Failed to partial close.");
    }
  };

  // Quick preset assistants for Stop Loss / Take Profit
  const applyQuickOffset = (pips: number, type: 'tp' | 'sl') => {
    const isBuy = tradeType === 'buy';
    const entryPrice = isBuy ? selectedSymbol.ask : selectedSymbol.bid;
    const pipVal = getPipValue(selectedSymbol.symbol);

    let offsetPrice = 0;
    if (type === 'tp') {
      offsetPrice = isBuy ? (entryPrice + pips * pipVal) : (entryPrice - pips * pipVal);
      setTp(offsetPrice.toFixed(DECIMAL_PLACES[selectedSymbol.symbol]));
    } else {
      offsetPrice = isBuy ? (entryPrice - pips * pipVal) : (entryPrice + pips * pipVal);
      setSl(offsetPrice.toFixed(DECIMAL_PLACES[selectedSymbol.symbol]));
    }
  };

  // SL/TP modification handler functions
  const handleOpenModifySlTpModal = (trade: Trade) => {
    setModifyingSlTpTrade(trade);
    const existingSl = trade.stopLoss != null ? String(trade.stopLoss) : (trade.sl ? String(trade.sl) : '');
    const existingTp = trade.takeProfit != null ? String(trade.takeProfit) : (trade.tp ? String(trade.tp) : '');
    setEditSlInput(existingSl);
    setEditTpInput(existingTp);
    setEditSlTpError('');
  };

  const handleSaveModifySlTp = async () => {
    if (!modifyingSlTpTrade || !selectedAccount) return;
    setIsSavingSlTp(true);
    setEditSlTpError('');

    try {
      const symData = priceEngine[modifyingSlTpTrade.symbol];
      const livePrice = symData ? (modifyingSlTpTrade.type === 'buy' ? symData.bid : symData.ask) : modifyingSlTpTrade.openPrice;

      const parsedTp = editTpInput.trim() !== '' ? parseFloat(editTpInput) : null;
      const parsedSl = editSlInput.trim() !== '' ? parseFloat(editSlInput) : null;

      if (parsedTp !== null && !isNaN(parsedTp)) {
        if (modifyingSlTpTrade.type === 'buy' && parsedTp <= modifyingSlTpTrade.openPrice) {
          setEditSlTpError(`Take Profit ($${parsedTp}) must be higher than entry price ($${modifyingSlTpTrade.openPrice}) for BUY position.`);
          setIsSavingSlTp(false);
          return;
        }
        if (modifyingSlTpTrade.type === 'sell' && parsedTp >= modifyingSlTpTrade.openPrice) {
          setEditSlTpError(`Take Profit ($${parsedTp}) must be lower than entry price ($${modifyingSlTpTrade.openPrice}) for SELL position.`);
          setIsSavingSlTp(false);
          return;
        }
      }

      if (parsedSl !== null && !isNaN(parsedSl)) {
        if (modifyingSlTpTrade.type === 'buy' && parsedSl >= modifyingSlTpTrade.openPrice) {
          setEditSlTpError(`Stop Loss ($${parsedSl}) must be lower than entry price ($${modifyingSlTpTrade.openPrice}) for BUY position.`);
          setIsSavingSlTp(false);
          return;
        }
        if (modifyingSlTpTrade.type === 'sell' && parsedSl <= modifyingSlTpTrade.openPrice) {
          setEditSlTpError(`Stop Loss ($${parsedSl}) must be higher than entry price ($${modifyingSlTpTrade.openPrice}) for SELL position.`);
          setIsSavingSlTp(false);
          return;
        }
      }

      const updatePayload = {
        tp: parsedTp !== null ? String(parsedTp) : '',
        sl: parsedSl !== null ? String(parsedSl) : '',
        takeProfit: parsedTp,
        stopLoss: parsedSl,
      };

      await updateDoc(doc(db, 'trades', modifyingSlTpTrade.id), updatePayload);

      setOpenTrades(prev => prev.map(t => {
        if (t.id === modifyingSlTpTrade.id) {
          return {
            ...t,
            ...updatePayload
          };
        }
        return t;
      }));

      setSuccessMsg(`SL/TP updated for Trade #${modifyingSlTpTrade.id} (${modifyingSlTpTrade.symbol})`);
      setModifyingSlTpTrade(null);
    } catch (err: any) {
      console.error("Failed to update SL/TP:", err);
      setEditSlTpError(`Failed to update SL/TP: ${err.message || String(err)}`);
    } finally {
      setIsSavingSlTp(false);
    }
  };

  const getCloseReasonBadge = (reason?: string) => {
    const r = reason || 'Manual Close';
    if (r.includes('Take Profit')) {
      return <span className="px-2 py-0.5 rounded text-[9px] font-bold font-mono bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">{r}</span>;
    }
    if (r.includes('Stop Loss')) {
      return <span className="px-2 py-0.5 rounded text-[9px] font-bold font-mono bg-rose-500/15 text-rose-400 border border-rose-500/20">{r}</span>;
    }
    if (r.includes('Daily Drawdown')) {
      return <span className="px-2 py-0.5 rounded text-[9px] font-bold font-mono bg-amber-500/15 text-amber-400 border border-amber-500/20">{r}</span>;
    }
    if (r.includes('Max Drawdown')) {
      return <span className="px-2 py-0.5 rounded text-[9px] font-bold font-mono bg-red-600/20 text-red-400 border border-red-500/30">{r}</span>;
    }
    if (r.includes('Margin')) {
      return <span className="px-2 py-0.5 rounded text-[9px] font-bold font-mono bg-purple-500/15 text-purple-300 border border-purple-500/20">{r}</span>;
    }
    if (r.includes('Breach')) {
      return <span className="px-2 py-0.5 rounded text-[9px] font-bold font-mono bg-pink-500/15 text-pink-400 border border-pink-500/20">{r}</span>;
    }
    return <span className="px-2 py-0.5 rounded text-[9px] font-bold font-mono bg-slate-500/15 text-slate-300 border border-slate-500/20">{r}</span>;
  };

  const generateAuditReportText = () => {
    const nowStr = new Date().toISOString();
    const accId = selectedAccount?.login || selectedAccount?.id || 'N/A';
    const accType = selectedAccount?.accountType || 'Standard';

    let lines = [
      `=====================================================`,
      `CRITICAL TRADING TERMINAL AUTO-CLOSE AUDIT REPORT`,
      `=====================================================`,
      `Generated At: ${nowStr}`,
      `Account ID: ${accId} (${accType})`,
      `User ID: ${userId}`,
      `Total Closed Positions Audited: ${closedTrades.length}`,
      `-----------------------------------------------------`,
      ``
    ];

    if (closedTrades.length === 0) {
      lines.push(`No closed trades recorded for this account yet.`);
    } else {
      closedTrades.forEach((t, idx) => {
        const reason = t.closeReason || t.comment || 'Manual Close';
        const rule = t.triggeredRule || (reason.includes('Protection') ? reason : 'Manual Execution');
        const tpVal = t.takeProfit != null ? `$${t.takeProfit}` : (t.tp ? `$${t.tp}` : 'None');
        const slVal = t.stopLoss != null ? `$${t.stopLoss}` : (t.sl ? `$${t.sl}` : 'None');

        lines.push(`[Position #${idx + 1} | ID: ${t.id}]`);
        lines.push(`- Account ID: ${t.accountId || accId}`);
        lines.push(`- Position ID: ${t.id}`);
        lines.push(`- Symbol / Direction: ${t.symbol} (${(t.type || 'buy').toUpperCase()} ${t.lots} Lots)`);
        lines.push(`- Entry Price: $${t.openPrice} | Exit Price: $${t.closePrice ?? 'N/A'}`);
        lines.push(`- Set TP: ${tpVal} | Set SL: ${slVal}`);
        lines.push(`- Realized PnL: $${(t.profit || 0).toFixed(2)}`);
        lines.push(`- Close Reason: ${reason}`);
        lines.push(`- Triggered Rule: ${rule}`);
        lines.push(`- Time of Closure: ${t.closeTime || 'N/A'}`);
        lines.push(`-----------------------------------------------------`);
      });
    }

    lines.push(``);
    lines.push(`=====================================================`);
    lines.push(`END OF AUDIT REPORT`);
    lines.push(`=====================================================`);

    return lines.join('\n');
  };

  const handleCopyAuditReport = () => {
    const text = generateAuditReportText();
    navigator.clipboard.writeText(text);
    setCopiedReport(true);
    setTimeout(() => setCopiedReport(false), 2500);
  };

  // Rule Metrics Trackers
  const getDailyDrawdownProgress = () => {
    if (!selectedAccount) return { pct: 0, rem: 0, rawLoss: 0 };
    const limit = selectedAccount.dailyDrawdownLimit;
    const dailyLoss = selectedAccount.dailyStartingBalance - metrics.equity;
    const remaining = Number((limit - dailyLoss).toFixed(2));
    const percentUsed = Number(Math.min(100, Math.max(0, (dailyLoss / limit) * 100)).toFixed(1));
    return {
      pct: isFinite(percentUsed) ? percentUsed : 0,
      rem: Math.max(0, remaining),
      rawLoss: dailyLoss
    };
  };

  const getMaxDrawdownProgress = () => {
    if (!selectedAccount) return { pct: 0, rem: 0, rawLoss: 0 };
    const limit = selectedAccount.maxDrawdownLimit;
    const maxLoss = selectedAccount.startingBalance - metrics.equity;
    const remaining = Number((limit - maxLoss).toFixed(2));
    const percentUsed = Number(Math.min(100, Math.max(0, (maxLoss / limit) * 100)).toFixed(1));
    return {
      pct: isFinite(percentUsed) ? percentUsed : 0,
      rem: Math.max(0, remaining),
      rawLoss: maxLoss
    };
  };

  const getProfitTargetProgress = () => {
    if (!selectedAccount) return { pct: 0, rem: 0, reached: true };
    const target = selectedAccount.accountType === 'payout_later' ? selectedAccount.startingBalance * 0.08 : selectedAccount.profitTarget;
    if (target <= 0) return { pct: 0, rem: 0, reached: true };
    const netProfit = metrics.balance - selectedAccount.startingBalance;
    const remaining = Number((target - netProfit).toFixed(2));
    const percentReached = Number(Math.min(100, Math.max(0, (netProfit / target) * 100)).toFixed(1));
    return {
      pct: isFinite(percentReached) ? percentReached : 0,
      rem: Math.max(0, remaining),
      reached: netProfit >= target
    };
  };

  const getTradingDaysProgress = () => {
    if (!selectedAccount) return { current: 0, required: 0, pct: 0 };
    const requiredDays = selectedAccount.accountType === 'payout_later' ? 4 : 4; // standard 4 min trading days
    const uniqueDays = new Set<string>();
    
    // Accumulate unique dates
    openTrades.forEach(t => { if (t.openTime) uniqueDays.add(t.openTime.split('T')[0]); });
    closedTrades.forEach(t => { if (t.openTime) uniqueDays.add(t.openTime.split('T')[0]); });

    const current = uniqueDays.size;
    const pct = Number(Math.min(100, (current / requiredDays) * 100).toFixed(1));
    return {
      current,
      required: requiredDays,
      pct: isFinite(pct) ? pct : 0
    };
  };

  const dailyDd = getDailyDrawdownProgress();
  const maxDd = getMaxDrawdownProgress();
  const profitTarget = getProfitTargetProgress();
  const tradingDays = getTradingDaysProgress();
  const closedPnL = closedTrades.reduce((sum, t) => sum + (t.profit || 0), 0);

  const isChallengeAccount = Boolean(
    selectedAccount && (selectedAccount.accountType === 'one_step' || selectedAccount.accountType === 'two_step')
  );
  const isPhaseLocked = Boolean(
    isChallengeAccount && selectedAccount && (
      selectedAccount.status === 'PHASE2_PENDING' || selectedAccount.status === 'phase2_pending' ||
      selectedAccount.status === 'FUNDED_PENDING' || selectedAccount.status === 'funded_pending' ||
      selectedAccount.status === 'pending_review' || selectedAccount.status === 'Pending Review'
    )
  );

  return (
    <div id="trading-terminal" className="space-y-6 text-white bg-[#070a13] p-4 md:p-6 rounded-3xl border border-white/5 relative">
      
      {/* 1. Header Information Panel */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-white/5 pb-5">
        <div>
          <div className="flex items-center space-x-2">
            <h2 className="text-xl md:text-2xl font-bold tracking-tight text-white font-sans">Prop-Firm Trading Console</h2>
            {selectedAccount && (
              <span className={`px-2.5 py-1 text-[10px] font-bold font-mono uppercase rounded-full ${
                selectedAccount.status === 'active' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                selectedAccount.status === 'breached' ? 'bg-red-500/10 text-red-400 border border-red-500/20' :
                selectedAccount.status === 'PHASE2_PENDING' || selectedAccount.status === 'phase2_pending' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
                selectedAccount.status === 'FUNDED_PENDING' || selectedAccount.status === 'funded_pending' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                'bg-blue-500/10 text-blue-400 border border-blue-500/20'
              }`}>
                {selectedAccount.status === 'phase2_pending' || selectedAccount.status === 'PHASE2_PENDING' ? 'PHASE 2 PENDING' :
                 selectedAccount.status === 'funded_pending' || selectedAccount.status === 'FUNDED_PENDING' ? 'FUNDED PENDING' :
                 selectedAccount.status}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1">Real-time market execution & prop rules monitor. Liquidations check live.</p>
        </div>

        {selectedAccount && (
          <div className="flex items-center gap-3">
            <div className="text-right">
              <span className="text-[10px] text-slate-500 block">ACCOUNT LOGIN</span>
              <span className="text-xs font-mono font-bold text-slate-300">{selectedAccount.login}</span>
            </div>
            <div className="h-8 w-px bg-white/5" />
            <div className="text-right">
              <span className="text-[10px] text-slate-500 block">TYPE</span>
              <span className="text-xs font-mono font-bold text-blue-400 uppercase">{selectedAccount.accountType.replace('_', ' ')}</span>
            </div>
          </div>
        )}
      </div>

      {!selectedAccount ? (
        <div className="bg-[#0b0f19] border border-white/5 rounded-3xl p-12 text-center max-w-md mx-auto space-y-4 shadow-xl">
          <Lock className="w-10 h-10 text-blue-500 mx-auto animate-pulse" />
          <h3 className="text-base font-bold text-white">Console Session Locked</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Please register or purchase an evaluation package, or choose an active trading account from the accounts drop-down on the sidebar menu.
          </p>
        </div>
      ) : isPhaseLocked ? (
        <div className="bg-[#0b0f19] border-2 border-white/10 rounded-3xl p-8 md:p-12 text-center max-w-2xl mx-auto space-y-6 shadow-2xl backdrop-blur-md">
          {selectedAccount.status === 'PHASE2_PENDING' || selectedAccount.status === 'phase2_pending' ? (
            <>
              <div className="w-16 h-16 rounded-full bg-amber-500/20 border-2 border-amber-500/40 flex items-center justify-center mx-auto text-amber-400 shadow-lg shadow-amber-500/10">
                <Award className="w-8 h-8 animate-bounce" />
              </div>
              <div className="space-y-3">
                <span className="px-4 py-1.5 rounded-full bg-amber-500/20 border border-amber-400/40 text-amber-300 font-black text-xs uppercase tracking-widest inline-block">
                  🟡 PHASE 2 PENDING
                </span>
                <h2 className="text-xl md:text-2xl font-black text-amber-100 uppercase tracking-wide">
                  Your account has successfully passed Phase 1.
                </h2>
                <p className="text-amber-200/90 font-medium text-sm">
                  Please wait for admin review and activation.
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 border-2 border-emerald-500/40 flex items-center justify-center mx-auto text-emerald-400 shadow-lg shadow-emerald-500/10">
                <Award className="w-8 h-8 animate-bounce" />
              </div>
              <div className="space-y-3">
                <span className="px-4 py-1.5 rounded-full bg-emerald-500/20 border border-emerald-400/40 text-emerald-300 font-black text-xs uppercase tracking-widest inline-block">
                  🟢 FUNDED PENDING
                </span>
                <h2 className="text-xl md:text-2xl font-black text-emerald-100 uppercase tracking-wide">
                  Congratulations!
                </h2>
                <p className="text-emerald-100 font-bold text-base">
                  Your account has successfully passed Phase 2.
                </p>
                <p className="text-emerald-200/90 font-medium text-sm">
                  Please wait for admin approval and funded account activation.
                </p>
              </div>
            </>
          )}

          {/* Account Display Summary */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-6 border-t border-white/10 text-left">
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <span className="text-[10px] text-slate-400 uppercase font-bold block tracking-wider">Account Status</span>
              <span className="text-xs font-mono font-extrabold text-amber-300 block mt-1 truncate uppercase">
                {selectedAccount.status === 'PHASE2_PENDING' || selectedAccount.status === 'phase2_pending' ? 'PHASE 2 PENDING' : 'FUNDED PENDING'}
              </span>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <span className="text-[10px] text-slate-400 uppercase font-bold block tracking-wider">Passed Phase</span>
              <span className="text-xs font-mono font-extrabold text-blue-400 block mt-1">
                {selectedAccount.status === 'PHASE2_PENDING' || selectedAccount.status === 'phase2_pending' ? 'Phase 1 Passed' : 'Phase 2 Passed'}
              </span>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <span className="text-[10px] text-slate-400 uppercase font-bold block tracking-wider">Current Balance</span>
              <span className="text-xs font-mono font-extrabold text-white block mt-1">
                ${(selectedAccount.balance || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
              <span className="text-[10px] text-slate-400 uppercase font-bold block tracking-wider">Current Profit</span>
              <span className={`text-xs font-mono font-extrabold block mt-1 ${
                ((selectedAccount.balance || 0) - (selectedAccount.startingBalance || selectedAccount.size || 10000)) >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}>
                ${((selectedAccount.balance || 0) - (selectedAccount.startingBalance || selectedAccount.size || 10000)).toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">

          {/* 2. LIVE METRICS SUMMARY BAR */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {/* Balance Card */}
            <div className="bg-[#0c1122] border border-white/5 rounded-2xl p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-400">
                <Wallet className="w-4.5 h-4.5" />
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Balance</p>
                <p className="text-sm md:text-base font-bold font-mono text-white mt-0.5">
                  ${metrics.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>

            {/* Equity Card */}
            <div className="bg-[#0c1122] border border-white/5 rounded-2xl p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                <Coins className="w-4.5 h-4.5" />
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Equity</p>
                <p className="text-sm md:text-base font-bold font-mono text-white mt-0.5">
                  ${metrics.equity.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>

            {/* Margin Used */}
            <div className="bg-[#0c1122] border border-white/5 rounded-2xl p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400">
                <Percent className="w-4.5 h-4.5" />
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Margin Used</p>
                <p className="text-sm md:text-base font-bold font-mono text-slate-300 mt-0.5">
                  ${metrics.marginUsed.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>

            {/* Free Margin */}
            <div className="bg-[#0c1122] border border-white/5 rounded-2xl p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-teal-500/10 border border-teal-500/20 flex items-center justify-center text-teal-400">
                <Sparkles className="w-4.5 h-4.5" />
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Free Margin</p>
                <p className="text-sm md:text-base font-bold font-mono text-teal-400 mt-0.5">
                  ${metrics.freeMargin.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>

            {/* Floating PnL */}
            <div className={`border rounded-2xl p-4 flex items-center gap-3 ${
              metrics.floatingPnL >= 0 
                ? 'bg-[#0f2421] border-emerald-500/15 text-emerald-400' 
                : 'bg-[#291418] border-red-500/15 text-red-400'
            }`}>
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                metrics.floatingPnL >= 0 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
              }`}>
                <Trophy className="w-4.5 h-4.5" />
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Floating PnL</p>
                <p className="text-sm md:text-base font-bold font-mono mt-0.5">
                  ${metrics.floatingPnL >= 0 ? '+' : ''}{metrics.floatingPnL.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>

            {/* Closed PnL */}
            <div className={`border rounded-2xl p-4 flex items-center gap-3 ${
              closedPnL >= 0 
                ? 'bg-[#0f2421] border-emerald-500/15 text-emerald-400' 
                : 'bg-[#291418] border-red-500/15 text-red-400'
            }`}>
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                closedPnL >= 0 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
              }`}>
                <TrendingUp className="w-4.5 h-4.5" />
              </div>
              <div>
                <p className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Closed PnL</p>
                <p className="text-sm md:text-base font-bold font-mono mt-0.5">
                  ${closedPnL >= 0 ? '+' : ''}{closedPnL.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </p>
              </div>
            </div>
          </div>

          {/* 3. PROP FIRM RULE ENGINE OVERVIEW CARD */}
          <div className="bg-[#0b0f19] border border-white/5 rounded-2xl p-5 space-y-4 shadow-xl relative overflow-hidden">
            <div className="absolute right-4 top-4 opacity-5 pointer-events-none">
              <ShieldAlert className="w-24 h-24" />
            </div>

            <div className="flex justify-between items-center">
              <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-widest flex items-center gap-1.5 font-mono">
                <ShieldAlert className="w-4 h-4 text-blue-400" />
                <span>PROP EVALUATION RULE TRACKER</span>
              </h3>
              <span className="text-[10px] text-slate-400">Target Phase: <span className="text-yellow-400 font-bold font-mono">Phase {selectedAccount.phase}</span></span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 pt-2">
              {/* Daily Drawdown Rule */}
              <div className="bg-[#0e1322] rounded-xl p-3.5 space-y-2 border border-white/5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Daily Drawdown (Limit)</span>
                  <span className="font-mono text-red-400 font-bold">-${selectedAccount.dailyDrawdownLimit.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-end">
                  <span className="text-[10px] text-slate-500">Remaining Loss budget</span>
                  <span className="text-xs font-bold text-white font-mono">${dailyDd.rem.toLocaleString()}</span>
                </div>
                <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                  <div className="bg-red-500 h-full rounded-full transition-all duration-300" style={{ width: `${dailyDd.pct}%` }} />
                </div>
                <div className="flex justify-between text-[9px] text-slate-500">
                  <span>Used: {dailyDd.pct}%</span>
                  <span>Daily Start: ${selectedAccount.dailyStartingBalance.toLocaleString()}</span>
                </div>
              </div>

              {/* Max Drawdown Rule */}
              <div className="bg-[#0e1322] rounded-xl p-3.5 space-y-2 border border-white/5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Max Drawdown (Limit)</span>
                  <span className="font-mono text-red-500 font-bold">-${selectedAccount.maxDrawdownLimit.toLocaleString()}</span>
                </div>
                <div className="flex justify-between items-end">
                  <span className="text-[10px] text-slate-500">Remaining Max Loss</span>
                  <span className="text-xs font-bold text-white font-mono">${maxDd.rem.toLocaleString()}</span>
                </div>
                <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                  <div className="bg-red-600 h-full rounded-full transition-all duration-300" style={{ width: `${maxDd.pct}%` }} />
                </div>
                <div className="flex justify-between text-[9px] text-slate-500">
                  <span>Used: {maxDd.pct}%</span>
                  <span>Initial Start: ${selectedAccount.startingBalance.toLocaleString()}</span>
                </div>
              </div>

              {/* Profit Target Rule */}
              {(() => {
                const targetVal = selectedAccount.accountType === 'payout_later' ? selectedAccount.startingBalance * 0.08 : selectedAccount.profitTarget;
                return (
                  <div className="bg-[#0e1322] rounded-xl p-3.5 space-y-2 border border-white/5">
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Profit Target</span>
                      <span className="font-mono text-emerald-400 font-bold">
                        {targetVal > 0 ? `+$${targetVal.toLocaleString()}` : 'No target'}
                      </span>
                    </div>
                    <div className="flex justify-between items-end">
                      <span className="text-[10px] text-slate-500">
                        {targetVal > 0 ? 'Remaining to target' : 'Net closed profit'}
                      </span>
                      <span className="text-xs font-bold text-white font-mono">
                        ${targetVal > 0 ? profitTarget.rem.toLocaleString() : (metrics.balance - selectedAccount.startingBalance).toLocaleString()}
                      </span>
                    </div>
                    <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                      <div className="bg-emerald-500 h-full rounded-full transition-all duration-300" style={{ width: `${profitTarget.pct}%` }} />
                    </div>
                    <div className="flex justify-between text-[9px] text-slate-500">
                      <span>{targetVal > 0 ? `Progress: ${profitTarget.pct}%` : 'Phase Passed / Active'}</span>
                      <span>Current Profit: ${(metrics.balance - selectedAccount.startingBalance).toLocaleString()}</span>
                    </div>
                  </div>
                );
              })()}

              {/* Trading Days Rule */}
              <div className="bg-[#0e1322] rounded-xl p-3.5 space-y-2 border border-white/5">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">Min Trading Days</span>
                  <span className="font-mono text-blue-400 font-bold">{tradingDays.required} Days</span>
                </div>
                <div className="flex justify-between items-end">
                  <span className="text-[10px] text-slate-500">Unique Active Days</span>
                  <span className="text-xs font-bold text-white font-mono">{tradingDays.current} / {tradingDays.required} Days</span>
                </div>
                <div className="w-full bg-white/5 h-1.5 rounded-full overflow-hidden">
                  <div className="bg-blue-500 h-full rounded-full transition-all duration-300" style={{ width: `${tradingDays.pct}%` }} />
                </div>
                <div className="flex justify-between text-[9px] text-slate-500">
                  <span>Completed: {tradingDays.pct}%</span>
                  <span>Requirements Met: {tradingDays.current >= tradingDays.required ? 'YES' : 'NO'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* 4. MAIN BENTO DIVISION */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            
            {/* LEFT AREA: MARKET WATCH AND ORDER MODULE (Col Span 4) */}
            <div className="lg:col-span-4 space-y-6">
              
              {/* MARKET WATCH PANEL */}
              <div className="bg-[#0b0f19] border border-white/5 rounded-2xl p-4.5 space-y-3.5 shadow-xl">
                <div className="flex justify-between items-center">
                  <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider font-mono">Market Watch</h3>
                  <span className="text-[10px] text-blue-400 flex items-center gap-1">
                    <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-ping" />
                    <span>Live Quoting</span>
                  </span>
                </div>

                <div className="space-y-1.5 max-h-[360px] overflow-y-auto pr-1">
                  {symbols.map((sym) => {
                    const activeSym = priceEngine[sym.symbol] || sym;
                    const isSelected = selectedSymbol.symbol === sym.symbol;
                    const decimals = DECIMAL_PLACES[sym.symbol] || 4;
                    const displaySpread = sym.symbol.includes('JPY') 
                      ? (sym.spread * 100).toFixed(1)
                      : sym.symbol === 'XAUUSD' 
                      ? (sym.spread * 10).toFixed(0)
                      : sym.symbol.includes('USD') 
                      ? (sym.spread * 100000).toFixed(1)
                      : sym.spread.toFixed(1);

                    const spreadLabel = sym.symbol.includes('BTC') || sym.symbol.includes('ETH') || sym.symbol.includes('SOL')
                      ? `$${sym.spread.toFixed(1)}`
                      : `${displaySpread} pips`;

                    return (
                      <div
                        key={sym.symbol}
                        onClick={() => setSelectedSymbol(sym)}
                        className={`flex items-center justify-between p-3 rounded-xl border cursor-pointer transition-all ${
                          isSelected 
                             ? 'border-blue-500 bg-blue-500/10 shadow-lg' 
                             : 'border-white/0 bg-[#0c1122] hover:bg-white/5'
                        }`}
                      >
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-white font-mono">{sym.symbol}</span>
                          <span className="text-[9px] text-slate-500 max-w-[120px] truncate">{sym.name}</span>
                          <span className="text-[8px] font-bold font-mono text-slate-400 uppercase mt-0.5 bg-white/5 px-1 rounded-sm w-fit">
                            Spread: {spreadLabel}
                          </span>
                        </div>
                        
                        <div className="flex gap-3">
                          <div className="text-right">
                            <span className="text-[9px] text-slate-500 font-mono block">BID</span>
                            <span className="text-xs font-bold text-white font-mono">{activeSym.bid}</span>
                          </div>
                          <div className="text-right">
                            <span className="text-[9px] text-slate-500 font-mono block">ASK</span>
                            <span className="text-xs font-bold text-white font-mono">{activeSym.ask}</span>
                          </div>
                        </div>

                        <div className="text-right ml-1">
                          <span className="text-xs font-bold text-white font-mono block">{activeSym.price}</span>
                          <span className={`text-[10px] font-bold font-mono ${sym.change24h >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {sym.change24h >= 0 ? '+' : ''}{sym.change24h}%
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ORDER PANEL */}
              <div className="bg-[#0b0f19] border border-white/5 rounded-2xl p-5 space-y-4 shadow-xl">
                <form onSubmit={handleExecuteTrade} className="space-y-4.5">
                  <div className="flex items-center justify-between border-b border-white/5 pb-3">
                    <span className="text-xs font-extrabold text-slate-400 uppercase tracking-wider font-mono">Create Order</span>
                    <div className="text-right">
                      <span className="text-xs font-extrabold text-blue-400 font-mono block">{selectedSymbol.symbol}</span>
                      <span className="text-[9px] text-slate-500 font-sans">{selectedSymbol.name}</span>
                    </div>
                  </div>

                  {/* 10-MINUTE COOLDOWN COUNTDOWN BANNER */}
                  {cooldownRemainingSec > 0 && (
                    <div className="p-3.5 rounded-2xl bg-amber-500/15 border border-amber-500/40 flex items-center justify-between shadow-xl animate-pulse">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400">
                          <Clock className="w-4 h-4 animate-spin" />
                        </div>
                        <div>
                          <span className="text-xs font-black text-amber-300 uppercase tracking-wide block">10-Minute Cooldown Active</span>
                          <span className="text-[10px] text-slate-400 font-mono">Trading paused post trade close</span>
                        </div>
                      </div>
                      <div className="text-right font-mono">
                        <span className="text-[9px] uppercase text-slate-400 block font-bold">Cooldown Remaining</span>
                        <span className="text-sm font-black text-amber-400 font-mono tracking-widest">
                          {formatCooldownTime(cooldownRemainingSec)}
                        </span>
                      </div>
                    </div>
                  )}

                  {errorMsg && (
                    <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/25 flex items-start space-x-2">
                      <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                      <span className="text-xs text-red-300 leading-relaxed">{errorMsg}</span>
                    </div>
                  )}

                  {successMsg && (
                    <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 flex items-start space-x-2">
                      <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                      <span className="text-xs text-emerald-300 leading-relaxed">{successMsg}</span>
                    </div>
                  )}

                  {/* Buy / Sell Selection Tabs */}
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setTradeType('buy')}
                      className={`h-14 rounded-xl text-xs font-bold flex flex-col items-center justify-center space-y-1 transition-all ${
                        tradeType === 'buy' 
                          ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-500/10 ring-1 ring-emerald-400/20' 
                          : 'bg-[#0c1122] border border-white/5 text-slate-400 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center space-x-1">
                        <TrendingUp className="w-4 h-4" />
                        <span>BUY (Ask)</span>
                      </div>
                      <span className="text-xs font-mono font-bold tracking-wider">${activeSelectedSymbol.ask}</span>
                    </button>
                    
                    <button
                      type="button"
                      onClick={() => setTradeType('sell')}
                      className={`h-14 rounded-xl text-xs font-bold flex flex-col items-center justify-center space-y-1 transition-all ${
                        tradeType === 'sell' 
                          ? 'bg-red-600 hover:bg-red-500 text-white shadow-md shadow-red-500/10 ring-1 ring-red-400/20' 
                          : 'bg-[#0c1122] border border-white/5 text-slate-400 hover:text-white'
                      }`}
                    >
                      <div className="flex items-center space-x-1">
                        <TrendingDown className="w-4 h-4" />
                        <span>SELL (Bid)</span>
                      </div>
                      <span className="text-xs font-mono font-bold tracking-wider">${activeSelectedSymbol.bid}</span>
                    </button>
                  </div>

                  {/* Lot size input field */}
                  <div className="space-y-1.5">
                    <div className="flex justify-between items-center text-xs text-slate-400 font-medium">
                      <span>Trade Volume (Lots)</span>
                      <span className="text-[10px] font-mono text-slate-500">Contract Size: {getContractSize(selectedSymbol.symbol).toLocaleString()}</span>
                    </div>
                    <div className="grid grid-cols-4 gap-1.5">
                      {[0.01, 0.10, 0.50, 1.00].map((val) => (
                        <button
                          key={val}
                          type="button"
                          onClick={() => setLots(val)}
                          className={`h-8 rounded-lg text-xs font-mono font-bold border transition-colors ${
                            lots === val 
                              ? 'border-blue-500 bg-blue-500/15 text-white font-bold' 
                              : 'border-white/5 bg-[#0c1122] text-slate-400 hover:border-blue-500/30 hover:text-white'
                          }`}
                        >
                          {val.toFixed(2)} Lot
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center mt-2 relative">
                      <input
                        type="number"
                        step="0.01"
                        min="0.01"
                        value={lots}
                        onChange={(e) => setLots(Number(parseFloat(e.target.value).toFixed(2)) || 0.01)}
                        className="w-full h-11 bg-[#0c1122] border border-white/5 rounded-xl px-4 text-sm font-mono text-white focus:outline-none focus:border-blue-500/50"
                      />
                    </div>

                    {/* Live Required Margin display */}
                    {(() => {
                      const orderPrice = tradeType === 'buy' ? activeSelectedSymbol.ask : activeSelectedSymbol.bid;
                      const reqMargin = calculatePositionMargin(selectedSymbol.symbol, Number(lots), orderPrice, selectedAccount?.accountType || 'standard');
                      const isInsuff = reqMargin > metrics.freeMargin;
                      return (
                        <div className={`flex items-center justify-between p-2.5 rounded-xl bg-[#0c1122] border font-mono text-xs transition-colors mt-2 ${
                          isInsuff ? 'border-rose-500/40 bg-rose-500/10' : 'border-white/5'
                        }`}>
                          <span className="text-slate-400 font-sans text-[11px]">Est. Required Margin:</span>
                          <span className={`font-bold ${isInsuff ? 'text-rose-400 font-black' : 'text-blue-300'}`}>
                            ${reqMargin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            {isInsuff && (
                              <span className="text-[9px] uppercase ml-1.5 px-1.5 py-0.5 bg-rose-500/30 text-rose-300 rounded font-black">
                                Insufficient
                              </span>
                            )}
                          </span>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Take Profit / Stop Loss Inputs */}
                  <div className="grid grid-cols-2 gap-4">
                    {/* Take Profit */}
                    <div className="space-y-1.5">
                      <span className="text-xs text-slate-400 font-medium block">Take Profit (TP)</span>
                      <input
                        type="number"
                        step="0.00001"
                        placeholder="None"
                        value={tp}
                        onChange={(e) => setTp(e.target.value)}
                        className="w-full h-11 bg-[#0c1122] border border-white/5 rounded-xl px-3.5 text-xs font-mono text-white focus:outline-none focus:border-emerald-500/50"
                      />
                      <div className="flex gap-1.5 mt-1">
                        <button
                          type="button"
                          onClick={() => applyQuickOffset(20, 'tp')}
                          className="flex-1 py-1 text-[9px] bg-[#0c1122] border border-white/5 rounded text-slate-400 hover:text-white font-mono"
                        >
                          +20 pips
                        </button>
                        <button
                          type="button"
                          onClick={() => applyQuickOffset(50, 'tp')}
                          className="flex-1 py-1 text-[9px] bg-[#0c1122] border border-white/5 rounded text-slate-400 hover:text-white font-mono"
                        >
                          +50 pips
                        </button>
                      </div>
                    </div>

                    {/* Stop Loss */}
                    <div className="space-y-1.5">
                      <span className="text-xs text-slate-400 font-medium block">Stop Loss (SL)</span>
                      <input
                        type="number"
                        step="0.00001"
                        placeholder="None"
                        value={sl}
                        onChange={(e) => setSl(e.target.value)}
                        className="w-full h-11 bg-[#0c1122] border border-white/5 rounded-xl px-3.5 text-xs font-mono text-white focus:outline-none focus:border-red-500/50"
                      />
                      <div className="flex gap-1.5 mt-1">
                        <button
                          type="button"
                          onClick={() => applyQuickOffset(20, 'sl')}
                          className="flex-1 py-1 text-[9px] bg-[#0c1122] border border-white/5 rounded text-slate-400 hover:text-white font-mono"
                        >
                          -20 pips
                        </button>
                        <button
                          type="button"
                          onClick={() => applyQuickOffset(50, 'sl')}
                          className="flex-1 py-1 text-[9px] bg-[#0c1122] border border-white/5 rounded text-slate-400 hover:text-white font-mono"
                        >
                          -50 pips
                        </button>
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isExecuting || isSubmittingRef.current || selectedAccount.status !== 'active'}
                    className="w-full h-11.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white font-bold rounded-xl transition-colors text-xs flex items-center justify-center space-x-2 shadow-lg shadow-blue-500/10 disabled:cursor-not-allowed"
                  >
                    <Play className="w-3.5 h-3.5" />
                    <span>Instant Execution ({tradeType.toUpperCase()})</span>
                  </button>
                </form>
              </div>

            </div>

            {/* RIGHT AREA: TV CHART AND TRANSACTIONS PANELS (Col Span 8) */}
            <div className="lg:col-span-8 space-y-6">
              
              {/* INTERACTIVE TV CHART CONTAINER */}
              <div className={`bg-[#0b0f19] border border-white/5 rounded-2xl p-5 space-y-4 shadow-xl transition-all duration-300 relative ${
                isChartFullscreen ? 'fixed inset-4 z-50 overflow-hidden bg-[#070a13]' : ''
              }`}>
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-extrabold text-slate-400 uppercase tracking-wider font-mono">
                      TradingView Terminal Feed
                    </span>
                    <select
                      value={selectedSymbol.symbol}
                      onChange={(e) => {
                        const s = symbols.find(item => item.symbol === e.target.value);
                        if (s) setSelectedSymbol(s);
                      }}
                      className="bg-[#070a13] border border-white/10 rounded-lg px-2.5 py-1 text-xs font-mono font-bold text-blue-400 focus:outline-none focus:border-blue-500 cursor-pointer"
                    >
                      {symbols.map(s => (
                        <option key={s.symbol} value={s.symbol} className="bg-[#0b0f19] text-white">
                          {s.symbol} - {s.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Timeframe selector toolbar */}
                  <div className="flex flex-wrap items-center gap-2.5">
                    <div className="flex rounded-lg bg-[#070a13] p-1 border border-white/5">
                      {[
                        { label: '1m', value: '1' },
                        { label: '5m', value: '5' },
                        { label: '15m', value: '15' },
                        { label: '30m', value: '30' },
                        { label: '1H', value: '60' },
                        { label: '4H', value: '240' },
                        { label: 'Daily', value: 'D' }
                      ].map((tf) => (
                        <button
                          key={tf.value}
                          onClick={() => setTimeframe(tf.value)}
                          className={`px-2.5 py-1 text-[10px] font-bold font-mono rounded-md transition-colors ${
                            timeframe === tf.value ? 'bg-blue-500 text-white' : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {tf.label}
                        </button>
                      ))}
                    </div>

                    <button
                      onClick={() => setIsChartFullscreen(!isChartFullscreen)}
                      className="p-1.5 rounded-lg bg-[#070a13] border border-white/5 text-slate-400 hover:text-white hover:border-blue-500/30 transition-all"
                      title="Fullscreen toggle"
                    >
                      {isChartFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Indicators multi-select checkboxes row */}
                <div className="flex flex-wrap gap-2 pt-1">
                  <span className="text-[10px] font-bold uppercase font-mono text-slate-500 self-center mr-1">Indicators:</span>
                  {[
                    { key: 'ema', label: 'EMA (Exponential MA)' },
                    { key: 'sma', label: 'SMA (Simple MA)' },
                    { key: 'rsi', label: 'RSI' },
                    { key: 'macd', label: 'MACD' },
                    { key: 'bb', label: 'Bollinger Bands' },
                  ].map((ind) => (
                    <button
                      key={ind.key}
                      onClick={() => setIndicators(prev => ({ ...prev, [ind.key]: !prev[ind.key as keyof typeof prev] }))}
                      className={`px-2.5 py-1 text-[10px] rounded-full border font-medium transition-all ${
                        indicators[ind.key as keyof typeof indicators]
                          ? 'border-blue-500 bg-blue-500/10 text-white'
                          : 'border-white/5 bg-[#070a13] text-slate-400 hover:text-white'
                      }`}
                    >
                      {ind.label}
                    </button>
                  ))}
                </div>

                {/* Custom High-Performance Lightweight-Charts Component */}
                <div className={isChartFullscreen ? 'h-[calc(100%-100px)]' : 'h-[400px] md:h-[450px]'}>
                  <AdvancedChart 
                    symbol={selectedSymbol.symbol} 
                    timeframe={
                      timeframe === '1' ? '1m' :
                      timeframe === '5' ? '5m' :
                      timeframe === '15' ? '15m' :
                      timeframe === '30' ? '30m' :
                      timeframe === '60' ? '1H' :
                      timeframe === '240' ? '4H' : '1D'
                    } 
                    indicators={indicators} 
                    bid={activeSelectedSymbol.bid}
                    ask={activeSelectedSymbol.ask}
                  />
                </div>
              </div>

              {/* 5. OPEN POSITIONS PANEL */}
              <div className="bg-[#0b0f19] border border-white/5 rounded-2xl p-5 space-y-3 shadow-xl">
                <div className="flex justify-between items-center mb-1">
                  <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider font-mono">
                    Active Open Positions ({openTrades.length})
                  </h3>
                  <span className="text-[10px] text-slate-400 font-mono flex items-center gap-1.5 bg-white/5 px-2 py-0.5 rounded">
                    <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
                    Floating Margin Used: ${metrics.marginUsed.toLocaleString()}
                  </span>
                </div>

                {openTrades.length === 0 ? (
                  <div className="py-12 text-center text-xs text-slate-500">
                    No active positions. Execute a BUY or SELL order using the left console panel to open a trade.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left min-w-[650px]">
                      <thead>
                        <tr className="border-b border-white/5 text-[10px] uppercase font-mono text-slate-500">
                          <th className="py-2.5">Symbol</th>
                          <th className="py-2.5">Direction</th>
                          <th className="py-2.5">Lots</th>
                          <th className="py-2.5">Open Price</th>
                          <th className="py-2.5">Live Quote</th>
                          <th className="py-2.5 font-mono text-right">TP / SL</th>
                          <th className="py-2.5 text-right">PnL (USD)</th>
                          <th className="py-2.5 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 text-xs text-slate-300 font-medium">
                        {openTrades.map((trade) => {
                          const symData = priceEngine[trade.symbol];
                          const currentPrice = symData ? (trade.type === 'buy' ? symData.bid : symData.ask) : trade.openPrice;
                          const currentPnL = calculateTradePnL(
                            trade.symbol,
                            trade.type,
                            trade.openPrice,
                            trade.lots,
                            symData?.bid ?? trade.openPrice,
                            symData?.ask ?? trade.openPrice
                          );

                          const priceDiff = trade.type === 'buy' ? (currentPrice - trade.openPrice) : (trade.openPrice - currentPrice);
                          const decimals = DECIMAL_PLACES[trade.symbol] || 4;

                          return (
                            <tr key={trade.id} className="hover:bg-white/[0.01]">
                              <td className="py-3.5 font-bold text-white font-mono">
                                <div>{trade.symbol}</div>
                                <div className="text-[9px] text-slate-500 font-normal mt-0.5 space-y-0.5">
                                  <div>EP: {Number(trade.openPrice || 0).toFixed(decimals)} | CP: {currentPrice.toFixed(decimals)}</div>
                                  <div>Diff: {priceDiff >= 0 ? '+' : ''}{priceDiff.toFixed(decimals)}</div>
                                  <div>CS: {getContractSize(trade.symbol).toLocaleString()} | Vol: {trade.lots} Lot</div>
                                  <div>PnL: ${currentPnL.toFixed(2)}</div>
                                </div>
                              </td>
                              <td className="py-3.5">
                                <span className={`px-2 py-0.5 rounded text-[9px] font-bold font-mono uppercase ${
                                  trade.type === 'buy' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                                }`}>
                                  {trade.type}
                                </span>
                              </td>
                              <td className="py-3.5 font-mono font-bold">{trade.lots}</td>
                              <td className="py-3.5 font-mono">${trade.openPrice}</td>
                              <td className="py-3.5 font-mono text-blue-400">${currentPrice}</td>
                              <td className="py-3.5 text-right font-mono text-[10px] text-slate-400">
                                <div>TP: {trade.takeProfit != null ? `$${trade.takeProfit}` : (trade.tp && trade.tp !== '' ? `$${trade.tp}` : 'None')}</div>
                                <div className="text-[9px] text-slate-500">SL: {trade.stopLoss != null ? `$${trade.stopLoss}` : (trade.sl && trade.sl !== '' ? `$${trade.sl}` : 'None')}</div>
                              </td>
                              <td className={`py-3.5 text-right font-mono font-bold text-sm ${currentPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                ${currentPnL >= 0 ? '+' : ''}{currentPnL.toFixed(2)}
                              </td>
                              <td className="py-3.5 text-right">
                                <div className="flex gap-1.5 justify-end">
                                  <button
                                    onClick={() => handleOpenModifySlTpModal(trade)}
                                    className="px-2 py-1.5 bg-purple-500/10 hover:bg-purple-500 hover:text-white border border-purple-500/20 text-purple-400 rounded-lg text-[10px] font-bold transition-all flex items-center space-x-1"
                                    title="Modify Stop Loss & Take Profit"
                                  >
                                    <Sliders className="w-3 h-3" />
                                    <span>SL/TP</span>
                                  </button>
                                  <button
                                    onClick={() => handleOpenPartialModal(trade)}
                                    className="px-2 py-1.5 bg-blue-500/10 hover:bg-blue-500 hover:text-white border border-blue-500/20 text-blue-400 rounded-lg text-[10px] font-bold transition-all"
                                  >
                                    Partial
                                  </button>
                                  <button
                                    onClick={() => handleCloseTrade(trade)}
                                    className="px-2 py-1.5 bg-red-500/10 hover:bg-red-500 hover:text-white border border-red-500/20 text-red-400 rounded-lg text-[10px] font-bold transition-all flex items-center space-x-1"
                                  >
                                    <Square className="w-2 h-2 fill-current" />
                                    <span>Close</span>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* 5b. TRADING ENGINE DEBUG PANEL */}
              <div id="trading-engine-debug" className="bg-[#0b0f19] border border-white/5 rounded-2xl p-5 space-y-3.5 shadow-xl">
                <div className="flex justify-between items-center border-b border-white/5 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                    </span>
                    <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider font-mono">
                      Trading Engine Debug Panel
                    </h3>
                  </div>
                  <span className="text-[9px] font-mono text-slate-500 bg-white/5 px-2 py-0.5 rounded-full">v1.2.5-stable</span>
                </div>

                {openTrades.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-500 font-mono">
                    No active positions to inspect. Open a BUY or SELL position to stream live engine calculations.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs font-mono text-slate-400 min-w-[750px]">
                      <thead>
                        <tr className="border-b border-white/5 text-[9px] uppercase text-slate-500 pb-2">
                          <th className="py-2">Trade Info</th>
                          <th className="py-2 text-right">Entry Price</th>
                          <th className="py-2 text-right">Current Price</th>
                          <th className="py-2 text-right">Price Difference</th>
                          <th className="py-2 text-right">Contract Size</th>
                          <th className="py-2 text-right font-bold text-slate-300">Lot Size</th>
                          <th className="py-2 text-right text-slate-500">PnL Formula</th>
                          <th className="py-2 text-right text-blue-400">Calculated PnL</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {openTrades.map((trade) => {
                          const symData = priceEngine[trade.symbol];
                          const contractSize = getContractSize(trade.symbol);
                          const currentPrice = symData ? (trade.type === 'buy' ? symData.bid : symData.ask) : trade.openPrice;
                          const diff = trade.type === 'buy' ? (currentPrice - trade.openPrice) : (trade.openPrice - currentPrice);
                          const calcPnL = calculateTradePnL(
                            trade.symbol,
                            trade.type,
                            trade.openPrice,
                            trade.lots,
                            symData?.bid ?? trade.openPrice,
                            symData?.ask ?? trade.openPrice
                          );
                          const decimals = DECIMAL_PLACES[trade.symbol] || 4;

                          return (
                            <tr key={`debug-${trade.id}`} className="hover:bg-white/[0.02]">
                              <td className="py-2.5">
                                <span className="text-slate-500 mr-1">#{trade.id}</span>
                                <span className="font-bold text-white">{trade.symbol}</span>
                                <span className={`ml-2 px-1.5 py-0.5 rounded text-[8px] font-bold ${trade.type === 'buy' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'}`}>
                                  {trade.type.toUpperCase()}
                                </span>
                              </td>
                              <td className="py-2.5 text-right font-mono">${Number(trade.openPrice || 0).toFixed(decimals)}</td>
                              <td className="py-2.5 text-right font-mono text-blue-400">${currentPrice.toFixed(decimals)}</td>
                              <td className={`py-2.5 text-right font-mono font-bold ${diff >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {diff >= 0 ? '+' : ''}{diff.toFixed(decimals)}
                              </td>
                              <td className="py-2.5 text-right font-mono">{contractSize.toLocaleString()}</td>
                              <td className="py-2.5 text-right font-mono font-bold text-white">{trade.lots}</td>
                              <td className="py-2.5 text-right font-mono text-[10px] text-slate-400">
                                ({diff >= 0 ? '+' : ''}{diff.toFixed(decimals)}) × {contractSize.toLocaleString()} × {trade.lots}
                              </td>
                              <td className={`py-2.5 text-right font-mono font-bold text-sm ${calcPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                ${calcPnL >= 0 ? '+' : ''}{calcPnL.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* 6. HISTORIC TRADES PANEL */}
              <div className="bg-[#0b0f19] border border-white/5 rounded-2xl p-5 space-y-3 shadow-xl">
                <div className="flex justify-between items-center">
                  <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-wider font-mono">
                    Simulated Trade History
                  </h3>
                  <button
                    onClick={() => setShowAuditReportModal(true)}
                    className="px-3 py-1.5 bg-blue-500/10 hover:bg-blue-500 hover:text-white border border-blue-500/20 text-blue-400 rounded-lg text-xs font-bold font-mono transition-all flex items-center space-x-1.5"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    <span>Auto-Close Audit Report</span>
                  </button>
                </div>

                {closedTrades.length === 0 ? (
                  <div className="py-12 text-center text-xs text-slate-500">
                    No completed mock trades recorded. Close open positions to realize profit or loss.
                  </div>
                ) : (
                  <div className="overflow-x-auto max-h-[280px] overflow-y-auto pr-1">
                    <table className="w-full text-left min-w-[720px]">
                      <thead>
                        <tr className="border-b border-white/5 text-[10px] uppercase font-mono text-slate-500 sticky top-0 bg-[#0b0f19] z-10">
                          <th className="py-2">Symbol</th>
                          <th className="py-2">Type</th>
                          <th className="py-2">Lots</th>
                          <th className="py-2">Entry Price</th>
                          <th className="py-2">Exit Price</th>
                          <th className="py-2">Close Reason</th>
                          <th className="py-2 font-mono">Close Time</th>
                          <th className="py-2 text-right">Realized Profit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 text-xs text-slate-400 font-medium">
                        {closedTrades.map((trade) => (
                          <tr key={trade.id} className="hover:bg-white/[0.01]">
                            <td className="py-3 font-bold text-white font-mono">{trade.symbol}</td>
                            <td className="py-3">
                              <span className={`px-2 py-0.5 rounded text-[9px] font-bold font-mono uppercase ${
                                trade.type === 'buy' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                              }`}>
                                {trade.type}
                              </span>
                            </td>
                            <td className="py-3 font-mono">{trade.lots}</td>
                            <td className="py-3 font-mono">${trade.openPrice}</td>
                            <td className="py-3 font-mono">${trade.closePrice ?? 'N/A'}</td>
                            <td className="py-3 font-mono">
                              {getCloseReasonBadge(trade.closeReason || trade.comment)}
                            </td>
                            <td className="py-3 font-mono text-[10px] text-slate-500">
                              {trade.closeTime ? `${new Date(trade.closeTime).toLocaleDateString()} ${new Date(trade.closeTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'N/A'}
                            </td>
                            <td className={`py-3 text-right font-mono font-bold text-sm ${trade.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                              ${trade.profit >= 0 ? '+' : ''}{trade.profit.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

            </div>
          </div>

        </div>
      )}

      {/* 7. PARTIAL CLOSE MODAL */}
      {partialCloseTrade && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-[#0b0f19] border border-white/5 rounded-3xl max-w-sm w-full p-6 space-y-4 shadow-2xl relative">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono border-b border-white/5 pb-3">
              Partial Close Position
            </h3>

            {partialCloseError && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-300">
                {partialCloseError}
              </div>
            )}

            <div className="space-y-3.5 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-400">Position ID:</span>
                <span className="font-mono text-white font-bold">{partialCloseTrade.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Asset Symbol:</span>
                <span className="font-mono text-white font-bold">{partialCloseTrade.symbol}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Total Position Volume:</span>
                <span className="font-mono text-white font-bold">{partialCloseTrade.lots} Lots</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Open Price:</span>
                <span className="font-mono text-white">${partialCloseTrade.openPrice}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Live Price:</span>
                <span className="font-mono text-blue-400 font-bold">
                  ${(priceEngine[partialCloseTrade.symbol] || partialCloseTrade)[partialCloseTrade.type === 'buy' ? 'bid' : 'ask'] || partialCloseTrade.openPrice}
                </span>
              </div>

              <div className="h-px bg-white/5 my-2" />

              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 block font-medium">Volume to close (Lots)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  max={Number((partialCloseTrade.lots - 0.01).toFixed(2))}
                  value={partialLots}
                  onChange={(e) => setPartialLots(Number(parseFloat(e.target.value).toFixed(2)) || 0.01)}
                  className="w-full h-11 bg-[#0c1122] border border-white/5 rounded-xl px-4 text-sm font-mono text-white focus:outline-none focus:border-blue-500/50"
                />
                <span className="text-[9px] text-slate-500 block">
                  Remaining volume after transaction: {Number((partialCloseTrade.lots - partialLots).toFixed(2))} Lots
                </span>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setPartialCloseTrade(null)}
                className="flex-1 h-11 bg-white/5 hover:bg-white/10 text-slate-300 font-bold rounded-xl transition-colors text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecutePartialClose}
                className="flex-1 h-11 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-colors text-xs"
              >
                Confirm Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RULE BREACH / PHASE PASS WARNING POPUP MODAL */}
      {ruleBreachModal && ruleBreachModal.isOpen && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in">
          <div className={`border-2 rounded-3xl p-6 sm:p-8 max-w-lg w-full space-y-5 shadow-2xl relative ${
            ruleBreachModal.type === 'success' 
              ? 'bg-[#0b192e] border-emerald-500/50 shadow-emerald-950/40' 
              : 'bg-[#0f172a] border-amber-500/50 shadow-amber-950/40'
          }`}>
            <div className="flex items-center space-x-3.5">
              <div className={`w-12 h-12 rounded-2xl border flex items-center justify-center shrink-0 ${
                ruleBreachModal.type === 'success'
                  ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400'
                  : 'bg-amber-500/20 border-amber-500/40 text-amber-400'
              }`}>
                {ruleBreachModal.type === 'success' ? (
                  <Award className="w-6 h-6 animate-bounce" />
                ) : (
                  <AlertTriangle className="w-6 h-6 animate-pulse" />
                )}
              </div>
              <div>
                <h3 className="text-base font-extrabold text-white uppercase tracking-wider">{ruleBreachModal.title}</h3>
                {ruleBreachModal.subtitle && (
                  <p className={`text-xs font-semibold mt-0.5 ${
                    ruleBreachModal.type === 'success' ? 'text-emerald-400' : 'text-amber-400'
                  }`}>
                    {ruleBreachModal.subtitle}
                  </p>
                )}
              </div>
            </div>

            <div className={`p-4 rounded-2xl space-y-2 text-xs border ${
              ruleBreachModal.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-100'
                : 'bg-amber-500/10 border-amber-500/20 text-slate-200'
            }`}>
              <p className="whitespace-pre-line leading-relaxed font-medium">{ruleBreachModal.message}</p>
              {ruleBreachModal.details && (
                <p className="text-[11px] text-slate-300 pt-2 border-t border-white/10 leading-relaxed font-mono">
                  {ruleBreachModal.details}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={() => setRuleBreachModal(null)}
              className={`w-full h-11 font-extrabold rounded-full text-xs uppercase tracking-wider transition-colors shadow-lg ${
                ruleBreachModal.type === 'success'
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-500/20'
                  : 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-500/20'
              }`}
            >
              {ruleBreachModal.type === 'success' ? 'Awesome, Got It!' : 'I Understand & Acknowledge Warning'}
            </button>
          </div>
        </div>
      )}

      {/* 8. MODIFY SL / TP MODAL */}
      {modifyingSlTpTrade && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[998] flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-[#0b0f19] border border-white/10 rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl relative">
            <div className="flex justify-between items-center border-b border-white/10 pb-3">
              <div className="flex items-center space-x-2">
                <Sliders className="w-5 h-5 text-purple-400" />
                <h3 className="text-sm font-bold text-white uppercase tracking-wider font-mono">
                  Modify Position SL & TP
                </h3>
              </div>
              <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono uppercase ${
                modifyingSlTpTrade.type === 'buy' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
              }`}>
                {modifyingSlTpTrade.type} {modifyingSlTpTrade.symbol} ({modifyingSlTpTrade.lots} Lots)
              </span>
            </div>

            {editSlTpError && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-300 font-medium">
                {editSlTpError}
              </div>
            )}

            <div className="space-y-3 text-xs bg-[#070a13] p-3.5 rounded-2xl border border-white/5 font-mono">
              <div className="flex justify-between text-slate-400">
                <span>Position ID:</span>
                <span className="text-white font-bold">{modifyingSlTpTrade.id}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Entry Price:</span>
                <span className="text-white font-bold">${modifyingSlTpTrade.openPrice}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Current Live Quote:</span>
                <span className="text-blue-400 font-bold">
                  ${(priceEngine[modifyingSlTpTrade.symbol] || modifyingSlTpTrade)[modifyingSlTpTrade.type === 'buy' ? 'bid' : 'ask'] || modifyingSlTpTrade.openPrice}
                </span>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-300 font-bold font-mono flex justify-between">
                  <span>Take Profit Target (TP)</span>
                  <span className="text-slate-500 font-normal">Leave blank to clear</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-xs text-slate-500 font-mono">$</span>
                  <input
                    type="number"
                    step="0.0001"
                    placeholder="e.g. 1.0850 or 2750.00"
                    value={editTpInput}
                    onChange={(e) => setEditTpInput(e.target.value)}
                    className="w-full h-10 bg-[#070a13] border border-white/10 rounded-xl pl-7 pr-3 text-xs font-mono text-emerald-400 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-slate-300 font-bold font-mono flex justify-between">
                  <span>Stop Loss Boundary (SL)</span>
                  <span className="text-slate-500 font-normal">Leave blank to clear</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-xs text-slate-500 font-mono">$</span>
                  <input
                    type="number"
                    step="0.0001"
                    placeholder="e.g. 1.0700 or 2680.00"
                    value={editSlInput}
                    onChange={(e) => setEditSlInput(e.target.value)}
                    className="w-full h-10 bg-[#070a13] border border-white/10 rounded-xl pl-7 pr-3 text-xs font-mono text-rose-400 focus:outline-none focus:border-rose-500"
                  />
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setModifyingSlTpTrade(null)}
                disabled={isSavingSlTp}
                className="flex-1 h-11 bg-white/5 hover:bg-white/10 text-slate-300 font-bold rounded-xl transition-colors text-xs"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveModifySlTp}
                disabled={isSavingSlTp}
                className="flex-1 h-11 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl transition-colors text-xs flex items-center justify-center space-x-2"
              >
                {isSavingSlTp ? (
                  <RefreshCw className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Check className="w-4 h-4" />
                    <span>Save Parameters</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 9. SYSTEM FORCE-CLOSED NOTIFICATION MODAL */}
      {forceCloseNotifModal && forceCloseNotifModal.isOpen && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
          <div className="border-2 border-rose-500/50 bg-[#0f172a] rounded-3xl p-6 sm:p-8 max-w-lg w-full space-y-5 shadow-2xl shadow-rose-950/40 relative">
            <div className="flex items-center space-x-3.5">
              <div className="w-12 h-12 rounded-2xl border border-rose-500/40 bg-rose-500/20 text-rose-400 flex items-center justify-center shrink-0">
                <ShieldAlert className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-white uppercase tracking-wider">
                  Position Force-Closed Notice
                </h3>
                <p className="text-xs font-semibold text-rose-400 mt-0.5 font-mono">
                  Triggered Reason: {forceCloseNotifModal.closeReason}
                </p>
              </div>
            </div>

            <div className="bg-rose-500/10 border border-rose-500/20 rounded-2xl p-4 space-y-2.5 text-xs text-slate-200 font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400">Position ID:</span>
                <span className="text-white font-bold">#{forceCloseNotifModal.tradeId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Account ID:</span>
                <span className="text-white font-bold">{forceCloseNotifModal.accountId}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Symbol / Direction:</span>
                <span className="text-white font-bold">{forceCloseNotifModal.symbol} ({forceCloseNotifModal.type.toUpperCase()} {forceCloseNotifModal.lots} Lots)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Execution Close Price:</span>
                <span className="text-blue-400 font-bold">${forceCloseNotifModal.closePrice}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Realized PnL:</span>
                <span className={`font-bold ${forceCloseNotifModal.profit >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  ${forceCloseNotifModal.profit.toFixed(2)}
                </span>
              </div>
              <div className="pt-2 border-t border-rose-500/20 flex justify-between">
                <span className="text-slate-400">Triggered Protection Rule:</span>
                <span className="text-amber-400 font-bold">{forceCloseNotifModal.triggeredRule}</span>
              </div>
            </div>

            <p className="text-[11px] text-slate-400 italic">
              Note: This position was closed automatically by the Risk Management Engine to safeguard account equity and strictly enforce terminal rules.
            </p>

            <button
              type="button"
              onClick={() => setForceCloseNotifModal(null)}
              className="w-full h-11 bg-rose-600 hover:bg-rose-500 text-white font-extrabold rounded-full text-xs uppercase tracking-wider transition-colors shadow-lg shadow-rose-600/20"
            >
              Acknowledge & Close Notice
            </button>
          </div>
        </div>
      )}

      {/* 10. AUTO-CLOSE AUDIT REPORT MODAL */}
      {showAuditReportModal && (
        <div className="fixed inset-0 z-[999] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fade-in">
          <div className="bg-[#0b0f19] border border-white/10 rounded-3xl p-6 sm:p-8 max-w-2xl w-full space-y-5 shadow-2xl relative">
            <div className="flex justify-between items-center border-b border-white/10 pb-4">
              <div className="flex items-center space-x-2.5">
                <FileText className="w-5 h-5 text-blue-400" />
                <h3 className="text-base font-extrabold text-white uppercase tracking-wider font-mono">
                  Auto-Close Audit Log Report
                </h3>
              </div>
              <button
                onClick={handleCopyAuditReport}
                className="px-3 py-1.5 bg-blue-500 hover:bg-blue-400 text-white rounded-xl text-xs font-bold font-mono transition-all flex items-center space-x-1.5"
              >
                {copiedReport ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
                <span>{copiedReport ? 'Report Copied!' : 'Copy Full Audit Text'}</span>
              </button>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              This report compiles complete audit metadata for all closed trades in this account, explicitly detailing Position IDs, Account IDs, Close Reasons, Triggered Rules, and Execution Timestamps.
            </p>

            <div className="bg-[#070a13] border border-white/5 rounded-2xl p-4 font-mono text-[11px] text-slate-300 max-h-[350px] overflow-y-auto whitespace-pre leading-relaxed select-all">
              {generateAuditReportText()}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setShowAuditReportModal(false)}
                className="px-6 h-10 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl text-xs transition-colors"
              >
                Close Report
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
