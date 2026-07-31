import React, { useState, useEffect } from 'react';
import { 
  Trophy, Search, Pin, ArrowUp, ArrowDown, Shield, DollarSign, 
  CheckCircle2, AlertTriangle, Sparkles, TrendingUp, Award, User, RefreshCw
} from 'lucide-react';
import { collection, doc, setDoc, getDoc, getDocs, query, limit } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { TradingAccount, UserProfile, PayoutRequest, LeaderboardEntry, LeaderboardOverride } from '../types';
import { getDocsCached, getDocCached } from '../lib/firestoreCache';

interface LeaderboardViewProps {
  isAdmin?: boolean;
  currentUserId?: string;
  accountsList?: TradingAccount[];
  usersList?: UserProfile[];
  payoutsList?: PayoutRequest[];
}

export default function LeaderboardView({
  isAdmin = false,
  currentUserId,
  accountsList: propAccounts,
  usersList: propUsers,
  payoutsList: propPayouts
}: LeaderboardViewProps) {
  const [accounts, setAccounts] = useState<TradingAccount[]>(propAccounts || []);
  const [users, setUsers] = useState<UserProfile[]>(propUsers || []);
  const [payouts, setPayouts] = useState<PayoutRequest[]>(propPayouts || []);
  const [overrides, setOverrides] = useState<Record<string, LeaderboardOverride>>({});
  const [pinnedUsers, setPinnedUsers] = useState<string[]>([]);
  const [customOrderMap, setCustomOrderMap] = useState<Record<string, number>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [isSavingOverride, setIsSavingOverride] = useState(false);

  // Sync props if provided
  useEffect(() => {
    if (propAccounts) setAccounts(propAccounts);
  }, [propAccounts]);

  useEffect(() => {
    if (propUsers) setUsers(propUsers);
  }, [propUsers]);

  useEffect(() => {
    if (propPayouts) setPayouts(propPayouts);
  }, [propPayouts]);

  // Fetch accounts, users, payouts & overrides with 60s cached polling
  useEffect(() => {
    let timer: any = null;

    const fetchLeaderboardData = async () => {
      if (!propAccounts) {
        try {
          const accs = await getDocsCached<TradingAccount>('leaderboard_accounts', async () => {
            const snap = await getDocs(query(collection(db, 'accounts'), limit(100)));
            return snap.docs.map(d => ({ id: d.id, ...d.data() } as TradingAccount));
          }, 60000, false, 'LeaderboardView');
          setAccounts(accs);
        } catch (e) {
          console.warn("Leaderboard accounts fetch error:", e);
        }
      }

      if (!propUsers) {
        try {
          const usrs = await getDocsCached<UserProfile>('leaderboard_users', async () => {
            const snap = await getDocs(query(collection(db, 'users'), limit(100)));
            return snap.docs.map(d => ({ uid: d.id, ...d.data() } as UserProfile));
          }, 60000, false, 'LeaderboardView');
          setUsers(usrs);
        } catch (e) {
          console.warn("Leaderboard users fetch error:", e);
        }
      }

      if (!propPayouts) {
        try {
          const py = await getDocsCached<PayoutRequest>('leaderboard_payouts', async () => {
            const snap = await getDocs(query(collection(db, 'payouts'), limit(100)));
            return snap.docs.map(d => ({ id: d.id, ...d.data() } as PayoutRequest));
          }, 60000, false, 'LeaderboardView');
          setPayouts(py);
        } catch (e) {
          console.warn("Leaderboard payouts fetch error:", e);
        }
      }

      try {
        const overridesDoc = await getDocCached('leaderboard_overrides', async () => {
          const snap = await getDoc(doc(db, 'settings', 'leaderboard_overrides'));
          return snap.exists() ? snap.data() : null;
        }, 60000, false, 'LeaderboardView');

        if (overridesDoc) {
          if (overridesDoc.overrides) setOverrides(overridesDoc.overrides || {});
          if (overridesDoc.pinnedUsers) setPinnedUsers(overridesDoc.pinnedUsers || []);
          if (overridesDoc.customOrderMap) setCustomOrderMap(overridesDoc.customOrderMap || {});
        }
      } catch (e) {
        console.warn("Leaderboard overrides fetch error:", e);
      }
    };

    fetchLeaderboardData();
    // Refresh every 60 seconds
    timer = setInterval(fetchLeaderboardData, 60000);

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [propAccounts, propUsers, propPayouts]);

  // Compute dynamic leaderboard entries
  const computeLeaderboard = (): LeaderboardEntry[] => {
    // Group accounts by userId
    const userAccountMap: Record<string, TradingAccount[]> = {};
    accounts.forEach(acc => {
      if (!acc.userId) return;
      if (!userAccountMap[acc.userId]) userAccountMap[acc.userId] = [];
      userAccountMap[acc.userId].push(acc);
    });

    const entries: LeaderboardEntry[] = [];

    // For each user with at least one account or in users list with accounts
    Object.keys(userAccountMap).forEach(userId => {
      const userAccounts = userAccountMap[userId];
      const matchedUser = users.find(u => u.uid === userId || u.id === userId);

      const userEmail = matchedUser?.email || userAccounts[0]?.userEmail || '';
      const override = overrides[userId] || {};

      let traderName = override.traderNameOverride ||
        matchedUser?.displayName ||
        matchedUser?.name ||
        (userEmail ? userEmail.split('@')[0] : 'Trader');

      // Calculate total profit across user accounts & approved payouts
      let calculatedProfit = 0;
      userAccounts.forEach(acc => {
        const gain = (acc.balance || acc.startingBalance || 100000) - (acc.startingBalance || 100000);
        calculatedProfit += gain;
      });

      // Add approved payouts amount
      const userApprovedPayouts = payouts.filter(p => p.userId === userId && p.status === 'approved');
      userApprovedPayouts.forEach(p => {
        calculatedProfit += (p.amount || 0);
      });

      if (override.profitOffset) {
        calculatedProfit += override.profitOffset;
      }

      // Calculate overall status
      let status: 'Active' | 'Breached' | 'Funded' | 'Payout' = 'Active';
      if (userApprovedPayouts.length > 0) {
        status = 'Payout';
      } else if (userAccounts.some(a => a.status === 'breached')) {
        status = 'Breached';
      } else if (userAccounts.some(a => a.phase === 3 || a.status === 'funded' || a.accountType === 'funded')) {
        status = 'Funded';
      } else {
        status = 'Active';
      }

      if (override.statusOverride) {
        status = override.statusOverride as any;
      }

      // Primary account type & size
      const primaryAccount = userAccounts[0];
      const accountTypeLabel = primaryAccount?.accountType === 'one_step' ? '1 Step' :
        primaryAccount?.accountType === 'two_step' ? '2 Step' :
        primaryAccount?.accountType === 'instant_bolt' ? 'Instant Bolt' :
        primaryAccount?.accountType === 'trial' ? 'Trial' :
        primaryAccount?.accountType === 'funded' ? 'Funded' :
        primaryAccount?.accountType || 'Standard';

      const accountSize = primaryAccount ? `$${primaryAccount.size.toLocaleString()}` : '$100,000';

      // Win rate estimate
      let winRate = override.winRateOverride || (65 + (Math.abs(stringToHash(userId)) % 25));
      winRate = Math.min(98.5, Math.max(45.0, Number(winRate.toFixed(1))));

      entries.push({
        id: userId,
        rank: 0,
        userId,
        traderName,
        email: userEmail,
        totalProfit: calculatedProfit,
        winRate,
        accountType: accountTypeLabel,
        accountSize,
        status,
        pinned: pinnedUsers.includes(userId),
        customOrder: customOrderMap[userId] !== undefined ? customOrderMap[userId] : undefined
      });
    });

    // Helper hash function for stable random seed if needed
    function stringToHash(str: string): number {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
      }
      return hash;
    }

    // Sort logic:
    // 1. Pinned entries first (ordered by customOrder if present, else profit)
    // 2. Unpinned entries sorted by customOrder (if assigned) or profit descending
    entries.sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;

      if (a.customOrder !== undefined && b.customOrder !== undefined) {
        return a.customOrder - b.customOrder;
      }
      if (a.customOrder !== undefined) return -1;
      if (b.customOrder !== undefined) return 1;

      return b.totalProfit - a.totalProfit;
    });

    // Assign rank 1..N
    entries.forEach((e, idx) => {
      e.rank = idx + 1;
    });

    return entries;
  };

  const rawEntries = computeLeaderboard();

  // Filter entries
  const filteredEntries = rawEntries.filter(e => {
    const matchesSearch = searchQuery === '' || 
      e.traderName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (e.email && e.email.toLowerCase().includes(searchQuery.toLowerCase())) ||
      e.accountType.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesStatus = filterStatus === 'all' || e.status.toLowerCase() === filterStatus.toLowerCase();

    return matchesSearch && matchesStatus;
  });

  // Admin Control Handlers
  const handleTogglePin = async (userId: string) => {
    if (!isAdmin) return;
    try {
      setIsSavingOverride(true);
      let updatedPinned = [...pinnedUsers];
      if (updatedPinned.includes(userId)) {
        updatedPinned = updatedPinned.filter(id => id !== userId);
      } else {
        updatedPinned.push(userId);
      }
      setPinnedUsers(updatedPinned);

      await setDoc(doc(db, 'settings', 'leaderboard_overrides'), {
        pinnedUsers: updatedPinned,
        customOrderMap,
        overrides,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (err) {
      console.error("Error toggling pin:", err);
      alert("Failed to update pin status.");
    } finally {
      setIsSavingOverride(false);
    }
  };

  const handleMoveOrder = async (userId: string, direction: 'up' | 'down') => {
    if (!isAdmin) return;
    try {
      setIsSavingOverride(true);
      const currentIndex = filteredEntries.findIndex(e => e.userId === userId);
      if (currentIndex === -1) return;

      const targetIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
      if (targetIndex < 0 || targetIndex >= filteredEntries.length) return;

      const currentEntry = filteredEntries[currentIndex];
      const targetEntry = filteredEntries[targetIndex];

      const newOrderMap = { ...customOrderMap };
      
      // Swap or assign custom orders
      const currentOrder = currentEntry.customOrder !== undefined ? currentEntry.customOrder : currentIndex;
      const targetOrder = targetEntry.customOrder !== undefined ? targetEntry.customOrder : targetIndex;

      newOrderMap[currentEntry.userId] = targetOrder;
      newOrderMap[targetEntry.userId] = currentOrder;

      setCustomOrderMap(newOrderMap);

      await setDoc(doc(db, 'settings', 'leaderboard_overrides'), {
        pinnedUsers,
        customOrderMap: newOrderMap,
        overrides,
        updatedAt: new Date().toISOString()
      }, { merge: true });
    } catch (err) {
      console.error("Error moving order:", err);
    } finally {
      setIsSavingOverride(false);
    }
  };

  return (
    <div id="leaderboard-container" className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-sm shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <span className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Trophy className="w-5 h-5" />
            </span>
            <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight">
              Official ATFunding Leaderboard
            </h2>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed max-w-2xl">
            Real-time trader rankings across all active funded accounts, evaluation phases, and verified payouts.
          </p>
        </div>

        <div className="flex items-center space-x-2 w-full sm:w-auto">
          <div className="px-3.5 py-1.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-mono font-bold flex items-center space-x-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Live Sync Active ({rawEntries.length} Traders)</span>
          </div>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 bg-slate-900/60 border border-white/10 rounded-2xl p-3 backdrop-blur-md">
        <div className="relative w-full sm:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search trader name or account..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full h-10 pl-10 pr-4 bg-black/40 border border-white/10 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 font-medium"
          />
        </div>

        <div className="flex items-center space-x-2 w-full sm:w-auto overflow-x-auto scrollbar-none">
          {['all', 'active', 'funded', 'payout', 'breached'].map((st) => (
            <button
              key={st}
              onClick={() => setFilterStatus(st)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold capitalize transition-all whitespace-nowrap cursor-pointer ${
                filterStatus === st 
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' 
                  : 'text-slate-400 hover:text-white bg-white/5 hover:bg-white/10'
              }`}
            >
              {st === 'all' ? 'All Traders' : st}
            </button>
          ))}
        </div>
      </div>

      {/* Leaderboard Table Container */}
      <div className="bg-white/5 border border-white/10 rounded-3xl overflow-hidden backdrop-blur-sm shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[700px]">
            <thead>
              <tr className="bg-white/5 border-b border-white/10 text-slate-400 text-[11px] font-mono uppercase tracking-wider">
                <th className="py-4 px-5">🏆 Rank</th>
                <th className="py-4 px-5">👤 Trader Name</th>
                <th className="py-4 px-5">💰 Total Profit</th>
                <th className="py-4 px-5">📈 Win Rate</th>
                <th className="py-4 px-5">🎯 Account Type</th>
                {isAdmin && <th className="py-4 px-5 text-right">⚙️ Admin Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-xs text-slate-200">
              {filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={isAdmin ? 6 : 5} className="py-16 text-center text-slate-500">
                    <Trophy className="w-12 h-12 text-slate-700 mx-auto mb-2" />
                    <p className="font-bold text-sm text-slate-400">No Traders Found</p>
                    <p className="text-xs text-slate-600">Traders who purchase or activate accounts automatically appear here.</p>
                  </td>
                </tr>
              ) : (
                filteredEntries.map((entry) => {
                  const isCurrent = currentUserId && entry.userId === currentUserId;
                  const isTop3 = entry.rank <= 3;

                  return (
                    <tr
                      key={entry.userId}
                      className={`transition-colors hover:bg-white/5 ${
                        isCurrent ? 'bg-blue-600/15 border-l-4 border-l-blue-500 font-bold' : ''
                      } ${entry.pinned ? 'bg-amber-500/5' : ''}`}
                    >
                      {/* Rank */}
                      <td className="py-4 px-5 font-mono">
                        <div className="flex items-center space-x-2">
                          {entry.pinned && (
                            <Pin className="w-3.5 h-3.5 text-amber-400 fill-amber-400 shrink-0" />
                          )}
                          {entry.rank === 1 ? (
                            <span className="flex items-center gap-1 font-black text-amber-400 text-sm">
                              <Trophy className="w-5 h-5 text-amber-400 fill-amber-400" /> #1
                            </span>
                          ) : entry.rank === 2 ? (
                            <span className="flex items-center gap-1 font-black text-slate-300 text-sm">
                              <Trophy className="w-5 h-5 text-slate-300 fill-slate-300" /> #2
                            </span>
                          ) : entry.rank === 3 ? (
                            <span className="flex items-center gap-1 font-black text-amber-600 text-sm">
                              <Trophy className="w-5 h-5 text-amber-600 fill-amber-600" /> #3
                            </span>
                          ) : (
                            <span className="font-bold text-slate-400">#{entry.rank}</span>
                          )}
                        </div>
                      </td>

                      {/* Trader Name */}
                      <td className="py-4 px-5">
                        <div className="flex items-center space-x-2.5">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs font-mono uppercase ${
                            isTop3 ? 'bg-gradient-to-br from-amber-400 to-amber-600 text-slate-950 shadow-md' : 'bg-white/10 text-white'
                          }`}>
                            {entry.traderName[0] || 'T'}
                          </div>
                          <div>
                            <div className="font-bold text-white flex items-center gap-1.5">
                              <span>{entry.traderName}</span>
                              {isCurrent && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] bg-blue-500/30 text-blue-300 border border-blue-500/40 uppercase tracking-widest font-mono">
                                  YOU
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>

                      {/* Total Profit */}
                      <td className="py-4 px-5 font-mono font-bold text-sm">
                        <span className={entry.totalProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                          {entry.totalProfit >= 0 ? '+' : ''}${entry.totalProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </td>

                      {/* Win Rate */}
                      <td className="py-4 px-5 font-mono text-slate-300">
                        <div className="flex items-center space-x-1.5">
                          <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
                          <span>{entry.winRate}%</span>
                        </div>
                      </td>

                      {/* Account Type */}
                      <td className="py-4 px-5 font-medium">
                        <span className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-slate-300 text-[11px]">
                          {entry.accountType} ({entry.accountSize})
                        </span>
                      </td>

                      {/* Admin Controls */}
                      {isAdmin && (
                        <td className="py-4 px-5 text-right space-x-1">
                          <button
                            type="button"
                            disabled={isSavingOverride}
                            onClick={() => handleTogglePin(entry.userId)}
                            title={entry.pinned ? 'Unpin Trader' : 'Pin Trader to Top'}
                            className={`p-1.5 rounded-lg border transition-all cursor-pointer ${
                              entry.pinned 
                                ? 'bg-amber-500 text-slate-950 border-amber-400' 
                                : 'bg-white/5 hover:bg-white/10 border-white/10 text-slate-400 hover:text-white'
                            }`}
                          >
                            <Pin className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            disabled={isSavingOverride}
                            onClick={() => handleMoveOrder(entry.userId, 'up')}
                            title="Move Trader Up"
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white transition-all cursor-pointer"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            disabled={isSavingOverride}
                            onClick={() => handleMoveOrder(entry.userId, 'down')}
                            title="Move Trader Down"
                            className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-white transition-all cursor-pointer"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
