import { describe, expect, it } from 'vitest';
import { networkEntry } from '../testing/network';
import {
  isLoopbackAddress,
  isOwnAddress,
  lanAddresses,
  lanHostValues,
  localHostName,
  normalizeAddress,
  type Interfaces,
} from './network';

const INTERFACES: Interfaces = {
  lo0: [networkEntry('127.0.0.1', 'IPv4', true), networkEntry('::1', 'IPv6', true)],
  utun0: [networkEntry('100.64.1.2', 'IPv4')],
  en0: [networkEntry('192.168.1.20', 'IPv4'), networkEntry('fe80::1', 'IPv6')],
  docker0: [networkEntry('172.17.0.1', 'IPv4')],
};

describe('addresses', () => {
  it('reads an IPv4-mapped IPv6 address as IPv4', () => {
    expect(normalizeAddress('::FFFF:192.168.1.5')).toBe('192.168.1.5');
  });

  it('recognises loopback in every spelling', () => {
    for (const address of ['127.0.0.1', '127.1.2.3', '::1', '::ffff:127.0.0.1']) {
      expect(isLoopbackAddress(address), address).toBe(true);
    }
    expect(isLoopbackAddress('192.168.1.5')).toBe(false);
  });

  it('lists reachable IPv4 addresses with the home-network ones first', () => {
    expect(lanAddresses(INTERFACES)).toEqual(['192.168.1.20', '172.17.0.1', '100.64.1.2']);
  });

  it('treats loopback and the computer’s own addresses as itself, and nothing else', () => {
    expect(isOwnAddress('127.0.0.1', INTERFACES)).toBe(true);
    expect(isOwnAddress('::ffff:192.168.1.20', INTERFACES)).toBe(true);
    expect(isOwnAddress('192.168.1.50', INTERFACES)).toBe(false);
  });
});

describe('host names', () => {
  it('makes a .local name from a plain host name', () => {
    expect(localHostName('Gaming-Laptop')).toBe('gaming-laptop.local');
    expect(localHostName('gaming-laptop.local')).toBe('gaming-laptop.local');
  });

  it('gives no name for a host name that is not a plain label', () => {
    expect(localHostName("Rahul's Laptop")).toBeNull();
    expect(localHostName('a.b.c')).toBeNull();
  });

  it('builds the Host values a phone may send', () => {
    expect(lanHostValues(4317, INTERFACES, 'laptop')).toEqual(
      new Set(['192.168.1.20:4317', '172.17.0.1:4317', '100.64.1.2:4317', 'laptop.local:4317']),
    );
  });
});
