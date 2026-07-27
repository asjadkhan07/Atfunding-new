import { collection, getDocs, doc, getDoc, Query, DocumentData } from 'firebase/firestore';
import { db } from '../firebase';

interface CacheItem<T> {
  data: T;
  timestamp: number;
}

const memoryCache = new Map<string, CacheItem<any>>();
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes cache TTL

/**
 * Get documents from Firestore with smart local storage and memory caching.
 * Prevents repetitive read quota consumption for static or semi-static collections.
 */
export async function getDocsCached<T = DocumentData>(
  cacheKey: string,
  fetcher: () => Promise<T[]>,
  ttlMs: number = DEFAULT_TTL_MS,
  forceRefresh: boolean = false
): Promise<T[]> {
  const now = Date.now();

  if (!forceRefresh) {
    // 1. Check in-memory cache
    if (memoryCache.has(cacheKey)) {
      const item = memoryCache.get(cacheKey)!;
      if (now - item.timestamp < ttlMs) {
        return item.data;
      }
    }

    // 2. Check LocalStorage cache
    try {
      const stored = localStorage.getItem(`fs_cache_${cacheKey}`);
      if (stored) {
        const parsed: CacheItem<T[]> = JSON.parse(stored);
        if (now - parsed.timestamp < ttlMs) {
          memoryCache.set(cacheKey, parsed);
          return parsed.data;
        }
      }
    } catch (e) {
      // Ignore localStorage errors
    }
  }

  // 3. Cache missed or expired - fetch from Firestore
  try {
    const data = await fetcher();
    const cacheItem: CacheItem<T[]> = { data, timestamp: now };
    
    memoryCache.set(cacheKey, cacheItem);
    try {
      localStorage.setItem(`fs_cache_${cacheKey}`, JSON.stringify(cacheItem));
    } catch (e) {
      // Ignore quota error for localStorage if full
    }

    return data;
  } catch (error) {
    // If offline or quota error, try serving stale cache if available
    if (memoryCache.has(cacheKey)) {
      console.warn(`Serving stale memory cache for ${cacheKey} due to network/quota error:`, error);
      return memoryCache.get(cacheKey)!.data;
    }
    try {
      const stored = localStorage.getItem(`fs_cache_${cacheKey}`);
      if (stored) {
        console.warn(`Serving stale localStorage cache for ${cacheKey} due to error:`, error);
        return JSON.parse(stored).data;
      }
    } catch (e) {}

    throw error;
  }
}

/**
 * Invalidate a specific cache key
 */
export function invalidateCache(cacheKey: string) {
  memoryCache.delete(cacheKey);
  try {
    localStorage.removeItem(`fs_cache_${cacheKey}`);
  } catch (e) {}
}

/**
 * Clear all firestore cache entries
 */
export function clearAllFirestoreCache() {
  memoryCache.clear();
  try {
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('fs_cache_')) {
        localStorage.removeItem(key);
      }
    });
  } catch (e) {}
}
