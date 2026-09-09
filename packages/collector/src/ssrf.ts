import { isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";

import { ALLOWED_PROTOCOLS } from "./constants.js";
import { InvalidUrlError, SsrfBlockedError } from "./errors.js";

/** Resolves a hostname to one or more IP address strings. */
export type DnsLookup = (hostname: string) => Promise<readonly string[]>;

export async function defaultDnsLookup(
  hostname: string,
): Promise<readonly string[]> {
  const results = await dnsLookup(hostname, { all: true, verbatim: true });
  return results.map((entry) => entry.address);
}

function normalizeHostname(hostname: string): string {
  let normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  // Some Node/URL versions keep brackets on IPv6 hostnames.
  if (normalized.startsWith("[") && normalized.endsWith("]")) {
    normalized = normalized.slice(1, -1);
  }
  return normalized;
}

function isLocalHostname(hostname: string): boolean {
  if (hostname === "localhost") {
    return true;
  }
  if (hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    return true;
  }
  return false;
}

function parseIpv4Octets(ip: string): readonly number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) {
    return null;
  }

  const octets: number[] = [];
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) {
      return null;
    }
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0 || value > 255) {
      return null;
    }
    if (part.length > 1 && part.startsWith("0")) {
      return null;
    }
    octets.push(value);
  }
  return octets;
}

function isBlockedIpv4(ip: string): boolean {
  const octets = parseIpv4Octets(ip);
  if (octets === null) {
    return false;
  }

  const [a, b] = octets;

  if (a === 0) {
    return true;
  }
  if (a === 10) {
    return true;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }
  if (a === 127) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 0 && octets[2] === 0) {
    return true;
  }
  if (a === 192 && b === 0 && octets[2] === 2) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 198 && (b === 18 || b === 19)) {
    return true;
  }
  if (a === 198 && b === 51 && octets[2] === 100) {
    return true;
  }
  if (a === 203 && b === 0 && octets[2] === 113) {
    return true;
  }
  if (a >= 224) {
    return true;
  }

  return false;
}

function expandIpv6(ip: string): string | null {
  const lowered = ip.toLowerCase();
  if (lowered.includes(".")) {
    return null;
  }

  const sides = lowered.split("::");
  if (sides.length > 2) {
    return null;
  }

  let head = sides[0] === "" ? [] : sides[0].split(":");
  let tail =
    sides.length === 2 ? (sides[1] === "" ? [] : sides[1].split(":")) : [];

  if (sides.length === 1) {
    if (head.length !== 8) {
      return null;
    }
  } else {
    const missing = 8 - head.length - tail.length;
    if (missing < 0) {
      return null;
    }
    head = [...head, ...Array.from({ length: missing }, () => "0"), ...tail];
  }

  if (head.length !== 8) {
    return null;
  }

  const groups: string[] = [];
  for (const group of head) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) {
      return null;
    }
    groups.push(group.padStart(4, "0"));
  }
  return groups.join(":");
}

function ipv6Groups(ip: string): readonly number[] | null {
  const expanded = expandIpv6(ip);
  if (expanded === null) {
    return null;
  }
  return expanded.split(":").map((group) => Number.parseInt(group, 16));
}

function extractIpv4FromMappedIpv6(ip: string): string | null {
  const lowered = ip.toLowerCase();

  const dotted = lowered.match(
    /^(?:0:){5}ffff:(\d{1,3}(?:\.\d{1,3}){3})$|^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i,
  );
  if (dotted) {
    return dotted[1] ?? dotted[2] ?? null;
  }

  const groups = ipv6Groups(lowered);
  if (groups === null) {
    return null;
  }

  // IPv4-mapped ::ffff:x.x.x.x
  const isMapped =
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0xffff;
  if (isMapped) {
    const hi = groups[6];
    const lo = groups[7];
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }

  // Deprecated IPv4-compatible ::a.b.c.d (non-zero)
  const isCompat =
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0 &&
    !(groups[6] === 0 && groups[7] === 0) &&
    !(groups[6] === 0 && groups[7] === 1);
  if (isCompat) {
    const hi = groups[6];
    const lo = groups[7];
    return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
  }

  return null;
}

