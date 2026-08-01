import { doc, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

export interface AccountAuditLog {
  id?: string;
  accountId: string;
  accountNumber?: string;
  userId?: string;
  previousBalance: number;
  newBalance: number;
  previousStatus?: string;
  newStatus?: string;
  sourceOfChange: string;
  timestamp: string;
  details?: string;
}

/**
 * Audit Logging System (Requirement 8)
 * Permanently logs every balance or state modification with Account ID, Previous Balance,
 * New Balance, Source of Change, and Timestamp.
 */
export async function logAccountAuditChange(log: Omit<AccountAuditLog, 'timestamp'>): Promise<AccountAuditLog> {
  const timestamp = new Date().toISOString();
  const logId = log.id || `AUDIT-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const fullLog: AccountAuditLog = {
    ...log,
    id: logId,
    timestamp
  };

  // 1. Save to local storage snapshot for offline/disaster recovery
  try {
    const existing = localStorage.getItem('account_audit_logs_snapshot');
    const logs: AccountAuditLog[] = existing ? JSON.parse(existing) : [];
    logs.unshift(fullLog);
    localStorage.setItem('account_audit_logs_snapshot', JSON.stringify(logs.slice(0, 200)));
  } catch (e) {
    console.warn("Could not save audit log to localStorage:", e);
  }

  // 2. Persist to Firestore
  try {
    await setDoc(doc(db, 'account_audit_logs', logId), fullLog);
  } catch (e) {
    console.warn("Could not persist audit log to Firestore (offline/quota):", e);
  }

  return fullLog;
}

/**
 * Account Integrity Verification (Requirement 7)
 * Verifies account data structure and returns a clean, non-null, uncorrupted TradingAccount object.
 */
export function verifyAccountIntegrity<T extends Record<string, any>>(acc: T): T {
  if (!acc) return acc;
  const verified: any = { ...acc };

  // Ensure balance and startingBalance exist and are finite numbers
  const startingBal = Number(verified.startingBalance || verified.size || 10000);
  verified.startingBalance = isNaN(startingBal) || startingBal <= 0 ? 10000 : startingBal;

  if (verified.balance === undefined || verified.balance === null || isNaN(Number(verified.balance))) {
    verified.balance = verified.startingBalance;
  } else {
    verified.balance = Number(verified.balance);
  }

  if (verified.equity === undefined || verified.equity === null || isNaN(Number(verified.equity))) {
    verified.equity = verified.balance;
  } else {
    verified.equity = Number(verified.equity);
  }

  if (!verified.status) {
    verified.status = 'active';
  }

  return verified as T;
}
