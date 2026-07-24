import React from 'react';
import { Award, BarChart2, Trophy, ShieldCheck, Calendar, Star } from 'lucide-react';
import { Certificate, CertificateTemplate } from '../types';

interface LuxuryCertificateProps {
  certificate: Partial<Certificate>;
  template: CertificateTemplate;
  containerRef?: React.RefObject<HTMLDivElement>;
  scale?: number;
}

export const DEFAULT_CERT_TEMPLATE: CertificateTemplate = {
  title: 'CERTIFICATE OF ACHIEVEMENT',
  subtitle: 'PROUDLY PRESENTED TO',
  customMessage: 'For successfully passing the evaluation and demonstrating exceptional trading skills, discipline and risk management.',
  badgeText: 'VERIFIED FUNDED TRADER',
  statusIntro: 'You are officially',
  statusTitle: 'FUNDED TRADER',
  ceoName: 'Asjad Khan',
  ceoTitle: 'CEO & FOUNDER',
  riskTeamName: 'Risk Team',
  riskTeamTitle: 'RISK TEAM',
  companyName: 'ATFUNDING',
  companyTagline: 'TRADE. PROVE. GET FUNDED.',
  sealText1: 'DISCIPLINE',
  sealText2: 'CONSISTENCY',
  sealText3: 'SUCCESS',
  footerMessage: 'THANK YOU FOR TRUSTING ATFUNDING. WE WISH YOU CONTINUED SUCCESS IN YOUR TRADING JOURNEY.',
  bgImageUrl: '',
  logoUrl: '',
  signatureUrl: '',
  riskSignatureUrl: ''
};

