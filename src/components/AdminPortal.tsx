import React, { useState } from 'react';
import { 
  ShieldAlert, Mail, Lock, AlertCircle, ArrowLeft, Terminal, Server
} from 'lucide-react';
import { auth, db } from '../firebase';
import { signInWithEmailAndPassword, signOut, createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { UserProfile } from '../types';
import { ensureUserAffiliateCode } from '../utils/affiliateManager';

interface AdminPortalProps {
  onAdminAuthSuccess: (profile: UserProfile) => void;
  onBackToLanding: () => void;
}

export default function AdminPortal({ onAdminAuthSuccess, onBackToLanding }: AdminPortalProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setIsLoading(true);

    if (!email.trim() || !password.trim()) {
      setErrorMsg("Please enter both administrator credentials.");
      setIsLoading(false);
      return;
    }

    if (password.length < 6) {
      setErrorMsg("Password must be at least 6 characters.");
      setIsLoading(false);
      return;
    }

    try {
      // 1. Authenticate with Firebase Auth
      let creds;
      try {
        creds = await signInWithEmailAndPassword(auth, email.trim(), password);
      } catch (signInErr: any) {
        if (signInErr.code === 'auth/user-not-found' || signInErr.code === 'auth/invalid-credential') {
          try {
            creds = await createUserWithEmailAndPassword(auth, email.trim(), password);
          } catch (signUpErr: any) {
            if (signUpErr.code === 'auth/email-already-in-use') {
              throw signInErr;
            } else {
              throw signUpErr;
            }
          }
        } else {
          throw signInErr;
        }
      }
      
      // 2. Fetch configured admin email from settings/general
      let allowedAdminEmail = 'ATgrowfund@gmail.com';
      try {
        const settingsRef = doc(db, 'settings', 'general');
        const settingsSnap = await getDoc(settingsRef);
        
        if (settingsSnap.exists()) {
          const settingsData = settingsSnap.data();
          if (settingsData.adminEmail) {
            allowedAdminEmail = settingsData.adminEmail.trim();
          }
        } else {
          // Doc doesn't exist, let's initialize it with default values
          await setDoc(settingsRef, {
            adminEmail: 'ATgrowfund@gmail.com',
            supportEmail: 'atfundingsupport@gmail.com',
            facebookLink: 'https://www.facebook.com/share/1MUjNkYEyF/',
            instagramLink: 'https://www.instagram.com/atfunding_?igsh=MTJwcnNrMTZ2NGppZg==',
            telegramLink: 'https://t.me/httpsAsjadTrades',
            updatedAt: new Date().toISOString()
          });
        }
      } catch (settingsError) {
        console.warn("Could not fetch settings from Firestore (offline fallback):", settingsError);
      }

      const loginEmail = (creds.user.email || '').toLowerCase();
      const isAllowedAdmin = 
        loginEmail === allowedAdminEmail.toLowerCase() || 
        loginEmail === 'atgrowfund@gmail.com' || 
        loginEmail === 'asjadtrades07@gmail.com';

      if (!isAllowedAdmin) {
        // If not the authorized admin, sign out immediately and deny entry
        await signOut(auth);
        throw new Error("Access Denied: This account is not authorized as an administrator.");
      }

      // If email matches the allowedAdminEmail, ensure they have role = 'admin' in users collection
      const userRef = doc(db, 'users', creds.user.uid);
      let userSnap = null;
      try {
        userSnap = await getDoc(userRef);
      } catch (userGetError) {
        console.warn("Could not retrieve user profile document from Firestore (offline fallback):", userGetError);
      }

      let profile: UserProfile;
      if (userSnap && userSnap.exists()) {
        profile = {
          ...(userSnap.data() as UserProfile),
          role: 'admin' as const
        };
        if (!profile.affiliateCode) {
          profile.affiliateCode = await ensureUserAffiliateCode({ uid: creds.user.uid, email: loginEmail });
        }
      } else {
        const permanentAffiliateCode = await ensureUserAffiliateCode({ uid: creds.user.uid, email: loginEmail });
        profile = {
          uid: creds.user.uid,
          email: loginEmail,
          displayName: loginEmail.split('@')[0],
          name: loginEmail.split('@')[0],
          status: 'active',
          role: 'admin',
          affiliateCode: permanentAffiliateCode,
          createdAt: new Date().toISOString()
        };
      }

      try {
        await setDoc(userRef, profile);
      } catch (userSetError) {
        console.warn("Could not update admin role in Firestore (offline fallback):", userSetError);
      }
      onAdminAuthSuccess(profile);
    } catch (error: any) {
      console.warn("Firebase Admin Auth Issue occurred:", {
        code: error?.code,
        message: error?.message,
        fullError: error
      });
      
      if (error?.code === 'auth/operation-not-allowed') {
        setErrorMsg("Email/Password Authentication is disabled. Please enable it in your Firebase Authentication console (Sign-in method panel).");
      } else if (error?.code === 'auth/user-not-found' || error?.code === 'auth/wrong-password' || error?.code === 'auth/invalid-credential') {
        setErrorMsg("Invalid administrator email or password.");
      } else {
        setErrorMsg(error?.message || "Authentication failed. Access Denied.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div id="admin-portal" className="min-h-screen bg-[#030712] text-slate-100 flex items-center justify-center p-4 relative font-sans overflow-hidden">
      {/* Dark cybergrid subtle background lines */}
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f2937_1px,transparent_1px),linear-gradient(to_bottom,#1f2937_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_0%,#000_70%,transparent_100%)] opacity-30"></div>
      
      {/* Background glow effects */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 w-96 h-96 bg-blue-500/10 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-10 right-10 w-64 h-64 bg-indigo-500/10 rounded-full blur-[100px] pointer-events-none"></div>

      <div className="w-full max-w-md space-y-6 relative z-10">
        
        {/* Hidden landing back navigation */}
        <button
          onClick={onBackToLanding}
          className="flex items-center space-x-1.5 text-xs font-semibold text-slate-500 hover:text-slate-300 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Exit Secure Portal</span>
        </button>

        {/* Access Terminal Panel */}
        <div className="bg-slate-900/60 border border-blue-500/20 rounded-3xl p-8 shadow-[0_0_50px_rgba(59,130,246,0.1)] backdrop-blur-xl space-y-6">
          
          {/* Header */}
          <div className="text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/35 flex items-center justify-center mx-auto shadow-inner">
              <Terminal className="w-6 h-6 text-blue-400" />
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-bold tracking-tight text-white flex items-center justify-center space-x-2">
                <span>ATFunding Admin Console</span>
              </h2>
              <p className="text-xs text-slate-500 font-mono">RESTRICTED ADMINISTRATIVE UTILITY</p>
            </div>
          </div>

          {/* Secure Warning Panel */}
          <div className="p-3.5 bg-yellow-500/5 border border-yellow-500/10 rounded-2xl flex items-start space-x-2.5 text-[11px] text-yellow-500/80 leading-relaxed font-mono">
            <ShieldAlert className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />
            <span>Unauthorized access, scanning, or credential harvesting is strictly prohibited and logged to system telemetry.</span>
          </div>

          {errorMsg && (
            <div className="p-3.5 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-start space-x-2 text-xs text-red-400 font-mono leading-relaxed">
              <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Terminal Input Form */}
          <form onSubmit={handleAdminLogin} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono flex items-center space-x-1.5">
                <Server className="w-3.5 h-3.5" />
                <span>Admin Identifier (Email)</span>
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                <input
                  type="email"
                  required
                  placeholder="admin@atfunding.io"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full h-11 bg-black/40 border border-slate-800 rounded-xl pl-10 pr-4 text-xs text-slate-200 placeholder-slate-600 font-mono focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-wider font-mono">Console Passkey (Password)</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full h-11 bg-black/40 border border-slate-800 rounded-xl pl-10 pr-4 text-xs text-slate-200 placeholder-slate-600 font-mono focus:outline-none focus:border-blue-500 transition-colors"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full h-11 bg-blue-950/80 hover:bg-blue-900 border border-blue-500/30 hover:border-blue-500/50 text-blue-300 hover:text-white font-bold rounded-xl text-xs font-mono tracking-wider transition-all shadow-lg cursor-pointer flex items-center justify-center space-x-2"
            >
              {isLoading ? (
                <span>Executing handshake...</span>
              ) : (
                <>
                  <span>Initialize Console session</span>
                </>
              )}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
