import type { NormalizedPage, PageType } from '../../shared/src/index.ts';

export function classifyPageType(page: NormalizedPage, html: string = ''): PageType {
  const url = page.url.toLowerCase();
  const title = page.title.toLowerCase();
  const content = page.content.toLowerCase();
  const combined = `${url} ${title} ${content.slice(0, 1000)}`;

  // 1. Release Notes & Changelog
  if (/\b(?:changelog|releases?|version-history)\b/i.test(url) || /\b(?:changelog|release notes)\b/i.test(title)) {
    return url.includes('release') ? 'release_notes' : 'changelog';
  }

  // 2. FAQ
  if (/\bfaq\b/i.test(url) || /\b(?:faq|frequently asked questions)\b/i.test(title)) {
    return 'faq';
  }

  // 3. Troubleshooting & Errors
  if (
    /\b(?:troubleshooting|error-codes|error-handling|debugging|errors)\b/i.test(url) ||
    /\b(?:troubleshooting|error codes|error handling|common errors)\b/i.test(title)
  ) {
    return 'troubleshooting';
  }

  // 4. Webhooks
  if (/\b(?:webhook|webhooks)\b/i.test(url) || /\bwebhooks?\b/i.test(title)) {
    return 'webhook';
  }

  // 5. Authentication & Rate Limiting
  if (
    /\b(?:auth|authentication|oauth|rate-limit|api-key|tokens?|security)\b/i.test(url) ||
    /\b(?:authentication|rate limiting|api keys?|oauth 2|authorization)\b/i.test(title)
  ) {
    return 'authentication';
  }

  // 6. Schemas & Models
  if (
    /\b(?:schemas?|models?|data-models?|types?)\b/i.test(url) ||
    /\b(?:object schema|data model|schema definition)\b/i.test(title)
  ) {
    return 'schema';
  }

  // 7. Individual API Endpoint vs General API Reference
  const hasEndpointBadge =
    /\b(?:GET|POST|PUT|DELETE|PATCH)\s+(?:\/v\d+[\w\/-]*|\/api[\w\/-]*)/i.test(page.content) ||
    /\b(?:request\s+body|response\s+body|status\s+code\s+200)\b/i.test(page.content);

  const endpointPathCount = (page.content.match(/\b(?:GET|POST|PUT|DELETE|PATCH)\s+\//gi) || []).length;

  if (endpointPathCount === 1 || (hasEndpointBadge && /\b(?:create|delete|update|get|list|cancel|parse)\b/i.test(title))) {
    return 'endpoint';
  }

  if (
    endpointPathCount > 1 ||
    /\b(?:api-reference|api-docs?|endpoints?|reference)\b/i.test(url) ||
    /\b(?:api reference|endpoints?)\b/i.test(title)
  ) {
    return 'api_reference';
  }

  // 8. Tutorials
  if (/\b(?:tutorials?|getting-started|walkthrough)\b/i.test(url) || /\b(?:tutorial|step-by-step|getting started)\b/i.test(title)) {
    return 'tutorial';
  }

  // 9. Guides
  if (/\b(?:guides?|how-to|recipes?)\b/i.test(url) || /\b(?:guide|how to)\b/i.test(title)) {
    return 'guide';
  }

  // 10. Concepts & Architecture
  if (/\b(?:concepts?|architecture|fundamentals|core-concepts)\b/i.test(url) || /\b(?:concepts?|architecture|overview)\b/i.test(title)) {
    return 'concept';
  }

  // 11. Overview / Introduction / Root
  if (
    /(?:\/docs\/?$|\/api\/docs\/?$|\/index(?:\.html)?$)/i.test(url) ||
    /\b(?:overview|introduction|welcome|quickstart)\b/i.test(title) ||
    page.depth === 0
  ) {
    return 'documentation_overview';
  }

  return 'other_documentation';
}
