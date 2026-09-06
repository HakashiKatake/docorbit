import type { CrawlerConfig } from '../../shared/src/index.ts';

export const DEFAULT_CRAWLER_CONFIG: CrawlerConfig = {
  maxPages: 50,
  maxDepth: 3,
  maxBytesPerResponse: 10 * 1024 * 1024, // 10MB
  timeoutMs: 10000,                      // 10 seconds
  maxRedirects: 5,
  concurrency: 5,
  allowedProtocols: ['http:', 'https:'],
  userAgent: 'DocRouter/1.0 (+https://github.com/docrouter/docrouter)',
};
