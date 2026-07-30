import React, { useState, useEffect, useRef } from 'react';
import { 
  CreditCard, ShieldCheck, Ticket, Check, Coins, AlertCircle, Sparkles, 
  User, Mail, Phone, Globe, MapPin, Hash, Clipboard, FileText, Upload, 
  Image as ImageIcon, Loader2, ArrowLeft, Clock, XCircle, CheckCircle2, ChevronRight, Bell
} from 'lucide-react';
import { CHALLENGE_PACKAGES, ChallengePackage, getAccountDrawdownLimits } from '../constants';
import RulesCard from './RulesCard';
import { db, auth, storage, handleFirestoreError, OperationType } from '../firebase';
import { collection, doc, setDoc, getDoc, updateDoc, increment, onSnapshot, addDoc, query, where, getDocs, limit } from 'firebase/firestore';
import { getDocsCached } from '../lib/firestoreCache';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { Order, PaymentSettings, Coupon } from '../types';

interface BuyAccountPanelProps {
  userId: string;
  userEmail: string;
  onPurchaseSuccess: (accountType: string, size: number) => void;
}

const DEFAULT_WALLET_ADDRESSES: PaymentSettings = {
  btcAddress: '',
  usdtTrc20Address: '',
  usdtErc20Address: '',
  ltcAddress: '',
  upiId: '',
  upiQrCode: '',
  btcQrCode: '',
  usdtTrc20QrCode: '',
  usdtErc20QrCode: '',
  ltcQrCode: ''
};

