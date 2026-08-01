/**
 * Safe Web3 & MetaMask integration manager.
 * Provides error-resistant MetaMask connection, account detection, and global exception handling
 * to prevent unhandled promise rejections from MetaMask extensions.
 */

export interface MetaMaskConnectResult {
  success: boolean;
  account?: string;
  error?: string;
  networkId?: string;
}

/**
 * Checks if MetaMask or a Web3 provider is available in window.ethereum
 */
export function isMetaMaskInstalled(): boolean {
  if (typeof window === 'undefined') return false;
  const ethereum = (window as any).ethereum;
  return Boolean(ethereum && (ethereum.isMetaMask || ethereum.providers));
}

/**
 * Connects to MetaMask safely without unhandled rejections
 */
export async function connectMetaMask(): Promise<MetaMaskConnectResult> {
  if (typeof window === 'undefined') {
    return { success: false, error: 'Window environment unavailable' };
  }

  const ethereum = (window as any).ethereum;

  if (!ethereum) {
    return {
      success: false,
      error: 'MetaMask extension not detected. Please install MetaMask browser extension or open in a Web3-enabled browser.'
    };
  }

  try {
    // If multiple providers exist (e.g. Coinbase Wallet + MetaMask)
    let provider = ethereum;
    if (ethereum.providers && Array.isArray(ethereum.providers)) {
      provider = ethereum.providers.find((p: any) => p.isMetaMask) || ethereum.providers[0];
    }

    const accounts = await provider.request({ 
      method: 'eth_requestAccounts' 
    }) as string[];

    if (!accounts || accounts.length === 0) {
      return {
        success: false,
        error: 'No accounts returned from MetaMask. Please unlock your wallet and try again.'
      };
    }

    const primaryAccount = accounts[0];

    // Optionally get chain ID
    let chainId = '';
    try {
      chainId = await provider.request({ method: 'eth_chainId' }) as string;
    } catch {
      // Non-critical, ignore
    }

    return {
      success: true,
      account: primaryAccount,
      networkId: chainId
    };
  } catch (err: any) {
    console.warn("MetaMask connection request returned error/cancelled:", err);
    
    let userMsg = 'Failed to connect to MetaMask.';
    if (err?.code === 4001 || err?.message?.includes('rejected') || err?.message?.includes('User rejected')) {
      userMsg = 'MetaMask connection request was cancelled by user.';
    } else if (err?.code === -32002) {
      userMsg = 'MetaMask connection request is already pending. Please check your MetaMask popup extension window.';
    } else if (err?.message) {
      userMsg = err.message;
    }

    return {
      success: false,
      error: userMsg
    };
  }
}

/**
 * Gets currently connected account if MetaMask is unlocked
 */
export async function getConnectedMetaMaskAccount(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  const ethereum = (window as any).ethereum;
  if (!ethereum) return null;

  try {
    const accounts = await ethereum.request({ method: 'eth_accounts' }) as string[];
    if (accounts && accounts.length > 0) {
      return accounts[0];
    }
  } catch (err) {
    console.warn("Error checking connected MetaMask accounts:", err);
  }
  return null;
}

/**
 * Registers global unhandledrejection handlers to catch background MetaMask extension errors
 * gracefully so browser extension rejections won't crash or display error overlays.
 */
export function setupMetaMaskErrorGuard(): () => void {
  if (typeof window === 'undefined') return () => {};

  const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    const reasonStr = String(event.reason?.message || event.reason || '').toLowerCase();
    if (
      reasonStr.includes('metamask') || 
      reasonStr.includes('failed to connect to metamask') ||
      reasonStr.includes('user rejected') ||
      reasonStr.includes('eth_') ||
      reasonStr.includes('web3')
    ) {
      // Prevent browser default error banner/overlay
      event.preventDefault();
      console.info("Suppressed background MetaMask rejection:", event.reason);
    }
  };

  window.addEventListener('unhandledrejection', handleUnhandledRejection);

  return () => {
    window.removeEventListener('unhandledrejection', handleUnhandledRejection);
  };
}
