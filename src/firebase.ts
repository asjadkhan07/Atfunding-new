import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer, setLogLevel } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyAADPW8LOIluHtErmMmdyuRDhiuSlvnhGA",
  authDomain: "gen-lang-client-0674008062.firebaseapp.com",
  projectId: "gen-lang-client-0674008062",
  storageBucket: "gen-lang-client-0674008062.firebasestorage.app",
  messagingSenderId: "956506567280",
  appId: "1:956506567280:web:d9472988e16bc4745cfab5"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Services with the custom Firestore Database ID required for this applet
export const auth = getAuth(app);
export const db = getFirestore(app, "ai-studio-atfunding-572fc147-1cbf-4a6b-9c9c-3af639e06bcc");

// Suppress Firestore SDK connectivity/retry warning logs from polluting the console
try {
  setLogLevel('silent');
} catch (e) {
  console.warn("Could not set Firestore log level to silent:", e);
}

export const storage = getStorage(app);

// Validate Connection to Firestore as per SKILL.md
export async function testFirestoreConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log("Firestore connection verified successfully.");
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn("Please check your Firebase configuration or network status (client is offline).");
    } else {
      console.warn("Firestore validation note (expected if document 'test/connection' doesn't exist, but connection is online):", error);
    }
  }
}

// Perform dry run of the connection test on initialization
testFirestoreConnection();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errMsg = error instanceof Error ? error.message : String(error);
  const isOffline = errMsg.toLowerCase().includes('offline') || errMsg.toLowerCase().includes('failed to get document');

  const errInfo: FirestoreErrorInfo = {
    error: errMsg,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData?.map(provider => ({
        providerId: provider.providerId,
        email: provider.email,
      })) || []
    },
    operationType,
    path
  };

  if (isOffline) {
    console.warn('Firestore (Offline/Connection Warning): ', JSON.stringify(errInfo));
    // Do not throw when offline to allow local cache/offline workflows to function gracefully without crashing
    return;
  }

  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
