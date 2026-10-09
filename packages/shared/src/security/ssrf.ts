import * as dns from 'dns/promises';
import * as net from 'net';

export interface SsrfValidationResult {
  isValid: boolean;
  sanitizedUrl?: string;
  sanitizedHostname?: string;
  errorCode?: string;
  errorMessage?: string;
  resolvedIp?: string;
}

/**
 * Checks if an IPv4 address is in private, loopback, link-local, or cloud metadata ranges.
 */
export function isPrivateOrReservedIPv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return true; // Malformed is rejected
  }

  const [b0, b1] = parts;

  // 0.0.0.0/8 (Current network)
  if (b0 === 0) return true;

  // 10.0.0.0/8 (Private)
  if (b0 === 10) return true;

  // 127.0.0.0/8 (Loopback)
  if (b0 === 127) return true;

  // 169.254.0.0/16 (Link-local & AWS/GCP/Azure Cloud Metadata 169.254.169.254)
  if (b0 === 169 && b1 === 254) return true;

  // 172.16.0.0/12 (Private: 172.16.0.0 - 172.31.255.255)
  if (b0 === 172 && b1 >= 16 && b1 <= 31) return true;

  // 192.168.0.0/16 (Private)
  if (b0 === 192 && b1 === 168) return true;

  // 100.64.0.0/10 (Carrier-grade NAT)
  if (b0 === 100 && b1 >= 64 && b1 <= 127) return true;

  // 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24 (Documentation/Test-Net)
  if (b0 === 192 && b1 === 0 && parts[2] === 2) return true;
  if (b0 === 198 && b1 === 51 && parts[2] === 100) return true;
  if (b0 === 203 && b1 === 0 && parts[2] === 113) return true;

  // 224.0.0.0/4 (Multicast) & 240.0.0.0/4 (Reserved)
  if (b0 >= 224) return true;

  return false;
}

/**
 * Checks if an IPv6 address is loopback, unique local, link-local, or IPv4-mapped private.
 */
export function isPrivateOrReservedIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();

  // ::1 loopback or :: unspecified
  if (normalized === '::1' || normalized === '::') return true;

  // Unique local fc00::/7 (starts with fc or fd)
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;

  // Link-local fe80::/10 (starts with fe8, fe9, fea, feb)
  if (/^fe[89ab]/i.test(normalized)) return true;

  // IPv4-mapped IPv6: ::ffff:192.168.1.1
  const ipv4Mapped = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (ipv4Mapped && ipv4Mapped[1]) {
    return isPrivateOrReservedIPv4(ipv4Mapped[1]);
  }

  return false;
}

/**
 * Validates a remote URL against SSRF vulnerabilities:
 * - Scheme must be http or https
 * - Hostname cannot be localhost, metadata.google.internal, etc.
 * - Resolves DNS and asserts that no returned IP is in private/internal networks
 */
export async function validateUrlSsrf(inputUrl: string): Promise<SsrfValidationResult> {
  let parsed: URL;
  try {
    parsed = new URL(inputUrl);
  } catch {
    return {
      isValid: false,
      errorCode: 'INVALID_URL',
      errorMessage: 'The provided URL could not be parsed.',
    };
  }

  // Enforce http or https protocol
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      isValid: false,
      errorCode: 'DISALLOWED_PROTOCOL',
      errorMessage: `Protocol '${parsed.protocol}' is not allowed. Only HTTP and HTTPS are supported.`,
    };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block obvious internal names
  const blockedHosts = [
    'localhost',
    'metadata.google.internal',
    'instance-data',
    'internal',
    'local',
    'router',
    '0.0.0.0',
    '127.0.0.1',
    '[::1]',
  ];

  if (blockedHosts.includes(hostname) || hostname.endsWith('.internal') || hostname.endsWith('.local')) {
    return {
      isValid: false,
      errorCode: 'BLOCKED_HOST',
      errorMessage: `Access to internal host '${hostname}' is prohibited.`,
    };
  }

  // If hostname is directly an IP address
  if (net.isIPv4(hostname)) {
    if (isPrivateOrReservedIPv4(hostname)) {
      return {
        isValid: false,
        errorCode: 'PRIVATE_IP',
        errorMessage: 'Direct access to private or loopback IPv4 addresses is prohibited.',
      };
    }
    return {
      isValid: true,
      sanitizedUrl: parsed.toString(),
      sanitizedHostname: hostname,
      resolvedIp: hostname,
    };
  }

  if (net.isIPv6(hostname)) {
    if (isPrivateOrReservedIPv6(hostname)) {
      return {
        isValid: false,
        errorCode: 'PRIVATE_IP',
        errorMessage: 'Direct access to private or loopback IPv6 addresses is prohibited.',
      };
    }
    return {
      isValid: true,
      sanitizedUrl: parsed.toString(),
      sanitizedHostname: hostname,
      resolvedIp: hostname,
    };
  }

  // Resolve hostname via DNS to verify target addresses
  try {
    const addresses = await dns.lookup(hostname, { all: true });

    if (!addresses || addresses.length === 0) {
      return {
        isValid: false,
        errorCode: 'DNS_RESOLVE_FAILED',
        errorMessage: `Could not resolve hostname '${hostname}'.`,
      };
    }

    for (const record of addresses) {
      if (record.family === 4 && isPrivateOrReservedIPv4(record.address)) {
        return {
          isValid: false,
          errorCode: 'DNS_REBINDING_OR_PRIVATE_IP',
          errorMessage: `Hostname resolves to private IP address ${record.address}, which is blocked.`,
        };
      }
      if (record.family === 6 && isPrivateOrReservedIPv6(record.address)) {
        return {
          isValid: false,
          errorCode: 'DNS_REBINDING_OR_PRIVATE_IP',
          errorMessage: `Hostname resolves to private IPv6 address ${record.address}, which is blocked.`,
        };
      }
    }

    return {
      isValid: true,
      sanitizedUrl: parsed.toString(),
      sanitizedHostname: hostname,
      resolvedIp: addresses[0].address,
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      isValid: false,
      errorCode: 'DNS_LOOKUP_ERROR',
      errorMessage: `DNS resolution failed: ${errMsg}`,
    };
  }
}
