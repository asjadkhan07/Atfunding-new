import { doc, getDoc, setDoc, query, where, collection, getDocs, increment } from 'firebase/firestore';

export function calculateAffiliateCommission(accountType: string, accountSizeStr: string | number): number {
  const typeKey = (accountType || '').toString().toLowerCase();

  let sizeNum = 0;
  if (typeof accountSizeStr === 'number') {
    sizeNum = accountSizeStr;
  } else if (typeof accountSizeStr === 'string') {
    const cleanStr = accountSizeStr.trim().toUpperCase();
    if (cleanStr.endsWith('K')) {
      sizeNum = parseFloat(cleanStr.replace('K', '')) * 1000;
    } else {
      sizeNum = parseFloat(cleanStr) || 0;
    }
  }

  // 1 Step
  if (typeKey.includes('one_step') || typeKey.includes('1_step') || typeKey.includes('1 step')) {
    if (sizeNum >= 100000) return 25;
    if (sizeNum >= 50000) return 15;
    if (sizeNum >= 25000) return 10;
    if (sizeNum >= 10000) return 5;
    if (sizeNum >= 5000) return 3;
    return 3;
  }

  // 2 Step
  if (typeKey.includes('two_step') || typeKey.includes('2_step') || typeKey.includes('2 step')) {
    if (sizeNum >= 100000) return 30;
    if (sizeNum >= 50000) return 18;
    if (sizeNum >= 25000) return 12;
    if (sizeNum >= 10000) return 7;
    if (sizeNum >= 5000) return 4;
    return 4;
  }

  // Payout Later
  if (typeKey.includes('payout_later') || typeKey.includes('payout later')) {
    if (sizeNum >= 100000) return 40;
    if (sizeNum >= 50000) return 25;
    if (sizeNum >= 25000) return 15;
    if (sizeNum >= 10000) return 8;
    if (sizeNum >= 5000) return 5;
    return 5;
  }

  // Instant / Instant Bolt
  if (typeKey.includes('instant')) {
    if (sizeNum >= 9000) return 10;
    if (sizeNum >= 6000) return 6;
    if (sizeNum >= 3000) return 3;
    if (sizeNum >= 2000) return 2;
    return 2;
  }

  // Fallback default
  return 5;
}

export async function processAffiliateCommission(order: any, db: any): Promise<number | null> {
  if (!order || order.commissionProcessed) {
    return null;
  }

  // Determine referrer code
  let refCode = (order.referredBy || '').trim();

  // If order.referredBy was empty, check user document
  if (!refCode && order.userId) {
    try {
      const uSnap = await getDoc(doc(db, 'users', order.userId));
      if (uSnap.exists()) {
        refCode = (uSnap.data()?.referredBy || '').trim();
      }
    } catch (e) {
      console.warn("Could not check referredBy on user doc:", e);
    }
  }

  if (!refCode) {
    return null;
  }

  // Find affiliate's user ID and details
  let affiliateUid = '';
  let affiliateEmail = '';

  try {
    // 1. Check if refCode directly matches a user UID
    const directUserSnap = await getDoc(doc(db, 'users', refCode));
    if (directUserSnap.exists()) {
      affiliateUid = directUserSnap.id;
      affiliateEmail = directUserSnap.data()?.email || '';
    } else {
      // 2. Query users by affiliateCode or username
      const qCode = query(collection(db, 'users'), where('affiliateCode', '==', refCode));
      const codeSnap = await getDocs(qCode);
      if (!codeSnap.empty) {
        affiliateUid = codeSnap.docs[0].id;
        affiliateEmail = codeSnap.docs[0].data()?.email || '';
      } else {
        const qUsername = query(collection(db, 'users'), where('username', '==', refCode));
        const userSnap = await getDocs(qUsername);
        if (!userSnap.empty) {
          affiliateUid = userSnap.docs[0].id;
          affiliateEmail = userSnap.docs[0].data()?.email || '';
        }
      }
    }
  } catch (err) {
    console.warn("Error finding affiliate user:", err);
  }

  if (!affiliateUid) {
    affiliateUid = refCode; // fallback ID
  }

  const commissionAmount = calculateAffiliateCommission(order.accountType, order.accountSize);

  // Record commission transaction
  const commissionId = 'COMM-' + Math.floor(100000 + Math.random() * 900000);
  await setDoc(doc(db, 'affiliate_commissions', commissionId), {
    id: commissionId,
    affiliateId: affiliateUid,
    affiliateCode: refCode,
    referredUserId: order.userId || '',
    referredUserEmail: order.email || '',
    orderId: order.orderId || '',
    accountType: order.accountType || '',
    accountSize: order.accountSize || '',
    orderPrice: order.finalPrice || order.price || 0,
    commissionAmount: commissionAmount,
    status: 'Earned',
    createdAt: new Date().toISOString()
  });

  // Update affiliate records
  const affRef = doc(db, 'affiliates', affiliateUid);
  await setDoc(affRef, {
    userId: affiliateUid,
    code: refCode,
    availableBalance: increment(commissionAmount),
    totalEarnings: increment(commissionAmount),
    totalSales: increment(1),
    totalReferredSalesAmount: increment(order.finalPrice || 0),
    updatedAt: new Date().toISOString()
  }, { merge: true });

  // Update user doc affiliate metrics
  const userRef = doc(db, 'users', affiliateUid);
  await setDoc(userRef, {
    affiliateBalance: increment(commissionAmount),
    totalAffiliateEarnings: increment(commissionAmount)
  }, { merge: true });

  // Update order to mark commission processed
  if (order.orderId) {
    await setDoc(doc(db, 'orders', order.orderId), {
      commissionProcessed: true,
      commissionAmount: commissionAmount,
      commissionAffiliateId: affiliateUid
    }, { merge: true });
  }

  // Send notification to affiliate
  const notifId = 'NOTIF-' + Math.floor(100000 + Math.random() * 900000);
  await setDoc(doc(db, 'notifications', notifId), {
    id: notifId,
    userId: affiliateUid,
    title: '🎉 Referral Commission Credited!',
    message: `You earned $${commissionAmount.toFixed(2)} commission from a referred purchase of ${order.accountSize} ${order.accountType.replace('_', ' ')}! Your affiliate wallet balance has been updated.`,
    type: 'success',
    read: false,
    createdAt: new Date().toISOString()
  });

  return commissionAmount;
}
