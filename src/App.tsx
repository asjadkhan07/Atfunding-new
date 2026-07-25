import React, { useState, useEffect } from 'react';
import LandingPage from './components/LandingPage';
import AuthPage from './components/AuthPage';
import TraderDashboard from './components/TraderDashboard';
import AdminPortal from './components/AdminPortal';
import AdminPanel from './components/AdminPanel';
import { UserProfile } from './types';
import { auth, db } from './firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, increment } from 'firebase/firestore';

export default function App() {
  const [screen, setScreen] = useState<'landing' | 'auth' | 'dashboard' | 'admin-portal' | 'admin-dashboard'>('landing');
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  // Monitor firebase authentication state on boot
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (authUser) => {
      if (authUser) {
        try {
          // Fetch allowed admin email gracefully
          let allowedAdminEmail = 'atgrowfund@gmail.com';
          try {
            const settingsSnap = await getDoc(doc(db, 'settings', 'general'));
            if (settingsSnap.exists()) {
              allowedAdminEmail = (settingsSnap.data().adminEmail || 'atgrowfund@gmail.com').trim().toLowerCase();
            }
          } catch (settingsError) {
            console.warn("Failed to fetch general settings, using default admin email:", settingsError);
          }

          const userEmail = (authUser.email || '').toLowerCase();
          const isUserConfiguredAdmin = 
            userEmail === allowedAdminEmail || 
            userEmail === 'atgrowfund@gmail.com' || 
            userEmail === 'asjadtrades07@gmail.com';

          let docSnap = null;
          try {
            docSnap = await getDoc(doc(db, 'users', authUser.uid));
          } catch (userDocError) {
            console.warn("Failed to fetch user profile, using fallback profile creation:", userDocError);
          }

          const finalRole = isUserConfiguredAdmin ? 'admin' : 'trader';

          if (docSnap && docSnap.exists()) {
            const profile = docSnap.data() as UserProfile;
            const updatedProfile = { ...profile, role: finalRole };
            
            setUserProfile(updatedProfile);
            
            // Sync role to Firestore if it changed
            if (profile.role !== finalRole) {
              try {
                await setDoc(doc(db, 'users', authUser.uid), { role: finalRole }, { merge: true });
                console.log(`Synced user role to ${finalRole} in Firestore.`);
              } catch (writeError) {
                console.warn("Could not sync user role to Firestore:", writeError);
              }
            }
            
            // Route based on role and current hash location
            if (finalRole === 'admin') {
              setScreen('admin-dashboard');
            } else if (window.location.hash === '#/admin-portal' || window.location.hash === '#admin-portal') {
              // Not an admin, sign out immediately
              await signOut(auth);
              setUserProfile(null);
              setScreen('admin-portal');
            } else {
              setScreen('dashboard');
            }
          } else {
            // Profile document missing fallback (default to trader or admin based on email)
            const fallback: UserProfile = {
              uid: authUser.uid,
              email: authUser.email || '',
              displayName: authUser.displayName || authUser.email?.split('@')[0] || 'Trader',
              name: authUser.displayName || authUser.email?.split('@')[0] || 'Trader',
              status: 'active',
              role: finalRole,
              affiliateCode: 'trader' + Math.floor(100 + Math.random() * 900),
              createdAt: new Date().toISOString()
            };
            setUserProfile(fallback);
            
            // Create user profile in Firestore
            try {
              await setDoc(doc(db, 'users', authUser.uid), fallback);
              console.log("Created user profile in Firestore.");
            } catch (createError) {
              console.warn("Could not create user profile in Firestore:", createError);
            }
            
            if (finalRole === 'admin') {
              setScreen('admin-dashboard');
            } else if (window.location.hash === '#/admin-portal' || window.location.hash === '#admin-portal') {
              await signOut(auth);
              setUserProfile(null);
              setScreen('admin-portal');
            } else {
              setScreen('dashboard');
            }
          }
        } catch (error) {
          console.error("Critical error inside auth status monitor:", error);
          setScreen('landing');
        }
      } else {
        setUserProfile(null);
        if (window.location.hash === '#/admin-portal' || window.location.hash === '#admin-portal') {
          setScreen('admin-portal');
        } else {
          // Check if user opened a referral link or registration request
          const href = window.location.href;
          const searchParams = new URLSearchParams(window.location.search);
          let hasRef = searchParams.get('ref') || searchParams.get('referral') || searchParams.get('code');

          if (!hasRef && window.location.hash.includes('?')) {
            const hashParams = new URLSearchParams(window.location.hash.substring(window.location.hash.indexOf('?')));
            hasRef = hashParams.get('ref') || hashParams.get('referral') || hashParams.get('code');
          }

          if (!hasRef) {
            const match = href.match(/[?&](ref|referral|code)=([^&/#]+)/i);
            if (match && match[2]) {
              hasRef = decodeURIComponent(match[2]);
            }
          }

          const isSignupAction = 
            Boolean(hasRef) || 
            searchParams.get('action') === 'signup' || 
            searchParams.get('mode') === 'signup' || 
            href.toLowerCase().includes('register') || 
            href.toLowerCase().includes('signup');

          if (isSignupAction) {
            setAuthMode('signup');
            setScreen('auth');
          } else {
            setScreen('landing');
          }
        }
      }
      setIsInitializing(false);
    });

    return () => unsubscribe();
  }, []);

  // Parse and save referral ID from URL on mount & track referral taps
  useEffect(() => {
    const href = window.location.href;
    const searchParams = new URLSearchParams(window.location.search);
    let referralId = searchParams.get('ref') || searchParams.get('referral') || searchParams.get('code');

    if (!referralId && window.location.hash.includes('?')) {
      const hashParams = new URLSearchParams(window.location.hash.substring(window.location.hash.indexOf('?')));
      referralId = hashParams.get('ref') || hashParams.get('referral') || hashParams.get('code');
    }

    if (!referralId) {
      const match = href.match(/[?&](ref|referral|code)=([^&/#]+)/i);
      if (match && match[2]) {
        referralId = decodeURIComponent(match[2]);
      }
    }

    if (referralId) {
      const cleanRef = referralId.trim();
      localStorage.setItem('referredBy', cleanRef);
      console.log('Saved referral ID to localStorage:', cleanRef);

      // Track link tap in Firestore if not already counted in this browser session
      const sessionKey = `tapped_ref_${cleanRef}`;
      if (!sessionStorage.getItem(sessionKey)) {
        sessionStorage.setItem(sessionKey, 'true');
        try {
          setDoc(doc(db, 'referral_stats', cleanRef), {
            code: cleanRef,
            clicks: increment(1),
            lastTappedAt: new Date().toISOString()
          }, { merge: true }).catch(err => console.warn("Failed to update referral_stats tap:", err));

          setDoc(doc(db, 'affiliates', cleanRef), {
            code: cleanRef,
            clicks: increment(1)
          }, { merge: true }).catch(err => console.warn("Failed to update affiliates tap:", err));
        } catch (e) {
          console.warn("Could not log referral tap metric:", e);
        }
      }
    }
  }, []);

  // Sync state if hash is updated dynamically on page
  useEffect(() => {
    const handleHashChange = () => {
      if (window.location.hash === '#/admin-portal' || window.location.hash === '#admin-portal') {
        if (userProfile) {
          if (userProfile.role === 'admin') {
            setScreen('admin-dashboard');
          } else {
            signOut(auth).then(() => {
              setUserProfile(null);
              setScreen('admin-portal');
            });
          }
        } else {
          setScreen('admin-portal');
        }
      } else {
        if (userProfile) {
          setScreen('dashboard');
        } else {
          setScreen('landing');
        }
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [userProfile]);

  const handleNavigateToAuth = (mode: 'login' | 'signup') => {
    setAuthMode(mode);
    setScreen('auth');
  };

  const handleAuthSuccess = async (profile: UserProfile) => {
    const isAdmin = profile.role === 'admin' || 
                    profile.email.toLowerCase() === 'atgrowfund@gmail.com' || 
                    profile.email.toLowerCase() === 'asjadtrades07@gmail.com';
    const updatedProfile = { ...profile, role: isAdmin ? ('admin' as const) : profile.role };
    setUserProfile(updatedProfile);
    
    if (isAdmin && profile.role !== 'admin') {
      try {
        await setDoc(doc(db, 'users', profile.uid), { role: 'admin' }, { merge: true });
        console.log("Updated user role to admin in Firestore via handleAuthSuccess.");
      } catch (e) {
        console.warn("Could not update user role to admin in Firestore in handleAuthSuccess:", e);
      }
    }

    if (isAdmin) {
      setScreen('admin-dashboard');
    } else {
      setScreen('dashboard');
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setUserProfile(null);
      if (window.location.hash === '#/admin-portal') {
        window.location.hash = '';
      }
      setScreen('landing');
    } catch (e) {
      console.error("Logout failed:", e);
    }
  };

  if (isInitializing) {
    return (
      <div className="min-h-screen bg-[#070a13] flex flex-col items-center justify-center text-gray-400 space-y-4">
        <div className="w-12 h-12 rounded-full border-4 border-indigo-500 border-t-transparent animate-spin"></div>
        <p className="text-xs font-semibold tracking-wider uppercase font-mono text-indigo-400">ATFunding Auth Sync...</p>
      </div>
    );
  }

  return (
    <>
      {screen === 'landing' && (
        <LandingPage
          isAuthenticated={!!userProfile}
          onSelectPackage={(pkg) => {
            handleNavigateToAuth('signup');
          }}
          onNavigateToAuth={handleNavigateToAuth}
          onNavigateToDashboard={() => setScreen('dashboard')}
        />
      )}

      {screen === 'auth' && (
        <AuthPage
          initialMode={authMode}
          onAuthSuccess={handleAuthSuccess}
          onBackToLanding={() => setScreen('landing')}
        />
      )}

      {screen === 'admin-portal' && (
        <AdminPortal
          onAdminAuthSuccess={handleAuthSuccess}
          onBackToLanding={() => {
            window.location.hash = '';
            setScreen('landing');
          }}
        />
      )}

      {screen === 'admin-dashboard' && userProfile && userProfile.role === 'admin' && (
        <div className="min-h-screen bg-[#020617] text-slate-200 flex flex-col font-sans">
          {/* Admin Header Bar */}
          <header className="bg-white/3 border-b border-white/10 px-6 py-4 flex justify-between items-center relative z-20 backdrop-blur-md">
            <div className="flex items-center space-x-3">
              <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center font-bold text-white font-mono">
                AT
              </div>
              <div>
                <span className="text-sm font-bold tracking-tight text-white block">ATFunding Admin Console</span>
                <span className="text-[10px] text-blue-400 block font-mono">SECURE ROOT NETWORK TERMINAL</span>
              </div>
            </div>
            
            <div className="flex items-center space-x-3 md:space-x-4">
              <button
                onClick={() => setScreen('dashboard')}
                className="h-9 px-4 bg-blue-600/10 hover:bg-blue-600/20 border border-blue-500/20 text-blue-400 hover:text-blue-300 rounded-full text-xs font-bold transition-all flex items-center space-x-1 cursor-pointer"
              >
                <span>Trader View</span>
              </button>
              <div className="text-right hidden sm:block">
                <span className="text-xs font-bold text-white block">{userProfile.displayName || 'System Admin'}</span>
                <span className="text-[10px] text-slate-500 block">{userProfile.email}</span>
              </div>
              <button
                onClick={handleLogout}
                className="h-9 px-4 bg-white/5 hover:bg-red-500/10 border border-white/10 hover:border-red-500/20 hover:text-red-400 rounded-full text-xs font-bold transition-all flex items-center space-x-1.5 cursor-pointer"
              >
                <span>Disconnect</span>
              </button>
            </div>
          </header>

          {/* Admin Main Layout Body */}
          <main className="flex-1 p-6 sm:p-10 overflow-y-auto max-w-7xl w-full mx-auto relative z-10">
            <AdminPanel />
          </main>
        </div>
      )}

      {screen === 'dashboard' && userProfile && (
        <TraderDashboard
          user={userProfile}
          onLogout={handleLogout}
          onSwitchToAdmin={userProfile.role === 'admin' ? () => setScreen('admin-dashboard') : undefined}
        />
      )}
    </>
  );
}
