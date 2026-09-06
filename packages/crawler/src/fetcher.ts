import {
  FetchTimeoutError,
  PayloadTooLargeError,
  DocRouterError,
} from '../../shared/src/index.ts';
import { validateTargetUrl } from '../../security/src/index.ts';
import type { SsrfValidationOptions } from '../../security/src/index.ts';
import { DEFAULT_CRAWLER_CONFIG } from './config.ts';

export interface FetchResult {
  url: string;
  finalUrl: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  contentType: string;
  bytesRead: number;
}

export interface FetchOptions extends SsrfValidationOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  userAgent?: string;
  headers?: Record<string, string>;
  method?: string;
  fetchFn?: typeof fetch;
  allowCrossDomainRedirects?: boolean;
}

export class SecureFetcher {
  private timeoutMs: number;
  private maxBytes: number;
  private maxRedirects: number;
  private userAgent: string;
  private allowLocalhostForTesting: boolean;
  private fetchFn: typeof fetch;

  constructor(defaults: Partial<FetchOptions> = {}) {
    this.timeoutMs = defaults.timeoutMs ?? DEFAULT_CRAWLER_CONFIG.timeoutMs;
    this.maxBytes = defaults.maxBytes ?? DEFAULT_CRAWLER_CONFIG.maxBytesPerResponse;
    this.maxRedirects = defaults.maxRedirects ?? DEFAULT_CRAWLER_CONFIG.maxRedirects;
    this.userAgent = defaults.userAgent ?? DEFAULT_CRAWLER_CONFIG.userAgent;
    this.allowLocalhostForTesting = defaults.allowLocalhostForTesting ?? false;
    this.fetchFn = defaults.fetchFn ?? globalThis.fetch;
  }

  async fetch(urlStr: string, options: FetchOptions = {}): Promise<FetchResult> {
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const maxBytes = options.maxBytes ?? this.maxBytes;
    const maxRedirects = options.maxRedirects ?? this.maxRedirects;
    const userAgent = options.userAgent ?? this.userAgent;
    const method = options.method ?? 'GET';
    const allowLocalhost = options.allowLocalhostForTesting ?? this.allowLocalhostForTesting;
    const activeFetch = options.fetchFn ?? this.fetchFn;

    let currentUrl = urlStr;
    let redirectCount = 0;
    const seenRedirects = new Set<string>();
    seenRedirects.add(currentUrl);

    while (redirectCount <= maxRedirects) {
      // 1. SSRF & Protocol validation before making the hop
      await validateTargetUrl(currentUrl, {
        allowLocalhostForTesting: allowLocalhost,
      });

      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort(new FetchTimeoutError(`Request timed out after ${timeoutMs}ms`, timeoutMs));
      }, timeoutMs);

      try {
        const reqHeaders: Record<string, string> = {
          'User-Agent': userAgent,
          Accept: 'text/html,application/xhtml+xml,text/plain,text/markdown,application/json,*/*',
          ...options.headers,
        };

        const res = await activeFetch(currentUrl, {
          method,
          headers: reqHeaders,
          redirect: 'manual',
          signal: controller.signal,
        });

        // 2. Handle HTTP redirects (301, 302, 303, 307, 308)
        if ([301, 302, 303, 307, 308].includes(res.status)) {
          const location = res.headers.get('location');
          if (!location) {
            throw new DocRouterError(`Redirect response (${res.status}) missing Location header.`);
          }

          redirectCount++;
          if (redirectCount > maxRedirects) {
            throw new DocRouterError(`Exceeded maximum allowed redirects (${maxRedirects}).`);
          }

          const nextUrl = new URL(location, currentUrl).href;

          // Check for redirect loop
          if (seenRedirects.has(nextUrl)) {
            throw new DocRouterError(`Redirect loop detected: "${nextUrl}" already visited in redirect chain.`);
          }
          seenRedirects.add(nextUrl);

          // Enforce domain/origin policy
          if (options.allowCrossDomainRedirects === false) {
            const origOrigin = new URL(urlStr).origin;
            const nextOrigin = new URL(nextUrl).origin;
            if (origOrigin !== nextOrigin) {
              throw new DocRouterError(`Cross-origin redirect from "${origOrigin}" to "${nextOrigin}" prohibited by policy.`);
            }
          }

          currentUrl = nextUrl;
          continue;
        }

        // 3. Extract response headers
        const headers: Record<string, string> = {};
        res.headers.forEach((val, key) => {
          headers[key.toLowerCase()] = val;
        });

        const contentType = headers['content-type'] || 'application/octet-stream';

        // 4. Stream response body with byte counting
        let bytesRead = 0;
        const chunks: Uint8Array[] = [];

        if (res.body) {
          const reader = res.body.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value) {
                bytesRead += value.length;
                if (bytesRead > maxBytes) {
                  controller.abort();
                  throw new PayloadTooLargeError(
                    `Response exceeded maximum allowed size of ${maxBytes} bytes (read ${bytesRead} bytes).`,
                    bytesRead,
                    maxBytes
                  );
                }
                chunks.push(value);
              }
            }
          } finally {
            reader.releaseLock();
          }
        }

        const totalBuffer = Buffer.concat(chunks);
        const bodyText = totalBuffer.toString('utf-8');

        return {
          url: urlStr,
          finalUrl: currentUrl,
          status: res.status,
          statusText: res.statusText,
          headers,
          body: bodyText,
          contentType,
          bytesRead,
        };
      } catch (err: unknown) {
        if (err instanceof DocRouterError) throw err;
        if (controller.signal.aborted) {
          const reason = controller.signal.reason;
          if (reason instanceof DocRouterError) throw reason;
          throw new FetchTimeoutError(`Request timed out after ${timeoutMs}ms`, timeoutMs);
        }
        throw new DocRouterError(`Fetch failure for "${currentUrl}": ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        clearTimeout(timeoutId);
      }
    }

    throw new DocRouterError(`Exceeded maximum allowed redirects (${maxRedirects}).`);
  }
}
