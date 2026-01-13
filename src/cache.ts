/**
 * In-memory cache for URL validation results with TTL support
 */

interface CacheEntry {
  isValid: boolean;
  statusCode?: number;
  statusText?: string;
  error?: string;
  timestamp: number;
}

export class UrlCache {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly ttlMs: number;

  constructor(ttlMinutes: number = 5) {
    this.ttlMs = ttlMinutes * 60 * 1000;
  }

  /**
   * Get cached result for a URL if it exists and hasn't expired
   */
  get(url: string): CacheEntry | undefined {
    const entry = this.cache.get(url);
    if (!entry) {
      return undefined;
    }

    // Check if entry has expired
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(url);
      return undefined;
    }

    return entry;
  }

  /**
   * Store a validation result in the cache
   */
  set(url: string, result: Omit<CacheEntry, 'timestamp'>): void {
    this.cache.set(url, {
      ...result,
      timestamp: Date.now(),
    });
  }

  /**
   * Check if a URL is in the cache and not expired
   */
  has(url: string): boolean {
    return this.get(url) !== undefined;
  }

  /**
   * Clear all cached entries
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Remove expired entries from the cache
   */
  cleanup(): void {
    const now = Date.now();
    for (const [url, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttlMs) {
        this.cache.delete(url);
      }
    }
  }

  /**
   * Get the number of cached entries
   */
  get size(): number {
    return this.cache.size;
  }
}
