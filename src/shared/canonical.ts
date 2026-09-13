/**
 * Canonicalizes a documentation source URL to ensure deterministic, idempotent source identity.
 *
 * Rules applied:
 * 1. Protocol and host are normalized to lowercase.
 * 2. Hash fragments (#...) are stripped.
 * 3. Marketing and tracking query parameters (utm_*, ref, gclid, etc.) are stripped.
 * 4. Remaining query parameters are sorted alphabetically for determinism.
 * 5. Consecutive path slashes are collapsed (e.g. //docs//api -> /docs/api).
 * 6. Trailing slashes are stripped on subpaths (e.g. /docs/ -> /docs, but / is preserved).
 */
export function canonicalizeSourceUrl(rawUrl: string): string {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const trimmed = rawUrl.trim();
  if (!trimmed) return '';

  try {
    const parsed = new URL(trimmed);

    // Only apply HTTP/HTTPS canonicalization; pass other schemes (e.g. local://) through cleanly
    if (!['http:', 'https:'].includes(parsed.protocol.toLowerCase())) {
      return trimmed;
    }

    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.host = parsed.host.toLowerCase();

    // Strip hash fragment
    parsed.hash = '';

    // Strip tracking parameters
    const TRACKING_PARAMS = new Set([
      'utm_source',
      'utm_medium',
      'utm_campaign',
      'utm_term',
      'utm_content',
      'utm_id',
      'ref',
      'source',
      'fbclid',
      'gclid',
      'msclkid',
      'mc_cid',
      'mc_eid',
      '_ga',
      '_gl',
    ]);

    const paramsToDelete: string[] = [];
    parsed.searchParams.forEach((_, key) => {
      if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith('utm_')) {
        paramsToDelete.push(key);
      }
    });
    for (const key of paramsToDelete) {
      parsed.searchParams.delete(key);
    }

    // Sort remaining search parameters deterministically
    parsed.searchParams.sort();

    // Collapse multiple consecutive slashes in pathname, preserving single leading slash
    let pathname = parsed.pathname.replace(/\/+/g, '/');

    // Strip trailing slash unless root '/'
    if (pathname.length > 1 && pathname.endsWith('/')) {
      pathname = pathname.slice(0, -1);
    }
    parsed.pathname = pathname;

    return parsed.href;
  } catch {
    return trimmed;
  }
}
