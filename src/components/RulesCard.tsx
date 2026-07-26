import React, { useState } from 'react';
import { ShieldCheck, FileText, ChevronDown, ChevronUp, Zap, Clock, AlertCircle, CheckCircle2, XCircle } from 'lucide-react';
import { AccountType } from '../types';

interface RulesCardProps {
  accountType: AccountType;
  phase?: number;
  size?: number;
  holdRuleUpgradePurchased?: boolean;
  className?: string;
  defaultExpanded?: boolean;
}

export default function RulesCard({
  accountType,
  phase = 1,
  size = 10000,
  holdRuleUpgradePurchased = false,
  className = '',
  defaultExpanded = true
}: RulesCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  // Derived Values based on account type
  const isInstant = accountType === 'instant_bolt';
  const isOneStep = accountType === 'one_step';
  const isTwoStep = accountType === 'two_step';
  const isPayoutLater = accountType === 'payout_later';
  const isTrial = accountType === 'trial';

  let accountTypeName = 'ATF Instant';
  if (isTwoStep) accountTypeName = phase === 2 ? 'Two Step - Phase 2' : 'Two Step - Phase 1';
  else if (isOneStep) accountTypeName = 'One Step Evaluation';
  else if (isPayoutLater) accountTypeName = 'Payout Later Challenge';
  else if (isTrial) accountTypeName = 'AT Trial Account';

  const formattedSize = `$${size.toLocaleString()}`;

  // Rule parameters
  let profitTarget = 'No Target';
  if (isTwoStep) profitTarget = phase === 2 ? '5%' : '8%';
  else if (isOneStep) profitTarget = '10%';
  else if (isPayoutLater) profitTarget = '8%';
  else if (isTrial) profitTarget = 'None';

  let dailyDrawdown = '5%';
  let maxDrawdown = '10%';
  if (isInstant) {
    dailyDrawdown = size <= 3000 ? '0.5%' : '1%';
    maxDrawdown = size <= 3000 ? '1%' : '2%';
  } else if (isOneStep) {
    dailyDrawdown = '4%';
    maxDrawdown = '8%';
  } else if (isPayoutLater) {
    dailyDrawdown = '3%';
    maxDrawdown = '6%';
  }

  let leverage = '1:100';
  if (isInstant) leverage = '1:30';
  else if (isPayoutLater) leverage = '1:50';

  let profitSplit = '80%';
  if (isTrial) profitSplit = '30%';

  const minHoldTime = isInstant
    ? '2 Minutes'
    : holdRuleUpgradePurchased 
      ? 'Removed (Addon Active)' 
      : '2 Minutes';

  const rulesList = isInstant ? [
    { label: 'Profit Target', value: 'No Target', allowed: true },
    { label: 'Daily Drawdown', value: dailyDrawdown, allowed: true },
    { label: 'Maximum Drawdown', value: maxDrawdown, allowed: true },
    { label: 'Profit Split', value: '80%', allowed: true },
    { label: 'Maximum Leverage', value: '1:30', allowed: true },
    { label: 'News Trading', value: 'Allowed', allowed: true },
    { label: 'Weekend Holding', value: 'Allowed', allowed: true },
    { label: 'Expert Advisors', value: 'Allowed', allowed: true },
    { label: 'Hedging', value: 'Allowed', allowed: true },
    { label: 'Copy Trading', value: 'Not Allowed', allowed: false },
    { label: 'Minimum Hold Time', value: '2 Minutes', allowed: true },
    { label: 'Warning Trigger', value: 'After 2 Minutes', allowed: true },
    { label: 'Maximum Hold Time', value: '10 Minutes', allowed: true },
    { label: '10 Minute Rule Violation', value: 'Instant Account Breach', allowed: false },
  ] : [
    { label: 'Profit Target', value: profitTarget, allowed: true },
    { label: 'Daily Drawdown', value: dailyDrawdown, allowed: true },
    { label: 'Maximum Drawdown', value: maxDrawdown, allowed: true },
    { label: 'Profit Split', value: profitSplit, allowed: true },
    { label: 'Maximum Leverage', value: leverage, allowed: true },
    { label: 'News Trading', value: 'Allowed', allowed: true },
    { label: 'Weekend Holding', value: 'Allowed', allowed: true },
    { label: 'Expert Advisors', value: 'Allowed', allowed: true },
    { label: 'Hedging', value: 'Allowed', allowed: true },
    { label: 'Copy Trading', value: 'Not Allowed', allowed: false },
    { label: 'Minimum Hold Time', value: minHoldTime, allowed: true, highlight: !isInstant && holdRuleUpgradePurchased },
    { label: 'Cooldown After Close', value: 'None', allowed: true },
    { label: 'Daily Payout', value: 'Bi-Weekly', allowed: true },
  ];

  return (
    <div className={`bg-gradient-to-b from-slate-900 to-slate-950 border border-blue-500/20 rounded-2xl overflow-hidden shadow-2xl backdrop-blur-md transition-all ${className}`}>
      {/* Top PDF Header Banner */}
      <div 
        onClick={() => setIsExpanded(!isExpanded)}
        className="px-5 py-4 bg-gradient-to-r from-blue-950/90 via-slate-900 to-indigo-950/90 border-b border-blue-500/20 flex items-center justify-between cursor-pointer select-none hover:bg-slate-800/60 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400">
            <FileText className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-white tracking-widest uppercase">ACCOUNT RULES & CONDITIONS</span>
              <span className="px-2 py-0.5 text-[9px] font-mono font-bold rounded-full bg-blue-500/20 text-blue-300 border border-blue-500/30">
                PDF SPECIFICATION
              </span>
            </div>
            <p className="text-[11px] text-slate-400 font-mono mt-0.5">
              {formattedSize} • {accountTypeName}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 text-slate-400 text-xs">
          <span className="text-xs font-mono font-bold text-blue-400 hidden sm:inline">
            {isExpanded ? 'Collapse Rules' : 'Expand Rules'}
          </span>
          {isExpanded ? <ChevronUp className="w-5 h-5 text-blue-400" /> : <ChevronDown className="w-5 h-5 text-blue-400" />}
        </div>
      </div>

      {/* Expandable Rules List Card */}
      {isExpanded && (
        <div className="p-5 sm:p-6 space-y-4">
          <div className="text-center pb-2 border-b border-white/5">
            <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500 block">------------------------------------</span>
            <span className="text-xs font-black font-mono text-blue-400 tracking-widest uppercase">ACCOUNT RULES</span>
            <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500 block">------------------------------------</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs font-mono">
            {rulesList.map((rule, idx) => (
              <div 
                key={idx}
                className={`p-3 rounded-xl border flex items-center justify-between transition-all ${
                  rule.highlight && holdRuleUpgradePurchased
                    ? 'bg-amber-500/10 border-amber-500/30 text-amber-200'
                    : 'bg-black/30 border-white/5 hover:border-blue-500/20'
                }`}
              >
                <div className="flex items-center gap-2">
                  {rule.allowed ? (
                    <span className="text-emerald-400 font-bold text-sm">✓</span>
                  ) : (
                    <span className="text-red-400 font-bold text-sm">✗</span>
                  )}
                  <span className="text-slate-300 font-medium">{rule.label}:</span>
                </div>
                <span className={`font-bold ${rule.allowed ? 'text-emerald-400' : 'text-red-400'}`}>
                  {rule.value}
                </span>
              </div>
            ))}
          </div>

          <div className="text-center pt-2 border-t border-white/5">
            <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500">------------------------------------</span>
          </div>
        </div>
      )}
    </div>
  );
}

