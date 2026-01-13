import axios, { AxiosError, AxiosResponse } from 'axios';
import { UrlCache } from './cache';

/**
 * Result of validating a URL
 */
export interface ValidationResult {
  url: string;
  isValid: boolean;
  statusCode?: number;
  statusText?: string;
  error?: string;
}

/**
 * Status codes that definitely mean the resource is broken/missing
 */
const BROKEN_STATUS_CODES = [
  404, // Not Found
  410, // Gone
];

/**
 * Extract origin from URL for Referer header
 */
function getOrigin(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.origin;
  } catch {
    return '';
  }
}

/**
 * Check if response indicates a missing resource (CDN error response)
 * CloudFront returns 403 with XML body for missing files
 */
function isCdnErrorResponse(response: AxiosResponse): boolean {
  const contentType = response.headers['content-type'] || '';
  const data = response.data;
  
  // CloudFront/S3 returns XML error for missing files
  if (contentType.includes('xml') || contentType.includes('text/html')) {
    if (typeof data === 'string') {
      // Check for common CDN error patterns
      const lowerData = data.toLowerCase();
      if (
        lowerData.includes('accessdenied') ||
        lowerData.includes('nosuchkey') ||
        lowerData.includes('not found') ||
        lowerData.includes('does not exist') ||
        lowerData.includes('<error>') ||
        lowerData.includes('the specified key does not exist')
      ) {
        return true;
      }
    }
  }
  
  return false;
}

/**
 * Validates URLs by making HTTP requests
 */
export class LinkValidator {
  private cache: UrlCache;
  private readonly timeoutMs: number;
  private readonly maxConcurrent: number;
  private abortController: AbortController | null = null;

  constructor(
    cache: UrlCache,
    timeoutMs: number = 5000,
    maxConcurrent: number = 5
  ) {
    this.cache = cache;
    this.timeoutMs = timeoutMs;
    this.maxConcurrent = maxConcurrent;
  }

  /**
   * Cancel any pending validations
   */
  cancel(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Validate a single URL
   */
  private async validateUrl(url: string, signal: AbortSignal): Promise<ValidationResult> {
    // Check cache first
    const cached = this.cache.get(url);
    if (cached) {
      return {
        url,
        isValid: cached.isValid,
        statusCode: cached.statusCode,
        statusText: cached.statusText,
        error: cached.error,
      };
    }

    const origin = getOrigin(url);
    const browserHeaders = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': origin, // Add referer to bypass hotlink protection
    };

    try {
      // First try HEAD request (lightweight)
      let response = await axios.head(url, {
        timeout: this.timeoutMs,
        signal,
        validateStatus: () => true,
        maxRedirects: 5,
        headers: browserHeaders,
      });

      // If HEAD returns success, the link is valid
      if (response.status >= 200 && response.status < 400) {
        return this.cacheAndReturn(url, true, response.status, response.statusText);
      }

      // If HEAD returns 404/410, definitely broken
      if (BROKEN_STATUS_CODES.includes(response.status)) {
        return this.cacheAndReturn(url, false, response.status, response.statusText);
      }

      // For 403/405 or other errors, try GET request to check response body
      // This helps distinguish between "forbidden but exists" vs "doesn't exist"
      if (response.status === 403 || response.status === 405) {
        response = await axios.get(url, {
          timeout: this.timeoutMs,
          signal,
          validateStatus: () => true,
          maxRedirects: 5,
          headers: {
            ...browserHeaders,
            'Range': 'bytes=0-1023', // Only fetch first 1KB to check response
          },
          // Get response as text to check for error messages
          responseType: 'text',
          // Limit response size
          maxContentLength: 10240,
        });

        // If GET succeeds, link is valid
        if (response.status >= 200 && response.status < 400) {
          return this.cacheAndReturn(url, true, response.status, response.statusText);
        }

        // If still 403, check if it's a CDN error (missing file) or just forbidden
        if (response.status === 403) {
          const isMissing = isCdnErrorResponse(response);
          if (isMissing) {
            return this.cacheAndReturn(url, false, response.status, 'Not Found (CDN)');
          }
          // 403 but not a CDN error - probably hotlink protection, treat as valid
          return this.cacheAndReturn(url, true, response.status, 'Protected');
        }
      }

      // For other status codes, use general rules
      const isValid = response.status >= 200 && response.status < 400;
      return this.cacheAndReturn(url, isValid, response.status, response.statusText);

    } catch (error) {
      return this.handleError(url, error);
    }
  }

  /**
   * Cache result and return ValidationResult
   */
  private cacheAndReturn(
    url: string,
    isValid: boolean,
    statusCode: number,
    statusText: string
  ): ValidationResult {
    this.cache.set(url, { isValid, statusCode, statusText });
    return { url, isValid, statusCode, statusText };
  }

  /**
   * Handle request errors
   */
  private handleError(url: string, error: unknown): ValidationResult {
    let errorMessage = 'Unknown error';

    if (axios.isCancel(error)) {
      return { url, isValid: true, error: 'Request cancelled' };
    }

    if (error instanceof AxiosError) {
      if (error.code === 'ECONNABORTED') {
        errorMessage = 'Request timeout';
      } else if (error.code === 'ENOTFOUND') {
        errorMessage = 'Domain not found';
      } else if (error.code === 'ECONNREFUSED') {
        errorMessage = 'Connection refused';
      } else if (error.code === 'ERR_CANCELED') {
        return { url, isValid: true, error: 'Request cancelled' };
      } else {
        errorMessage = error.message || 'Network error';
      }
    }

    this.cache.set(url, { isValid: false, error: errorMessage });
    return { url, isValid: false, error: errorMessage };
  }

  /**
   * Validate multiple URLs with concurrency limit
   */
  async validateUrls(urls: string[]): Promise<ValidationResult[]> {
    if (urls.length === 0) {
      return [];
    }

    // Cancel any previous validation
    this.cancel();

    // Create new abort controller
    this.abortController = new AbortController();
    const signal = this.abortController.signal;

    const results: ValidationResult[] = [];
    const uniqueUrls = [...new Set(urls)]; // Remove duplicates

    // Process in batches to limit concurrency
    for (let i = 0; i < uniqueUrls.length; i += this.maxConcurrent) {
      if (signal.aborted) {
        break;
      }

      const batch = uniqueUrls.slice(i, i + this.maxConcurrent);
      const batchResults = await Promise.all(
        batch.map(url => this.validateUrl(url, signal))
      );
      results.push(...batchResults);
    }

    return results;
  }
}
