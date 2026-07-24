import React, { useState } from 'react';
import { 
  TrendingUp, Mail, Lock, User, AlertCircle, CheckCircle, ArrowLeft, Phone, MapPin, Globe, Building, Eye, EyeOff
} from 'lucide-react';
import { auth, db } from '../firebase';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword, 
  sendPasswordResetEmail
} from 'firebase/auth';
import { doc, setDoc, getDoc, collection, query, where, getDocs, addDoc } from 'firebase/firestore';
import { UserProfile } from '../types';

interface AuthPageProps {
  initialMode: 'login' | 'signup';
  onAuthSuccess: (profile: UserProfile) => void;
  onBackToLanding: () => void;
}

const COMMON_COUNTRIES = [
  "United States", "United Kingdom", "India", "Canada", "Australia", 
  "United Arab Emirates", "Germany", "France", "Singapore", "Japan", 
  "Brazil", "South Africa", "Mexico", "Italy", "Spain", "Netherlands",
  "Saudi Arabia", "Turkey", "Nigeria", "Pakistan", "Vietnam", "Indonesia"
];

export default function AuthPage({ initialMode, onAuthSuccess, onBackToLanding }: AuthPageProps) {
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>(initialMode);
  
  // Login fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  // Signup fields
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [country, setCountry] = useState('United States');
  const [state, setState] = useState('');
  const [city, setCity] = useState('');
  const [address, setAddress] = useState('');

  // Forgot password OTP flow state
  const [forgotStep, setForgotStep] = useState<1 | 2 | 3 | 4>(1); // 1: Enter Email, 2: Enter OTP, 3: New Password, 4: Success
  const [otpCode, setOtpCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');
    setIsLoading(true);

    if (mode === 'signup') {
      // Validate required fields
      if (!firstName.trim() || !lastName.trim()) {
        setErrorMsg("Please enter your First Name and Last Name.");
        setIsLoading(false);
        return;
      }

      if (!username.trim()) {
        setErrorMsg("Please enter a unique username.");
        setIsLoading(false);
        return;
      }

      if (!phone.trim()) {
        setErrorMsg("Please enter your phone number.");
        setIsLoading(false);
        return;
      }

      if (!email.trim()) {
        setErrorMsg("Please enter your email address.");
        setIsLoading(false);
        return;
      }

      if (!password) {
        setErrorMsg("Please enter a password.");
        setIsLoading(false);
        return;
      }

      if (password.length < 6) {
        setErrorMsg("Password must be at least 6 characters.");
        setIsLoading(false);
        return;
      }

      if (password !== confirmPassword) {
        setErrorMsg("Password and Confirm Password do not match.");
        setIsLoading(false);
        return;
      }

      if (!country.trim() || !state.trim() || !city.trim() || !address.trim()) {
        setErrorMsg("Please complete your full location details (Country, State, City, Full Address).");
        setIsLoading(false);
        return;
      }

      try {
        // 1. Check Username uniqueness
        try {
          const usernameQuery = query(collection(db, 'users'), where('username', '==', username.trim()));
          const usernameSnap = await getDocs(usernameQuery);
          if (!usernameSnap.empty) {
            setErrorMsg("This username is already registered. Please choose another username.");
            setIsLoading(false);
            return;
          }
        } catch (uErr) {
          console.warn("Could not check username uniqueness:", uErr);
        }

        // 2. Check Email uniqueness
        try {
          const emailQuery = query(collection(db, 'users'), where('email', '==', email.trim().toLowerCase()));
          const emailSnap = await getDocs(emailQuery);
          if (!emailSnap.empty) {
            setErrorMsg("This email is already registered. Please use another email or log in.");
            setIsLoading(false);
            return;
          }
        } catch (eErr) {
          console.warn("Could not check email uniqueness:", eErr);
        }

        // 3. Check Phone Number uniqueness
        const phoneClean = phone.trim();
        try {
          const phoneQuery1 = query(collection(db, 'users'), where('phone', '==', phoneClean));
          const phoneSnap1 = await getDocs(phoneQuery1);
          const phoneQuery2 = query(collection(db, 'users'), where('phoneNumber', '==', phoneClean));
          const phoneSnap2 = await getDocs(phoneQuery2);

          if (!phoneSnap1.empty || !phoneSnap2.empty) {
            setErrorMsg("This phone number is already registered.");
            setIsLoading(false);
            return;
          }
        } catch (pErr) {
          console.warn("Could not check phone uniqueness:", pErr);
        }

        // 4. Create User in Firebase Auth
        let creds;
        try {
          creds = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
        } catch (signUpErr: any) {
          if (signUpErr.code === 'auth/email-already-in-use') {
            setErrorMsg("This email is already registered.");
            setIsLoading(false);
            return;
          }
          throw signUpErr;
        }

        // 5. Write Profile to Firestore
        const userDocRef = doc(db, 'users', creds.user.uid);
        const fullName = `${firstName.trim()} ${lastName.trim()}`;
        const savedRef = localStorage.getItem('referredBy');

        const profile: UserProfile = {
          uid: creds.user.uid,
          email: email.trim().toLowerCase(),
          displayName: fullName,
          name: fullName,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          username: username.trim(),
          phoneNumber: phoneClean,
          phone: phoneClean,
          country: country.trim(),
          state: state.trim(),
          city: city.trim(),
          address: address.trim(),
          status: 'active',
          role: 'trader',
          affiliateCode: username.trim().toLowerCase() + Math.floor(100 + Math.random() * 900),
          emailVerified: true,
          createdAt: new Date().toISOString()
        };

        if (savedRef) {
          profile.referredBy = savedRef;
          localStorage.removeItem('referredBy');
        }

        await setDoc(userDocRef, profile);

        // Queue welcome email
        try {
          await addDoc(collection(db, 'email_queue'), {
            id: `queue-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
            recipient: email.trim().toLowerCase(),
            subject: "Welcome To ATFunding",
            message: `Welcome to ATFunding, ${fullName}!\n\nYour account (@${username.trim()}) has been created successfully.\n\nYou can now log in and begin trading!`,
            status: "pending",
            createdAt: new Date().toISOString(),
            userId: creds.user.uid
          });
        } catch (queueErr) {
          console.warn("Failed to queue welcome email:", queueErr);
        }

        onAuthSuccess(profile);
      } catch (error: any) {
        console.error("Signup error:", error);
        setErrorMsg(error?.message || "Failed to create account. Please check your inputs.");
      } finally {
        setIsLoading(false);
      }

    } else if (mode === 'login') {
      if (!email.trim() || !password.trim()) {
        setErrorMsg("Please enter both email and password.");
        setIsLoading(false);
        return;
      }

      try {
        let creds;
        try {
          creds = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
        } catch (signInErr: any) {
          if (signInErr.code === 'auth/user-not-found' || signInErr.code === 'auth/invalid-credential' || signInErr.code === 'auth/wrong-password') {
            setErrorMsg("Invalid email or password.");
            setIsLoading(false);
            return;
          }
          throw signInErr;
        }

        let profileSnap = null;
        try {
          profileSnap = await getDoc(doc(db, 'users', creds.user.uid));
        } catch (err) {
          console.warn("Could not fetch user profile:", err);
        }

        if (profileSnap && profileSnap.exists()) {
          onAuthSuccess(profileSnap.data() as UserProfile);
        } else {
          const profile: UserProfile = {
            uid: creds.user.uid,
            email: email.trim().toLowerCase(),
            displayName: email.trim().split('@')[0],
            name: email.trim().split('@')[0],
            status: 'active',
            role: email.trim().toLowerCase() === 'atgrowfund@gmail.com' ? 'admin' : 'trader',
            affiliateCode: 'trader' + Math.floor(100 + Math.random() * 900),
            createdAt: new Date().toISOString()
          };
          await setDoc(doc(db, 'users', creds.user.uid), profile);
          onAuthSuccess(profile);
        }
      } catch (error: any) {
        setErrorMsg(error?.message || "Login failed. Try again.");
      } finally {
        setIsLoading(false);
      }

    } else if (mode === 'forgot') {
      if (forgotStep === 1) {
        if (!email.trim()) {
          setErrorMsg("Please enter your registered email address.");
          setIsLoading(false);
          return;
        }

        try {
          const res = await fetch("/api/auth/send-otp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email.trim() })
          });
          const data = await res.json();
          if (!data.success) {
            throw new Error(data.message || "Failed to send OTP.");
          }
          setSuccessMsg("OTP code sent to " + email.trim() + "! Please enter the 6-digit code.");
          setForgotStep(2);
        } catch (error: any) {
          setErrorMsg(error?.message || "Could not send OTP.");
        } finally {
          setIsLoading(false);
        }

      } else if (forgotStep === 2) {
        if (!otpCode.trim()) {
          setErrorMsg("Please enter the 6-digit OTP code.");
          setIsLoading(false);
          return;
        }

        try {
          const res = await fetch("/api/auth/verify-otp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email.trim(), otp: otpCode.trim() })
          });
          const data = await res.json();
          if (!data.success) {
            throw new Error(data.message || "Invalid OTP code.");
          }
          setSuccessMsg("OTP Verified! Now enter your new password below.");
          setForgotStep(3);
        } catch (error: any) {
          setErrorMsg(error?.message || "OTP verification failed.");
        } finally {
          setIsLoading(false);
        }

      } else if (forgotStep === 3) {
        if (!newPassword) {
          setErrorMsg("Please enter a new password.");
          setIsLoading(false);
          return;
        }
        if (newPassword.length < 6) {
          setErrorMsg("Password must be at least 6 characters long.");
          setIsLoading(false);
          return;
        }
        if (newPassword !== confirmNewPassword) {
          setErrorMsg("New password and confirm password do not match.");
          setIsLoading(false);
          return;
        }

        try {
          const res = await fetch("/api/auth/reset-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ 
              email: email.trim(), 
              otp: otpCode.trim(), 
              newPassword: newPassword 
            })
          });
          const data = await res.json();
          if (!data.success) {
            throw new Error(data.message || "Could not reset password.");
          }
          setSuccessMsg("Password Updated Successfully!");
          setForgotStep(4);
        } catch (error: any) {
          setErrorMsg(error?.message || "Password update failed.");
        } finally {
          setIsLoading(false);
        }
      }
    }
  };

  return (
    <div id="auth-page" className="min-h-screen bg-[#020617] text-slate-200 flex items-center justify-center p-4 sm:p-6 relative font-sans overflow-y-auto">
      {/* Background Mesh Gradients */}
      <div className="fixed top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/15 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="fixed bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-cyan-600/15 rounded-full blur-[120px] pointer-events-none"></div>

      <div className={`w-full ${mode === 'signup' ? 'max-w-3xl' : 'max-w-md'} space-y-6 relative z-10 py-8 transition-all`}>
        
        {/* Back navigation button */}
        <button
          type="button"
          onClick={onBackToLanding}
          className="flex items-center space-x-1.5 text-xs font-semibold text-slate-400 hover:text-white transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Landing Page</span>
        </button>

        {/* Central Card */}
        <div className="bg-white/5 border border-white/10 rounded-3xl p-6 sm:p-8 shadow-2xl backdrop-blur-md space-y-6">
          
          {/* Logo Header */}
          <div className="text-center space-y-2">
            <div className="w-12 h-12 rounded-2xl bg-blue-500 flex items-center justify-center mx-auto shadow-lg shadow-blue-500/20">
              <TrendingUp className="w-7 h-7 text-white" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              {mode === 'login' ? 'Access Trade Desk' : mode === 'signup' ? 'Create Trader Account' : 'Reset Password'}
            </h2>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              {mode === 'login' 
                ? 'Welcome back to ATFunding evaluation engine portal.' 
                : mode === 'signup' 
                  ? 'Complete your trader profile to access simulated evaluation accounts.' 
                  : 'Enter your email address to receive a password recovery link.'}
            </p>
          </div>

          {errorMsg && (
            <div className="p-4 bg-red-500/10 border border-red-500/25 rounded-2xl flex items-start space-x-3 text-xs text-red-300 leading-relaxed shadow-lg">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span className="font-medium">{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/25 rounded-2xl flex items-start space-x-3 text-xs text-emerald-300 leading-relaxed shadow-lg">
              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span className="font-medium">{successMsg}</span>
            </div>
          )}

          {/* Main Form */}
          <form onSubmit={handleAuthSubmit} className="space-y-5">
            {mode === 'signup' ? (
              /* Professional 2-Column Responsive Signup Form */
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  
                  {/* First Name */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">First Name *</label>
                    <div className="relative">
                      <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input
                        type="text"
                        required
                        placeholder="John"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        className="w-full h-11 bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                      />
                    </div>
                  </div>

                  {/* Last Name */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Last Name *</label>
                    <div className="relative">
                      <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input
                        type="text"
                        required
                        placeholder="Doe"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        className="w-full h-11 bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                      />
                    </div>
                  </div>

                  {/* Username */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Username *</label>
                    <div className="relative">
                      <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input
                        type="text"
                        required
                        placeholder="johndoe_trader"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="w-full h-11 bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors font-mono"
                      />
                    </div>
                  </div>

                  {/* Phone Number */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Phone Number *</label>
                    <div className="relative">
                      <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input
                        type="tel"
                        required
                        placeholder="+1 555 123 4567"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="w-full h-11 bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors font-mono"
                      />
                    </div>
                  </div>

                  {/* Email Address */}
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Email Address *</label>
                    <div className="relative">
                      <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input
                        type="email"
                        required
                        placeholder="trader@atfunding.io"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full h-11 bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                      />
                    </div>
                  </div>

                  {/* Password */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Password *</label>
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full h-11 bg-white/5 border border-white/10 rounded-xl pl-10 pr-10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                      >
                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {/* Confirm Password */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Confirm Password *</label>
                    <div className="relative">
                      <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        placeholder="••••••••"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full h-11 bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                      />
                    </div>
                  </div>

                  {/* Country */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Country *</label>
                    <div className="relative">
                      <Globe className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <select
                        value={country}
                        onChange={(e) => setCountry(e.target.value)}
                        className="w-full h-11 bg-[#0b0f19] border border-white/10 rounded-xl pl-10 pr-4 text-xs text-white focus:outline-none focus:border-blue-500 transition-colors cursor-pointer"
                      >
                        {COMMON_COUNTRIES.map(c => (
                          <option key={c} value={c} className="bg-[#0b0f19] text-white">{c}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* State */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">State / Province *</label>
                    <div className="relative">
                      <Building className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input
                        type="text"
                        required
                        placeholder="California"
                        value={state}
                        onChange={(e) => setState(e.target.value)}
                        className="w-full h-11 bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                      />
                    </div>
                  </div>

                  {/* City */}
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">City *</label>
                    <div className="relative">
                      <MapPin className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input
                        type="text"
                        required
                        placeholder="Los Angeles"
                        value={city}
                        onChange={(e) => setCity(e.target.value)}
                        className="w-full h-11 bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                      />
                    </div>
                  </div>

                  {/* Full Address */}
                  <div className="space-y-1 md:col-span-2">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Full Address *</label>
                    <div className="relative">
                      <MapPin className="absolute left-3.5 top-3 w-4 h-4 text-slate-500" />
                      <textarea
                        required
                        rows={2}
                        placeholder="123 Financial Blvd, Suite 400"
                        value={address}
                        onChange={(e) => setAddress(e.target.value)}
                        className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 pt-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors resize-none"
                      />
                    </div>
                  </div>

                </div>
              </div>
            ) : mode === 'forgot' ? (
              /* Forgot Password Multi-Step Form */
              <div className="space-y-5">
                {/* Step indicator bar */}
                <div className="flex items-center justify-between text-[10px] font-mono font-bold uppercase tracking-wider text-slate-400 pb-2 border-b border-white/10">
                  <span className={forgotStep === 1 ? 'text-blue-400 font-extrabold' : 'text-slate-500'}>1. Email</span>
                  <span className="text-slate-700">→</span>
                  <span className={forgotStep === 2 ? 'text-blue-400 font-extrabold' : 'text-slate-500'}>2. Verify OTP</span>
                  <span className="text-slate-700">→</span>
                  <span className={forgotStep === 3 ? 'text-blue-400 font-extrabold' : 'text-slate-500'}>3. New Password</span>
                  <span className="text-slate-700">→</span>
                  <span className={forgotStep === 4 ? 'text-emerald-400 font-extrabold' : 'text-slate-500'}>4. Done</span>
                </div>

                {forgotStep === 1 && (
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Step 1: Registered Email Address *</label>
                    <div className="relative">
                      <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                      <input
                        type="email"
                        required
                        placeholder="trader@atfunding.io"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full h-11 bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                      />
                    </div>
                  </div>
                )}

                {forgotStep === 2 && (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Target Email</label>
                      <input
                        type="text"
                        disabled
                        value={email}
                        className="w-full h-10 bg-white/5 border border-white/10 rounded-xl px-4 text-xs text-slate-400 font-mono"
                      />
                    </div>

                    <div className="space-y-1">
                      <div className="flex justify-between items-center">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Step 2: Enter 6-Digit OTP *</label>
                        <span className="text-[10px] font-mono text-amber-400">Valid for 10 mins</span>
                      </div>
                      <div className="relative">
                        <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                        <input
                          type="text"
                          required
                          maxLength={6}
                          placeholder="123456"
                          value={otpCode}
                          onChange={(e) => setOtpCode(e.target.value)}
                          className="w-full h-12 bg-white/5 border border-blue-500/40 rounded-xl pl-10 pr-4 text-lg font-mono tracking-widest text-white placeholder-slate-600 focus:outline-none focus:border-blue-400 text-center"
                        />
                      </div>
                    </div>

                    <div className="flex justify-between items-center text-[10px] pt-1">
                      <button
                        type="button"
                        onClick={async () => {
                          setErrorMsg('');
                          setSuccessMsg('');
                          setIsLoading(true);
                          try {
                            const res = await fetch("/api/auth/send-otp", {
                              method: "POST",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ email: email.trim() })
                            });
                            const data = await res.json();
                            if (!data.success) throw new Error(data.message);
                            setSuccessMsg("New OTP sent to " + email.trim() + "!");
                          } catch (err: any) {
                            setErrorMsg(err.message || "Failed to resend OTP.");
                          } finally {
                            setIsLoading(false);
                          }
                        }}
                        className="text-blue-400 hover:underline font-bold"
                      >
                        Resend OTP Code
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setErrorMsg('');
                          setSuccessMsg('');
                          setForgotStep(1);
                        }}
                        className="text-slate-400 hover:text-white"
                      >
                        Change Email
                      </button>
                    </div>
                  </div>
                )}

                {forgotStep === 3 && (
                  <div className="space-y-3">
                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Step 3: New Password *</label>
                      <div className="relative">
                        <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                        <input
                          type={showPassword ? 'text' : 'password'}
                          required
                          placeholder="At least 6 characters"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          className="w-full h-11 bg-white/5 border border-white/10 rounded-xl pl-10 pr-10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Confirm New Password *</label>
                      <div className="relative">
                        <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                        <input
                          type={showPassword ? 'text' : 'password'}
                          required
                          placeholder="Repeat new password"
                          value={confirmNewPassword}
                          onChange={(e) => setConfirmNewPassword(e.target.value)}
                          className="w-full h-11 bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {forgotStep === 4 && (
                  <div className="text-center py-6 space-y-4">
                    <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center mx-auto text-emerald-400 shadow-lg shadow-emerald-500/20">
                      <CheckCircle className="w-10 h-10" />
                    </div>
                    <div className="space-y-1">
                      <h3 className="text-xl font-extrabold text-white">Password Updated Successfully!</h3>
                      <p className="text-xs text-slate-400">
                        Your account password has been updated. You can now log in to the ATFunding Trade Desk using your new password.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Login Form */
              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Email Address</label>
                  <div className="relative">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="email"
                      required
                      placeholder="trader@atfunding.io"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full h-11 bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between items-center">
                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Account Password</label>
                    <button
                      type="button"
                      onClick={() => {
                        setErrorMsg('');
                        setSuccessMsg('');
                        setForgotStep(1);
                        setOtpCode('');
                        setNewPassword('');
                        setConfirmNewPassword('');
                        setMode('forgot');
                      }}
                      className="text-[10px] font-bold text-blue-400 hover:underline cursor-pointer"
                    >
                      Forgot Password?
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full h-11 bg-white/5 border border-white/10 rounded-xl pl-10 pr-10 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {mode === 'forgot' && forgotStep === 4 ? (
              <button
                type="button"
                onClick={() => {
                  setErrorMsg('');
                  setSuccessMsg('');
                  setForgotStep(1);
                  setMode('login');
                }}
                className="w-full h-12 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs uppercase tracking-wider transition-all shadow-lg shadow-emerald-600/20 cursor-pointer mt-2"
              >
                Sign In Now
              </button>
            ) : (
              <button
                type="submit"
                disabled={isLoading}
                className="w-full h-12 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white font-bold rounded-xl text-xs uppercase tracking-wider transition-all shadow-lg shadow-blue-600/20 cursor-pointer mt-2"
              >
                {isLoading 
                  ? 'Processing Request...' 
                  : mode === 'login' 
                    ? 'Sign In to Portal' 
                    : mode === 'signup' 
                      ? 'Register Trader Account' 
                      : forgotStep === 1 
                        ? 'Send OTP' 
                        : forgotStep === 2 
                          ? 'Verify OTP Code' 
                          : 'Update Password'}
              </button>
            )}
          </form>

          {/* Toggle buttons */}
          <div className="text-center pt-2 space-y-2 border-t border-white/10">
            {mode === 'forgot' ? (
              <button
                type="button"
                onClick={() => {
                  setErrorMsg('');
                  setSuccessMsg('');
                  setMode('login');
                }}
                className="text-xs font-semibold text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                Back to Sign In
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setErrorMsg('');
                  setSuccessMsg('');
                  setMode(mode === 'login' ? 'signup' : 'login');
                }}
                className="text-xs font-semibold text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                {mode === 'login' ? "Don't have an account? Create One Now" : "Already registered? Sign In"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
