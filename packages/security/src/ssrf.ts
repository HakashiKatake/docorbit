import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { SsrfError } from '../../shared/src/index.ts';

/**
 * Checks whether an IPv4 or IPv6 address is in a private, link-local, loopback,
 * or cloud provider metadata range.
 */
export function isPrivateOrBlockedIp(ip: string): boolean {
  // IPv4 check
  if (isIP(ip) === 4) {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(isNaN)) return true;

    const [b0, b1, b2, b3] = parts;

    // 0.0.0.0/8 (Current network)
    if (b0 === 0) return true;

    // 127.0.0.0/8 (Loopback)
    if (b0 === 127) return true;

    // 10.0.0.0/8 (RFC 1918 Private)
    if (b0 === 10) return true;

    // 172.16.0.0/12 (RFC 1918 Private: 172.16.0.0 - 172.31.255.255)
    if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;

    // 192.168.0.0/16 (RFC 1918 Private)
    if (b0 === 192 && b1 === 168) return true;

    // 169.254.0.0/16 (Link-local & AWS/GCP/Azure instance metadata 169.254.169.254)
    if (b0 === 169 && b1 === 254) return true;

    // 100.64.0.0/10 (Carrier-grade NAT)
    if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;

    // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 (TEST-NET-1, 2, 3)
    if (b0 === 192 && b1 === 0 && b2 === 2) return true;
    if (b0 === 198 && b1 === 51 && b2 === 100) return true;
    if (b0 === 203 && b1 === 0 && b2 === 113) return true;

    // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
    if (b0 >= 224) return true;

    return false;
  }

  // IPv6 check
  if (isIP(ip) === 6) {
    const normalized = ip.toLowerCase();

    // ::1 (Loopback)
    if (normalized === '::1' || normalized === '0:0:0:0:0:0:0:1') return true;

    // :: (Unspecified)
    if (normalized === '::' || normalized === '0:0:0:0:0:0:0:0') return true;

    // fc00::/7 (Unique local addresses / private)
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;

    // fe80::/10 (Link-local unicast)
    if (normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')) {
      return true;
    }

    // IPv4-mapped IPv6 addresses (::ffff:x.x.x.x)
    if (normalized.startsWith('::ffff:')) {
      const ipv4Part = normalized.slice(7);
      return isPrivateOrBlockedIp(ipv4Part);
    }

    return false;
  }

  return true; // Not a recognized IP, block by default
}

export interface SsrfValidationOptions {
  allowLocalhostForTesting?: boolean;
}

/**
 * Validates a target URL against SSRF threats:
 * - Ensures valid HTTP/HTTPS protocol
 * - Validates hostname does not resolve to private or loopback IP
 */
export async function validateTargetUrl(
  urlStr: string,
  options: SsrfValidationOptions = {}
): Promise<{ url: URL; resolvedIp: string }> {
  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    throw new SsrfError(`Malformed target URL: "${urlStr}"`);
  }

  // Protocol check
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfError(`Disallowed protocol "${url.protocol}". Only http: and https: are allowed.`);
  }

  const hostname = url.hostname.toLowerCase();
  const cleanHost = (hostname.startsWith('[') && hostname.endsWith(']'))
    ? hostname.slice(1, -1)
    : hostname;

  // Handle explicit localhost / loopback strings
  if (cleanHost === 'localhost' || cleanHost === '127.0.0.1' || cleanHost === '::1') {
    if (options.allowLocalhostForTesting) {
      return { url, resolvedIp: cleanHost === 'localhost' ? '127.0.0.1' : cleanHost };
    }
    throw new SsrfError(`Access to localhost is prohibited for security.`, '127.0.0.1', cleanHost);
  }

  // If the hostname itself is a literal IP address (IPv4 or IPv6)
  if (isIP(cleanHost)) {
    if (isPrivateOrBlockedIp(cleanHost)) {
      if (options.allowLocalhostForTesting && (cleanHost === '127.0.0.1' || cleanHost === '::1')) {
        return { url, resolvedIp: cleanHost };
      }
      throw new SsrfError(`Access to private/blocked IP address "${cleanHost}" is prohibited.`, cleanHost, cleanHost);
    }
    return { url, resolvedIp: cleanHost };
  }

  // Resolve hostname via DNS
  try {
    const res = await lookup(cleanHost, { all: true });
    if (!res || res.length === 0) {
      throw new SsrfError(`Hostname "${cleanHost}" could not be resolved via DNS.`);
    }

    for (const record of res) {
      if (isPrivateOrBlockedIp(record.address)) {
        if (options.allowLocalhostForTesting && (record.address === '127.0.0.1' || record.address === '::1')) {
          continue;
        }
        throw new SsrfError(
          `Hostname "${cleanHost}" resolved to blocked/private IP address "${record.address}".`,
          record.address,
          cleanHost
        );
      }
    }

    return { url, resolvedIp: res[0].address };
  } catch (err: unknown) {
    if (err instanceof SsrfError) throw err;
    throw new SsrfError(`DNS resolution failure for host "${cleanHost}": ${err instanceof Error ? err.message : String(err)}`);
  }
}
