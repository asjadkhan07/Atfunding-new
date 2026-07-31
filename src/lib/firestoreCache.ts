import { collection, getDocs, doc, getDoc, Query, DocumentData } from 'firebase/firestore';
import { db } from '../firebase';
import { firebaseTelemetry } from '../firebaseTelemetry';

interface CacheItem<T> {
  data: T;
  timestamp: number;
}

const memoryCache = new Map<string, CacheItem<any>>();
const inFlightRequests = new Map<string, Promise<any>>();
const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes default cache TTL

/**
 * Get documents from Firestore with smart local storage, memory caching, and in-flight request deduplication.
 * Prevents repetitive read quota consumption for static or semi-static collections.
 */
export async function getDocsCached<T = DocumentData>(
  cacheKey: string,
  fetcher: () => Promise<T[]>,
  ttlMs: number = DEFAULT_TTL_MS,
  forceRefresh: boolean = false,
  sourceComponent: string = 'Unknown'
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

  // 3. Prevent Duplicate In-Flight Requests
  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey)!;
  }

  // 4. Cache missed or expired - fetch from Firestore
  const fetchPromise = (async () => {
    try {
      const data = await fetcher();
      firebaseTelemetry.recordUsage(cacheKey.split('_')[0] || 'general', data.length || 1, 0, sourceComponent);
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
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  })();

  inFlightRequests.set(cacheKey, fetchPromise);
  return fetchPromise;
}

/**
 * Get single document cached for user profile or settings
 */
export async function getDocCached<T = DocumentData>(
  cacheKey: string,
  fetcher: () => Promise<T | null>,
  ttlMs: number = DEFAULT_TTL_MS,
  forceRefresh: boolean = false,
  sourceComponent: string = 'Unknown'
): Promise<T | null> {
  const now = Date.now();

  if (!forceRefresh) {
    if (memoryCache.has(cacheKey)) {
      const item = memoryCache.get(cacheKey)!;
      if (now - item.timestamp < ttlMs) {
        return item.data;
      }
    }

    try {
      const stored = localStorage.getItem(`fs_doc_cache_${cacheKey}`);
      if (stored) {
        const parsed: CacheItem<T | null> = JSON.parse(stored);
        if (now - parsed.timestamp < ttlMs) {
          memoryCache.set(cacheKey, parsed);
          return parsed.data;
        }
      }
    } catch (e) {}
  }

  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey)!;
  }

  const fetchPromise = (async () => {
    try {
      const data = await fetcher();
      firebaseTelemetry.recordUsage(cacheKey.split('_')[0] || 'users', 1, 0, sourceComponent);
      const cacheItem: CacheItem<T | null> = { data, timestamp: now };
      memoryCache.set(cacheKey, cacheItem);
      try {
        localStorage.setItem(`fs_doc_cache_${cacheKey}`, JSON.stringify(cacheItem));
      } catch (e) {}
      return data;
    } catch (error) {
      if (memoryCache.has(cacheKey)) {
        return memoryCache.get(cacheKey)!.data;
      }
      throw error;
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  })();

  inFlightRequests.set(cacheKey, fetchPromise);
  return fetchPromise;
}

/**
 * Invalidate a specific cache key
 */
export function invalidateCache(cacheKey: string) {
  memoryCache.delete(cacheKey);
  inFlightRequests.delete(cacheKey);
  try {
    localStorage.removeItem(`fs_cache_${cacheKey}`);
    localStorage.removeItem(`fs_doc_cache_${cacheKey}`);
  } catch (e) {}
}

/**
 * Clear all firestore cache entries
 */
export function clearAllFirestoreCache() {
  memoryCache.clear();
  inFlightRequests.clear();
  try {
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('fs_cache_') || key.startsWith('fs_doc_cache_')) {
        localStorage.removeItem(key);
      }
    });
  } catch (e) {}
}

