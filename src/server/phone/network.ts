import os from 'node:os';

/**
 * What this computer looks like on the network: the addresses a phone can reach it at, and
 * whether a connection comes from the computer itself. Reads the live interfaces each time,
 * because a laptop changes network without Mossnote being restarted.
 */

export type Interfaces = ReturnType<typeof os.networkInterfaces>;

const MAPPED_PREFIX = '::ffff:';
const HOST_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

/** An IPv6-mapped IPv4 address (`::ffff:192.168.1.5`) as plain IPv4. */
export function normalizeAddress(address: string): string {
  const lower = address.toLowerCase();
  return lower.startsWith(MAPPED_PREFIX) ? lower.slice(MAPPED_PREFIX.length) : lower;
}

export function isLoopbackAddress(address: string): boolean {
  const normal = normalizeAddress(address);
  return normal === '::1' || /^127(\.\d{1,3}){3}$/.test(normal);
}

/** Private ranges first (`192.168`, `10`, `172.16-31`): those are the ones a home router hands out. */
function isPrivateIpv4(address: string): boolean {
  const [first = 0, second = 0] = address.split('.').map(Number);
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

/** Every IPv4 address of this computer that other devices could reach, private ones first. */
export function lanAddresses(interfaces: Interfaces = os.networkInterfaces()): string[] {
  const found: string[] = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) found.push(entry.address);
    }
  }
  return found.sort((a, b) => Number(isPrivateIpv4(b)) - Number(isPrivateIpv4(a)));
}

/** True for loopback and for any address that belongs to one of this computer's interfaces. */
export function isOwnAddress(
  address: string,
  interfaces: Interfaces = os.networkInterfaces(),
): boolean {
  if (isLoopbackAddress(address)) return true;
  const normal = normalizeAddress(address);
  return Object.values(interfaces).some((entries) =>
    (entries ?? []).some((entry) => normalizeAddress(entry.address) === normal),
  );
}

/**
 * The name other devices on the network may know this computer by (`laptop.local`), or null when
 * the host name is not a plain DNS label.
 */
export function localHostName(hostname: string = os.hostname()): string | null {
  const label = hostname.toLowerCase().replace(/\.local$/, '');
  return HOST_NAME_PATTERN.test(label) ? `${label}.local` : null;
}

/** `Host` header values a phone may send for this computer. */
export function lanHostValues(
  port: number,
  interfaces: Interfaces = os.networkInterfaces(),
  hostname: string = os.hostname(),
): Set<string> {
  const hosts = new Set(lanAddresses(interfaces).map((address) => `${address}:${port}`));
  const name = localHostName(hostname);
  if (name) hosts.add(`${name}:${port}`);
  return hosts;
}
