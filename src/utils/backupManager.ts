import { collection, doc, getDocs, setDoc, query, orderBy, limit, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { clearAllFirestoreCache } from '../lib/firestoreCache';

export interface BackupCollectionCounts {
  users: number;
  accounts: number;
  trades: number;
  payouts: number;
  coupons: number;
  total: number;
}

export interface FirestoreBackupRecord {
  id: string;
  timestamp: string;
  type: 'AUTO_DAILY' | 'MANUAL';
  status: 'SUCCESS' | 'FAILED';
  counts: BackupCollectionCounts;
  data?: {
    users: any[];
    accounts: any[];
    trades: any[];
    payouts: any[];
    coupons: any[];
  };
  errorMsg?: string;
}

const BACKUP_COLLECTIONS = ['users', 'accounts', 'trades', 'payouts', 'coupons'] as const;
const LAST_AUTO_BACKUP_KEY = 'atfunding_last_auto_backup_timestamp';

/**
 * Creates a complete snapshot backup of the 5 primary Firestore collections.
 */
export async function createFirestoreBackup(type: 'AUTO_DAILY' | 'MANUAL' = 'MANUAL'): Promise<FirestoreBackupRecord> {
  const timestamp = new Date().toISOString();
  const id = `BACKUP-${Date.now()}`;

  const backupData: NonNullable<FirestoreBackupRecord['data']> = {
    users: [],
    accounts: [],
    trades: [],
    payouts: [],
    coupons: []
  };

  const counts: BackupCollectionCounts = {
    users: 0,
    accounts: 0,
    trades: 0,
    payouts: 0,
    coupons: 0,
    total: 0
  };

  try {
    for (const colName of BACKUP_COLLECTIONS) {
      try {
        const snap = await getDocs(collection(db, colName));
        const docsList: any[] = [];
        snap.forEach((d) => {
          docsList.push({ id: d.id, ...d.data() });
        });
        backupData[colName] = docsList;
        counts[colName] = docsList.length;
      } catch (colErr) {
        console.warn(`Backup collection fetch failed for ${colName}:`, colErr);
        // Try recovering from local storage cache snapshot if available
        try {
          const cached = localStorage.getItem(`cache_${colName}`);
          if (cached) {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed.data)) {
              backupData[colName] = parsed.data;
              counts[colName] = parsed.data.length;
            }
          }
        } catch (e) {}
      }
    }

    counts.total = counts.users + counts.accounts + counts.trades + counts.payouts + counts.coupons;

    const record: FirestoreBackupRecord = {
      id,
      timestamp,
      type,
      status: 'SUCCESS',
      counts,
      data: backupData
    };

    // 1. Save metadata to Firestore `firestore_backups` document
    const metadataOnly: FirestoreBackupRecord = {
      id,
      timestamp,
      type,
      status: 'SUCCESS',
      counts
    };

    try {
      await setDoc(doc(db, 'firestore_backups', id), metadataOnly);
      // Save full dataset into detail collection document for restoration
      await setDoc(doc(db, 'firestore_backup_details', id), {
        id,
        timestamp,
        data: backupData
      });
    } catch (e) {
      console.warn("Could not save backup record to Firestore (quota/offline):", e);
    }

    // 2. Always persist latest backup in localStorage for offline recovery
    try {
      localStorage.setItem('latest_firestore_backup_metadata', JSON.stringify(metadataOnly));
      localStorage.setItem('latest_firestore_backup_data', JSON.stringify(backupData));
      if (type === 'AUTO_DAILY') {
        localStorage.setItem(LAST_AUTO_BACKUP_KEY, String(Date.now()));
      }
    } catch (e) {
      console.warn("Could not write backup to localStorage:", e);
    }

    return record;
  } catch (err: any) {
    const failedRecord: FirestoreBackupRecord = {
      id,
      timestamp,
      type,
      status: 'FAILED',
      counts,
      errorMsg: err?.message || String(err)
    };
    return failedRecord;
  }
}

