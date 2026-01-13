import * as https from 'https';
import * as http from 'http';
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
 * Response from HTTP request
 */
interface HttpResponse {
  statusCode: number;
  statusText: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/**
 * Status codes that definitely mean the resource is broken/missing
 */
const BROKEN_STATUS_CODES = [404, 410];

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
function isCdnErrorResponse(response: HttpResponse): boolean {
  const contentType = response.headers['content-type'] || '';
  const data = response.body;

  if (contentType.includes('xml') || contentType.includes('text/html')) {
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

  return false;
}

/**
 * Make HTTP/HTTPS request using Node.js built-in modules
 */
function makeRequest(
  url: string,
  method: 'HEAD' | 'GET',
  headers: Record<string, string>,
  timeoutMs: number,
  signal: AbortSignal
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('Request cancelled'));
      return;
    }

    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const lib = isHttps ? https : http;

    const options: https.RequestOptions = {
      method,
      hostname: parsed.hostname,
      port: parsed.port || (isHttps ? 443 : 80),
      path: parsed.pathname + parsed.search,
      headers,
      timeout: timeoutMs,
    };

    const req = lib.request(options, (res) => {
      // Handle redirects (up to 5)
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectCount = (options as { _redirectCount?: number })._redirectCount || 0;
        if (redirectCount < 5) {
          const newUrl = new URL(res.headers.location, url).href;
          (options as { _redirectCount?: number })._redirectCount = redirectCount + 1;
          makeRequest(newUrl, method, headers, timeoutMs, signal)
            .then(resolve)
            .catch(reject);
          return;
        }
      }

      let body = '';
      
      // For HEAD requests or if we only need status, don't wait for body
      if (method === 'HEAD') {
        resolve({
          statusCode: res.statusCode || 0,
          statusText: res.statusMessage || '',
          headers: res.headers,
          body: '',
        });
        return;
      }

      // Limit body size to 10KB
      let bytesReceived = 0;
      const maxBytes = 10240;

      res.on('data', (chunk: Buffer) => {
        bytesReceived += chunk.length;
        if (bytesReceived <= maxBytes) {
          body += chunk.toString();
        }
      });

      res.on('end', () => {
        resolve({
          statusCode: res.statusCode || 0,
          statusText: res.statusMessage || '',
          headers: res.headers,
          body,
        });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.on('error', (err) => {
      reject(err);
    });

    // Handle abort signal
    const abortHandler = () => {
      req.destroy();
      reject(new Error('Request cancelled'));
    };
    signal.addEventListener('abort', abortHandler, { once: true });

    req.end();
  });
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
    const browserHeaders: Record<string, string> = {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': origin,
    };

    try {
      // First try HEAD request (lightweight)
      let response = await makeRequest(url, 'HEAD', browserHeaders, this.timeoutMs, signal);

      // If HEAD returns success, the link is valid
      if (response.statusCode >= 200 && response.statusCode < 400) {
        return this.cacheAndReturn(url, true, response.statusCode, response.statusText);
      }

      // If HEAD returns 404/410, definitely broken
      if (BROKEN_STATUS_CODES.includes(response.statusCode)) {
        return this.cacheAndReturn(url, false, response.statusCode, response.statusText);
      }

      // For 403/405 or other errors, try GET request to check response body
      if (response.statusCode === 403 || response.statusCode === 405) {
        response = await makeRequest(
          url,
          'GET',
          { ...browserHeaders, 'Range': 'bytes=0-1023' },
          this.timeoutMs,
          signal
        );

        // If GET succeeds, link is valid
        if (response.statusCode >= 200 && response.statusCode < 400) {
          return this.cacheAndReturn(url, true, response.statusCode, response.statusText);
        }

        // If still 403, check if it's a CDN error (missing file) or just forbidden
        if (response.statusCode === 403) {
          const isMissing = isCdnErrorResponse(response);
          if (isMissing) {
            return this.cacheAndReturn(url, false, response.statusCode, 'Not Found (CDN)');
          }
          // 403 but not a CDN error - probably hotlink protection, treat as valid
          return this.cacheAndReturn(url, true, response.statusCode, 'Protected');
        }
      }

      // For other status codes, use general rules
      const isValid = response.statusCode >= 200 && response.statusCode < 400;
      return this.cacheAndReturn(url, isValid, response.statusCode, response.statusText);

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

    if (error instanceof Error) {
      if (error.message === 'Request cancelled') {
        return { url, isValid: true, error: 'Request cancelled' };
      }
      if (error.message === 'Request timeout') {
        errorMessage = 'Request timeout';
      } else if (error.message.includes('ENOTFOUND')) {
        errorMessage = 'Domain not found';
      } else if (error.message.includes('ECONNREFUSED')) {
        errorMessage = 'Connection refused';
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
