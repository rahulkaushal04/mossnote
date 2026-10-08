import type { Interfaces } from '../phone/network';

type Entry = NonNullable<Interfaces[string]>[number];

/** One entry of `os.networkInterfaces()`, for tests that pretend to be on a network. */
export function networkEntry(
  address: string,
  family: 'IPv4' | 'IPv6' = 'IPv4',
  internal = false,
): Entry {
  const common = { address, mac: '00:00:00:00:00:00', internal };
  return family === 'IPv4'
    ? { ...common, family, netmask: '255.255.255.0', cidr: null }
    : { ...common, family, netmask: 'ffff:ffff:ffff:ffff::', cidr: null, scopeid: 0 };
}

/** A computer with one Wi-Fi interface at `address`. */
export const wifiAt = (address: string): Interfaces => ({ en0: [networkEntry(address)] });