export default function BuyAccountPanel({ userId, userEmail, onPurchaseSuccess }: BuyAccountPanelProps) {
  // Navigation steps: 'select' | 'checkout' | 'success'
  const [step, setStep] = useState<'select' | 'checkout' | 'success'>('select');
  
  // Package Selection State
  const [selectedType, setSelectedType] = useState<'one_step' | 'two_step' | 'payout_later' | 'instant_bolt' | 'trial'>('two_step');
  const [selectedPkg, setSelectedPkg] = useState<ChallengePackage>(
    CHALLENGE_PACKAGES.find(p => p.type === 'two_step' && p.size === 50000) || CHALLENGE_PACKAGES[0]
  );
  const [selectedPlatform, setSelectedPlatform] = useState<string>('ATTerminal');
  const [holdRuleUpgradePurchased, setHoldRuleUpgradePurchased] = useState<boolean>(false);
  
  // Coupon State
  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<{
    code: string;
    discountType?: 'percent' | 'fixed';
    discountPercent?: number;
    discountAmount?: number;
    applicableAccountTypes?: string[];
    applicablePackages?: string[];
  } | null>(null);
  const [couponError, setCouponError] = useState('');
  const [couponSuccess, setCouponSuccess] = useState('');
  const [availableCoupons, setAvailableCoupons] = useState<Coupon[]>([]);

  // Personal Information Billing State
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [billingEmail, setBillingEmail] = useState(userEmail);
  const [phone, setPhone] = useState('');
  const [country, setCountry] = useState('United States');
  const [stateProv, setStateProv] = useState('');
  const [city, setCity] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [fullAddress, setFullAddress] = useState('');

  // Payment Method State
  const [cryptoMethod, setCryptoMethod] = useState<'Bitcoin (BTC)' | 'USDT TRC20' | 'USDT ERC20' | 'Litecoin (LTC)' | 'UPI'>('USDT TRC20');
  const [walletAddresses, setWalletAddresses] = useState<PaymentSettings>(DEFAULT_WALLET_ADDRESSES);
  const [copyFeedback, setCopyFeedback] = useState(false);

  // File Screenshot State
  const [screenshotFile, setScreenshotFile] = useState<File | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Transaction Details States
  const [transactionHash, setTransactionHash] = useState('');
  const [transactionId, setTransactionId] = useState('');

  // KYC Verification Document States
  const [passportFile, setPassportFile] = useState<File | null>(null);
  const [passportPreview, setPassportPreview] = useState<string | null>(null);
  const [idCardFile, setIdCardFile] = useState<File | null>(null);
  const [idCardPreview, setIdCardPreview] = useState<string | null>(null);
  const [selfieFile, setSelfieFile] = useState<File | null>(null);
  const [selfiePreview, setSelfiePreview] = useState<string | null>(null);
  const [addressProofFile, setAddressProofFile] = useState<File | null>(null);
  const [addressProofPreview, setAddressProofPreview] = useState<string | null>(null);

  const passportInputRef = useRef<HTMLInputElement>(null);
  const idCardInputRef = useRef<HTMLInputElement>(null);
  const selfieInputRef = useRef<HTMLInputElement>(null);
  const addressProofInputRef = useRef<HTMLInputElement>(null);

  // Completed Order State
  const [latestOrder, setLatestOrder] = useState<Order | null>(null);

  // Past Orders History State
  const [myOrders, setMyOrders] = useState<Order[]>([]);

  // Simple BOGO Mappings, Packages Config, and Waitlist Systems
  const [bogoMappings, setBogoMappings] = useState<Record<string, string>>({});
  const [packagesConfig, setPackagesConfig] = useState<Record<string, { disabled?: boolean; expectedReturnDate?: string }>>({});
  const [waitlist, setWaitlist] = useState<any[]>([]);
  const [showNotifyModal, setShowNotifyModal] = useState(false);
  const [notifyEmail, setNotifyEmail] = useState(userEmail || '');
  const [notifyPkgId, setNotifyPkgId] = useState('');
  const [notifyMsg, setNotifyMsg] = useState('');
  const [isSubmittingNotify, setIsSubmittingNotify] = useState(false);

  useEffect(() => {
    const unsubBogoMappings = onSnapshot(doc(db, 'settings', 'bogo_mappings'), (snapshot) => {
      if (snapshot.exists()) {
        setBogoMappings(snapshot.data().mappings || {});
      } else {
        setBogoMappings({});
      }
    }, (err) => {
      console.warn("Error subscribing to BOGO mappings in BuyAccountPanel:", err);
    });

    const unsubPackages = onSnapshot(doc(db, 'settings', 'packages'), (snapshot) => {
      if (snapshot.exists()) {
        setPackagesConfig(snapshot.data());
      } else {
        setPackagesConfig({});
      }
    }, (err) => {
      console.warn("Error subscribing to packages config in BuyAccountPanel:", err);
    });

    getDocsCached('buy_waitlist', async () => {
      const snap = await getDocs(query(collection(db, 'availability_waitlist'), limit(50)));
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    }).then(res => setWaitlist(res)).catch(e => console.warn(e));

    return () => {
      unsubBogoMappings();
      unsubPackages();
    };
  }, []);

  // Realtime subscription for payment settings from settings/payment
  useEffect(() => {
    const settingsRef = doc(db, 'settings', 'payment');
    const unsubscribe = onSnapshot(settingsRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setWalletAddresses({
          btcAddress: data.btcAddress || '',
          btcQrCode: data.btcQrCode || '',
          usdtTrc20Address: data.usdtTrc20Address || '',
          usdtTrc20QrCode: data.usdtTrc20QrCode || '',
          usdtErc20Address: data.usdtErc20Address || '',
          usdtErc20QrCode: data.usdtErc20QrCode || '',
          ltcAddress: data.ltcAddress || '',
          ltcQrCode: data.ltcQrCode || '',
          upiId: data.upiId || '',
          upiQrCode: data.upiQrCode || ''
        });
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'settings/payment');
    });

    return () => unsubscribe();
  }, []);

  // Fetch my billing / order history in real-time
  useEffect(() => {
    const ordersRef = collection(db, 'orders');
    const q = query(ordersRef, where('userId', '==', userId));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedOrders: Order[] = [];
      snapshot.forEach((doc) => {
        fetchedOrders.push({ ...doc.data() as Order });
      });
      // Sort orders by createdAt descending
      fetchedOrders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setMyOrders(fetchedOrders);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'orders');
    });

    return () => unsubscribe();
  }, [userId]);

  // Sync selected package when challenge type tab changes
  useEffect(() => {
    const pkg = CHALLENGE_PACKAGES.find(p => p.type === selectedType && p.size === selectedPkg.size);
    if (pkg) {
      setSelectedPkg(pkg);
    } else {
      const fallbackPkg = CHALLENGE_PACKAGES.find(p => p.type === selectedType);
      if (fallbackPkg) setSelectedPkg(fallbackPkg);
    }
  }, [selectedType]);

  // Fetch active coupons from Firestore in real-time
  useEffect(() => {
    const couponsRef = collection(db, 'coupons');
    const q = query(couponsRef, where('active', '==', true));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const activeCoupons: Coupon[] = [];
      snapshot.forEach((doc) => {
        activeCoupons.push({ id: doc.id, ...doc.data() as Coupon });
      });
      setAvailableCoupons(activeCoupons);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'coupons');
    });

    return () => unsubscribe();
  }, []);

  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) return;
    setCouponError('');
    setCouponSuccess('');

    const inputClean = couponCode.trim();
    const codeUpper = inputClean.toUpperCase();

    try {
      let couponData: Coupon | null = null;

      // 1. First check in real-time cached active coupons
      const matchedLocal = availableCoupons.find(
        c => c.code?.trim().toUpperCase() === codeUpper || (c.id && c.id.trim().toUpperCase() === codeUpper)
      );

      if (matchedLocal) {
        couponData = matchedLocal;
      } else {
        // 2. Direct document fetch by uppercase code
        const docSnap = await getDoc(doc(db, 'coupons', codeUpper));
        if (docSnap.exists()) {
          couponData = { id: docSnap.id, ...docSnap.data() } as Coupon;
        } else {
          // 3. Firestore query by code field
          const q = query(collection(db, 'coupons'), where('code', '==', codeUpper));
          const querySnapshot = await getDocs(q);
          if (!querySnapshot.empty) {
            couponData = { id: querySnapshot.docs[0].id, ...querySnapshot.docs[0].data() } as Coupon;
          } else {
            // 4. Fallback case-insensitive scan across all coupons
            const allCouponsSnap = await getDocs(collection(db, 'coupons'));
            allCouponsSnap.forEach(d => {
              const data = d.data() as Coupon;
              if (data.code?.trim().toUpperCase() === codeUpper || d.id.trim().toUpperCase() === codeUpper) {
                couponData = { id: d.id, ...data };
              }
            });
          }
        }
      }

      if (!couponData) {
        setCouponError(`Invalid coupon code '${inputClean}'.`);
        return;
      }

      // Check active status
      if (couponData.active === false) {
        setCouponError(`Coupon code '${couponData.code}' is currently inactive or disabled.`);
        return;
      }

      // Expiry Date Validation
      if (couponData.expiresAt) {
        const expTime = new Date(couponData.expiresAt).getTime();
        const adjustedExp = couponData.expiresAt.length === 10 ? expTime + 86399000 : expTime;
        if (!isNaN(adjustedExp) && adjustedExp < Date.now()) {
          setCouponError(`Coupon code '${couponData.code}' expired on ${new Date(adjustedExp).toLocaleDateString()}.`);
          return;
        }
      }

      // Usage Limit Validation
      if (couponData.maxUses && couponData.maxUses > 0) {
        const used = couponData.usedCount || 0;
        if (used >= couponData.maxUses) {
          setCouponError(`Coupon code '${couponData.code}' has reached its maximum usage limit (${used}/${couponData.maxUses}).`);
          return;
        }
      }

      // Applicability check
      const allowedTypes = couponData.applicableAccountTypes || [];
      const allowedPackages = couponData.applicablePackages || [];

      const isAllTypes = !allowedTypes.length || allowedTypes.includes('all');
      const isTypeAllowed = isAllTypes || allowedTypes.includes(selectedType);

      const isAllPackages = !allowedPackages.length || allowedPackages.includes('all');
      const isPackageAllowed = isAllPackages || allowedPackages.includes(selectedPkg.id);

      if (!isTypeAllowed || !isPackageAllowed) {
        const typeLabels: Record<string, string> = {
          one_step: 'One Step Challenge',
          two_step: 'Two Step Challenge',
          payout_later: 'Payout Later Challenge',
          instant_bolt: 'Instant Bolt Account',
          trial: 'AT Trial Account'
        };

        const validLabels = allowedTypes
          .filter(t => t !== 'all')
          .map(t => typeLabels[t] || t);

        const currentLabel = typeLabels[selectedType] || selectedType;
        const validText = validLabels.length > 0 ? `Valid for: ${validLabels.join(', ')}` : 'Valid for other account types';

        setCouponError(`Coupon '${couponData.code}' is not applicable for ${currentLabel}. ${validText}.`);
        return;
      }

      const discType = couponData.discountType || (couponData.discountAmount && couponData.discountAmount > 0 && !couponData.discountPercent ? 'fixed' : 'percent');
      const pctVal = couponData.discountPercent || 0;
      const amtVal = couponData.discountAmount || 0;

      setAppliedCoupon({
        code: couponData.code.toUpperCase(),
        discountType: discType,
        discountPercent: pctVal,
        discountAmount: amtVal,
        applicableAccountTypes: allowedTypes,
        applicablePackages: allowedPackages
      });

      const discText = discType === 'fixed' ? `$${amtVal} OFF` : `${pctVal}% OFF`;
      setCouponSuccess(`Coupon '${couponData.code}' applied! (${discText})`);
    } catch (error) {
      console.warn("Error fetching coupon from DB (handled):", error);
      setCouponError('Error verifying coupon.');
    }
  };

  // Re-verify applied coupon if trader switches account type or package
  useEffect(() => {
    if (appliedCoupon) {
      const allowedTypes = appliedCoupon.applicableAccountTypes || [];
      const allowedPackages = appliedCoupon.applicablePackages || [];

      const isAllTypes = !allowedTypes.length || allowedTypes.includes('all');
      const isTypeAllowed = isAllTypes || allowedTypes.includes(selectedType);

      const isAllPackages = !allowedPackages.length || allowedPackages.includes('all');
      const isPackageAllowed = isAllPackages || allowedPackages.includes(selectedPkg.id);

      if (!isTypeAllowed || !isPackageAllowed) {
        setAppliedCoupon(null);
        setCouponSuccess('');
        const typeLabels: Record<string, string> = {
          one_step: 'One Step Challenge',
          two_step: 'Two Step Challenge',
          payout_later: 'Payout Later Challenge',
          instant_bolt: 'Instant Bolt Account',
          trial: 'AT Trial Account'
        };
        setCouponError(`Applied coupon '${appliedCoupon.code}' removed as it is not valid for ${typeLabels[selectedType] || selectedType}.`);
      }
    }
  }, [selectedType, selectedPkg.id]);

  const getPackagePrice = (pkg: ChallengePackage) => {
    const config = packagesConfig[pkg.id];
    if (config && typeof config.discount === 'number' && config.discount > 0) {
      return pkg.price * (1 - config.discount / 100);
    }
    return pkg.price;
  };

  const calculateTotal = () => {
    let basePrice = getPackagePrice(selectedPkg);
    if (selectedType !== 'instant_bolt' && holdRuleUpgradePurchased) {
      basePrice += 10;
    }
    if (appliedCoupon) {
      if (appliedCoupon.discountType === 'fixed' || (appliedCoupon.discountAmount && appliedCoupon.discountAmount > 0 && !appliedCoupon.discountPercent)) {
        return Math.max(0, basePrice - (appliedCoupon.discountAmount || 0));
      } else {
        const pct = appliedCoupon.discountPercent || 0;
        return Math.max(0, basePrice - (basePrice * (pct / 100)));
      }
    }
    return basePrice;
  };

  const handleSelectType = (type: 'one_step' | 'two_step' | 'payout_later' | 'instant_bolt' | 'trial') => {
    setSelectedType(type);
    const firstPkgOf = CHALLENGE_PACKAGES.find(p => p.type === type);
    if (firstPkgOf) {
      setSelectedPkg(firstPkgOf);
    }
    if (type === 'instant_bolt') {
      setHoldRuleUpgradePurchased(false);
    }
  };

  const handleCopyWalletAddress = () => {
    const activeAddress = getActiveWalletAddress();
    navigator.clipboard.writeText(activeAddress);
    setCopyFeedback(true);
    setTimeout(() => setCopyFeedback(false), 2000);
  };

  const getActiveWalletAddress = () => {
    switch (cryptoMethod) {
      case 'Bitcoin (BTC)': return walletAddresses.btcAddress || '';
      case 'USDT TRC20': return walletAddresses.usdtTrc20Address || '';
      case 'USDT ERC20': return walletAddresses.usdtErc20Address || '';
      case 'Litecoin (LTC)': return walletAddresses.ltcAddress || '';
      case 'UPI': return walletAddresses.upiId || '';
      default: return '';
    }
  };

  const getActiveQrCode = () => {
    let customQr = '';
    switch (cryptoMethod) {
      case 'Bitcoin (BTC)': customQr = walletAddresses.btcQrCode || ''; break;
      case 'USDT TRC20': customQr = walletAddresses.usdtTrc20QrCode || ''; break;
      case 'USDT ERC20': customQr = walletAddresses.usdtErc20QrCode || ''; break;
      case 'Litecoin (LTC)': customQr = walletAddresses.ltcQrCode || ''; break;
      case 'UPI': customQr = walletAddresses.upiQrCode || ''; break;
    }
    if (customQr) return customQr;

    const address = getActiveWalletAddress();
    if (address) {
      return `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(address)}`;
    }
    return '';
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setScreenshotFile(file);
      setScreenshotPreview(URL.createObjectURL(file));
    }
  };

  const handlePassportChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setPassportFile(file);
      setPassportPreview(URL.createObjectURL(file));
    }
  };

  const handleIdCardChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setIdCardFile(file);
      setIdCardPreview(URL.createObjectURL(file));
    }
  };

  const handleSelfieChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelfieFile(file);
      setSelfiePreview(URL.createObjectURL(file));
    }
  };

  const handleAddressProofChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setAddressProofFile(file);
      setAddressProofPreview(URL.createObjectURL(file));
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      setScreenshotFile(file);
      setScreenshotPreview(URL.createObjectURL(file));
    }
  };

  function timeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout")), ms);
      promise
        .then((res) => {
          clearTimeout(timer);
          resolve(res);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = (event) => {
        const img = new Image();
        img.src = event.target?.result as string;
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 1280; // High-resolution crisp clarity
          const MAX_HEIGHT = 1280;
          let width = img.width;
          let height = img.height;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height *= MAX_WIDTH / width;
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width *= MAX_HEIGHT / height;
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx?.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.80); // Extremely crisp 0.80 high-def quality
          resolve(dataUrl);
        };
        img.onerror = (err) => reject(err);
      };
      reader.onerror = (err) => reject(err);
    });
  };

  const handleScreenshotUpload = async (file: File): Promise<string> => {
    try {
      const storageRef = ref(storage, `paymentScreenshots/${Date.now()}_${file.name}`);
      const uploadPromise = uploadBytes(storageRef, file);
      const snapshot = await timeout(uploadPromise, 30000); // 30-second timeout for full high-resolution upload
      const downloadURL = await getDownloadURL(snapshot.ref);
      return downloadURL;
    } catch (err) {
      console.warn("Firebase Storage unavailable, timed out, or permission denied. Falling back to compressed Base64 data URL.", err);
      return await compressImage(file);
    }
  };

  const handleSubmitOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    // Input Validation
    if (!firstName.trim()) return setFormError("First Name is required.");
    if (!lastName.trim()) return setFormError("Last Name is required.");
    if (!billingEmail.trim()) return setFormError("Email Address is required.");
    if (!phone.trim()) return setFormError("Phone Number is required.");
    if (!country.trim()) return setFormError("Country is required.");
    if (!stateProv.trim()) return setFormError("State / Province is required.");
    if (!city.trim()) return setFormError("City is required.");
    if (!postalCode.trim()) return setFormError("Postal Code is required.");
    if (!fullAddress.trim()) return setFormError("Billing Address is required.");
    if (!screenshotFile) return setFormError("Proof of Payment Screenshot is required to complete review.");

    setIsSubmitting(true);
    try {
      const effectiveUserId = auth.currentUser?.uid || userId || 'anon_' + Date.now();

      // 1. Fetch user's referredBy value safely
      let referredBy = '';
      let userData: any = null;
      if (effectiveUserId) {
        try {
          const userDoc = await getDoc(doc(db, 'users', effectiveUserId));
          userData = userDoc.exists() ? userDoc.data() : null;
          referredBy = userData?.referredBy || '';
        } catch (uErr) {
          console.warn("Could not fetch user document during order submission:", uErr);
        }
      }

      // 2. Upload proof screenshot
      const proofUrl = await handleScreenshotUpload(screenshotFile);

      // 3. Generate pre-approved account document (DO NOT activate immediately)
      const accountId = 'AT-' + Math.floor(100000 + Math.random() * 900000);
      const sizeVal = selectedPkg.size;
      const expiresAt = selectedType === 'trial'
        ? new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString()
        : null;

      const preApprovedAccount = {
        id: accountId,
        userId: effectiveUserId,
        userEmail: billingEmail.trim(),
        accountType: selectedType,
        size: sizeVal,
        balance: sizeVal,
        startingBalance: sizeVal,
        equity: sizeVal,
        dailyStartingBalance: sizeVal,
        dailyStartingEquity: sizeVal,
        phase: selectedType === 'two_step' ? 1 : 3, // starts at phase 1 or 3
        status: 'Pending Approval', // Status = Pending Approval
        login: 'Awaiting Approval',
        password: 'Awaiting Approval',
        platform: 'ATTerminal',
        server: 'ATFunding-LiveServer',
        profitTarget: selectedType === 'two_step' ? sizeVal * 0.08 : selectedType === 'one_step' ? sizeVal * 0.10 : selectedType === 'payout_later' ? sizeVal * 0.08 : 0,
        dailyDrawdownLimit: getAccountDrawdownLimits(selectedType, sizeVal).dailyDrawdownLimit,
        maxDrawdownLimit: getAccountDrawdownLimits(selectedType, sizeVal).maxDrawdownLimit,
        expiresAt: expiresAt,
        createdAt: new Date().toISOString(),
        holdRuleEnabled: selectedType === 'instant_bolt' && holdRuleUpgradePurchased ? false : true,
        holdRuleUpgradePurchased: selectedType === 'instant_bolt' ? holdRuleUpgradePurchased : false
      };

      await setDoc(doc(db, 'accounts', accountId), preApprovedAccount);

      // Check BOGO active status
      const mappedFreeBonusId = bogoMappings[selectedPkg.id];
      const isBogoActive = !!mappedFreeBonusId;
      let bogoFreeAccountId = '';

      if (mappedFreeBonusId) {
        bogoFreeAccountId = accountId + '-FREE';
        const freePkg = CHALLENGE_PACKAGES.find(p => p.id === mappedFreeBonusId);
        if (freePkg) {
          const freeAccountDoc = {
            id: bogoFreeAccountId,
            userId: effectiveUserId,
            userEmail: billingEmail.trim(),
            accountType: freePkg.type,
            size: freePkg.size,
            balance: freePkg.size,
            startingBalance: freePkg.size,
            equity: freePkg.size,
            dailyStartingBalance: freePkg.size,
            dailyStartingEquity: freePkg.size,
            phase: freePkg.type === 'two_step' ? 1 : 3,
            status: 'Pending Approval',
            login: 'Awaiting BOGO Approval',
            password: 'Awaiting BOGO Approval',
            platform: 'ATTerminal',
            server: 'ATFunding-LiveServer',
            profitTarget: freePkg.type === 'two_step' ? freePkg.size * 0.08 : freePkg.type === 'one_step' ? freePkg.size * 0.10 : freePkg.type === 'payout_later' ? freePkg.size * 0.08 : 0,
            dailyDrawdownLimit: getAccountDrawdownLimits(freePkg.type, freePkg.size).dailyDrawdownLimit,
            maxDrawdownLimit: getAccountDrawdownLimits(freePkg.type, freePkg.size).maxDrawdownLimit,
            createdAt: new Date().toISOString(),
            isBogoFree: true
          };
          await setDoc(doc(db, 'accounts', bogoFreeAccountId), freeAccountDoc);
        }
      }

      // 4. Generate Order details
      const orderId = 'ORD-' + Math.floor(100000 + Math.random() * 900000);
      const basePrice = getPackagePrice(selectedPkg);
      const discountPct = appliedCoupon ? appliedCoupon.discountPercent : 0;
      const discountVal = (basePrice * discountPct) / 100;
      const finalPrice = calculateTotal();

      const newOrder: any = {
        orderId,
        userId: effectiveUserId,
        referredBy,
        accountId, // Link to the newly created pre-approved account
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: billingEmail.trim(),
        phone: phone.trim(),
        country: country.trim(),
        state: stateProv.trim(),
        city: city.trim(),
        postalCode: postalCode.trim(),
        address: fullAddress.trim(),
        accountType: selectedType,
        accountSize: (selectedPkg.size >= 1000 ? `${selectedPkg.size / 1000}K` : `${selectedPkg.size}`) as any,
        platform: 'ATTerminal',
        couponCode: appliedCoupon ? appliedCoupon.code : '',
        paymentMethod: cryptoMethod,
        walletAddress: getActiveWalletAddress(),
        paymentScreenshot: proofUrl,
        transactionHash: transactionHash.trim(),
        transactionId: transactionId.trim(),
        kycStatus: 'N/A',
        kycDocuments: {
          passport: '',
          idCard: '',
          selfie: '',
          addressProof: ''
        },
        price: basePrice,
        discount: discountVal,
        finalPrice,
        status: 'Pending Payment Review',
        bogoApplied: isBogoActive,
        bogoFreeAccountId: bogoFreeAccountId || '',
        bogoFreePackageId: isBogoActive ? mappedFreeBonusId : '',
        holdRuleUpgradePurchased: selectedType === 'instant_bolt' ? holdRuleUpgradePurchased : false,
        createdAt: new Date().toISOString()
      };

      // 4. Save Order to Firestore
      await setDoc(doc(db, 'orders', orderId), newOrder);

      // Increment coupon usage count in Firestore if coupon applied
      if (appliedCoupon) {
        try {
          await updateDoc(doc(db, 'coupons', appliedCoupon.code), {
            usedCount: increment(1)
          });
        } catch (err) {
          console.warn("Could not increment coupon usedCount:", err);
        }
      }

      // Trigger checkout/purchase receipt email in background queue
      try {
        const { triggerPurchaseEmail } = await import('../utils/emailTriggers');
        const userFullName = `${firstName} ${lastName}`.trim() || userData?.displayName || userData?.name || 'Trader';
        triggerPurchaseEmail(effectiveUserId, billingEmail.trim(), userFullName, selectedType, newOrder.accountSize);
      } catch (err) {
        console.warn("Could not queue purchase email trigger:", err);
      }
      
      // 5. Send standard local notification in notifications collection safely
      try {
        const notificationId = 'NOTIF-' + Math.floor(100000 + Math.random() * 900000);
        await setDoc(doc(db, 'notifications', notificationId), {
          id: notificationId,
          userId: effectiveUserId,
          title: 'Order Submitted',
          message: `Your checkout for the ${newOrder.accountSize} ${selectedType.replace('_', ' ')} program has been submitted successfully. Our billing administrators are verifying your transaction.`,
          type: 'info',
          read: false,
          createdAt: new Date().toISOString()
        });
      } catch (nErr) {
        console.warn("Could not record notification document:", nErr);
      }

      setLatestOrder(newOrder);
      setStep('success');

      // Clear checkout inputs
      setScreenshotFile(null);
      setScreenshotPreview(null);
      setTransactionHash('');
      setTransactionId('');
      setPassportFile(null);
      setPassportPreview(null);
      setIdCardFile(null);
      setIdCardPreview(null);
      setSelfieFile(null);
      setSelfiePreview(null);
      setAddressProofFile(null);
      setAddressProofPreview(null);
    } catch (err: any) {
      console.error("Order creation failed:", err);
      setFormError(err?.message || "There was an error submitting your billing details. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const getStatusColor = (status: Order['status']) => {
    switch (status) {
      case 'Pending Payment Review': return 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20';
      case 'Approved': return 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20';
      case 'Rejected': return 'bg-rose-500/10 text-rose-400 border border-rose-500/20';
    }
  };

  return (
    <div id="buy-account-panel" className="space-y-12 max-w-7xl mx-auto pb-16">
      
      {/* STEP HEADER */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight text-white flex items-center gap-2">
            <Coins className="w-8 h-8 text-blue-500" />
            <span>ATFunding Checkout & Billing</span>
          </h2>
          <p className="text-slate-400 text-sm mt-1">
            Choose your prop parameters, enter billing info, and complete secure cryptocurrency transactions.
          </p>
        </div>

        {/* STEP PROGRESS TRACKER */}
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
          <span className={`${step === 'select' ? 'text-blue-400' : 'text-slate-400'}`}>1. Program Specs</span>
          <ChevronRight className="w-3 h-3" />
          <span className={`${step === 'checkout' ? 'text-blue-400' : 'text-slate-400'}`}>2. Billing & Proof</span>
          <ChevronRight className="w-3 h-3" />
          <span className={`${step === 'success' ? 'text-blue-400' : 'text-slate-400'}`}>3. Verification</span>
        </div>
      </div>

      {/* STEP 1: SPECIFICATION & SELECTION CARD */}
      {step === 'select' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left specification zone */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* Account Type selectors */}
            <div className="bg-white/5 border border-white/10 rounded-3xl p-6 space-y-4 backdrop-blur-sm">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">1. Select Challenge Type</label>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 bg-black/25 rounded-2xl p-1 border border-white/5">
                {(['one_step', 'two_step', 'payout_later', 'instant_bolt', 'trial'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => handleSelectType(type)}
                    className={`px-3 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
                      selectedType === type 
                        ? 'bg-blue-600 text-white shadow-lg' 
                        : 'text-slate-400 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {type === 'trial' ? 'AT Trial' : type === 'instant_bolt' ? 'ATF Instant' : type.replace('_', ' ')}
                  </button>
                ))}
              </div>
            </div>

            {/* Account Sizing Cards - FundedSquad Style */}
            <div className="bg-gradient-to-b from-slate-900 to-slate-950 border border-white/10 rounded-3xl p-6 space-y-5 backdrop-blur-md shadow-2xl">
              <div className="flex justify-between items-center">
                <label className="text-xs font-black text-slate-300 uppercase tracking-widest block">2. Select Account Size & Parameters</label>
                <span className="text-[10px] font-mono font-bold text-blue-400 bg-blue-500/10 border border-blue-500/20 px-2.5 py-1 rounded-full uppercase">
                  {selectedType === 'trial' ? 'Free Trial' : selectedType === 'instant_bolt' ? 'Instant Funding' : selectedType.replace('_', ' ')}
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {CHALLENGE_PACKAGES.filter(p => p.type === selectedType).map((pkg) => {
                  const isUnavailable = packagesConfig[pkg.id]?.disabled;
                  const discountedPrice = getPackagePrice(pkg);
                  const isSelected = selectedPkg.id === pkg.id;

                  // Target & parameters
                  const pTarget = pkg.profitTargetPercent > 0 ? `${pkg.profitTargetPercent}%` : 'No Target';
                  const dDrawdown = `${pkg.dailyDrawdownPercent}%`;
                  const mDrawdown = `${pkg.maxDrawdownPercent}%`;
                  const pSplit = `${pkg.payoutSplit}%`;
                  const pLeverage = pkg.type === 'instant_bolt' ? '1:30' : '1:100';

                  return (
                    <div
                      key={pkg.id}
                      onClick={() => setSelectedPkg(pkg)}
                      className={`rounded-2xl p-5 cursor-pointer transition-all relative overflow-hidden flex flex-col justify-between border ${
                        isSelected 
                          ? 'bg-gradient-to-b from-blue-950/80 via-slate-900 to-slate-950 border-blue-500 shadow-xl shadow-blue-500/20 ring-1 ring-blue-500/30' 
                          : 'bg-black/40 border-white/10 hover:border-blue-500/40 hover:bg-slate-900/60'
                      }`}
                    >
                      {isUnavailable && (
                        <span className="absolute top-0 right-0 bg-red-600/90 text-white text-[9px] font-black uppercase px-2.5 py-0.5 rounded-bl-lg tracking-wider">
                          Unavailable
                        </span>
                      )}

                      <div>
                        {/* Header: Account Size & Name */}
                        <div className="flex justify-between items-start pb-3 border-b border-white/10">
                          <div>
                            <span className="text-xl font-black text-white font-mono block tracking-tight">
                              ${(pkg.size / 1000).toFixed(0)}K Account
                            </span>
                            <span className="text-[10px] text-slate-400 uppercase tracking-widest font-mono block mt-0.5">
                              {pkg.name}
                            </span>
                          </div>
                          {isSelected && (
                            <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center shadow-lg shadow-blue-500/50">
                              <Check className="w-3.5 h-3.5 text-white stroke-[3]" />
                            </div>
                          )}
                        </div>

                        {/* Package Specs Block */}
                        <div className="mt-4 space-y-2 text-xs font-mono">
                          <div className="flex justify-between py-1 border-b border-white/5">
                            <span className="text-slate-400">Profit Target:</span>
                            <span className="font-bold text-emerald-400">{pkg.type === 'instant_bolt' ? 'No Target' : pTarget}</span>
                          </div>
                          <div className="flex justify-between py-1 border-b border-white/5">
                            <span className="text-slate-400">{pkg.type === 'instant_bolt' ? 'Minimum Loss:' : 'Daily Drawdown:'}</span>
                            <span className="font-bold text-amber-400">
                              {pkg.type === 'instant_bolt' ? `$${(pkg.size * 0.0225).toLocaleString(undefined, { maximumFractionDigits: 1 })}` : dDrawdown}
                            </span>
                          </div>
                          <div className="flex justify-between py-1 border-b border-white/5">
                            <span className="text-slate-400">{pkg.type === 'instant_bolt' ? 'Maximum Loss:' : 'Max Drawdown:'}</span>
                            <span className="font-bold text-red-400">
                              {pkg.type === 'instant_bolt' ? `$${(pkg.size * 0.05).toLocaleString(undefined, { maximumFractionDigits: 1 })}` : mDrawdown}
                            </span>
                          </div>
                          {pkg.type === 'instant_bolt' && (
                            <div className="flex justify-between py-1 border-b border-white/5">
                              <span className="text-slate-400">Min Trading Days:</span>
                              <span className="font-bold text-slate-200">None</span>
                            </div>
                          )}
                          <div className="flex justify-between py-1 border-b border-white/5">
                            <span className="text-slate-400">Profit Split:</span>
                            <span className="font-bold text-blue-400">{pSplit}</span>
                          </div>
                          <div className="flex justify-between py-1">
                            <span className="text-slate-400">Leverage:</span>
                            <span className="font-bold text-slate-200">{pLeverage}</span>
                          </div>
                        </div>
                      </div>

                      {/* Footer: Price & Select Trigger */}
                      <div className="mt-5 pt-3 border-t border-white/10 flex items-center justify-between">
                        <div>
                          <span className="text-[10px] uppercase font-mono text-slate-500 block">Account Price</span>
                          <span className="text-xl font-black text-white font-mono">
                            ${discountedPrice.toFixed(0)}
                          </span>
                        </div>
                        <button
                          type="button"
                          className={`px-3.5 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all ${
                            isSelected
                              ? 'bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-600/30'
                              : 'bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10'
                          }`}
                        >
                          {isSelected ? 'Selected' : 'Select'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* REMOVE 2 MINUTE RULE ADDON CARD (For 1 Step, 2 Step, Payout Later, AT Trial) */}
              {selectedType !== 'instant_bolt' && (
                <div className="mt-6 bg-gradient-to-r from-amber-500/15 via-slate-900 to-indigo-950/50 border border-amber-500/40 rounded-2xl p-5 space-y-3 shadow-2xl relative overflow-hidden">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/40 shrink-0">
                        <Clock className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-black text-white tracking-wider uppercase">REMOVE 2 MINUTE RULE</h4>
                          <span className="px-2 py-0.5 text-[9px] font-mono font-bold rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            +$10 ADDON
                          </span>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">
                          Trade without minimum hold restriction on your evaluation account.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 self-end sm:self-center">
                      <span className={`text-xs font-mono font-bold px-3 py-1 rounded-full border ${
                        holdRuleUpgradePurchased 
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' 
                          : 'bg-slate-800 text-slate-400 border-slate-700'
                      }`}>
                        {holdRuleUpgradePurchased ? 'ON = Rule Removed (+$10)' : 'OFF = Rule Active'}
                      </span>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input 
                          type="checkbox" 
                          checked={holdRuleUpgradePurchased}
                          onChange={(e) => setHoldRuleUpgradePurchased(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-12 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-amber-500"></div>
                      </label>
                    </div>
                  </div>

                  <div className="flex justify-between items-center text-xs font-mono text-slate-400 pt-2 border-t border-white/10">
                    <span>Switch Status: {holdRuleUpgradePurchased ? 'ON (Rule Removed)' : 'OFF (Rule Active - 2 Min Hold)'}</span>
                    <span className="text-amber-300 font-bold">
                      Account Total: ${calculateTotal().toFixed(0)}
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* EXPANDABLE RULES CARD */}
            <RulesCard 
              accountType={selectedType}
              size={selectedPkg.size}
              holdRuleUpgradePurchased={holdRuleUpgradePurchased}
              defaultExpanded={true}
            />

            {/* Platform Option selection */}
            <div className="bg-white/5 border border-white/10 rounded-3xl p-6 space-y-4 backdrop-blur-sm">
              <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">3. Select Trading Platform Instance</label>
              <div className="flex">
                <button
                  type="button"
                  onClick={() => setSelectedPlatform('ATTerminal')}
                  className="px-6 py-3.5 rounded-2xl text-xs font-bold tracking-wider border border-blue-500 bg-blue-500/10 text-white flex items-center gap-2"
                >
                  <Sparkles className="w-4 h-4 text-blue-400" />
                  <span>ATTerminal (Proprietary Execution Engine)</span>
                </button>
              </div>
            </div>

            {/* Evaluation Objectives details */}
            <div className="bg-white/5 border border-white/10 rounded-3xl p-6 space-y-4 backdrop-blur-sm shadow-xl">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center space-x-2">
                <Sparkles className="w-4 h-4 text-blue-400" />
                <span>Selected Evaluation Parameters</span>
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-center divide-y sm:divide-y-0 sm:divide-x divide-white/10">
                <div className="pt-2 sm:pt-0">
                  <p className="text-xs text-slate-400">Profit Target</p>
                  <p className="text-base font-bold text-emerald-400 mt-1">
                    {selectedPkg.profitTargetPercent > 0 ? `${selectedPkg.profitTargetPercent}%` : 'No Target'}
                  </p>
                </div>
                <div className="pt-2 sm:pt-0 pl-0 sm:pl-4">
                  <p className="text-xs text-slate-400">Daily Loss Limit</p>
                  <p className="text-base font-bold text-red-400 mt-1">{selectedPkg.dailyDrawdownPercent}%</p>
                </div>
                <div className="pt-2 sm:pt-0 pl-0 sm:pl-4">
                  <p className="text-xs text-slate-400">Overall Loss Limit</p>
                  <p className="text-base font-bold text-red-400 mt-1">{selectedPkg.maxDrawdownPercent}%</p>
                </div>
                <div className="pt-2 sm:pt-0 pl-0 sm:pl-4">
                  <p className="text-xs text-slate-400">Payout Split</p>
                  <p className="text-base font-bold text-blue-400 mt-1">{selectedPkg.payoutSplit}%</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Column Checkout summary card */}
          <div className="lg:col-span-5 space-y-6">
            <div className="bg-white/5 border border-white/10 rounded-3xl p-6 space-y-6 backdrop-blur-md sticky top-24 shadow-2xl">
              <h3 className="text-lg font-bold text-white">Selected Challenge Summary</h3>
              
              <div className="space-y-3.5 border-b border-white/10 pb-4 text-sm">
                <div className="flex justify-between text-slate-400">
                  <span>Program Type</span>
                  <span className="text-white font-semibold uppercase">{selectedType.replace('_', ' ')}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Funding Target</span>
                  <span className="text-white font-semibold font-mono">{selectedPkg.name}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Platform Host</span>
                  <span className="text-white font-semibold font-mono">{selectedPlatform}</span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Original Fee</span>
                  <span className="text-white font-semibold font-mono">
                    ${selectedPkg.price}
                  </span>
                </div>

                {appliedCoupon && (
                  <div className="flex justify-between text-emerald-400">
                    <span>Discount Applied ({appliedCoupon.code})</span>
                    <span className="font-semibold font-mono">
                      {appliedCoupon.discountType === 'fixed' || (appliedCoupon.discountAmount && appliedCoupon.discountAmount > 0 && !appliedCoupon.discountPercent)
                        ? `-$${appliedCoupon.discountAmount?.toFixed(2)}`
                        : `-${appliedCoupon.discountPercent}%`
                      }
                    </span>
                  </div>
                )}
              </div>

              {/* Promo code inputs */}
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider block">Apply Promo Coupon</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Ticket className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      placeholder="ENTER COUPON"
                      value={couponCode}
                      onChange={(e) => setCouponCode(e.target.value)}
                      className="w-full h-11 bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 uppercase font-mono"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleApplyCoupon}
                    className="px-5 h-11 bg-white/10 hover:bg-white/20 text-white rounded-xl text-sm font-bold border border-white/10 transition-colors"
                  >
                    Apply
                  </button>
                </div>

                {couponError && (
                  <p className="text-xs text-red-400 flex items-center space-x-1.5 pt-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    <span>{couponError}</span>
                  </p>
                )}
                {couponSuccess && (
                  <p className="text-xs text-emerald-400 flex items-center space-x-1.5 pt-1">
                    <Check className="w-3.5 h-3.5" />
                    <span>{couponSuccess}</span>
                  </p>
                )}
              </div>

              <div className="flex justify-between items-baseline pt-4 border-t border-white/10">
                <span className="text-base font-bold text-white">Grand Fee Total</span>
                <span className="text-3xl font-bold text-blue-400 font-mono font-bold">
                  ${calculateTotal().toFixed(2)}
                </span>
              </div>

              {/* BOGO Offer Banner */}
              {bogoMappings[selectedPkg.id] && (
                <div className="bg-gradient-to-r from-blue-600/20 to-cyan-600/20 border border-blue-500/30 rounded-2xl p-4 space-y-1">
                  <p className="text-xs font-black text-blue-300 uppercase tracking-widest flex items-center gap-1.5">
                    <span>🎁 Buy 1 Get 1 Free Active</span>
                  </p>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    You will receive a completely <strong>FREE {CHALLENGE_PACKAGES.find(p => p.id === bogoMappings[selectedPkg.id])?.name || 'Bonus'} Account</strong> automatically upon purchase approval!
                  </p>
                </div>
              )}

              {packagesConfig[selectedPkg.id]?.disabled ? (
                <div className="space-y-3">
                  <div className="bg-red-500/10 border border-red-500/20 rounded-2xl p-4 text-center space-y-2">
                    <span className="text-xs uppercase font-bold text-red-400 flex items-center justify-center gap-1">
                      <XCircle className="w-4 h-4" />
                      <span>Currently Unavailable</span>
                    </span>
                    <p className="text-xs text-slate-400">
                      Expected return date: <strong className="text-white">{packagesConfig[selectedPkg.id]?.expectedReturnDate || 'TBD'}</strong>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setNotifyPkgId(selectedPkg.id);
                      setNotifyMsg('');
                      setNotifyEmail(userEmail || '');
                      setShowNotifyModal(true);
                    }}
                    className="w-full h-12 bg-cyan-600 hover:bg-cyan-500 text-white font-bold rounded-xl transition-all shadow-lg flex items-center justify-center gap-2 text-sm tracking-wider uppercase"
                  >
                    <Bell className="w-4 h-4" />
                    <span>Notify Me When Available</span>
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setStep('checkout')}
                  className="w-full h-12 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-all shadow-lg flex items-center justify-center gap-2 text-sm tracking-wider uppercase"
                >
                  <span>Proceed to Billing</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              )}

              <div className="flex items-center gap-2 justify-center text-[11px] text-slate-500 text-center leading-relaxed">
                <ShieldCheck className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                <span>100% Secure Cryptographic Processing.</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* STEP 2: BILLING & PAYMENT GATEWAY SCREEN */}
      {step === 'checkout' && (
        <form onSubmit={handleSubmitOrder} className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column Billing Inputs */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* Back button */}
            <button
              type="button"
              onClick={() => setStep('select')}
              className="flex items-center gap-2 text-xs font-bold text-slate-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Spec Customizer</span>
            </button>

            {/* Personal billing info form block */}
            <div className="bg-white/5 border border-white/10 rounded-3xl p-6 space-y-6 backdrop-blur-sm">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <User className="w-5 h-5 text-blue-500" />
                <span>Personal Billing Information</span>
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block">First Name</label>
                  <input
                    type="text"
                    required
                    placeholder="Enter First Name"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full h-11 bg-white/5 border border-white/10 rounded-xl px-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block">Last Name</label>
                  <input
                    type="text"
                    required
                    placeholder="Enter Last Name"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full h-11 bg-white/5 border border-white/10 rounded-xl px-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block">Email Address</label>
                  <input
                    type="email"
                    required
                    placeholder="Enter Email Address"
                    value={billingEmail}
                    onChange={(e) => setBillingEmail(e.target.value)}
                    className="w-full h-11 bg-white/5 border border-white/10 rounded-xl px-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block">Phone Number</label>
                  <input
                    type="tel"
                    required
                    placeholder="e.g. +1 (555) 123-4567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full h-11 bg-white/5 border border-white/10 rounded-xl px-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block">Country</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. United States"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="w-full h-11 bg-white/5 border border-white/10 rounded-xl px-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block">State / Province</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. California"
                    value={stateProv}
                    onChange={(e) => setStateProv(e.target.value)}
                    className="w-full h-11 bg-white/5 border border-white/10 rounded-xl px-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block">City</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. Los Angeles"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    className="w-full h-11 bg-white/5 border border-white/10 rounded-xl px-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block">Postal Code</label>
                  <input
                    type="text"
                    required
                    placeholder="e.g. 90001"
                    value={postalCode}
                    onChange={(e) => setPostalCode(e.target.value)}
                    className="w-full h-11 bg-white/5 border border-white/10 rounded-xl px-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block">Full Billing Address</label>
                <textarea
                  required
                  rows={2}
                  placeholder="Street name, suite, apartment number, etc."
                  value={fullAddress}
                  onChange={(e) => setFullAddress(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl p-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>
            </div>

            {/* Transaction Identification block */}
            <div className="bg-white/5 border border-white/10 rounded-3xl p-6 space-y-4 backdrop-blur-sm">
              <h3 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <Hash className="w-4 h-4 text-blue-400" />
                <span>Transaction Verification Details</span>
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Provide the blockchain transaction hash or payment reference ID to expedite the verification process.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block">Transaction Hash (TxHash)</label>
                  <input
                    type="text"
                    placeholder="Enter blockchain transaction hash"
                    value={transactionHash}
                    onChange={(e) => setTransactionHash(e.target.value)}
                    className="w-full h-11 bg-white/5 border border-white/10 rounded-xl px-4 text-xs font-mono text-white focus:outline-none focus:border-blue-500 placeholder-slate-600"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400 font-semibold uppercase tracking-wider block">Transaction ID (TxID)</label>
                  <input
                    type="text"
                    placeholder="Enter Payment/UPI Reference ID"
                    value={transactionId}
                    onChange={(e) => setTransactionId(e.target.value)}
                    className="w-full h-11 bg-white/5 border border-white/10 rounded-xl px-4 text-xs font-mono text-white focus:outline-none focus:border-blue-500 placeholder-slate-600"
                  />
                </div>
              </div>
            </div>

          </div>

          {/* Right Column billing crypto system */}
          <div className="lg:col-span-5 space-y-6">
            
            {/* crypto payment address details block */}
            <div className="bg-white/5 border border-white/10 rounded-3xl p-6 space-y-6 backdrop-blur-md shadow-2xl">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Coins className="w-5 h-5 text-blue-500" />
                <span>Payment Checkout Center</span>
              </h3>

              {/* crypto / UPI selection methods */}
              <div className="space-y-2.5">
                <label className="text-xs text-slate-400 font-bold uppercase tracking-wider block">Select Payment Method</label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
                  {(['Bitcoin (BTC)', 'USDT TRC20', 'USDT ERC20', 'Litecoin (LTC)', 'UPI'] as const).map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setCryptoMethod(method)}
                      className={`h-12 rounded-xl border flex items-center justify-center text-xs font-bold gap-1.5 transition-all ${
                        cryptoMethod === method 
                          ? 'border-blue-500 bg-blue-500/10 text-white shadow-md' 
                          : 'border-white/10 text-slate-400 hover:text-white hover:bg-white/5'
                      }`}
                    >
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                      <span>{method}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Wallet Address or UPI ID to send funds to */}
              <div className="bg-black/40 border border-white/10 rounded-2xl p-4 space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    {cryptoMethod === 'UPI' ? 'Pay to UPI ID' : 'Transfer to Wallet Address'}
                  </span>
                  <span className="text-[10px] text-blue-400 font-semibold bg-blue-500/10 border border-blue-500/25 px-2 py-0.5 rounded-md uppercase font-mono">
                    {cryptoMethod.split(' ')[0]}
                  </span>
                </div>

                <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-xl px-3 py-2.5">
                  <span className="text-xs font-mono text-white break-all flex-1 select-all">
                    {getActiveWalletAddress() || "No payment address configured by Admin."}
                  </span>
                  {getActiveWalletAddress() && (
                    <button
                      type="button"
                      onClick={handleCopyWalletAddress}
                      className="p-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors flex-shrink-0"
                      title="Copy Address"
                    >
                      {copyFeedback ? (
                        <Check className="w-3.5 h-3.5" />
                      ) : (
                        <Clipboard className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>

                {/* Real QR Code uploaded by Admin */}
                {getActiveQrCode() && (
                  <div className="flex flex-col items-center justify-center py-3 bg-black/30 border border-white/5 rounded-xl gap-2">
                    <img 
                      src={getActiveQrCode()} 
                      alt={`${cryptoMethod} QR Code`} 
                      className="w-40 h-40 object-contain rounded-lg border border-white/10 p-1.5 bg-white"
                      referrerPolicy="no-referrer"
                    />
                    <span className="text-[10px] font-mono text-slate-400">Scan to pay automatically</span>
                  </div>
                )}

                {copyFeedback && (
                  <p className="text-[11px] text-emerald-400 font-semibold text-center font-mono">
                    Copied successfully to clipboard!
                  </p>
                )}

                <div className="text-[11px] text-slate-400 bg-slate-800/20 p-2.5 rounded-xl leading-relaxed">
                  <strong>Instruction:</strong> Send exactly <span className="font-mono text-white">
                    ${calculateTotal().toFixed(2)} USD
                  </span> worth of {cryptoMethod.split(' ')[0]} to the details above. Make sure to transfer using the correct network / ID.
                </div>
              </div>

              {/* Upload Screenshot block */}
              <div className="space-y-2.5">
                <label className="text-xs text-slate-400 font-bold uppercase tracking-wider block">Proof of Payment Submission</label>
                
                <div 
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-white/10 hover:border-blue-500/50 bg-white/5 hover:bg-white/10 rounded-2xl p-6 text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-3 group"
                >
                  <input
                    type="file"
                    ref={fileInputRef}
                    accept="image/*"
                    onChange={handleFileChange}
                    className="hidden"
                  />

                  {screenshotPreview ? (
                    <div className="space-y-3 w-full">
                      <div className="relative w-full h-32 rounded-xl overflow-hidden bg-black flex items-center justify-center">
                        <img 
                          src={screenshotPreview} 
                          alt="Screenshot Proof" 
                          className="max-h-full max-w-full object-contain"
                          referrerPolicy="no-referrer"
                        />
                      </div>
                      <p className="text-xs text-blue-400 group-hover:underline flex items-center justify-center gap-1">
                        <Upload className="w-3 h-3" />
                        <span>Change uploaded screenshot</span>
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/25 flex items-center justify-center text-blue-400">
                        <Upload className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-white">Upload Payment Screenshot</p>
                        <p className="text-[10px] text-slate-400 mt-1">Drag and drop your file here, or click to browse</p>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* Form Errors */}
              {formError && (
                <div className="p-3 bg-red-500/10 border border-red-500/25 text-red-300 text-xs rounded-xl flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Checkout submit controls */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full h-12 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 text-white font-bold rounded-xl transition-all flex items-center justify-center gap-2 tracking-wider text-xs uppercase shadow-lg shadow-blue-500/10"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin text-white" />
                      <span>Verifying & Writing Order...</span>
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4" />
                      <span>Submit Payment Proof for Review</span>
                    </>
                  )}
                </button>
              </div>

              <div className="text-[10px] text-slate-500 text-center leading-normal">
                Submitting your transaction creates a pending order in our Firestore database. Your prop accounts are created instantly once an administrator approves the screenshot proof.
              </div>
            </div>
          </div>
        </form>
      )}

      {/* STEP 3: ORDER SUCCESS & TIMELINE REVIEW SCREEN */}
      {step === 'success' && latestOrder && (
        <div className="max-w-3xl mx-auto bg-white/5 border border-white/10 rounded-3xl p-8 space-y-8 backdrop-blur-sm text-center shadow-2xl">
          
          <div className="flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <CheckCircle2 className="w-10 h-10" />
            </div>
            <h3 className="text-2xl font-bold text-white tracking-tight">Order Received Successfully!</h3>
            <p className="text-slate-400 text-sm max-w-md">
              Your proof of payment is now being manually audited by ATFunding billing officers. Once verified, your credentials will appear in your dashboard instantly.
            </p>
          </div>

          <div className="bg-black/35 rounded-2xl p-5 border border-white/5 text-left grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
            <div className="space-y-1.5">
              <p className="text-slate-500 uppercase font-semibold">Order Reference ID</p>
              <p className="text-white text-sm font-bold">#{latestOrder.orderId}</p>
            </div>
            <div className="space-y-1.5">
              <p className="text-slate-500 uppercase font-semibold">Target Size / Program</p>
              <p className="text-white text-sm font-bold uppercase">{latestOrder.accountSize} {latestOrder.accountType.replace('_', ' ')}</p>
            </div>
            <div className="space-y-1.5">
              <p className="text-slate-500 uppercase font-semibold">Payment Method</p>
              <p className="text-white text-sm font-bold">{latestOrder.paymentMethod}</p>
            </div>
            <div className="space-y-1.5">
              <p className="text-slate-500 uppercase font-semibold">Total Amount Due</p>
              <p className="text-blue-400 text-sm font-bold">${latestOrder.finalPrice.toFixed(2)} USD</p>
            </div>
            <div className="space-y-1.5 md:col-span-2 border-t border-white/5 pt-3 mt-1">
              <p className="text-slate-500 uppercase font-semibold">Uploaded Proof of Payment</p>
              <a 
                href={latestOrder.paymentScreenshot} 
                target="_blank" 
                rel="noreferrer" 
                className="text-blue-400 hover:underline break-all mt-1 block"
              >
                {latestOrder.paymentScreenshot.startsWith('data:') ? 'Local Screenshot Base64 Image Representation' : latestOrder.paymentScreenshot}
              </a>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
            <button
              type="button"
              onClick={() => {
                setStep('select');
                setLatestOrder(null);
              }}
              className="px-6 h-11 bg-white/10 hover:bg-white/15 text-white font-bold rounded-xl transition-colors text-xs uppercase"
            >
              Order Another Account
            </button>
            <button
              type="button"
              onClick={() => onPurchaseSuccess(latestOrder.accountType, selectedPkg.size)}
              className="px-6 h-11 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-xl transition-colors text-xs uppercase"
            >
              Return to Overview
            </button>
          </div>
        </div>
      )}

      {/* BILLING & RECENT ORDER HISTORY AT THE BOTTOM */}
      <div className="space-y-5 border-t border-white/10 pt-10">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Clock className="w-5 h-5 text-blue-500" />
            <span>My Billing & Challenge Orders History</span>
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Realtime tracking of your cryptographic checkouts, review status, and active funded prop accounts.
          </p>
        </div>

        {myOrders.length === 0 ? (
          <div className="bg-white/5 border border-white/10 rounded-2xl p-8 text-center text-slate-500 text-sm">
            No checkout orders recorded. Select an evaluation size and submit payment to get started.
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {myOrders.map((ord) => (
              <div 
                key={ord.orderId}
                className="bg-white/5 border border-white/10 rounded-2xl p-5 space-y-4 backdrop-blur-sm hover:border-white/15 transition-all"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <span className="text-[10px] text-slate-500 font-mono block">ORDER NUMBER</span>
                    <span className="text-xs font-mono font-bold text-white">#{ord.orderId}</span>
                  </div>
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wider ${getStatusColor(ord.status)}`}>
                    {ord.status}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[11px] border-b border-white/5 pb-3">
                  <div>
                    <span className="text-slate-500 block uppercase font-semibold">Challenge Program</span>
                    <span className="text-white uppercase font-mono font-bold">{ord.accountSize} {ord.accountType.replace('_', ' ')}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block uppercase font-semibold">Paid via Coin</span>
                    <span className="text-white font-mono font-bold">{ord.paymentMethod}</span>
                  </div>
                  <div className="mt-1.5">
                    <span className="text-slate-500 block uppercase font-semibold">Grand Total Paid</span>
                    <span className="text-blue-400 font-mono font-bold">${ord.finalPrice.toFixed(2)}</span>
                  </div>
                  <div className="mt-1.5">
                    <span className="text-slate-500 block uppercase font-semibold">Date Submitted</span>
                    <span className="text-slate-300 font-mono">{new Date(ord.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>

                <div className="flex justify-between items-center text-[10px]">
                  <div className="flex items-center gap-1.5">
                    <ImageIcon className="w-3.5 h-3.5 text-slate-500" />
                    <a 
                      href={ord.paymentScreenshot} 
                      target="_blank" 
                      rel="noreferrer" 
                      className="text-blue-400 hover:underline font-mono"
                    >
                      View Proof Screenshot
                    </a>
                  </div>

                  {ord.platform && (
                    <span className="text-slate-400 font-mono">Platform: <strong className="text-white">{ord.platform}</strong></span>
                  )}
                </div>

                {ord.status === 'Rejected' && ord.rejectionReason && (
                  <div className="p-2.5 bg-rose-500/10 border border-rose-500/20 text-rose-300 text-[11px] rounded-xl font-mono leading-relaxed">
                    <strong>Rejection reason:</strong> {ord.rejectionReason}
                  </div>
                )}

                {ord.status === 'Approved' && (
                  <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 text-[11px] rounded-xl font-mono leading-relaxed flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5" />
                    <span>Prop evaluation account generated and linked to dashboard!</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showNotifyModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#0b0f19] border border-white/15 rounded-3xl w-full max-w-md p-6 space-y-4 animate-fade-in relative">
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
                className="w-full h-10 bg-black/40 border border-white/10 rounded-xl px-3 text-xs text-white focus:outline-none"
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