/**
 * Checks if 24 hours have passed since the last daily export backup; if so, executes automatic backup.
 */
export async function checkAndRunDailyAutoBackup(): Promise<FirestoreBackupRecord | null> {
  try {
    const lastRun = localStorage.getItem(LAST_AUTO_BACKUP_KEY);
    const now = Date.now();
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

    if (!lastRun || (now - Number(lastRun)) >= TWENTY_FOUR_HOURS) {
      console.log("Executing automatic daily Firestore export backup...");
      const record = await createFirestoreBackup('AUTO_DAILY');
      return record;
    }
  } catch (e) {
    console.warn("Daily auto backup check failed:", e);
  }
  return null;
}

/**
 * Lists metadata of available backups from Firestore or local storage snapshots.
 */
export async function listFirestoreBackups(): Promise<FirestoreBackupRecord[]> {
  const records: FirestoreBackupRecord[] = [];

  try {
    const q = query(collection(db, 'firestore_backups'), orderBy('timestamp', 'desc'), limit(20));
    const snap = await getDocs(q);
    snap.forEach((d) => {
      records.push(d.data() as FirestoreBackupRecord);
    });
  } catch (e) {
    console.warn("Could not list backups from Firestore:", e);
  }

  // Combine with local snapshot if not present
  try {
    const localMeta = localStorage.getItem('latest_firestore_backup_metadata');
    if (localMeta) {
      const parsed = JSON.parse(localMeta) as FirestoreBackupRecord;
      if (!records.some((r) => r.id === parsed.id)) {
        records.unshift(parsed);
      }
    }
  } catch (e) {}

  return records;
}

/**
 * Restores all records from a backup snapshot into Firestore collections.
 */
export async function restoreFirestoreBackup(
  backupIdOrRecord: string | FirestoreBackupRecord
): Promise<{ restoredCounts: Record<string, number>; errors: string[] }> {
  let backupData: FirestoreBackupRecord['data'] | null = null;
  const errors: string[] = [];
  const restoredCounts: Record<string, number> = {
    users: 0,
    accounts: 0,
    trades: 0,
    payouts: 0,
    coupons: 0
  };

  if (typeof backupIdOrRecord === 'string') {
    const backupId = backupIdOrRecord;
    // 1. Try reading from firestore_backup_details
    try {
      const docSnap = await getDoc(doc(db, 'firestore_backup_details', backupId));
      if (docSnap.exists()) {
        backupData = docSnap.data().data;
      }
    } catch (e) {}

    // 2. Fallback to localStorage backup data
    if (!backupData) {
      try {
        const stored = localStorage.getItem('latest_firestore_backup_data');
        if (stored) backupData = JSON.parse(stored);
      } catch (e) {}
    }
  } else if (backupIdOrRecord.data) {
    backupData = backupIdOrRecord.data;
  }

  if (!backupData) {
    throw new Error("No backup dataset found for the selected backup ID.");
  }

  // Restore each collection
  for (const colName of BACKUP_COLLECTIONS) {
    const items = backupData[colName];
    if (Array.isArray(items) && items.length > 0) {
      for (const item of items) {
        if (!item.id) continue;
        const { id, ...dataWithoutId } = item;
        try {
          await setDoc(doc(db, colName, id), item, { merge: true });
          restoredCounts[colName]++;
        } catch (itemErr: any) {
          errors.push(`Failed to restore item #${id} in ${colName}: ${itemErr?.message || String(itemErr)}`);
        }
      }
      // Update local storage cache snapshot as well
      try {
        localStorage.setItem(`cache_${colName}`, JSON.stringify({ timestamp: Date.now(), data: items }));
      } catch (e) {}
    }
  }

  // Invalidate all caches
  clearAllFirestoreCache();

  return { restoredCounts, errors };
}
