import React, { useState } from 'react';
import { 
  Award, Calendar, User, ShieldCheck, Download, Printer, X 
} from 'lucide-react';
import { Certificate } from '../types';

interface CertificatesViewProps {
  certificates: Certificate[];
  onClose?: () => void;
}

export default function CertificatesView({ certificates, onClose }: CertificatesViewProps) {
  const [activeCert, setActiveCert] = useState<Certificate | null>(null);

  const printCertificate = () => {
    window.print();
  };

  return (
    <div id="certificates-view" className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-white">Your Earned Certificates</h2>
        <p className="text-xs text-slate-400">Awards certifying evaluation achievements, phase passing records, and processed profit share payout milestones.</p>
      </div>

      {certificates.length === 0 ? (
        <div className="bg-white/5 border border-white/10 rounded-3xl p-10 text-center max-w-md mx-auto space-y-4 backdrop-blur-sm shadow-xl">
          <Award className="w-12 h-12 text-slate-600 mx-auto" />
          <h3 className="text-base font-bold text-white">No Certificates Awarded Yet</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Certificates are awarded automatically when you satisfy evaluation criteria (pass challenge phases) or receive successfully completed payout share approvals from the Admin team.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {certificates.map((cert) => (
            <div 
              key={cert.id}
              className="bg-white/5 border border-white/10 rounded-3xl p-5 flex flex-col justify-between hover:border-blue-500/30 transition-all shadow-xl"
            >
              <div className="space-y-4">
                <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                  <Award className="w-5.5 h-5.5 text-amber-500" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-white uppercase tracking-wider">
                    {cert.type === 'passed_evaluation' ? 'Evaluation Success Award' : 'Payout Achievement Cert'}
                  </h4>
                  <p className="text-xs text-slate-500 mt-1">ID: {cert.id}</p>
                </div>
                <div className="space-y-1 text-xs text-slate-400">
                  <div className="flex justify-between">
                    <span>Trader</span>
                    <span className="text-white font-semibold">{cert.userName}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Date awarded</span>
                    <span className="text-white font-semibold font-mono">{new Date(cert.date).toLocaleDateString()}</span>
                  </div>
                  {cert.amount > 0 && (
                    <div className="flex justify-between">
                      <span>Certified Value</span>
                      <span className="text-emerald-400 font-bold font-mono">${cert.amount.toLocaleString()}</span>
                    </div>
                  )}
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-white/10">
                <button
                  onClick={() => setActiveCert(cert)}
                  className="w-full py-2 bg-blue-600/10 hover:bg-blue-600 border border-blue-600/25 text-blue-400 hover:text-white rounded-full text-xs font-bold transition-all text-center"
                >
                  View Digital Certificate
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Full-Screen Digital Certificate Modal */}
      {activeCert && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 overflow-y-auto backdrop-blur-md print:bg-white print:p-0">
          <div className="relative w-full max-w-4xl bg-slate-950/95 border-4 border-amber-500/30 rounded-3xl p-8 sm:p-12 shadow-2xl text-center space-y-8 print:border-black print:bg-white print:text-black">
            
            {/* Close actions */}
            <button
              onClick={() => setActiveCert(null)}
              className="absolute right-6 top-6 text-slate-400 hover:text-white p-1.5 rounded-full hover:bg-white/5 transition-colors print:hidden"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Print action trigger */}
            <div className="absolute left-6 top-6 flex items-center space-x-2 print:hidden">
              <button
                onClick={printCertificate}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-white rounded-full transition-all"
              >
                <Printer className="w-3.5 h-3.5" />
                <span>Print Certificate</span>
              </button>
            </div>

            {/* Certificate Header Decoration */}
            <div className="flex flex-col items-center space-y-4">
              <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-amber-600 to-amber-400 flex items-center justify-center shadow-lg shadow-amber-500/20">
                <Award className="w-10 h-10 text-white" />
              </div>
              <span className="text-xs font-black text-amber-500 tracking-widest uppercase font-mono">ATFunding Elite Performance Group</span>
            </div>

            <div className="space-y-3">
              <h1 className="text-3xl sm:text-4xl font-extrabold text-white uppercase tracking-wider print:text-black">
                Certificate of Achievement
              </h1>
              <p className="text-slate-400 text-sm max-w-lg mx-auto print:text-black">
                This document officially recognizes the outstanding trading parameters, dedication, and strict risk metrics satisfied by:
              </p>
            </div>

            <div className="py-2 border-b-2 border-dashed border-amber-500/20 max-w-md mx-auto">
              <p className="text-2xl sm:text-3xl font-extrabold text-white tracking-wide font-sans print:text-black">
                {activeCert.userName}
              </p>
            </div>

            <div className="space-y-4 max-w-xl mx-auto">
              <p className="text-sm text-slate-400 leading-relaxed print:text-black">
                For successfully qualifying under the rules of the <strong className="text-white print:text-black">{activeCert.type === 'passed_evaluation' ? 'Evaluation Challenge Program' : 'Funded Profit Share Division'}</strong> on Account ID <span className="font-mono text-blue-300 font-bold">{activeCert.accountId}</span>. 
                The trader demonstrated absolute compliance with all drawdown thresholds, and outstanding precision execution.
              </p>
              
              {activeCert.amount > 0 && (
                <p className="text-lg font-bold text-emerald-400 font-mono">
                  Certified Payout/Funded Volume: ${activeCert.amount.toLocaleString()} USD
                </p>
              )}
            </div>

            {/* Signatures seals row */}
            <div className="grid grid-cols-2 gap-8 max-w-lg mx-auto pt-8 border-t border-white/10 print:border-black/10">
              <div className="text-center">
                <p className="text-sm font-bold text-white font-mono print:text-black">Asjad Trades</p>
                <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-1">Founder, CEO</p>
              </div>
              <div className="text-center">
                <p className="text-sm font-bold text-white font-mono print:text-black">{new Date(activeCert.date).toLocaleDateString()}</p>
                <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-1">Date of Certification</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
