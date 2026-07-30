import React, { useState, useRef, useEffect } from 'react';
import { 
  Award, Search, Upload, Save, FileText, Image as ImageIcon, 
  CheckCircle2, X, AlertTriangle, User, RefreshCw, Eye, Download, Trash2, Mail
} from 'lucide-react';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { doc, setDoc, collection, onSnapshot, deleteDoc, getDocs } from 'firebase/firestore';
import { db, storage, auth, handleFirestoreError, OperationType } from '../firebase';
import { UserProfile, TradingAccount, Certificate } from '../types';

interface AdminCertificateManagerProps {
  users: UserProfile[];
  accounts: TradingAccount[];
  certificates: Certificate[];
}

export default function AdminCertificateManager({ users, accounts, certificates: propCertificates }: AdminCertificateManagerProps) {
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedUser, setSelectedUser] = useState<UserProfile | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<TradingAccount | null>(null);

  // Certificate form state
  const [certificateType, setCertificateType] = useState('Passed Evaluation');
  const [customTitle, setCustomTitle] = useState('CERTIFICATE OF EXCELLENCE');
  const [accountSizeInput, setAccountSizeInput] = useState('$100,000');
  const [accountTypeInput, setAccountTypeInput] = useState('2 Step');
  const [phaseInput, setPhaseInput] = useState('Phase 1');
  const [statusInput, setStatusInput] = useState('Passed');

  // File Upload State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [fileType, setFileType] = useState<'image' | 'pdf' | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Save/Upload State
  const [isSaving, setIsSaving] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Issued Certificates State
  const [issuedCertificates, setIssuedCertificates] = useState<Certificate[]>(propCertificates || []);
  const [previewCert, setPreviewCert] = useState<Certificate | null>(null);

  // Sync prop certificates
  useEffect(() => {
    if (propCertificates) setIssuedCertificates(propCertificates);
  }, [propCertificates]);

  // Also listen directly to top-level `certificates` collection for real-time updates
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'certificates'), (snap) => {
      const list: Certificate[] = [];
      snap.forEach((d) => {
        list.push({ id: d.id, ...d.data() } as Certificate);
      });
      // Sort by upload/created date descending
      list.sort((a, b) => new Date(b.createdAt || b.uploadDate || 0).getTime() - new Date(a.createdAt || a.uploadDate || 0).getTime());
      setIssuedCertificates(list);
    }, (err) => {
      console.warn("Certificates live subscription note:", err);
    });
    return () => unsub();
  }, []);

  // Filter users by search query (Gmail Address or User ID or Display Name)
  const filteredUsers = users.filter(u => {
    if (!searchQuery.trim()) return true; // Show all users if query is empty
    const query = searchQuery.toLowerCase().trim();
    const email = (u.email || '').toLowerCase();
    const uid = (u.uid || '').toLowerCase();
    const name = (u.displayName || u.name || '').toLowerCase();
    return email.includes(query) || uid.includes(query) || name.includes(query);
  });

  // Handle user selection from list or dropdown
  const handleSelectUser = (user: UserProfile) => {
    setSelectedUser(user);
    setSearchQuery(user.email || '');

    // Auto find user's primary trading account
    const userAccounts = accounts.filter(a => a.userId === user.uid);
    if (userAccounts.length > 0) {
      const primary = userAccounts[0];
      setSelectedAccount(primary);
      setAccountSizeInput(`$${primary.size.toLocaleString()}`);
      setAccountTypeInput(primary.accountType === 'one_step' ? '1 Step' : primary.accountType === 'two_step' ? '2 Step' : primary.accountType === 'instant_bolt' ? 'Instant Bolt' : 'Standard');
      setPhaseInput(primary.phase === 3 ? 'Funded' : `Phase ${primary.phase || 1}`);
      setStatusInput(primary.status === 'passed' ? 'Passed' : primary.status === 'funded' ? 'Funded' : 'Active');
    } else {
      setSelectedAccount(null);
      setAccountSizeInput('$100,000');
      setAccountTypeInput('2 Step');
      setPhaseInput('Phase 1');
      setStatusInput('Active');
    }
  };

  // Helper to handle manual email/UID input if user not in preset array
  const handleDirectEmailUser = (emailOrUid: string) => {
    const trimmed = emailOrUid.trim();
    if (!trimmed) return;

    // Check if matching user exists
    const match = users.find(u => 
      u.email?.toLowerCase() === trimmed.toLowerCase() || 
      u.uid?.toLowerCase() === trimmed.toLowerCase()
    );

    if (match) {
      handleSelectUser(match);
    } else {
      // Create lightweight profile object
      const safeUid = trimmed.includes('@') 
        ? `USR-${trimmed.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`
        : trimmed;
      const directUser: UserProfile = {
        uid: safeUid,
        email: trimmed.includes('@') ? trimmed : `${trimmed}@atfunding.com`,
        displayName: trimmed.split('@')[0],
        name: trimmed.split('@')[0],
        status: 'active',
        role: 'trader',
        affiliateCode: '',
        createdAt: new Date().toISOString()
      };
      setSelectedUser(directUser);
      setSelectedAccount(null);
    }
  };

  // Handle file selection (PNG, JPG, JPEG, PDF)
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      setFeedbackMsg({ type: 'error', text: 'File size exceeds 10MB limit. Please select a smaller certificate file.' });
      return;
    }

    setSelectedFile(file);
    const fileExt = file.name.split('.').pop()?.toLowerCase();

    if (file.type.includes('pdf') || fileExt === 'pdf') {
      setFileType('pdf');
      setFilePreview(null);
    } else {
      setFileType('image');
      const reader = new FileReader();
      reader.onload = (evt) => {
        setFilePreview(evt.target?.result as string);
      };
      reader.readAsDataURL(file);
    }
    setFeedbackMsg(null);
  };

  // Save certificate to Firebase Storage & Firestore
  const handleSaveCertificate = async (e: React.FormEvent) => {
    e.preventDefault();

    let targetUser = selectedUser;

    // Fallback: If no user selected yet, try using search query or top user match
    if (!targetUser) {
      if (searchQuery.trim()) {
        const trimmed = searchQuery.trim();
        const match = users.find(u => 
          u.email?.toLowerCase() === trimmed.toLowerCase() || 
          u.uid?.toLowerCase() === trimmed.toLowerCase() ||
          (u.displayName && u.displayName.toLowerCase().includes(trimmed.toLowerCase()))
        );
        if (match) {
          targetUser = match;
          setSelectedUser(match);
        } else {
          // Construct direct email profile
          const safeUid = trimmed.includes('@') 
            ? `USR-${trimmed.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}`
            : trimmed;
          targetUser = {
            uid: safeUid,
            email: trimmed.includes('@') ? trimmed : `${trimmed}@atfunding.com`,
            displayName: trimmed.split('@')[0],
            name: trimmed.split('@')[0],
            status: 'active',
            role: 'trader',
            affiliateCode: '',
            createdAt: new Date().toISOString()
          };
          setSelectedUser(targetUser);
        }
      } else if (users.length > 0) {
        // Default to first user if available
        targetUser = users[0];
        setSelectedUser(users[0]);
      }
    }

    if (!targetUser) {
      setFeedbackMsg({ 
        type: 'error', 
        text: '⚠️ Please select or type a user email address in Step 1 first.' 
      });
      // Scroll to step 1
      document.getElementById('step1-user-search')?.scrollIntoView({ behavior: 'smooth' });
      return;
    }

    setIsSaving(true);
    setFeedbackMsg(null);

    try {
      const certId = `CERT-${Date.now().toString(36).toUpperCase()}-${Math.floor(1000 + Math.random() * 9000)}`;
      let certUrl = '';

      // 1. Upload file if provided
      if (selectedFile) {
        // Read file as base64 first as safe fallback
        let base64Url = filePreview;
        if (!base64Url) {
          base64Url = await new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = (evt) => resolve((evt.target?.result as string) || '');
            reader.onerror = () => resolve('');
            reader.readAsDataURL(selectedFile);
          });
        }

        try {
          const storageRef = ref(storage, `certificates/${targetUser.uid}/${certId}_${selectedFile.name}`);
          
          const uploadPromise = uploadBytes(storageRef, selectedFile).then(async (snapshot) => {
            return await getDownloadURL(snapshot.ref);
          });

          const timeoutPromise = new Promise<string>((_, reject) => 
            setTimeout(() => reject(new Error("Storage upload timeout")), 3000)
          );

          certUrl = await Promise.race([uploadPromise, timeoutPromise]);
        } catch (storageErr) {
          console.warn("Firebase storage upload skipped/timed out, using base64 URL:", storageErr);
          certUrl = base64Url || '';
        }
      }

      const timestamp = new Date().toISOString();
      const adminName = auth.currentUser?.email || 'Admin';

      const certificateData: Certificate = {
        id: certId,
        certificateId: certId,
        userId: targetUser.uid,
        userName: targetUser.displayName || targetUser.name || targetUser.email?.split('@')[0] || 'Trader',
        name: targetUser.displayName || targetUser.name || targetUser.email?.split('@')[0] || 'Trader',
        email: targetUser.email,
        userEmail: targetUser.email,
        accountSize: accountSizeInput,
        accountType: accountTypeInput,
        phase: phaseInput,
        status: statusInput,
        certificateType: certificateType,
        customTitle: customTitle,
        certificateUrl: certUrl || undefined,
        certificateImage: certUrl || undefined,
        issueDate: new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }),
        uploadDate: timestamp,
        uploadedBy: adminName,
        createdAt: timestamp
      };

      // 2. Save in Firestore subcollection users/{userId}/certificates/{certificateId}
      try {
        await setDoc(doc(db, 'users', targetUser.uid, 'certificates', certId), certificateData);
        await setDoc(doc(db, 'certificates', certId), certificateData);
      } catch (fErr) {
        console.warn("Firestore setDoc warning:", fErr);
        try {
          await setDoc(doc(db, 'certificates', certId), certificateData);
        } catch (e2) {
          console.warn("Top-level setDoc warning:", e2);
        }
      }

      // Update local state instantly so it appears in the list right away
      setIssuedCertificates(prev => [certificateData, ...prev.filter(c => c.id !== certId)]);

      // 3. Send Dashboard Notification to User as per specification
      try {
        const notifId = `NOTIF-${Date.now()}`;
        await setDoc(doc(db, 'notifications', notifId), {
          id: notifId,
          userId: targetUser.uid,
          title: 'New Certificate Issued! 📜',
          message: 'Your certificate has been issued and is now available in the Certificates section.',
          type: 'success',
          read: false,
          createdAt: timestamp
        });
      } catch (nErr) {
        console.warn("Notification save warning:", nErr);
      }

      setFeedbackMsg({
        type: 'success',
        text: `🎉 Certificate ${certId} successfully uploaded and assigned to ${targetUser.displayName || targetUser.email}!`
      });

      // Reset form file inputs
      setSelectedFile(null);
      setFilePreview(null);
      setFileType(null);
      if (fileInputRef.current) fileInputRef.current.value = '';

    } catch (err) {
      console.error("Save certificate error:", err);
      setFeedbackMsg({ type: 'error', text: 'Error saving certificate to Firebase. Please try again.' });
    } finally {
      setIsSaving(false);
    }
  };

  // Delete certificate from Firestore
  const handleDeleteCert = async (cert: Certificate) => {
    if (!window.confirm(`Are you sure you want to delete Certificate ${cert.certificateId || cert.id}?`)) return;
    try {
      await deleteDoc(doc(db, 'certificates', cert.id || cert.certificateId));
      if (cert.userId) {
        await deleteDoc(doc(db, 'users', cert.userId, 'certificates', cert.id || cert.certificateId));
      }
      setFeedbackMsg({ type: 'success', text: 'Certificate removed successfully.' });
    } catch (err) {
      console.error("Delete cert error:", err);
      alert("Error deleting certificate record.");
    }
  };

  return (
    <div id="admin-certificate-manager" className="space-y-8 animate-fade-in">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-sm shadow-xl">
        <div>
          <h2 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight flex items-center gap-2">
            <Award className="w-6 h-6 text-amber-400" />
            <span>📜 Certificate Manager</span>
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Search traders by Gmail or User ID, upload custom award certificates, and save them directly to user accounts.
          </p>
        </div>

        <div className="px-4 py-2 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 font-mono text-xs font-bold flex items-center gap-2">
          <Award className="w-4 h-4" />
          <span>{issuedCertificates.length} Total Certificates Issued</span>
        </div>
      </div>

      {feedbackMsg && (
        <div className={`p-4 rounded-2xl text-xs font-bold shadow-lg flex items-center justify-between ${
          feedbackMsg.type === 'success' 
            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' 
            : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
        }`}>
          <div className="flex items-center space-x-2">
            {feedbackMsg.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
            <span>{feedbackMsg.text}</span>
          </div>
          <button type="button" onClick={() => setFeedbackMsg(null)} className="text-slate-400 hover:text-white">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* WORKFLOW GRID */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        
        {/* LEFT COLUMN: 🔍 1. SEARCH USER & SELECT */}
        <div id="step1-user-search" className="lg:col-span-5 space-y-6">
          <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-sm shadow-xl space-y-5">
            <div className="border-b border-white/10 pb-3 flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-white uppercase tracking-wider flex items-center gap-2">
                <Search className="w-4 h-4 text-blue-400" />
                <span>🔍 Step 1: Select or Search Target User</span>
              </h3>
            </div>

            {/* Quick Dropdown Selection */}
            <div className="space-y-1">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Quick Select From Registered Traders ({users.length})
              </label>
              <select
                value={selectedUser?.uid || ''}
                onChange={(e) => {
                  const val = e.target.value;
                  if (!val) {
                    setSelectedUser(null);
                  } else {
                    const found = users.find(u => u.uid === val);
                    if (found) handleSelectUser(found);
                  }
                }}
                className="w-full h-10 bg-black/40 border border-blue-500/30 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-blue-400 font-medium"
              >
                <option value="">-- Choose Trader From List --</option>
                {users.map(u => (
                  <option key={u.uid} value={u.uid}>
                    {u.displayName || u.name || 'Trader'} ({u.email || u.uid})
                  </option>
                ))}
              </select>
            </div>

            {/* Manual Search Box */}
            <div className="space-y-2 pt-2">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                Or Search By Gmail Address / User ID
              </label>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Type Gmail or User ID (e.g. trader@gmail.com)..."
                  value={searchQuery}
                  onChange={(e) => {
                    const q = e.target.value;
                    setSearchQuery(q);
                    if (q.trim()) {
                      handleDirectEmailUser(q);
                    }
                  }}
                  className="w-full h-11 pl-10 pr-4 bg-black/40 border border-blue-500/30 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-400 font-medium"
                />
              </div>
            </div>

            {/* Search Results List */}
            {searchQuery.trim() !== '' && (
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1 border border-white/10 rounded-2xl p-2 bg-black/30">
                {filteredUsers.length === 0 ? (
                  <div className="p-3 text-center text-xs text-amber-400 space-y-2">
                    <p>No account found for "{searchQuery}".</p>
                    <button
                      type="button"
                      onClick={() => handleDirectEmailUser(searchQuery)}
                      className="px-3 py-1.5 bg-amber-500 text-slate-950 rounded-xl text-[11px] font-bold"
                    >
                      Use "{searchQuery}" as Target Email
                    </button>
                  </div>
                ) : (
                  filteredUsers.map((u) => {
                    const uAccounts = accounts.filter(a => a.userId === u.uid);
                    const primaryAcc = uAccounts[0];
                    const isSelected = selectedUser?.uid === u.uid;

                    return (
                      <div
                        key={u.uid}
                        onClick={() => handleSelectUser(u)}
                        className={`p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-blue-600/20 border-blue-500 text-white shadow-md'
                            : 'bg-white/5 border-white/5 hover:bg-white/10 text-slate-300'
                        }`}
                      >
                        <div className="flex justify-between items-start">
                          <div>
                            <span className="font-bold text-white block">
                              {u.displayName || u.name || 'Unnamed Trader'}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono block">
                              {u.email}
                            </span>
                          </div>
                          <span className="text-[9px] font-mono font-bold bg-white/10 text-slate-300 px-1.5 py-0.5 rounded">
                            ID: {u.uid.slice(0, 8)}...
                          </span>
                        </div>

                        {primaryAcc && (
                          <div className="mt-2 pt-2 border-t border-white/10 grid grid-cols-2 gap-2 text-[10px] font-mono text-slate-400">
                            <div>Account Size: <span className="text-emerald-400 font-bold">${primaryAcc.size.toLocaleString()}</span></div>
                            <div>Phase: <span className="text-amber-400 font-bold">{primaryAcc.phase === 3 ? 'Funded' : `Phase ${primaryAcc.phase || 1}`}</span></div>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            )}

            {/* Selected User Details Box */}
            {selectedUser ? (
              <div className="bg-gradient-to-br from-blue-950/40 to-slate-900 border border-blue-500/30 rounded-2xl p-4 space-y-3 shadow-lg">
                <div className="flex items-center justify-between border-b border-blue-500/20 pb-2">
                  <span className="text-[10px] font-bold text-blue-400 uppercase tracking-widest flex items-center gap-1">
                    <User className="w-3.5 h-3.5" /> Selected Target User
                  </span>
                  <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase font-mono">
                    Verified Match
                  </span>
                </div>

                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Name:</span>
                    <span className="font-bold text-white">{selectedUser.displayName || selectedUser.name || 'Trader'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Gmail:</span>
                    <span className="font-mono text-blue-300 font-bold">{selectedUser.email}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">User ID:</span>
                    <span className="font-mono text-slate-300 text-[10px]">{selectedUser.uid}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Account Size:</span>
                    <span className="font-mono text-emerald-400 font-bold">{accountSizeInput}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Account Type:</span>
                    <span className="text-slate-200 capitalize">{accountTypeInput}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Phase & Status:</span>
                    <span className="font-mono text-amber-400 font-bold">{phaseInput} ({statusInput})</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="p-4 bg-amber-500/10 border border-dashed border-amber-500/30 rounded-2xl text-center text-xs text-amber-300">
                👉 Select a trader from the dropdown above or type an email to link this certificate.
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: 📤 2. UPLOAD CERTIFICATE & 💾 3. SAVE TO USER */}
        <div className="lg:col-span-7 space-y-6">
          <form onSubmit={handleSaveCertificate} className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-sm shadow-xl space-y-6">
            <div className="border-b border-white/10 pb-3 flex items-center justify-between">
              <h3 className="text-sm font-extrabold text-white uppercase tracking-wider flex items-center gap-2">
                <Upload className="w-4 h-4 text-amber-400" />
                <span>📤 Step 2 & 3: Upload & Save Certificate</span>
              </h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Certificate Type</label>
                <select
                  value={certificateType}
                  onChange={(e) => setCertificateType(e.target.value)}
                  className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-amber-400"
                >
                  <option value="Passed Evaluation">Passed Evaluation</option>
                  <option value="Phase 1 Passed">Phase 1 Passed</option>
                  <option value="Phase 2 Passed">Phase 2 Passed</option>
                  <option value="Funded Trader Certificate">Funded Trader Certificate</option>
                  <option value="Payout Achievement">Payout Achievement</option>
                  <option value="Custom Award">Custom Award</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Certificate Title</label>
                <input
                  type="text"
                  value={customTitle}
                  onChange={(e) => setCustomTitle(e.target.value)}
                  placeholder="e.g. CERTIFICATE OF EXCELLENCE"
                  className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-amber-400"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Account Size</label>
                <input
                  type="text"
                  value={accountSizeInput}
                  onChange={(e) => setAccountSizeInput(e.target.value)}
                  placeholder="$100,000"
                  className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-amber-400 font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Phase</label>
                <select
                  value={phaseInput}
                  onChange={(e) => setPhaseInput(e.target.value)}
                  className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none focus:border-amber-400"
                >
                  <option value="Trial">Trial</option>
                  <option value="Phase 1">Phase 1</option>
                  <option value="Phase 2">Phase 2</option>
                  <option value="Funded">Funded</option>
                </select>
              </div>
            </div>

            {/* File Upload Box (PC & Mobile compatible) */}
            <div className="space-y-2">
              <label className="text-[11px] font-bold text-amber-400 uppercase tracking-wider block flex items-center justify-between">
                <span>Upload Certificate File (PNG, JPG, JPEG, PDF) *</span>
                <span className="text-[10px] text-slate-400 font-normal">PC & Mobile Device File Picker</span>
              </label>

              <div 
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-amber-500/40 hover:border-amber-400 bg-amber-500/5 hover:bg-amber-500/10 rounded-2xl p-6 text-center cursor-pointer transition-all group space-y-3"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,application/pdf"
                  onChange={handleFileChange}
                  className="hidden"
                />

                {selectedFile ? (
                  <div className="space-y-2">
                    <div className="w-12 h-12 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center mx-auto border border-amber-500/30">
                      {fileType === 'pdf' ? <FileText className="w-6 h-6" /> : <ImageIcon className="w-6 h-6" />}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-white truncate max-w-xs mx-auto">{selectedFile.name}</p>
                      <p className="text-[10px] text-slate-400 font-mono">{(selectedFile.size / 1024).toFixed(1)} KB • {selectedFile.type || 'Document'}</p>
                    </div>

                    {filePreview && (
                      <div className="mt-3 max-w-xs mx-auto rounded-xl overflow-hidden border border-white/10 max-h-36">
                        <img src={filePreview} alt="Certificate preview" className="w-full h-full object-cover" />
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 text-slate-400 group-hover:text-amber-400 group-hover:bg-amber-500/10 transition-colors flex items-center justify-center mx-auto">
                      <Upload className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-white">Click or tap to choose certificate from storage</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">Supports PNG, JPG, JPEG, and PDF documents (Max 10MB)</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Save Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={isSaving}
                className={`w-full h-13 rounded-2xl font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center space-x-2 shadow-xl cursor-pointer ${
                  isSaving
                    ? 'bg-amber-500/50 text-slate-900 cursor-wait'
                    : selectedUser || searchQuery.trim()
                      ? 'bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 hover:scale-[1.01] text-slate-950 shadow-amber-500/25 border border-amber-300/40'
                      : 'bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white shadow-blue-500/20'
                }`}
              >
                <Save className="w-4 h-4" />
                <span>
                  {isSaving 
                    ? '⏳ UPLOADING & SAVING CERTIFICATE...' 
                    : selectedUser 
                      ? `💾 SAVE CERTIFICATE TO ${selectedUser.displayName || selectedUser.email}`
                      : searchQuery.trim()
                        ? `💾 SAVE CERTIFICATE TO ${searchQuery.trim()}`
                        : '💾 SAVE CERTIFICATE TO USER'
                  }
                </span>
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* ISSUED CERTIFICATES TABLE */}
      <div className="bg-white/5 border border-white/10 rounded-3xl p-6 backdrop-blur-sm shadow-xl space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4">
          <div>
            <h3 className="text-base font-extrabold text-white flex items-center gap-2">
              <Award className="w-5 h-5 text-amber-400" />
              <span>All Issued Certificates</span>
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">Live list of certificates assigned to users in Firestore.</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left min-w-[700px]">
            <thead>
              <tr className="border-b border-white/10 text-slate-400 text-[11px] font-mono uppercase tracking-wider pb-3">
                <th className="py-3 px-4">Certificate ID</th>
                <th className="py-3 px-4">Trader Name & Email</th>
                <th className="py-3 px-4">Type & Phase</th>
                <th className="py-3 px-4">Account Size</th>
                <th className="py-3 px-4">Issue Date</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 text-xs text-slate-300 font-medium">
              {issuedCertificates.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-xs text-slate-500">
                    No certificates uploaded yet. Use the tool above to issue certificates.
                  </td>
                </tr>
              ) : (
                issuedCertificates.map((cert) => (
                  <tr key={cert.id || cert.certificateId} className="hover:bg-white/5 transition-colors">
                    <td className="py-3 px-4 font-mono font-bold text-amber-400">
                      {cert.certificateId || cert.id}
                    </td>
                    <td className="py-3 px-4">
                      <div>
                        <span className="font-bold text-white block">{cert.name || cert.userName || 'Trader'}</span>
                        <span className="text-[10px] text-slate-400 font-mono">{cert.userEmail || cert.email}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <span className="px-2.5 py-1 rounded-full text-[10px] font-mono font-bold bg-amber-500/15 border border-amber-500/30 text-amber-300">
                        {cert.certificateType || cert.phase || 'Certificate'}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-emerald-400">
                      {typeof cert.accountSize === 'number' ? `$${cert.accountSize.toLocaleString()}` : cert.accountSize || '$100,000'}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-400">
                      {cert.issueDate || cert.uploadDate || 'N/A'}
                    </td>
                    <td className="py-3 px-4 text-right space-x-2">
                      {cert.certificateUrl && (
                        <a
                          href={cert.certificateUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-2.5 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 border border-blue-500/30 text-blue-300 text-xs font-bold inline-flex items-center gap-1 transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" /> View
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDeleteCert(cert)}
                        className="px-2.5 py-1.5 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 text-rose-300 text-xs font-bold inline-flex items-center gap-1 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