export default function LuxuryCertificate({ certificate, template, containerRef }: LuxuryCertificateProps) {
  const mergedTemplate = { ...DEFAULT_CERT_TEMPLATE, ...template };
  
  const certName = certificate.name || certificate.userName || 'Asjad Khan';
  const certId = certificate.certificateId || certificate.id || 'ATF-2026-001';
  const certPhase = certificate.phase || 'Funded';
  const rawSize = certificate.accountSize || '$10,000';
  const certSize = typeof rawSize === 'number' ? `$${rawSize.toLocaleString()}` : rawSize;
  const certType = certificate.accountType || (certPhase.toLowerCase().includes('funded') ? 'FUNDED ACCOUNT' : '2 STEP EVALUATION');
  const certDate = certificate.issueDate || certificate.date || new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }).toUpperCase();
  const certStatus = (certificate as any)?.status || 'APPROVED';

  const formatMessage = (msg: string) => {
    if (!msg) return 'For successfully passing the evaluation and demonstrating exceptional trading skills, discipline and risk management.';
    return msg
      .replace(/{USER_NAME}/gi, certName)
      .replace(/\[USER NAME\]/gi, certName)
      .replace(/{ACCOUNT_SIZE}/gi, certSize)
      .replace(/\[ACCOUNT SIZE\]/gi, certSize)
      .replace(/{PHASE}/gi, certPhase)
      .replace(/\[PHASE\]/gi, certPhase)
      .replace(/{DATE}/gi, certDate)
      .replace(/\[DATE\]/gi, certDate)
      .replace(/{CERTIFICATE_ID}/gi, certId)
      .replace(/\[CERTIFICATE ID\]/gi, certId);
  };

  return (
    <div 
      ref={containerRef}
      className="relative w-full aspect-[1.3/1] min-h-[580px] bg-[#06070B] text-white p-6 sm:p-10 rounded-2xl overflow-hidden shadow-2xl flex flex-col justify-between font-sans border border-[#D4AF37]/30 select-none"
      style={mergedTemplate.bgImageUrl ? { backgroundImage: `url(${mergedTemplate.bgImageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
    >
      {/* Outer Luxury Gold Border & Corner Frames */}
      <div className="absolute inset-2 sm:inset-3 border border-[#D4AF37]/50 rounded-xl pointer-events-none"></div>
      <div className="absolute inset-3 sm:inset-4 border-2 border-double border-[#D4AF37]/30 rounded-lg pointer-events-none"></div>

      {/* Geometric Gold Wings / Chevrons on Left & Right Sides */}
      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-8 sm:w-16 h-48 sm:h-80 pointer-events-none opacity-80">
        <svg viewBox="0 0 100 400" className="w-full h-full text-[#D4AF37]">
          <path d="M 0 0 L 80 100 L 40 200 L 80 300 L 0 400 Z" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M 0 30 L 60 110 L 20 200 L 60 290 L 0 370 Z" fill="currentColor" opacity="0.15" />
          <polygon points="0,150 40,200 0,250" fill="currentColor" opacity="0.4" />
        </svg>
      </div>
      <div className="absolute right-0 top-1/2 -translate-y-1/2 w-8 sm:w-16 h-48 sm:h-80 pointer-events-none opacity-80 rotate-180">
        <svg viewBox="0 0 100 400" className="w-full h-full text-[#D4AF37]">
          <path d="M 0 0 L 80 100 L 40 200 L 80 300 L 0 400 Z" fill="none" stroke="currentColor" strokeWidth="2" />
          <path d="M 0 30 L 60 110 L 20 200 L 60 290 L 0 370 Z" fill="currentColor" opacity="0.15" />
          <polygon points="0,150 40,200 0,250" fill="currentColor" opacity="0.4" />
        </svg>
      </div>

      {/* TOP ROW: Badge (Left), Logo (Center), Certificate ID (Right) */}
      <div className="relative z-10 flex items-start justify-between gap-2 pt-2 px-2 sm:px-6">
        {/* TOP LEFT: Verified Badge Seal */}
        <div className="flex flex-col items-center">
          <div className="relative w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-gradient-to-br from-[#F5E6CA] via-[#D4AF37] to-[#8B6508] p-0.5 shadow-xl flex items-center justify-center">
            {/* Scalloped Edge Effect */}
            <div className="w-full h-full rounded-full bg-[#0A0C10] border border-[#D4AF37]/60 flex flex-col items-center justify-center p-1 text-center shadow-inner">
              <div className="flex space-x-0.5 mb-0.5">
                <Star className="w-2.5 h-2.5 fill-[#D4AF37] text-[#D4AF37]" />
                <Star className="w-3 h-3 fill-[#D4AF37] text-[#D4AF37]" />
                <Star className="w-2.5 h-2.5 fill-[#D4AF37] text-[#D4AF37]" />
              </div>
              <span className="text-[7px] sm:text-[8px] font-black tracking-tight text-[#E5C07B] uppercase leading-tight font-sans">
                {mergedTemplate.badgeText || 'VERIFIED FUNDED TRADER'}
              </span>
            </div>
            {/* Draping Ribbon Tails */}
            <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 flex space-x-1 pointer-events-none">
              <div className="w-3 h-5 bg-gradient-to-b from-[#D4AF37] to-[#8B6508] clip-ribbon-left shadow-md"></div>
              <div className="w-3 h-5 bg-gradient-to-b from-[#D4AF37] to-[#8B6508] clip-ribbon-right shadow-md"></div>
            </div>
          </div>
        </div>

        {/* TOP CENTER: Company Logo & Header */}
        <div className="flex flex-col items-center text-center">
          {mergedTemplate.logoUrl ? (
            <img src={mergedTemplate.logoUrl} alt="Logo" className="h-10 sm:h-12 object-contain filter drop-shadow-md" />
          ) : (
            <div className="flex flex-col items-center">
              {/* ATF Logo Symbol */}
              <div className="flex items-center space-x-1.5 mb-1">
                <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-gradient-to-br from-[#F5E6CA] via-[#D4AF37] to-[#996515] p-0.5 shadow-lg flex items-center justify-center">
                  <div className="w-full h-full bg-[#06070B] rounded-[6px] flex items-center justify-center">
                    <span className="text-sm sm:text-base font-black tracking-tighter text-transparent bg-clip-text bg-gradient-to-r from-[#FFF] via-[#E5C07B] to-[#D4AF37]">
                      ATF
                    </span>
                  </div>
                </div>
              </div>
              <h2 className="text-lg sm:text-2xl font-black tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-[#FFFFFF] via-[#E5C07B] to-[#D4AF37] uppercase font-cinzel">
                {mergedTemplate.companyName || 'ATFUNDING'}
              </h2>
              <p className="text-[8px] sm:text-[10px] font-bold text-[#D4AF37]/90 tracking-[0.25em] uppercase mt-0.5">
                {mergedTemplate.companyTagline || 'TRADE. PROVE. GET FUNDED.'}
              </p>
            </div>
          )}
        </div>

        {/* TOP RIGHT: Certificate ID Box */}
        <div className="flex flex-col items-end text-right">
          <span className="text-[8px] sm:text-[9px] font-bold text-[#D4AF37] uppercase tracking-widest block mb-1">
            CERTIFICATE ID
          </span>
          <div className="px-3 py-1 bg-[#0A0C10] border border-[#D4AF37]/70 rounded-md shadow-md">
            <span className="text-xs sm:text-sm font-mono font-bold text-[#E5C07B] tracking-wider">
              {certId}
            </span>
          </div>
        </div>
      </div>

      {/* MIDDLE SECTION: Title, Recipient Name, Description & Status */}
      <div className="relative z-10 text-center my-3 sm:my-5 space-y-2.5 max-w-3xl mx-auto px-4">
        {/* CERTIFICATE OF ACHIEVEMENT */}
        <div className="space-y-1">
          <h1 className="text-2xl sm:text-4xl font-black tracking-[0.15em] text-transparent bg-clip-text bg-gradient-to-r from-[#F5E6CA] via-[#D4AF37] to-[#F5E6CA] font-cinzel uppercase drop-shadow-md">
            {mergedTemplate.title || 'CERTIFICATE'}
          </h1>
          
          <div className="flex items-center justify-center space-x-3 text-[#D4AF37]">
            <div className="w-12 sm:w-24 h-[1px] bg-gradient-to-r from-transparent to-[#D4AF37]"></div>
            <span className="text-[10px] sm:text-xs font-bold tracking-[0.3em] uppercase text-[#E5C07B]">
              OF ACHIEVEMENT
            </span>
            <div className="w-12 sm:w-24 h-[1px] bg-gradient-to-l from-transparent to-[#D4AF37]"></div>
          </div>
        </div>

        {/* Subtitle */}
        <div className="pt-1">
          <div className="inline-flex items-center space-x-3 text-[#D4AF37]/80">
            <div className="w-8 sm:w-16 h-[1px] bg-[#D4AF37]/40"></div>
            <span className="text-[9px] sm:text-[11px] font-bold tracking-[0.25em] text-[#E5C07B]/90 uppercase">
              {mergedTemplate.subtitle || 'PROUDLY PRESENTED TO'}
            </span>
            <div className="w-8 sm:w-16 h-[1px] bg-[#D4AF37]/40"></div>
          </div>
        </div>

        {/* Recipient Name in Cursive Script */}
        <div className="py-1">
          <h2 className="text-3xl sm:text-5xl font-normal text-transparent bg-clip-text bg-gradient-to-r from-[#FFF] via-[#FCE38A] to-[#E5C07B] font-script tracking-wide py-1 drop-shadow-lg">
            {certName}
          </h2>
          <div className="w-48 sm:w-72 h-[1px] bg-gradient-to-r from-transparent via-[#D4AF37] to-transparent mx-auto mt-0.5"></div>
        </div>

        {/* Certificate Message Description */}
        <p className="text-[11px] sm:text-xs text-slate-300 leading-relaxed font-sans max-w-xl mx-auto px-2 font-light">
          {formatMessage(mergedTemplate.customMessage)}
        </p>

        {/* Status Announcement */}
        <div className="pt-1">
          <p className="text-[9px] sm:text-[10px] text-[#E5C07B]/80 font-semibold tracking-wider uppercase">
            {mergedTemplate.statusIntro || 'You are officially'}
          </p>
          <h3 className="text-xl sm:text-3xl font-extrabold tracking-[0.12em] text-transparent bg-clip-text bg-gradient-to-r from-[#F5E6CA] via-[#D4AF37] to-[#FCE38A] font-cinzel uppercase mt-0.5">
            {certificate.customTitle || mergedTemplate.statusTitle || `${certPhase.toUpperCase()} TRADER`}
          </h3>
        </div>
      </div>

      {/* METRICS ROW: 4 Stat Boxes (Account Size, Program Type, Status, Date) */}
      <div className="relative z-10 my-2 px-2 sm:px-8">
        <div className="grid grid-cols-4 border-y border-[#D4AF37]/40 py-2.5 text-center items-center">
          {/* Account Size */}
          <div className="flex flex-col sm:flex-row items-center justify-center space-y-1 sm:space-y-0 sm:space-x-2 border-r border-[#D4AF37]/30 px-1">
            <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-[#D4AF37]/10 border border-[#D4AF37]/40 flex items-center justify-center text-[#D4AF37]">
              <BarChart2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
            <div className="text-center sm:text-left">
              <span className="text-[7px] sm:text-[9px] font-bold text-[#D4AF37] uppercase tracking-wider block">
                ACCOUNT SIZE
              </span>
              <span className="text-xs sm:text-sm font-black text-white font-mono">
                {certSize}
              </span>
            </div>
          </div>

          {/* Program Type */}
          <div className="flex flex-col sm:flex-row items-center justify-center space-y-1 sm:space-y-0 sm:space-x-2 border-r border-[#D4AF37]/30 px-1">
            <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-[#D4AF37]/10 border border-[#D4AF37]/40 flex items-center justify-center text-[#D4AF37]">
              <Trophy className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
            <div className="text-center sm:text-left">
              <span className="text-[7px] sm:text-[9px] font-bold text-[#D4AF37] uppercase tracking-wider block">
                PROGRAM TYPE
              </span>
              <span className="text-[10px] sm:text-xs font-bold text-slate-200 uppercase truncate max-w-[100px]">
                {certType}
              </span>
            </div>
          </div>

          {/* Status */}
          <div className="flex flex-col sm:flex-row items-center justify-center space-y-1 sm:space-y-0 sm:space-x-2 border-r border-[#D4AF37]/30 px-1">
            <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-[#D4AF37]/10 border border-[#D4AF37]/40 flex items-center justify-center text-[#D4AF37]">
              <ShieldCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
            <div className="text-center sm:text-left">
              <span className="text-[7px] sm:text-[9px] font-bold text-[#D4AF37] uppercase tracking-wider block">
                STATUS
              </span>
              <span className="text-[10px] sm:text-xs font-bold text-emerald-400 font-mono uppercase">
                {certStatus}
              </span>
            </div>
          </div>

          {/* Date */}
          <div className="flex flex-col sm:flex-row items-center justify-center space-y-1 sm:space-y-0 sm:space-x-2 px-1">
            <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-full bg-[#D4AF37]/10 border border-[#D4AF37]/40 flex items-center justify-center text-[#D4AF37]">
              <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
            </div>
            <div className="text-center sm:text-left">
              <span className="text-[7px] sm:text-[9px] font-bold text-[#D4AF37] uppercase tracking-wider block">
                DATE
              </span>
              <span className="text-[10px] sm:text-xs font-bold text-slate-200 font-mono">
                {certDate}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* BOTTOM ROW: CEO Signature (Left), Center Gold Medal Seal, Risk Team Signature (Right) */}
      <div className="relative z-10 grid grid-cols-3 items-end text-center px-2 sm:px-8 pt-2">
        {/* CEO Signature Left */}
        <div className="flex flex-col items-center">
          {mergedTemplate.signatureUrl ? (
            <img src={mergedTemplate.signatureUrl} alt="CEO Signature" className="h-8 sm:h-10 object-contain filter invert drop-shadow mb-1" />
          ) : (
            <span className="text-xl sm:text-2xl font-normal text-[#E5C07B] font-script tracking-wider mb-0.5">
              {mergedTemplate.ceoName || 'Asjad Khan'}
            </span>
          )}
          <div className="w-24 sm:w-36 h-[1px] bg-[#D4AF37]/50 mb-1"></div>
          <span className="text-[9px] sm:text-xs font-bold text-white uppercase tracking-wider block">
            {mergedTemplate.ceoTitle || 'CEO & FOUNDER'}
          </span>
          <span className="text-[8px] sm:text-[9px] font-bold text-[#D4AF37] uppercase tracking-widest block">
            {mergedTemplate.companyName || 'ATFUNDING'}
          </span>
        </div>

        {/* Center Circular Gold Seal Medallion */}
        <div className="flex flex-col items-center justify-center">
          <div className="w-14 h-14 sm:w-20 sm:h-20 rounded-full bg-gradient-to-br from-[#F5E6CA] via-[#D4AF37] to-[#8B6508] p-0.5 shadow-2xl flex items-center justify-center">
            <div className="w-full h-full rounded-full bg-[#06070B] border border-[#D4AF37]/80 flex flex-col items-center justify-center p-1 text-center">
              <div className="flex space-x-0.5 mb-0.5">
                <Star className="w-2 h-2 fill-[#D4AF37] text-[#D4AF37]" />
                <Star className="w-2.5 h-2.5 fill-[#D4AF37] text-[#D4AF37]" />
                <Star className="w-2 h-2 fill-[#D4AF37] text-[#D4AF37]" />
              </div>
              <span className="text-[6px] sm:text-[7px] font-black text-[#E5C07B] uppercase leading-tight font-mono tracking-tighter">
                {mergedTemplate.sealText1 || 'DISCIPLINE'}
                <br />
                {mergedTemplate.sealText2 || 'CONSISTENCY'}
                <br />
                {mergedTemplate.sealText3 || 'SUCCESS'}
              </span>
              <div className="flex space-x-0.5 mt-0.5">
                <Star className="w-2 h-2 fill-[#D4AF37] text-[#D4AF37]" />
                <Star className="w-2.5 h-2.5 fill-[#D4AF37] text-[#D4AF37]" />
                <Star className="w-2 h-2 fill-[#D4AF37] text-[#D4AF37]" />
              </div>
            </div>
          </div>
        </div>

        {/* Risk Team Signature Right */}
        <div className="flex flex-col items-center">
          {mergedTemplate.riskSignatureUrl ? (
            <img src={mergedTemplate.riskSignatureUrl} alt="Risk Signature" className="h-8 sm:h-10 object-contain filter invert drop-shadow mb-1" />
          ) : (
            <span className="text-xl sm:text-2xl font-normal text-[#E5C07B] font-script tracking-wider mb-0.5">
              {mergedTemplate.riskTeamName || 'Risk Team'}
            </span>
          )}
          <div className="w-24 sm:w-36 h-[1px] bg-[#D4AF37]/50 mb-1"></div>
          <span className="text-[9px] sm:text-xs font-bold text-white uppercase tracking-wider block">
            {mergedTemplate.riskTeamTitle || 'RISK TEAM'}
          </span>
          <span className="text-[8px] sm:text-[9px] font-bold text-[#D4AF37] uppercase tracking-widest block">
            {mergedTemplate.companyName || 'ATFUNDING'}
          </span>
        </div>
      </div>

      {/* FOOTER MESSAGE */}
      <div className="relative z-10 pt-3 border-t border-[#D4AF37]/20 text-center">
        <p className="text-[8px] sm:text-[9px] font-mono text-[#E5C07B]/80 uppercase tracking-widest">
          {mergedTemplate.footerMessage || 'THANK YOU FOR TRUSTING ATFUNDING. WE WISH YOU CONTINUED SUCCESS IN YOUR TRADING JOURNEY.'}
        </p>
      </div>

      {/* Custom Styles for Ribbon Tails */}
      <style>{`
        .clip-ribbon-left {
          clip-path: polygon(0 0, 100% 0, 100% 100%, 0 80%);
        }
        .clip-ribbon-right {
          clip-path: polygon(0 0, 100% 0, 100% 80%, 0 100%);
        }
      `}</style>
    </div>
  );
}
