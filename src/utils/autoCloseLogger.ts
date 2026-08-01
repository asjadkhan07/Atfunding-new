import { doc, setDoc, collection, getDocs, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../firebase';

export interface AutoCloseDebugLog {
  id: string;
  accountId: string;
  accountNumber?: string;
  tradeId: string;
  symbol: string;
  entryPrice: number;
  exitPrice: number;
  closeReason: string;
  triggeredRule: string;
  timestamp: string;
  userId?: string;
  debugModeActive: boolean;
}

const DEBUG_MODE_KEY = 'atfunding_auto_close_debug_mode';

export function getAutoCloseDebugMode(): boolean {
  try {
    const val = localStorage.getItem(DEBUG_MODE_KEY);
    return val === null ? true : val === 'true'; // Default to enabled for visibility
  } catch (e) {
    return true;
  }
}

export function setAutoCloseDebugMode(enabled: boolean): void {
  try {
    localStorage.setItem(DEBUG_MODE_KEY, String(enabled));
  } catch (e) {
    console.warn("Could not save auto close debug mode state:", e);
  }
}

/**
 * Permanently logs every auto-closed or force-closed trade in Firestore & local storage.
 */
export async function logAutoCloseDebug(
  logData: Omit<AutoCloseDebugLog, 'id' | 'timestamp' | 'debugModeActive'>
): Promise<AutoCloseDebugLog> {
  const timestamp = new Date().toISOString();
  const id = `AUTO-CLOSE-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const debugModeActive = getAutoCloseDebugMode();

  const fullLog: AutoCloseDebugLog = {
    ...logData,
    id,
    timestamp,
    debugModeActive
  };

  // 1. Save to local storage cache for immediate offline viewing & fallback
  try {
    const existing = localStorage.getItem('auto_close_debug_logs_snapshot');
    const logs: AutoCloseDebugLog[] = existing ? JSON.parse(existing) : [];
    logs.unshift(fullLog);
    localStorage.setItem('auto_close_debug_logs_snapshot', JSON.stringify(logs.slice(0, 300)));
  } catch (e) {
    console.warn("Could not save auto close log to localStorage:", e);
  }

  // 2. Persist to Firestore collection `auto_close_debug_logs`
  try {
    await setDoc(doc(db, 'auto_close_debug_logs', id), fullLog);
  } catch (e) {
    console.warn("Could not persist auto close debug log to Firestore (offline/quota):", e);
  }

  return fullLog;
}

/**
 * Retrieves all recorded auto-close debug logs.
 */
export async function getAutoCloseDebugLogs(): Promise<AutoCloseDebugLog[]> {
  try {
    const q = query(collection(db, 'auto_close_debug_logs'), orderBy('timestamp', 'desc'), limit(150));
    const snap = await getDocs(q);
    const logs: AutoCloseDebugLog[] = [];
    snap.forEach((d) => logs.push(d.data() as AutoCloseDebugLog));

    if (logs.length > 0) return logs;
  } catch (e) {
    console.warn("Could not fetch auto close logs from Firestore, reading local snapshot:", e);
  }

  // Fallback to local snapshot
  try {
    const stored = localStorage.getItem('auto_close_debug_logs_snapshot');
    if (stored) return JSON.parse(stored);
  } catch (e) {}

  return [];
}
