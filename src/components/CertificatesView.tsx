import React, { useState, useRef, useEffect } from 'react';
import { 
  Award, Download, Printer, X, FileText, Image as ImageIcon, ShieldCheck, CheckCircle2 
} from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { Certificate, CertificateTemplate } from '../types';
import LuxuryCertificate, { DEFAULT_CERT_TEMPLATE } from './LuxuryCertificate';

interface CertificatesViewProps {
  certificates: Certificate[];
  onClose?: () => void;
}

const DEFAULT_TEMPLATE: CertificateTemplate = {
  title: 'CERTIFICATE OF ACHIEVEMENT',
  subtitle: 'PROUDLY PRESENTED TO',
  customMessage: 'For successfully passing the evaluation and demonstrating exceptional trading skills, discipline and risk management.',
  badgeText: 'VERIFIED FUNDED TRADER',
  ceoName: 'Asjad Khan',
  ceoTitle: 'CEO & FOUNDER',
  companyName: 'ATFUNDING',
  footerMessage: 'THANK YOU FOR TRUSTING ATFUNDING. WE WISH YOU CONTINUED SUCCESS IN YOUR TRADING JOURNEY.',
  bgImageUrl: '',
  logoUrl: '',
  signatureUrl: ''
};

export default function CertificatesView({ certificates, onClose }: CertificatesViewProps) {
  const [activeCert, setActiveCert] = useState<Certificate | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [template, setTemplate] = useState<CertificateTemplate>(DEFAULT_TEMPLATE);
  const certRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'settings', 'certificate_template'), (docSnap) => {
      if (docSnap.exists()) {
        setTemplate({ ...DEFAULT_TEMPLATE, ...docSnap.data() } as CertificateTemplate);
      }
    }, (err) => {
      console.warn("Certificate template subscription error:", err);
    });

    return () => unsub();
  }, []);

  const formatMessage = (msg: string, cert: Certificate) => {
    if (!msg) {
      return `has successfully achieved ${cert.phase || 'Phase 1'} on a ${typeof cert.accountSize === 'number' ? `$${cert.accountSize.toLocaleString()}` : cert.accountSize || '$100,000'} account.`;
    }
    
    const certName = cert.name || cert.userName || 'Trader';
    const certSize = typeof cert.accountSize === 'number' ? `$${cert.accountSize.toLocaleString()}` : cert.accountSize || '$100,000';
    const certPhase = cert.phase || 'Phase 1';
    const certDate = cert.issueDate || cert.date || new Date().toLocaleDateString();
    const certId = cert.certificateId || cert.id;

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

  const downloadPNG = async (cert: Certificate) => {
    if (!certRef.current) return;
    try {
      setIsDownloading(true);
      const canvas = await html2canvas(certRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#020617'
      });
      const link = document.createElement('a');
      link.download = `ATFunding_Certificate_${cert.certificateId || cert.id}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err) {
      console.error("PNG export error:", err);
      alert("Error generating PNG certificate download.");
    } finally {
      setIsDownloading(false);
    }
  };

  const downloadPDF = async (cert: Certificate) => {
    if (!certRef.current) return;
    try {
      setIsDownloading(true);
      const canvas = await html2canvas(certRef.current, {
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
      pdf.save(`ATFunding_Certificate_${cert.certificateId || cert.id}.pdf`);
    } catch (err) {
      console.error("PDF export error:", err);
      alert("Error generating PDF certificate download.");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div id="certificates-view" className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-white flex items-center gap-2">
            <Award className="w-6 h-6 text-amber-400" />
            <span>Earned Certificates</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Official performance awards certifying evaluation phase progression, challenge completion, and funded trader achievements.
          </p>
        </div>
        <div className="px-3 py-1 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-full font-mono text-xs font-bold">
          {certificates.length} Certificate{certificates.length === 1 ? '' : 's'} Issued
        </div>
      </div>

      {certificates.length === 0 ? (
        <div className="bg-white/5 border border-white/10 rounded-3xl p-12 text-center max-w-md mx-auto space-y-4 backdrop-blur-sm shadow-xl">
          <Award className="w-14 h-14 text-slate-600 mx-auto" />
          <h3 className="text-base font-bold text-white">No Certificates Issued Yet</h3>
          <p className="text-xs text-slate-400 leading-relaxed">
            Certificates are automatically awarded when you pass Phase 1 Evaluation, Phase 2 Evaluation, or reach Funded Account status.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {certificates.map((cert) => {
            const certName = cert.name || cert.userName || 'Trader';
            const certId = cert.certificateId || cert.id;
            const certPhase = cert.phase || (cert.type === 'passed_evaluation' ? 'Phase 1' : 'Funded');
            const certSize = typeof cert.accountSize === 'number' 
              ? `$${cert.accountSize.toLocaleString()}` 
              : cert.accountSize || '$100,000';
            const certType = cert.accountType || '2 Step';

            return (
              <div 
                key={cert.id}
                className="bg-white/5 border border-white/10 rounded-3xl p-6 flex flex-col justify-between hover:border-amber-500/40 transition-all shadow-xl group"
              >
                <div className="space-y-4">
                  <div className="flex justify-between items-start">
                    <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shadow-md">
                      <Award className="w-6 h-6" />
                    </div>
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 uppercase tracking-wider">
                      {certPhase}
                    </span>
                  </div>

                  <div>
                    <h4 className="text-base font-extrabold text-white tracking-wide">
                      {certPhase} Certificate
                    </h4>
                    <p className="text-[11px] font-mono text-slate-400 mt-0.5">
                      ID: {certId}
                    </p>
                  </div>

                  <div className="space-y-1.5 text-xs text-slate-400 bg-black/20 p-3.5 rounded-2xl border border-white/5">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Trader Name</span>
                      <span className="text-white font-bold">{certName}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Account Size</span>
                      <span className="text-emerald-400 font-bold font-mono">{certSize}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Account Type</span>
                      <span className="text-slate-300 capitalize">{certType}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Issue Date</span>
                      <span className="text-slate-300 font-mono">{cert.issueDate || cert.date || new Date().toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t border-white/10 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setActiveCert(cert)}
                    className="flex-1 py-2.5 bg-amber-500/10 hover:bg-amber-500 text-amber-300 hover:text-slate-950 border border-amber-500/30 rounded-xl text-xs font-extrabold transition-all text-center uppercase tracking-wider cursor-pointer"
                  >
                    View Certificate
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Full-Screen Digital Certificate Modal */}
      {activeCert && (
        <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 overflow-y-auto backdrop-blur-md">
          <div className="relative w-full max-w-4xl space-y-4 my-8">
            
            {/* Modal Top Control Bar */}
            <div className="flex justify-between items-center bg-slate-900 border border-white/10 rounded-2xl px-5 py-3">
              <div className="flex items-center space-x-2 text-white font-bold text-xs">
                <Award className="w-4 h-4 text-amber-400" />
                <span>Certificate #{activeCert.certificateId || activeCert.id}</span>
              </div>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  disabled={isDownloading}
                  onClick={() => downloadPNG(activeCert)}
                  className="flex items-center space-x-1.5 px-3.5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold transition-all cursor-pointer shadow-lg shadow-blue-600/20"
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span>{isDownloading ? 'Generating...' : 'Download PNG'}</span>
                </button>

                <button
                  type="button"
                  disabled={isDownloading}
                  onClick={() => downloadPDF(activeCert)}
                  className="flex items-center space-x-1.5 px-3.5 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-xl text-xs font-extrabold transition-all cursor-pointer shadow-lg shadow-amber-500/20"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>{isDownloading ? 'Generating...' : 'Download PDF'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveCert(null)}
                  className="p-2 text-slate-400 hover:text-white rounded-xl bg-white/5 hover:bg-white/10 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Rendered Official Certificate Card Node (for display, canvas PNG, and PDF download) */}
            <div className="w-full">
              <LuxuryCertificate 
                certificate={activeCert}
                template={template}
                containerRef={certRef}
              />
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
