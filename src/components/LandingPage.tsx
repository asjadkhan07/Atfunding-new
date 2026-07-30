import React, { useState, useEffect } from 'react';
import * as LucideIcons from 'lucide-react';
import { 
  TrendingUp, Award, ShieldCheck, Zap, DollarSign, Trophy, ArrowRight, Check, Play, ChevronRight, HelpCircle,
  Facebook, Instagram, Send, Clock, Bell
} from 'lucide-react';
import { CHALLENGE_PACKAGES, ChallengePackage } from '../constants';
import { AccountType, SocialLink } from '../types';
import { db } from '../firebase';
import { doc, collection, query, where, setDoc, getDoc, getDocs, limit } from 'firebase/firestore';
import { getDocsCached } from '../lib/firestoreCache';

interface LandingPageProps {
  onSelectPackage: (pkg: ChallengePackage) => void;
  onNavigateToAuth: (mode: 'login' | 'signup') => void;
  onNavigateToDashboard: () => void;
  isAuthenticated: boolean;
  onNavigateToLeaderboardDirectly?: () => void;
}

export default function LandingPage({
  onSelectPackage,
  onNavigateToAuth,
  onNavigateToDashboard,
  isAuthenticated,
}: LandingPageProps) {
  const [selectedType, setSelectedType] = useState<AccountType>('two_step');
  const [faqOpen, setFaqOpen] = useState<number | null>(null);

  // Dynamic Landing Page CMS states
  const [faqsList, setFaqsList] = useState<any[]>([]);
  const [challengeRules, setChallengeRules] = useState<Record<string, any>>({});
  const [howItWorks, setHowItWorks] = useState<any[]>([]);
  const [whyChoose, setWhyChoose] = useState<any[]>([]);

  const [supportEmail, setSupportEmail] = useState('atfundingsupport@gmail.com');
  const [socialLinks, setSocialLinks] = useState<SocialLink[]>([]);

  const [payouts, setPayouts] = useState<any[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [usersList, setUsersList] = useState<any[]>([]);

  // Policy CMS modal states
  const [activePolicyModal, setActivePolicyModal] = useState<'terms_of_service' | 'privacy_policy' | 'refund_policy' | 'risk_disclosure' | null>(null);
  const [cmsPages, setCmsPages] = useState<Record<string, string>>({});

  // Simple BOGO Mappings, Packages Config, and Waitlist Systems
  const [bogoMappings, setBogoMappings] = useState<Record<string, string>>({});
  const [packagesConfig, setPackagesConfig] = useState<Record<string, { disabled?: boolean; expectedReturnDate?: string }>>({});
  const [waitlist, setWaitlist] = useState<any[]>([]);
  const [showNotifyModal, setShowNotifyModal] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState('');
  const [notifyPkgId, setNotifyPkgId] = useState('');
  const [notifyMsg, setNotifyMsg] = useState('');
  const [isSubmittingNotify, setIsSubmittingNotify] = useState(false);

  useEffect(() => {
    // 1. Settings & BOGO & Packages
    getDocsCached('landing_settings_bogo', async () => {
      const snap = await getDoc(doc(db, 'settings', 'bogo_mappings'));
      return snap.exists() ? [snap.data().mappings || {}] : [{}];
    }).then(res => setBogoMappings(res[0] || {})).catch(e => console.warn(e));

    getDocsCached('landing_settings_pkgs', async () => {
      const snap = await getDoc(doc(db, 'settings', 'packages'));
      return snap.exists() ? [snap.data()] : [{}];
    }).then(res => setPackagesConfig(res[0] || {})).catch(e => console.warn(e));

    getDocsCached('landing_waitlist', async () => {
      const snap = await getDocs(query(collection(db, 'availability_waitlist'), limit(50)));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }).then(res => setWaitlist(res)).catch(e => console.warn(e));

    // 2. CMS Pages
    getDocsCached('landing_cms', async () => {
      const snap = await getDocs(query(collection(db, 'cms_pages'), limit(20)));
      const pages: Record<string, string> = {};
      snap.forEach(d => { pages[d.id] = d.data().content || ''; });
      return [pages];
    }).then(res => setCmsPages(res[0] || {})).catch(e => console.warn(e));

    // 3. FAQs
    getDocsCached('landing_faqs', async () => {
      const snap = await getDocs(query(collection(db, 'faqs'), limit(50)));
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      list.sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
      return list;
    }).then(res => setFaqsList(res)).catch(e => console.warn(e));

    // 4. Challenge Rules
    getDocsCached('landing_rules', async () => {
      const snap = await getDocs(collection(db, 'challenge_rules'));
      const rulesObj: Record<string, any> = {};
      snap.forEach(d => { rulesObj[d.id] = d.data(); });
      return [rulesObj];
    }).then(res => setChallengeRules(res[0] || {})).catch(e => console.warn(e));

    // 5. How It Works
    getDocsCached('landing_how_it_works', async () => {
      const snap = await getDocs(query(collection(db, 'how_it_works'), limit(20)));
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      list.sort((a: any, b: any) => (a.stepNumber || 1) - (b.stepNumber || 1));
      return list;
    }).then(res => setHowItWorks(res)).catch(e => console.warn(e));

    // 6. Why Choose Us
    getDocsCached('landing_why_choose', async () => {
      const snap = await getDocs(query(collection(db, 'why_choose'), limit(20)));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }).then(res => setWhyChoose(res)).catch(e => console.warn(e));

    // 7. General Settings & Social Links
    getDocsCached('landing_gen_settings', async () => {
      const snap = await getDoc(doc(db, 'settings', 'general'));
      return snap.exists() ? [snap.data()] : [{ supportEmail: 'atfundingsupport@gmail.com' }];
    }).then(res => setSupportEmail(res[0]?.supportEmail || 'atfundingsupport@gmail.com')).catch(e => console.warn(e));

    getDocsCached('landing_socials', async () => {
      const snap = await getDocs(query(collection(db, 'socialLinks'), where('active', '==', true), limit(20)));
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() as any }));
      list.sort((a, b) => a.sortOrder - b.sortOrder);
      return list;
    }).then(res => setSocialLinks(res)).catch(e => console.warn(e));

    // 8. Leaderboard Payouts, Accounts, Users (Targeted Limit Queries)
    getDocsCached('landing_leaderboard_payouts', async () => {
      const qPayouts = query(collection(db, 'payouts'), where('status', '==', 'approved'), limit(20));
      const snap = await getDocs(qPayouts);
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      list.sort((a: any, b: any) => new Date(b.processedAt || b.createdAt || 0).getTime() - new Date(a.processedAt || a.createdAt || 0).getTime());
      return list;
    }).then(res => setPayouts(res)).catch(e => console.warn(e));

    getDocsCached('landing_leaderboard_accounts', async () => {
      const qAccs = query(collection(db, 'accounts'), limit(50));
      const snap = await getDocs(qAccs);
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }).then(res => setAccounts(res)).catch(e => console.warn(e));

    getDocsCached('landing_leaderboard_users', async () => {
      const qUsers = query(collection(db, 'users'), limit(50));
      const snap = await getDocs(qUsers);
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }).then(res => setUsersList(res)).catch(e => console.warn(e));
  }, []);

  // Filter packages by type
  const filteredPackages = CHALLENGE_PACKAGES.filter(pkg => pkg.type === selectedType);

  const toggleFaq = (index: number) => {
    setFaqOpen(faqOpen === index ? null : index);
  };

  const getTypeText = (type: AccountType) => {
    switch (type) {
      case 'one_step': return 'One Step Evaluation';
      case 'two_step': return 'Two Step Evaluation';
      case 'payout_later': return 'Payout Later Challenge';
      case 'instant_bolt': return 'Instant Bolt Direct';
      case 'trial': return 'AT Trial Program';
    }
  };

  return (
    <div id="landing-page" className="min-h-screen bg-[#020617] text-slate-200 font-sans selection:bg-blue-500 selection:text-white overflow-x-hidden relative">
      {/* Background Mesh Gradients */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/15 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-cyan-600/15 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute top-1/3 right-1/4 w-[500px] h-[500px] bg-blue-900/10 rounded-full blur-[150px] pointer-events-none"></div>

      {/* Header / Navbar */}
      <header className="sticky top-0 z-50 bg-white/5 border-b border-white/10 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center font-bold text-white">
              AT
            </div>
            <span className="text-xl font-bold tracking-tight text-white">
              ATFUNDING
            </span>
          </div>

          <nav className="hidden md:flex items-center space-x-8">
            <a href="#hero" className="text-sm font-medium text-slate-400 hover:text-white transition-colors">Home</a>
            <a href="#challenges" className="text-sm font-medium text-slate-400 hover:text-white transition-colors">Challenges</a>
            <a href="#comparison" className="text-sm font-medium text-slate-400 hover:text-white transition-colors">Comparison</a>
            <a href="#features" className="text-sm font-medium text-slate-400 hover:text-white transition-colors">Why ATFunding</a>
            <a href="#leaderboard" className="text-sm font-medium text-slate-400 hover:text-white transition-colors">Leaderboard</a>
          </nav>

          <div className="flex items-center space-x-4">
            {isAuthenticated ? (
              <button 
                onClick={onNavigateToDashboard}
                id="btn-goto-dashboard"
                className="px-5 h-11 rounded-full text-sm font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-900/20 transition-all duration-200 flex items-center space-x-2"
              >
                <span>Trader Dashboard</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <>
                <button 
                  onClick={() => onNavigateToAuth('login')}
                  id="btn-nav-login"
                  className="text-sm font-medium text-slate-400 hover:text-white px-4 py-2 transition-colors"
                >
                  Log In
                </button>
                <button 
                  onClick={() => onNavigateToAuth('signup')}
                  id="btn-nav-signup"
                  className="px-5 h-11 rounded-full text-sm font-bold bg-white/5 border border-white/10 text-white hover:bg-white/10 transition-colors"
                >
                  Sign Up
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section id="hero" className="relative pt-12 pb-24 md:pt-24 md:pb-32 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          <div className="lg:col-span-7 space-y-8 text-center lg:text-left">
            <div className="inline-flex items-center space-x-2 px-3.5 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/25 text-blue-300 text-xs font-bold tracking-wider uppercase">
              <Zap className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
              <span>UP TO 90% PROFIT SPLIT • INSTANT CREATION</span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-none text-white">
              Empowering Traders with <br />
              <span className="bg-gradient-to-r from-blue-400 via-cyan-400 to-teal-400 bg-clip-text text-transparent glow-text-primary">
                Institutional Capital
              </span>
            </h1>

            <p className="text-lg text-slate-400 max-w-2xl mx-auto lg:mx-0 leading-relaxed">
              Trade with confidence. Achieve your simulated objectives, get funded, and payout on your terms. We provide standard low spreads, zero commission accounts, and instant bolt programs.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start space-y-4 sm:space-y-0 sm:space-x-4">
              <a 
                href="#challenges"
                id="btn-hero-explore"
                className="w-full sm:w-auto px-8 h-14 rounded-full text-base font-bold bg-blue-600 hover:bg-blue-500 text-white transition-all duration-200 flex items-center justify-center space-x-2 shadow-lg shadow-blue-600/20"
              >
                <span>View Challenges</span>
                <ArrowRight className="w-5 h-5" />
              </a>
              <button 
                onClick={() => onNavigateToAuth('signup')}
                id="btn-hero-join"
                className="w-full sm:w-auto px-8 h-14 rounded-full text-base font-bold bg-white/5 border border-white/10 hover:bg-white/10 text-white transition-colors flex items-center justify-center space-x-2"
              >
                <span>Join Affiliate Program</span>
              </button>
            </div>

            {/* Quick stats banner */}
            <div className="grid grid-cols-3 gap-4 pt-4 border-t border-white/10">
              <div className="text-center lg:text-left">
                <p className="text-2xl sm:text-3xl font-extrabold text-white">24h</p>
                <p className="text-xs text-slate-400 uppercase tracking-widest mt-1">Average Payout</p>
              </div>
              <div className="text-center lg:text-left">
                <p className="text-2xl sm:text-3xl font-extrabold text-blue-400">$2.1M+</p>
                <p className="text-xs text-slate-400 uppercase tracking-widest mt-1">Paid Out to Date</p>
              </div>
              <div className="text-center lg:text-left">
                <p className="text-2xl sm:text-3xl font-extrabold text-emerald-400">0%</p>
                <p className="text-xs text-slate-400 uppercase tracking-widest mt-1">Hidden Rules</p>
              </div>
            </div>
          </div>

          {/* Interactive Hero Widget: Simulated Dashboard Preview */}
          <div className="lg:col-span-5 relative">
            <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/10 to-cyan-500/10 rounded-3xl blur-2xl"></div>
            <div className="relative glass-card rounded-3xl p-6 shadow-2xl border border-white/10 space-y-6">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div className="flex items-center space-x-3">
                  <div className="w-3 h-3 rounded-full bg-red-500"></div>
                  <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                  <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                  <span className="text-xs font-mono text-slate-400 ml-2">Live Evaluation Simulator</span>
                </div>
                <span className="px-2.5 py-1 rounded-md bg-blue-500/10 text-blue-300 text-xs font-bold border border-blue-500/20">Phase 1 Active</span>
              </div>

              <div className="space-y-4">
                <div className="flex justify-between items-end">
                  <div>
                    <p className="text-xs text-slate-400 uppercase tracking-wider">Simulated Account Balance</p>
                    <p className="text-3xl font-black text-white">$108,452.12</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-emerald-400 font-bold bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/25">+8.45%</p>
                  </div>
                </div>

                {/* Progress bars */}
                <div className="space-y-3 pt-2">
                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-300">Profit Target ($108,000)</span>
                      <span className="text-emerald-400 font-bold">105% (Passed!)</span>
                    </div>
                    <div className="w-full bg-white/5 h-2.5 rounded-full overflow-hidden">
                      <div className="bg-emerald-500 h-full rounded-full" style={{ width: '100%' }}></div>
                    </div>
                  </div>

                  <div>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-slate-300">Daily Drawdown limit ($96,000)</span>
                      <span className="text-slate-400">Current Loss: -$450</span>
                    </div>
                    <div className="w-full bg-white/5 h-2.5 rounded-full overflow-hidden">
                      <div className="bg-blue-500 h-full rounded-full" style={{ width: '11%' }}></div>
                    </div>
                  </div>
                </div>

                {/* Simulated Trades Widget */}
                <div className="border-t border-white/5 pt-4 space-y-2">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Recent Simulated Orders</p>
                  <div className="flex items-center justify-between p-2 rounded-xl bg-white/5 border border-white/5">
                    <div className="flex items-center space-x-2">
                      <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-xs font-bold font-mono">BUY</span>
                      <span className="text-xs font-extrabold text-white font-mono">XAUUSD</span>
                    </div>
                    <span className="text-xs font-mono text-gray-400">5.00 Lots</span>
                    <span className="text-xs font-mono font-bold text-emerald-400">+$1,450.00</span>
                  </div>
                  <div className="flex items-center justify-between p-2 rounded-xl bg-white/5 border border-white/5">
                    <div className="flex items-center space-x-2">
                      <span className="px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 text-xs font-bold font-mono">BUY</span>
                      <span className="text-xs font-extrabold text-white font-mono">BTCUSD</span>
                    </div>
                    <span className="text-xs font-mono text-gray-400">1.50 Lots</span>
                    <span className="text-xs font-mono font-bold text-emerald-400">+$2,852.12</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="py-20 md:py-28 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
        <div className="text-center max-w-3xl mx-auto space-y-4">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs font-bold uppercase tracking-wider">
            <span>Our Simple 4-Step Process</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">How ATFunding Works</h2>
          <p className="text-slate-400 text-sm">
            Get your simulated funded account up and running in record time by following these clear, verified milestones.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8 relative">
          {/* Connecting line for desktop */}
          <div className="hidden lg:block absolute top-1/2 left-4 right-4 h-0.5 bg-gradient-to-r from-blue-500/5 via-blue-500/30 to-blue-500/5 -translate-y-12 z-0"></div>

          {howItWorks.map((step, idx) => {
            const IconComp = (LucideIcons as any)[step.icon] || LucideIcons.HelpCircle;
            return (
              <div 
                key={step.id || idx}
                id={`how-step-${idx}`}
                className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-sm space-y-6 relative hover:border-blue-500/40 transition-all shadow-xl flex flex-col justify-between z-10 group hover:-translate-y-1 duration-200"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/25 flex items-center justify-center text-blue-400 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                      <IconComp className="w-6 h-6" />
                    </div>
                    <span className="text-4xl font-black text-white/10 group-hover:text-blue-500/20 transition-colors font-mono">
                      0{step.stepNumber || (idx + 1)}
                    </span>
                  </div>
                  <h3 className="text-xl font-bold text-white tracking-tight">{step.title}</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">{step.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Account Challenges Selector */}
      <section id="challenges" className="py-20 md:py-28 bg-white/3 backdrop-blur-sm border-y border-white/10 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
          <div className="text-center max-w-3xl mx-auto space-y-4">
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">Choose Your Trading Challenge</h2>
            <p className="text-slate-400 text-sm">
              Select the account type and size that matches your strategy. Purchase a evaluation, satisfy the parameters, and claim up to 90% simulated split.
            </p>
          </div>



          {/* Account Type Tabs */}
          <div className="flex flex-wrap justify-center gap-2 p-1 bg-slate-900/50 border border-white/5 rounded-2xl max-w-2xl mx-auto">
            {(['one_step', 'two_step', 'payout_later', 'instant_bolt', 'trial'] as AccountType[]).map((type) => (
              <button
                key={type}
                onClick={() => setSelectedType(type)}
                id={`tab-${type}`}
                className={`flex-1 min-w-[110px] py-3.5 rounded-xl text-xs sm:text-sm font-bold transition-all duration-150 uppercase tracking-wider ${
                  selectedType === type
                    ? 'bg-white/10 border border-white/10 text-white shadow-xl'
                    : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
              >
                {type.replace('_', ' ')}
              </button>
            ))}
          </div>

          {/* Challenges Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6 pt-6">
            {filteredPackages.map((pkg) => {
              const config = packagesConfig[pkg.id];
              const isUnavailable = config?.disabled === true;
              const expectedReturnDate = config?.expectedReturnDate || 'TBD';
              const freeBonusId = bogoMappings[pkg.id];
              const waitingCount = waitlist.filter(w => w.packageId === pkg.id).length;

              return (
                <div 
                  key={pkg.id} 
                  id={`pkg-card-${pkg.id}`}
                  className={`bg-white/5 border rounded-3xl p-5 flex flex-col justify-between backdrop-blur-sm transition-all shadow-xl group relative overflow-hidden ${
                    isUnavailable 
                      ? 'border-red-500/20 bg-red-950/5' 
                      : 'border-white/10 hover:border-blue-500/50'
                  }`}
                >
                  {isUnavailable && (
                    <span className="absolute top-0 left-0 bg-red-600/80 text-white text-[8px] font-black uppercase px-2.5 py-1 rounded-br-lg tracking-widest">
                      Currently Unavailable
                    </span>
                  )}
                  
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-blue-400 tracking-wider uppercase font-mono">{getTypeText(pkg.type)}</span>
                      {pkg.size >= 100000 && (
                        <span className="px-2.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 text-[10px] font-bold border border-blue-500/20">Elite</span>
                      )}
                    </div>
                    <h3 className="text-2xl font-bold text-white tracking-tight">{pkg.name}</h3>

                    {freeBonusId && (
                      <div className="bg-blue-500/10 border border-blue-500/25 rounded-xl px-2.5 py-1.5 text-[10px] text-blue-300 font-bold flex items-center gap-1">
                        <span>🎁 Buy 1 Get 1: Free {CHALLENGE_PACKAGES.find(p => p.id === freeBonusId)?.name || 'Bonus'}</span>
                      </div>
                    )}

                    <div className="space-y-2.5 border-t border-white/10 pt-4">
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">{pkg.type === 'instant_bolt' ? 'Profit Target' : 'Simulated Target'}</span>
                        <span className="text-white font-semibold">{pkg.profitTargetPercent > 0 ? `${pkg.profitTargetPercent}%` : pkg.type === 'instant_bolt' ? 'No Target' : 'N/A'}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">{pkg.type === 'instant_bolt' ? 'Minimum Loss' : 'Daily Drawdown'}</span>
                        <span className="text-amber-400 font-semibold">{pkg.type === 'instant_bolt' ? `$${(pkg.size * 0.0225).toLocaleString(undefined, { maximumFractionDigits: 1 })}` : `${pkg.dailyDrawdownPercent}%`}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">{pkg.type === 'instant_bolt' ? 'Maximum Loss' : 'Max Drawdown'}</span>
                        <span className="text-red-400 font-semibold">{pkg.type === 'instant_bolt' ? `$${(pkg.size * 0.05).toLocaleString(undefined, { maximumFractionDigits: 1 })}` : `${pkg.maxDrawdownPercent}%`}</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">Profit Split</span>
                        <span className="text-emerald-400 font-semibold">{pkg.payoutSplit}%</span>
                      </div>
                      <div className="flex justify-between text-xs">
                        <span className="text-slate-400">Leverage</span>
                        <span className="text-white font-semibold font-mono">{pkg.leverage}</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 pt-4 border-t border-white/10 space-y-4">
                    <div className="flex items-baseline justify-between">
                      <span className="text-xs text-slate-500 font-medium">
                        {pkg.type === 'trial' ? 'Registration Fee' : 'Refundable Fee'}
                      </span>
                      <span className="text-2xl font-bold text-white font-mono tracking-tight">
                        ${pkg.price}
                      </span>
                    </div>

                    {isUnavailable ? (
                      <div className="space-y-3">
                        <div className="text-xs space-y-1.5 bg-slate-900/40 p-3 rounded-xl border border-white/5">
                          <div className="flex justify-between text-[11px]">
                            <span className="text-slate-400">Expected Return:</span>
                            <span className="text-amber-400 font-medium font-mono">{expectedReturnDate}</span>
                          </div>
                          <div className="flex justify-between text-[11px]">
                            <span className="text-slate-400">Traders Waiting:</span>
                            <span className="text-cyan-400 font-bold">{waitingCount} Traders Waiting</span>
                          </div>
                        </div>

                        <button
                          onClick={() => {
                            setNotifyPkgId(pkg.id);
                            setNotifyMsg('');
                            setNotifyEmail('');
                            setShowNotifyModal(true);
                          }}
                          id={`btn-purchase-${pkg.id}`}
                          className="w-full py-3 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-xs font-bold transition-all border border-cyan-500/30 flex items-center justify-center space-x-1 shadow-lg shadow-cyan-950/50"
                        >
                          <Bell className="w-3.5 h-3.5" />
                          <span>Notify Me</span>
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => onSelectPackage(pkg)}
                        id={`btn-purchase-${pkg.id}`}
                        className="w-full py-3 bg-white/10 group-hover:bg-blue-600 text-white rounded-xl text-xs font-bold transition-all border border-white/10 group-hover:border-blue-500 flex items-center justify-center space-x-1"
                      >
                        <span>Get Challenge</span>
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Dynamic Challenge Rules Section */}
      <section id="rules" className="py-16 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 border-b border-white/10 pb-6">
          <div>
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs font-bold uppercase tracking-wider mb-2">
              <span>Challenge Guidelines</span>
            </div>
            <h2 className="text-3xl font-extrabold tracking-tight text-white">
              Rules for {getTypeText(selectedType)}
            </h2>
          </div>
          <p className="text-slate-400 text-sm max-w-md">
            Our rules are transparent and objective. Complete the parameters safely to qualify for funded simulation status.
          </p>
        </div>

        {(() => {
          const rules = challengeRules[selectedType] || {
            phases: "Evaluation Phase",
            profitTarget: "8% Target",
            dailyDrawdown: "5% (Equity Based)",
            maxDrawdown: "10% Overall",
            minDays: "0 Days",
            leverage: "1:100",
            feeStructure: "Refundable Fee",
            payoutInterval: "Bi-Weekly",
            customRules: "- Consistent risk allocation\n- News trading allowed\n- Overnight holding permitted"
          };

          return (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* Rules Grid */}
              <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  { label: "Evaluation Phases", value: rules.phases, icon: LucideIcons.Award },
                  { label: "Profit Target", value: rules.profitTarget, icon: LucideIcons.Trophy },
                  { label: "Daily Drawdown", value: rules.dailyDrawdown, icon: LucideIcons.TrendingUp },
                  { label: "Max Drawdown", value: rules.maxDrawdown, icon: LucideIcons.ShieldCheck },
                  { label: "Minimum Days", value: rules.minDays, icon: LucideIcons.Calendar || LucideIcons.Clock },
                  { label: "Trading Leverage", value: rules.leverage, icon: LucideIcons.Zap },
                  { label: "Fee Structure", value: rules.feeStructure, icon: LucideIcons.DollarSign },
                  { label: "Payout Interval", value: rules.payoutInterval, icon: LucideIcons.Send },
                ].map((rule, idx) => {
                  const RuleIcon = rule.icon || LucideIcons.HelpCircle;
                  return (
                    <div 
                      key={idx}
                      className="bg-white/5 border border-white/10 rounded-2xl p-5 flex items-start space-x-4 hover:border-blue-500/30 transition-colors shadow-lg"
                    >
                      <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center text-blue-400 flex-shrink-0">
                        <RuleIcon className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 uppercase tracking-widest font-mono">{rule.label}</p>
                        <p className="text-base font-bold text-white mt-1">{rule.value}</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Special Terms & Guidelines Card */}
              <div className="lg:col-span-4 bg-gradient-to-br from-blue-950/40 to-slate-950 border border-white/10 rounded-3xl p-6 shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-blue-600/10 rounded-full blur-2xl"></div>
                <h3 className="text-lg font-bold text-white mb-4 flex items-center space-x-2">
                  <LucideIcons.ShieldCheck className="w-5 h-5 text-blue-400" />
                  <span>Important Guidelines</span>
                </h3>
                <div className="text-sm text-slate-400 space-y-3 whitespace-pre-line leading-relaxed font-sans">
                  {rules.customRules || "- Expert advisors are fully supported.\n- News and weekend holdings allowed.\n- Scalp protection & risk controls active."}
                </div>
              </div>
            </div>
          );
        })()}
      </section>

      {/* Account Comparison Table */}
      <section id="comparison" className="py-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
        <div className="text-center max-w-2xl mx-auto space-y-4">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">Compare Evaluation Models</h2>
          <p className="text-slate-400 text-sm">Select the rules and structures that perfectly match your specific trading timeline.</p>
        </div>

        <div className="overflow-x-auto rounded-3xl border border-white/10 shadow-2xl bg-white/5 backdrop-blur-sm">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead>
              <tr className="border-b border-white/10 bg-white/3 text-slate-300 uppercase tracking-widest text-[11px] font-bold">
                <th className="p-6">Feature Details</th>
                <th className="p-6 text-blue-400">1-Step Challenge</th>
                <th className="p-6 text-blue-400">2-Step Challenge</th>
                <th className="p-6 text-blue-400 font-bold">Payout Later</th>
                <th className="p-6 text-cyan-400">Instant Bolt</th>
                <th className="p-6 text-amber-400">AT Trial Program</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10 text-sm text-slate-300">
              <tr>
                <td className="p-6 font-bold text-white">Evaluation Phases</td>
                <td className="p-6">Single Phase Evaluation</td>
                <td className="p-6">Two Phase Evaluation</td>
                <td className="p-6 font-bold text-white">Single Phase (Discounted)</td>
                <td className="p-6 text-cyan-300 font-bold">Instant (No Phase)</td>
                <td className="p-6 text-amber-300 font-bold">15 Days Duration Trial</td>
              </tr>
              <tr>
                <td className="p-6 font-bold text-white">Profit Target</td>
                <td className="p-6">10% Phase 1</td>
                <td className="p-6">8% Phase 1 / 5% Phase 2</td>
                <td className="p-6">10% Phase 1</td>
                <td className="p-6 text-emerald-400">No Profit Target</td>
                <td className="p-6 text-amber-400">No Profit Target</td>
              </tr>
              <tr>
                <td className="p-6 font-bold text-white">Daily Drawdown Limit</td>
                <td className="p-6">4% (Balance Based)</td>
                <td className="p-6">5% (Equity Based)</td>
                <td className="p-6">3% (Balance Based)</td>
                <td className="p-6 text-amber-400 font-bold">0.5% (2K/3K) / 1% (6K/9K)</td>
                <td className="p-6">5% (Equity Based)</td>
              </tr>
              <tr>
                <td className="p-6 font-bold text-white">Max Drawdown Limit</td>
                <td className="p-6">8% Overall</td>
                <td className="p-6">10% Overall</td>
                <td className="p-6">6% Overall</td>
                <td className="p-6 text-red-400 font-bold">1% (2K/3K) / 2% (6K/9K)</td>
                <td className="p-6">10% Overall</td>
              </tr>
              <tr>
                <td className="p-6 font-bold text-white">Minimum Days Required</td>
                <td className="p-6">0 Days</td>
                <td className="p-6">0 Days</td>
                <td className="p-6">5 Trading Days</td>
                <td className="p-6">0 Days</td>
                <td className="p-6">0 Days</td>
              </tr>
              <tr>
                <td className="p-6 font-bold text-white">Trading Leverage</td>
                <td className="p-6 font-mono">1:100</td>
                <td className="p-6 font-mono">1:100</td>
                <td className="p-6 font-mono">1:50</td>
                <td className="p-6 font-mono">1:30</td>
                <td className="p-6 font-mono">1:100</td>
              </tr>
              <tr>
                <td className="p-6 font-bold text-white">Fee Structure</td>
                <td className="p-6">Standard Fee</td>
                <td className="p-6">Standard Fee</td>
                <td className="p-6 text-blue-400 font-bold">Highly Discounted ($9+)</td>
                <td className="p-6 text-cyan-400 font-bold">Direct Entry Fee</td>
                <td className="p-6 text-amber-400 font-bold">$1 USD Entry</td>
              </tr>
              <tr>
                <td className="p-6 font-bold text-white">Payout Interval</td>
                <td className="p-6">Bi-Weekly</td>
                <td className="p-6">Bi-Weekly</td>
                <td className="p-6">Monthly (First)</td>
                <td className="p-6 text-cyan-400 font-bold">Same Day Payout</td>
                <td className="p-6 text-amber-400">N/A (Split: 30%)</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* Why ATFunding Section */}
      <section id="features" className="py-20 md:py-28 bg-white/3 border-t border-white/10 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-16">
          <div className="text-center max-w-2xl mx-auto space-y-4">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs font-bold uppercase tracking-wider">
              <span>Why Choose Us</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">Designed by Real Traders</h2>
            <p className="text-slate-400 text-sm">Our evaluation rules are designed to give successful, disciplined traders the easiest path to scaling their performance.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {whyChoose.map((item, idx) => {
              const IconComp = (LucideIcons as any)[item.icon] || LucideIcons.Award;
              return (
                <div 
                  key={item.id || idx}
                  className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-sm space-y-4 hover:border-blue-500/40 transition-all shadow-xl group hover:-translate-y-1 duration-200"
                >
                  <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-colors">
                    <IconComp className="w-6 h-6 text-blue-400 group-hover:text-white" />
                  </div>
                  <h3 className="text-xl font-bold text-white tracking-tight">{item.title}</h3>
                  <p className="text-slate-400 text-sm leading-relaxed">{item.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Live Leaderboard Section */}
      <section id="leaderboard" className="py-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
        <div className="text-center max-w-2xl mx-auto space-y-4">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight text-white">The ATFunding Wall of Fame</h2>
          <p className="text-slate-400 text-sm">Transparently displaying the performance, win-rates, and total processed payouts of our elite traders.</p>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-3xl p-6 overflow-hidden backdrop-blur-sm shadow-xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left min-w-[600px]">
              <thead>
                <tr className="border-b border-white/10 text-slate-400 text-xs uppercase tracking-widest font-mono pb-4">
                  <th className="py-3 px-4">Rank</th>
                  <th className="py-3 px-4">Trader Name</th>
                  <th className="py-3 px-4">Account Size</th>
                  <th className="py-3 px-4">Payout Amount</th>
                  <th className="py-3 px-4 text-right">Payout Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10 font-medium text-sm text-slate-300">
                {payouts.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-xs text-slate-500">
                      No approved payouts yet. Join ATFunding and be the first on our Wall of Fame!
                    </td>
                  </tr>
                ) : (
                  payouts.map((p, idx) => {
                    const matchedUser = usersList.find(u => u.id === p.userId || u.uid === p.userId);
                    const matchedAccount = accounts.find(a => a.id === p.accountId);

                    const traderName = matchedUser?.displayName || matchedUser?.name || p.userEmail?.split('@')[0] || 'Elite Trader';
                    const accountSize = matchedAccount ? `$${matchedAccount.size.toLocaleString()}` : 'N/A';
                    const payoutAmount = `$${p.amount.toLocaleString()}`;
                    const payoutDate = p.processedAt 
                      ? new Date(p.processedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
                      : p.createdAt 
                        ? new Date(p.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
                        : 'N/A';

                    return (
                      <tr key={p.id || idx}>
                        <td className="py-4 px-4 flex items-center space-x-2">
                          {idx === 0 ? (
                            <Trophy className="w-5 h-5 text-amber-400" />
                          ) : idx === 1 ? (
                            <Trophy className="w-5 h-5 text-slate-300" />
                          ) : idx === 2 ? (
                            <Trophy className="w-5 h-5 text-amber-600" />
                          ) : null}
                          <span className="font-bold text-white">{idx + 1}</span>
                        </td>
                        <td className="py-4 px-4 font-semibold text-white">{traderName}</td>
                        <td className="py-4 px-4 font-mono">{accountSize}</td>
                        <td className="py-4 px-4 text-emerald-400 font-mono font-bold">{payoutAmount}</td>
                        <td className="py-4 px-4 text-right text-slate-400 font-mono">{payoutDate}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* FAQs Section */}
      <section id="faq" className="py-20 md:py-28 bg-white/3 border-t border-white/10 backdrop-blur-sm">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 space-y-12">
          <div className="text-center space-y-4">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs font-bold uppercase tracking-wider">
              <span>FAQ Center</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">Frequently Asked Questions</h2>
            <p className="text-slate-400 text-sm">Get instant answers to core prop evaluation rules.</p>
          </div>

          <div className="space-y-4">
            {faqsList.map((faq, index) => (
              <div 
                key={faq.id || index} 
                onClick={() => toggleFaq(index)}
                className="bg-white/5 border border-white/10 rounded-3xl p-5 cursor-pointer hover:border-blue-500/30 transition-all shadow-xl"
              >
                <div className="flex justify-between items-center">
                  <h4 className="font-bold text-white text-base sm:text-lg tracking-tight">{faq.question}</h4>
                  <HelpCircle className={`w-5 h-5 text-blue-400 transition-transform duration-200 ${faqOpen === index ? 'rotate-180' : ''}`} />
                </div>
                {faqOpen === index && (
                  <p className="mt-3 text-sm text-slate-400 leading-relaxed border-t border-white/10 pt-3 whitespace-pre-wrap">
                    {faq.answer}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact & Support Section */}
      <section id="contact-support" className="py-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-gradient-to-r from-blue-950/30 via-slate-900/50 to-blue-950/30 border border-white/10 rounded-3xl p-8 md:p-12 shadow-2xl relative overflow-hidden">
          <div className="absolute top-[-20%] right-[-10%] w-[30%] h-[50%] bg-blue-500/10 rounded-full blur-[100px] pointer-events-none"></div>
          
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-7 space-y-6">
              <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs font-bold uppercase tracking-wider">
                <span>Support Desk</span>
              </div>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
                Need Help? Our Support is Always Online
              </h2>
              <p className="text-slate-400 text-sm sm:text-base leading-relaxed">
                Have questions about our Evaluation Challenges, drawdown rules, or payouts? Contact our expert billing and risk teams. We are available 24/7 to support your simulated trading success.
              </p>
              
              <div className="flex flex-col sm:flex-row gap-4 pt-4">
                <a 
                  href={`mailto:${supportEmail}`}
                  className="px-6 h-12 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-full text-sm transition-all duration-200 flex items-center justify-center space-x-2 shadow-lg shadow-blue-600/20"
                >
                  <LucideIcons.Mail className="w-4 h-4" />
                  <span>Email: {supportEmail}</span>
                </a>
                <a 
                  href="#challenges"
                  className="px-6 h-12 bg-white/5 border border-white/10 hover:bg-white/10 text-white font-bold rounded-full text-sm transition-colors flex items-center justify-center space-x-2"
                >
                  <span>Explore Evaluation Models</span>
                  <ArrowRight className="w-4 h-4" />
                </a>
              </div>
            </div>

            <div className="lg:col-span-5 bg-white/3 border border-white/5 rounded-2xl p-6 space-y-6">
              <h3 className="text-lg font-bold text-white border-b border-white/5 pb-3">Contact Information</h3>
              <ul className="space-y-4 text-sm">
                <li className="flex items-center space-x-3 text-slate-300">
                  <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400 flex-shrink-0">
                    <LucideIcons.Mail className="w-5 h-5" />
                  </div>
                  <span className="font-mono">{supportEmail}</span>
                </li>
                <li className="flex items-start space-x-3 text-slate-300">
                  <div className="w-9 h-9 rounded-lg bg-blue-500/10 flex items-center justify-center text-blue-400 flex-shrink-0">
                    <LucideIcons.MapPin className="w-5 h-5" />
                  </div>
                  <span className="text-xs text-slate-400">Premium Financial Hub, Level 44, World Trade Tower, UAE</span>
                </li>
              </ul>

              <div className="pt-4 border-t border-white/5">
                <p className="text-xs text-slate-500 mb-3 uppercase tracking-wider font-bold">Follow Our Community</p>
                <div className="flex flex-wrap gap-2.5">
                  {socialLinks.map((link) => {
                    const IconComp = (LucideIcons as any)[link.icon] || LucideIcons.Link;
                    return (
                      <a
                        key={link.id}
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center border border-white/10 text-slate-400 hover:text-white transition-all transform hover:scale-105"
                        title={link.name}
                      >
                        <IconComp className="w-5 h-5" />
                      </a>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/10 bg-[#020617]/90 backdrop-blur-md py-16 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 md:grid-cols-4 gap-10">
          <div className="space-y-4">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center font-bold text-white">
                AT
              </div>
              <span className="text-xl font-bold tracking-tight text-white">ATFUNDING</span>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">
              ATFunding provides evaluation accounts for simulated trading. All operations are risk-free simulated accounts and do not represent live financial assets.
            </p>
          </div>

          <div>
            <h5 className="text-white font-bold text-sm uppercase tracking-wider mb-4">Challenge Types</h5>
            <ul className="space-y-2 text-xs text-slate-400">
              <li><button onClick={() => { setSelectedType('one_step'); window.scrollTo({top: document.getElementById('challenges')?.offsetTop, behavior: 'smooth'}); }} className="hover:text-white">One Step Challenge</button></li>
              <li><button onClick={() => { setSelectedType('two_step'); window.scrollTo({top: document.getElementById('challenges')?.offsetTop, behavior: 'smooth'}); }} className="hover:text-white">Two Step Challenge</button></li>
              <li><button onClick={() => { setSelectedType('payout_later'); window.scrollTo({top: document.getElementById('challenges')?.offsetTop, behavior: 'smooth'}); }} className="hover:text-white">Payout Later Challenge</button></li>
              <li><button onClick={() => { setSelectedType('instant_bolt'); window.scrollTo({top: document.getElementById('challenges')?.offsetTop, behavior: 'smooth'}); }} className="hover:text-white">Instant Bolt Account</button></li>
            </ul>
          </div>

          <div>
            <h5 className="text-white font-bold text-sm uppercase tracking-wider mb-4">Legal & Risks</h5>
            <ul className="space-y-2 text-xs text-slate-400">
              <li>
                <button 
                  onClick={() => setActivePolicyModal('terms_of_service')} 
                  className="hover:text-white bg-transparent border-none p-0 cursor-pointer text-left block w-full transition-colors"
                >
                  Terms of Service
                </button>
              </li>
              <li>
                <button 
                  onClick={() => setActivePolicyModal('privacy_policy')} 
                  className="hover:text-white bg-transparent border-none p-0 cursor-pointer text-left block w-full transition-colors"
                >
                  Privacy Policy
                </button>
              </li>
              <li>
                <button 
                  onClick={() => setActivePolicyModal('refund_policy')} 
                  className="hover:text-white bg-transparent border-none p-0 cursor-pointer text-left block w-full transition-colors"
                >
                  Refund Policy
                </button>
              </li>
              <li>
                <button 
                  onClick={() => setActivePolicyModal('risk_disclosure')} 
                  className="hover:text-white bg-transparent border-none p-0 cursor-pointer text-left block w-full transition-colors"
                >
                  Risk Disclosure
                </button>
              </li>
            </ul>
          </div>

          <div>
            <h5 className="text-white font-bold text-sm uppercase tracking-wider mb-4">Contacts</h5>
            <p className="text-xs text-slate-400 font-mono">Email: {supportEmail}</p>
            <p className="text-xs text-slate-500 mt-2 mb-4">Address: Premium Financial Hub, Level 44, World Trade Tower, UAE</p>
            <div className="flex flex-wrap gap-2.5">
              {socialLinks.map((link) => {
                const IconComp = (LucideIcons as any)[link.icon] || LucideIcons.Link;
                return (
                  <a
                    key={link.id}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center border border-white/10 text-slate-400 hover:text-white transition-all transform hover:scale-105"
                    title={link.name}
                  >
                    <IconComp className="w-4 h-4" />
                  </a>
                );
              })}
              {socialLinks.length === 0 && (
                <span className="text-xs text-slate-500 font-mono">No socials configured</span>
              )}
            </div>
          </div>
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 border-t border-white/10 mt-12 pt-8 text-center text-xs text-slate-500">
          © {new Date().getFullYear()} ATFunding. All rights reserved.
        </div>
      </footer>

      {/* POLICY MODAL */}
      {activePolicyModal && (() => {
        const title = activePolicyModal === 'terms_of_service' ? 'Terms of Service' :
                      activePolicyModal === 'privacy_policy' ? 'Privacy Policy' :
                      activePolicyModal === 'refund_policy' ? 'Refund Policy' :
                      'Risk Disclosure Statement';

        const defaultContent = activePolicyModal === 'terms_of_service' ? 
          `Welcome to ATFunding. By accessing our platform and purchasing any Evaluation Challenge, you agree to comply with our Terms of Service. ATFunding provides simulated, demo-account trading evaluations designed to identify disciplined traders.\n\n1. Simulated Environment: All accounts, balances, and trades are entirely virtual. No real capital is traded.\n\n2. Prohibited Strategies: Copy-trading from external third-party signals, high-frequency arbitrage, martingale grids exceeding safety parameters, or exploiting system bugs is strictly prohibited.\n\n3. Account Rules: Traders must comply with daily drawdown and loss limits to qualify for funded profit-splits.` :
          activePolicyModal === 'privacy_policy' ? 
          `At ATFunding, your privacy is our top priority.\n\n1. Collection: We collect essential account registration details (email, full name, phone number, location, and IP logs).\n\n2. Security: All sensitive KYC documents uploaded for verification are securely encrypted and stored with Firebase Authentication.\n\n3. Sharing: We do not sell or lease your personal information to third parties. Data is only shared to comply with security audits or regulatory standards.` :
          activePolicyModal === 'refund_policy' ? 
          `Thank you for choosing ATFunding.\n\n1. Refundable Fee: The purchase fee for any Evaluation Challenge is fully refundable. It will be reimbursed to you along with your very first successful profit split withdrawal on your active Funded Account.\n\n2. Non-Refundable Scenarios: Once a user begins trading on the purchased evaluation account, or if the account is breached due to daily or maximum loss limit violations, the purchase fee becomes completely non-refundable.` :
          `Trading Foreign Exchange (Forex) and Contracts for Difference (CFDs) carries high financial risk.\n\n1. High Leverage: High leverage can work against you as well as for you, potentially leading to immediate account breaches.\n\n2. Virtual Evaluation: All evaluation programs offered by ATFunding are simulated. No real money or real assets are at stake.\n\n3. Professional Warning: Past performance on simulated evaluations does not guarantee future success in live markets.`;

        const content = cmsPages[activePolicyModal] || defaultContent;

        return (
          <div className="fixed inset-0 z-50 overflow-y-auto bg-black/85 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-slate-950 border border-white/10 w-full max-w-2xl rounded-3xl overflow-hidden shadow-2xl flex flex-col max-h-[80vh]">
              {/* Header */}
              <div className="p-6 border-b border-white/10 bg-white/5 flex items-center justify-between">
                <h4 className="text-sm font-black text-white uppercase tracking-wider">
                  {title}
                </h4>
                <button
                  type="button"
                  onClick={() => setActivePolicyModal(null)}
                  className="w-8 h-8 text-slate-400 hover:text-white flex items-center justify-center transition-colors font-bold text-base"
                >
                  ✕
                </button>
              </div>

              {/* Content */}
              <div className="p-6 overflow-y-auto text-xs text-slate-300 leading-relaxed space-y-4 whitespace-pre-wrap font-sans">
                {content}
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-white/10 bg-white/5 flex justify-end">
                <button
                  type="button"
                  onClick={() => setActivePolicyModal(null)}
                  className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl text-xs uppercase tracking-wider transition-colors border border-white/10"
                >
                  Acknowledge & Close
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {showNotifyModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0b0f19] border border-white/15 rounded-3xl w-full max-w-md p-6 space-y-4 animate-fade-in relative text-left">
            <button
              type="button"
              onClick={() => setShowNotifyModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-white"
            >
              ✕
            </button>
            <h3 className="text-lg font-bold text-white">Notify Me When Available</h3>
            <p className="text-xs text-slate-400">
              The <strong>{CHALLENGE_PACKAGES.find(p => p.id === notifyPkgId)?.name || 'selected account size'}</strong> is currently unavailable. Enter your email below to get notified as soon as it becomes available again.
            </p>
            {notifyMsg && (
              <p className={`p-3 rounded-xl text-xs font-bold ${notifyMsg.includes('success') || notifyMsg.includes('registered') ? 'bg-emerald-500/10 border border-emerald-500/25 text-emerald-300' : 'bg-red-500/10 border border-red-500/25 text-red-300'}`}>
                {notifyMsg}
              </p>
            )}
            <div className="space-y-1">
              <label className="text-[10px] text-slate-400 uppercase font-semibold">Email Address</label>
              <input
                type="email"
                placeholder="you@example.com"
                value={notifyEmail}
                onChange={(e) => setNotifyEmail(e.target.value)}
                className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <button
              onClick={async () => {
                if (!notifyEmail.trim()) {
                  setNotifyMsg("Please enter a valid email.");
                  return;
                }
                setIsSubmittingNotify(true);
                try {
                  const id = 'WAIT-' + Math.floor(100000 + Math.random() * 900000);
                  await setDoc(doc(db, 'availability_waitlist', id), {
                    id,
                    email: notifyEmail.trim(),
                    packageId: notifyPkgId,
                    packageName: CHALLENGE_PACKAGES.find(p => p.id === notifyPkgId)?.name || 'Unknown',
                    createdAt: new Date().toISOString()
                  });
                  setNotifyMsg("Your interest is registered! We'll notify you as soon as this account is available.");
                  setTimeout(() => {
                    setShowNotifyModal(false);
                    setNotifyMsg('');
                  }, 2500);
                } catch (err: any) {
                  setNotifyMsg("Error registering notification: " + err.message);
                } finally {
                  setIsSubmittingNotify(false);
                }
              }}
              disabled={isSubmittingNotify}
              className="w-full h-10 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 text-white font-bold rounded-xl text-xs transition-colors"
            >
              {isSubmittingNotify ? 'Registering...' : 'Notify Me'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