function isBlockedIpv6(ip: string): boolean {
  const mappedIpv4 = extractIpv4FromMappedIpv6(ip);
  if (mappedIpv4 !== null) {
    return isBlockedIpv4(mappedIpv4);
  }

  const groups = ipv6Groups(ip);
  if (groups === null) {
    // Fail closed when the address cannot be parsed.
    return true;
  }

  // :: / unspecified
  if (groups.every((group) => group === 0)) {
    return true;
  }
  // ::1 / loopback
  if (
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0 &&
    groups[6] === 0 &&
    groups[7] === 1
  ) {
    return true;
  }
  // fe80::/10 — link-local
  if ((groups[0] & 0xffc0) === 0xfe80) {
    return true;
  }
  // fc00::/7 — unique local
  if ((groups[0] & 0xfe00) === 0xfc00) {
    return true;
  }
  // ff00::/8 — multicast
  if ((groups[0] & 0xff00) === 0xff00) {
    return true;
  }

  return false;
}

/** Returns true when the IP is local, private, reserved, or non-routable. */
export function isBlockedIpAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    return isBlockedIpv4(address);
  }
  if (family === 6) {
    return isBlockedIpv6(address);
  }
  return true;
}

export function parseHttpUrl(input: string | URL): URL {
  let url: URL;
  try {
    url = input instanceof URL ? new URL(input.href) : new URL(input);
  } catch (cause) {
    throw new InvalidUrlError("Invalid URL.", { cause });
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol as "http:" | "https:")) {
    throw new InvalidUrlError(
      `Disallowed URL protocol: ${url.protocol || "(none)"}.`,
    );
  }

  if (!url.hostname) {
    throw new InvalidUrlError("URL hostname is required.");
  }

  return url;
}

/**
 * Validates protocol/hostname rules and resolves DNS to pinned safe addresses.
 * No network request is performed beyond DNS resolution.
 */
export type SafeDestination = {
  readonly url: URL;
  /** Original hostname (for Host / SNI). */
  readonly hostname: string;
  readonly pinnedAddresses: readonly string[];
  /** First validated address used for the TCP connection. */
  readonly pinnedAddress: string;
};

export async function resolveSafeDestination(
  input: string | URL,
  lookup: DnsLookup = defaultDnsLookup,
): Promise<SafeDestination> {
  const url = parseHttpUrl(input);
  const hostname = normalizeHostname(url.hostname);

  if (isLocalHostname(hostname)) {
    throw new SsrfBlockedError("Request blocked: local hostname is not allowed.");
  }

  const literalFamily = isIP(hostname);
  if (literalFamily !== 0) {
    if (isBlockedIpAddress(hostname)) {
      throw new SsrfBlockedError(
        "Request blocked: IP address is not allowed.",
      );
    }
    return {
      url,
      hostname,
      pinnedAddresses: [hostname],
      pinnedAddress: hostname,
    };
  }

  let addresses: readonly string[];
  try {
    addresses = await lookup(hostname);
  } catch (cause) {
    throw new SsrfBlockedError("Request blocked: hostname could not be resolved.", {
      cause,
    });
  }

  if (addresses.length === 0) {
    throw new SsrfBlockedError("Request blocked: hostname resolved to no addresses.");
  }

  for (const address of addresses) {
    if (isBlockedIpAddress(address)) {
      throw new SsrfBlockedError(
        "Request blocked: resolved address is not allowed.",
      );
    }
  }

  return {
    url,
    hostname,
    pinnedAddresses: addresses,
    pinnedAddress: addresses[0]!,
  };
}

/**
 * Validates protocol/hostname rules and resolves DNS.
 * No network request is performed beyond DNS resolution.
 */
export async function assertSafeDestination(
  input: string | URL,
  lookup: DnsLookup = defaultDnsLookup,
): Promise<URL> {
  const destination = await resolveSafeDestination(input, lookup);
  return destination.url;
}
