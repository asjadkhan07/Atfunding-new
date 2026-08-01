import React, { useState, useEffect, useMemo } from 'react';
import { 
  Search, HelpCircle, ChevronDown, ChevronUp, Sparkles, MessageSquare, 
  Mail, Send, ExternalLink, Check, Copy, Layers, ArrowLeft, ArrowRight, ShieldCheck, Zap
} from 'lucide-react';
import { DEFAULT_FAQS, FAQItem } from '../constants/defaultFaqs';
import { db } from '../firebase';
import { collection, query, getDocs, limit } from 'firebase/firestore';
import { getDocsCached } from '../lib/firestoreCache';

interface FAQSectionProps {
  isFullPage?: boolean;
  onBackToHome?: () => void;
  onNavigateToAuth?: (mode: 'login' | 'signup') => void;
  onNavigateToDashboard?: () => void;
  isAuthenticated?: boolean;
  supportEmail?: string;
}

export default function FAQSection({
  isFullPage = false,
  onBackToHome,
  onNavigateToAuth,
  onNavigateToDashboard,
  isAuthenticated = false,
  supportEmail = 'atfundingsupport@gmail.com'
}: FAQSectionProps) {
  const [faqs, setFaqs] = useState<FAQItem[]>(DEFAULT_FAQS);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [openIds, setOpenIds] = useState<Set<string>>(new Set(['FAQ-001'])); // Default open first question
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    // Load dynamic FAQs from Firestore if present
    getDocsCached('landing_faqs_full', async () => {
      const snap = await getDocs(query(collection(db, 'faqs'), limit(100)));
      if (snap.empty) return DEFAULT_FAQS;
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as FAQItem));
      list.sort((a, b) => (a.order || 0) - (b.order || 0));
      return list;
    }).then(res => {
      if (res && res.length > 0) {
        setFaqs(res);
      }
    }).catch(err => {
      console.warn("Using default FAQs due to fetch error:", err);
      setFaqs(DEFAULT_FAQS);
    });
  }, []);

  const categories = useMemo(() => {
    const cats = ['All'];
    faqs.forEach(item => {
      if (item.category && !cats.includes(item.category)) {
        cats.push(item.category);
      }
    });
    return cats;
  }, [faqs]);

  const filteredFaqs = useMemo(() => {
    return faqs.filter(faq => {
      const matchesCategory = selectedCategory === 'All' || faq.category === selectedCategory;
      if (!matchesCategory) return false;

      if (!searchQuery.trim()) return true;

      const q = searchQuery.toLowerCase().trim();
      return (
        faq.question.toLowerCase().includes(q) ||
        faq.answer.toLowerCase().includes(q) ||
        (faq.category && faq.category.toLowerCase().includes(q))
      );
    });
  }, [faqs, selectedCategory, searchQuery]);

  const toggleQuestion = (id: string) => {
    setOpenIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleExpandAll = () => {
    const allIds = new Set(filteredFaqs.map(f => f.id));
    setOpenIds(allIds);
  };

  const handleCollapseAll = () => {
    setOpenIds(new Set());
  };

  const handleCopyQuestion = (faq: FAQItem) => {
    const shareText = `Q: ${faq.question}\n\nA: ${faq.answer}\n\nRead more at ATFunding: ${window.location.origin}`;
    navigator.clipboard.writeText(shareText);
    setCopiedId(faq.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className={`w-full text-slate-200 font-sans ${isFullPage ? 'min-h-screen bg-[#020617] relative overflow-x-hidden' : ''}`}>
      {/* Background Mesh Accents for Full Page Mode */}
      {isFullPage && (
        <>
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/15 rounded-full blur-[120px] pointer-events-none"></div>
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-cyan-600/15 rounded-full blur-[120px] pointer-events-none"></div>

          {/* Full Page Header Navbar */}
          <header className="sticky top-0 z-50 bg-[#020617]/80 border-b border-white/10 backdrop-blur-md">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-20 flex items-center justify-between">
              <div className="flex items-center space-x-3 cursor-pointer" onClick={onBackToHome}>
                <div className="w-9 h-9 rounded-xl bg-blue-600 flex items-center justify-center font-black text-white text-sm shadow-lg shadow-blue-500/30">
                  AT
                </div>
                <div className="flex flex-col">
                  <span className="text-lg font-black tracking-tight text-white leading-tight">ATFUNDING</span>
                  <span className="text-[10px] text-blue-400 font-mono font-semibold tracking-wider uppercase">Help & Knowledge Base</span>
                </div>
              </div>

              <div className="flex items-center space-x-3">
                {onBackToHome && (
                  <button
                    onClick={onBackToHome}
                    className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white rounded-full text-xs font-bold transition-all flex items-center space-x-2 cursor-pointer"
                  >
                    <ArrowLeft className="w-3.5 h-3.5" />
                    <span className="hidden sm:inline">Back to Home</span>
                  </button>
                )}

                {isAuthenticated ? (
                  <button
                    onClick={onNavigateToDashboard}
                    className="px-5 py-2 rounded-full text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/20 transition-all flex items-center space-x-1.5 cursor-pointer"
                  >
                    <span>Dashboard</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <button
                    onClick={() => onNavigateToAuth && onNavigateToAuth('login')}
                    className="px-5 py-2 rounded-full text-xs font-bold bg-white/10 hover:bg-white/20 text-white border border-white/10 transition-all cursor-pointer"
                  >
                    Log In
                  </button>
                )}
              </div>
            </div>
          </header>
        </>
      )}

      {/* Main Container */}
      <div className={`max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 ${isFullPage ? 'py-12 sm:py-16 space-y-10' : 'space-y-8'}`}>
        
        {/* Title Header */}
        <div className="text-center space-y-4 relative">
          <div className="inline-flex items-center space-x-2 px-3.5 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-300 text-xs font-bold uppercase tracking-wider">
            <HelpCircle className="w-3.5 h-3.5 text-blue-400" />
            <span>Official ATFunding Knowledge Base</span>
          </div>

          <h2 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight text-white">
            Frequently Asked <span className="bg-gradient-to-r from-blue-400 via-cyan-400 to-teal-400 bg-clip-text text-transparent">Questions</span>
          </h2>

          <p className="text-slate-400 text-sm sm:text-base max-w-2xl mx-auto leading-relaxed">
            Everything you need to know about evaluation rules, daily and max drawdowns, instant accounts, payouts, and automated trading bot policies.
          </p>
        </div>

        {/* Live Search Bar */}
        <div className="relative max-w-2xl mx-auto">
          <div className="relative flex items-center bg-[#0b0f19] border border-white/15 rounded-2xl p-2 shadow-2xl focus-within:border-blue-500/60 focus-within:ring-2 focus-within:ring-blue-500/20 transition-all">
            <Search className="w-5 h-5 text-slate-400 ml-3 shrink-0" />
            <input
              type="text"
              placeholder="Search questions (e.g., drawdown, payout, EAs, news, hold time)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-transparent px-3 py-2 text-sm text-white placeholder-slate-500 outline-none font-sans"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="p-1.5 mr-1 text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-lg text-xs font-bold font-mono transition-colors cursor-pointer"
              >
                Clear
              </button>
            )}
          </div>
          {searchQuery && (
            <div className="mt-2 text-center text-xs text-slate-400 font-mono">
              Found <span className="text-blue-400 font-bold">{filteredFaqs.length}</span> results matching "{searchQuery}"
            </div>
          )}
        </div>

        {/* Category Pills & Controls Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/10 pb-6">
          {/* Category Filter Pills */}
          <div className="flex flex-wrap items-center gap-2">
            {categories.map((cat) => {
              const count = cat === 'All' ? faqs.length : faqs.filter(f => f.category === cat).length;
              const isSelected = selectedCategory === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center space-x-1.5 border ${
                    isSelected
                      ? 'bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-600/30'
                      : 'bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white border-white/10'
                  }`}
                >
                  <span>{cat}</span>
                  <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                    isSelected ? 'bg-white/20 text-white' : 'bg-white/10 text-slate-400'
                  }`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Master Expand / Collapse Toggle Buttons */}
          <div className="flex items-center space-x-2 shrink-0 self-end md:self-auto">
            <button
              onClick={handleExpandAll}
              className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white rounded-lg text-xs font-medium font-mono transition-colors cursor-pointer"
            >
              Expand All
            </button>
            <button
              onClick={handleCollapseAll}
              className="px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white rounded-lg text-xs font-medium font-mono transition-colors cursor-pointer"
            >
              Collapse All
            </button>
          </div>
        </div>

        {/* FAQ Accordion List */}
        {filteredFaqs.length === 0 ? (
          <div className="bg-[#0b0f19] border border-white/10 rounded-3xl p-12 text-center space-y-4">
            <HelpCircle className="w-12 h-12 text-slate-600 mx-auto" />
            <div className="text-base font-bold text-white">No matching questions found</div>
            <p className="text-xs text-slate-400 max-w-md mx-auto">
              We couldn't find any FAQs matching your query "{searchQuery}". Try searching with different keywords or contact our 24/7 support team.
            </p>
            <button
              onClick={() => { setSearchQuery(''); setSelectedCategory('All'); }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all cursor-pointer"
            >
              Reset Search Filters
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredFaqs.map((faq) => {
              const isOpen = openIds.has(faq.id);
              return (
                <div
                  key={faq.id}
                  className={`border rounded-2xl transition-all duration-200 overflow-hidden shadow-xl ${
                    isOpen 
                      ? 'bg-[#0b0f19] border-blue-500/40 ring-1 ring-blue-500/20' 
                      : 'bg-white/5 hover:bg-white/8 border-white/10 hover:border-white/20'
                  }`}
                >
                  {/* Accordion Question Header */}
                  <button
                    onClick={() => toggleQuestion(faq.id)}
                    className="w-full p-4 sm:p-5 text-left flex justify-between items-center gap-4 cursor-pointer outline-none focus:outline-none"
                  >
                    <div className="flex items-start space-x-3.5">
                      <div className={`mt-0.5 p-1.5 rounded-lg shrink-0 transition-colors ${
                        isOpen ? 'bg-blue-500/20 text-blue-400' : 'bg-white/5 text-slate-400'
                      }`}>
                        <HelpCircle className="w-4 h-4" />
                      </div>
                      <div>
                        {faq.category && (
                          <span className="text-[10px] uppercase font-mono font-bold tracking-wider text-blue-400 block mb-0.5">
                            {faq.category}
                          </span>
                        )}
                        <h3 className="font-extrabold text-white text-sm sm:text-base tracking-tight leading-snug">
                          {faq.question}
                        </h3>
                      </div>
                    </div>

                    <div className={`p-1.5 rounded-full shrink-0 transition-all duration-200 ${
                      isOpen ? 'bg-blue-500/20 text-blue-400 rotate-180' : 'bg-white/5 text-slate-400'
                    }`}>
                      <ChevronDown className="w-4 h-4" />
                    </div>
                  </button>

                  {/* Accordion Answer Content */}
                  {isOpen && (
                    <div className="px-4 pb-5 sm:px-5 sm:pb-6 pt-1 border-t border-white/10 text-xs sm:text-sm text-slate-300 leading-relaxed whitespace-pre-wrap animate-fade-in font-sans">
                      <div className="pl-9 pr-2 space-y-3">
                        <p className="text-slate-300 leading-relaxed">{faq.answer}</p>
                        
                        <div className="pt-2 flex items-center justify-between border-t border-white/5 text-[11px] text-slate-400">
                          <span className="font-mono text-[10px]">Topic: <strong className="text-slate-300">{faq.category || 'General'}</strong></span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopyQuestion(faq);
                            }}
                            className="flex items-center space-x-1 hover:text-white transition-colors cursor-pointer bg-white/5 hover:bg-white/10 px-2.5 py-1 rounded-md"
                          >
                            {copiedId === faq.id ? (
                              <>
                                <Check className="w-3 h-3 text-emerald-400" />
                                <span className="text-emerald-400 font-bold">Copied!</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3 h-3" />
                                <span>Share Answer</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Dedicated Support CTA Banner */}
        <div className="bg-gradient-to-r from-blue-950/40 via-slate-900/60 to-blue-950/40 border border-blue-500/20 rounded-3xl p-6 sm:p-8 shadow-2xl relative overflow-hidden mt-10">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="space-y-2 text-center md:text-left">
              <div className="inline-flex items-center space-x-1.5 text-xs font-bold text-blue-400 uppercase tracking-wider font-mono">
                <Zap className="w-4 h-4 text-blue-400" />
                <span>24/7 Trader Assistance</span>
              </div>
              <h3 className="text-xl sm:text-2xl font-black text-white">Have a question not answered here?</h3>
              <p className="text-xs sm:text-sm text-slate-400 max-w-xl">
                Our support team and risk managers are online around the clock to assist you with evaluation questions, billing, or rule clarifications.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-3 shrink-0">
              <a
                href={`mailto:${supportEmail}`}
                className="w-full sm:w-auto px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl text-xs transition-all shadow-lg shadow-blue-600/30 flex items-center justify-center space-x-2 cursor-pointer"
              >
                <Mail className="w-4 h-4" />
                <span>Email Support</span>
              </a>
              {isAuthenticated && onNavigateToDashboard && (
                <button
                  onClick={onNavigateToDashboard}
                  className="w-full sm:w-auto px-6 py-3 bg-white/10 hover:bg-white/20 text-white border border-white/10 font-bold rounded-xl text-xs transition-all flex items-center justify-center space-x-2 cursor-pointer"
                >
                  <MessageSquare className="w-4 h-4" />
                  <span>Open Support Ticket</span>
                </button>
              )}
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
