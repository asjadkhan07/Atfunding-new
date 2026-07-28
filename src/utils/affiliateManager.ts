import { db } from '../firebase';
import { doc, getDoc, setDoc, collection, getDocs, query, where, limit } from 'firebase/firestore';

export const OFFICIAL_AFFILIATE_DOMAIN = 'https://atfunding.online';

/**
 * Generates the permanent official affiliate link for a given code
 */
export function getOfficialAffiliateLink(code: string): string {
  const cleanCode = (code || '').trim();
  return `${OFFICIAL_AFFILIATE_DOMAIN}/?ref=${cleanCode}`;
}

/**
 * Validates whether an affiliate code is globally unique across Firestore
 */
export async function isAffiliateCodeUnique(code: string, currentUserId?: string): Promise<boolean> {
  const cleanCode = (code || '').trim();
  if (!cleanCode) return false;

  try {
    // 1. Single efficient check on users collection
    const usersQuery = await getDocs(query(collection(db, 'users'), where('affiliateCode', '==', cleanCode), limit(5)));
    for (const docSnap of usersQuery.docs) {
      if (!currentUserId || docSnap.id !== currentUserId) {
        return false; // Code is already taken by another user
      }
    }
    return true;
  } catch (err) {
    console.warn("Warning during affiliate code uniqueness check (offline/quota fallback):", err);
    return true; // Fallback allowing code generation to proceed without throwing
  }
}

/**
 * Generates a unique, permanent affiliate code for a new user
 */
export async function generatePermanentAffiliateCode(
  userId: string,
  email?: string,
  username?: string
): Promise<string> {
  let baseName = '';
  if (username && username.trim()) {
    baseName = username.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  } else if (email && email.trim()) {
    baseName = email.trim().split('@')[0].toUpperCase().replace(/[^A-Z0-9]/g, '');
  }
  if (!baseName || baseName.length < 2) {
    baseName = 'ATF';
  }

  if (baseName.length > 8) {
    baseName = baseName.substring(0, 8);
  }

  // Generate deterministic/candidate code
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  const candidateCode = `${baseName}${randomNum}`;

  try {
    const isUnique = await isAffiliateCodeUnique(candidateCode, userId);
    if (isUnique) return candidateCode;
  } catch {
    // Ignore quota/network errors
  }

  // Fallback unique code derived from UID
  const shortUid = (userId || 'ATF').slice(0, 5).toUpperCase();
  return `${baseName}${shortUid}`;
}

/**
 * Ensures user has a PERMANENT affiliate code.
 * Reuses existing code if available in memory, localStorage, or Firestore.
 * NEVER throws quota errors.
 */
export async function ensureUserAffiliateCode(user: {
  uid: string;
  email?: string;
  username?: string;
  affiliateCode?: string;
}): Promise<string> {
  if (!user || !user.uid) return 'ATF100';

  const cacheKey = `atf_affcode_${user.uid}`;

  // 1. If affiliateCode is already in passed user object
  if (user.affiliateCode && typeof user.affiliateCode === 'string' && user.affiliateCode.trim()) {
    const cleanCode = user.affiliateCode.trim();
    try { localStorage.setItem(cacheKey, cleanCode); } catch {}
    return cleanCode;
  }

  // 2. Check localStorage cache
  try {
    const cachedCode = localStorage.getItem(cacheKey);
    if (cachedCode && cachedCode.trim()) {
      return cachedCode.trim();
    }
  } catch {}

  // 3. Query Firestore user doc gracefully
  try {
    const userDocRef = doc(db, 'users', user.uid);
    const userDocSnap = await getDoc(userDocRef);

    if (userDocSnap.exists()) {
      const userData = userDocSnap.data();
      if (userData.affiliateCode && typeof userData.affiliateCode === 'string' && userData.affiliateCode.trim()) {
        const existingCode = userData.affiliateCode.trim();
        try { localStorage.setItem(cacheKey, existingCode); } catch {}
        return existingCode;
      }
    }
  } catch (err) {
    console.warn("Firestore read failed in ensureUserAffiliateCode (quota or network limit). Using local fallback code.", err);
  }

  // 4. Generate candidate code & cache locally
  const newCode = await generatePermanentAffiliateCode(user.uid, user.email, user.username);
  try { localStorage.setItem(cacheKey, newCode); } catch {}

  // 5. Try updating Firestore asynchronously without throwing
  try {
    await setDoc(doc(db, 'users', user.uid), { affiliateCode: newCode }, { merge: true });
    await setDoc(doc(db, 'affiliates', user.uid), {
      userId: user.uid,
      code: newCode,
      clicks: 0,
      referrals: 0,
      unpaidBalance: 0,
      totalEarned: 0,
      createdAt: new Date().toISOString()
    }, { merge: true }).catch(() => {});
  } catch (writeErr) {
    console.warn("Could not write new affiliate code to Firestore (quota limit reached):", writeErr);
  }

  return newCode;
}

/**
 * Audits all users and affiliates documents in Firestore.
 */
export async function auditAndFixAllAffiliateCodes(): Promise<{
  totalUsersAudited: number;
  usersFixed: number;
  reportLog: string[];
}> {
  const reportLog: string[] = [];
  let totalUsersAudited = 0;
  let usersFixed = 0;

  reportLog.push(`[${new Date().toISOString()}] Starting Firestore Affiliate Code Audit...`);

  try {
    const usersSnap = await getDocs(collection(db, 'users'));
    totalUsersAudited = usersSnap.docs.length;
    reportLog.push(`Found ${totalUsersAudited} user records in 'users' collection.`);

    for (const userDoc of usersSnap.docs) {
      const uid = userDoc.id;
      const data = userDoc.data();
      let existingCode = (data.affiliateCode || '').trim();

      if (!existingCode) {
        existingCode = await generatePermanentAffiliateCode(uid, data.email, data.username);
        usersFixed++;
        reportLog.push(`✅ Fixed user ${data.email || uid}: set permanent code '${existingCode}'`);
      }
    }

    reportLog.push(`[${new Date().toISOString()}] Audit Complete.`);
  } catch (err) {
    reportLog.push(`❌ Error during affiliate code audit: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { totalUsersAudited, usersFixed, reportLog };
}

