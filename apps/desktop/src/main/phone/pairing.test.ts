import { describe, it, expect } from 'vitest';
import {
  buildPairingUrl,
  formatPairingCode,
  listLanAddresses,
  pickLanAddress,
  rankLanAddress,
  tokenMatches,
  type NetworkInterfaces,
} from './pairing.js';

const v4 = (address: string, internal = false) => ({ address, family: 'IPv4', internal });

describe('pickLanAddress', () => {
  // The shape a real Windows dev machine reports: the reachable Wi-Fi address
  // sits among several virtual adapters that a phone can never route to.
  const WINDOWS_DEV_MACHINE: NetworkInterfaces = {
    'vEthernet (WSL (Hyper-V firewall))': [v4('172.20.176.1')],
    'vEthernet (Default Switch)': [v4('172.29.32.1')],
    'VirtualBox Host-Only Network': [v4('192.168.56.1')],
    'Wi-Fi': [v4('192.168.1.42')],
    'Loopback Pseudo-Interface 1': [v4('127.0.0.1', true)],
  };

  it('picks the real Wi-Fi address, not a Hyper-V or VirtualBox one', () => {
    expect(pickLanAddress(WINDOWS_DEV_MACHINE)).toBe('192.168.1.42');
  });

  it('skips loopback and other internal addresses', () => {
    expect(pickLanAddress({ lo: [v4('127.0.0.1', true)] })).toBeNull();
  });

  it('skips IPv6 entries', () => {
    const interfaces: NetworkInterfaces = {
      'Wi-Fi': [{ address: 'fe80::1', family: 'IPv6', internal: false }],
    };
    expect(pickLanAddress(interfaces)).toBeNull();
  });

  it('skips a link-local address from a failed DHCP lease', () => {
    expect(pickLanAddress({ Ethernet: [v4('169.254.10.5')] })).toBeNull();
  });

  it('ignores public addresses — those are not a LAN to advertise', () => {
    expect(pickLanAddress({ Ethernet: [v4('93.184.216.34')] })).toBeNull();
  });

  it('accepts the legacy numeric family from older Node', () => {
    const interfaces: NetworkInterfaces = {
      'Wi-Fi': [{ address: '192.168.0.7', family: 4, internal: false }],
    };
    expect(pickLanAddress(interfaces)).toBe('192.168.0.7');
  });

  it('falls back to a 10.x address when there is no 192.168 one', () => {
    expect(pickLanAddress({ Ethernet: [v4('10.0.0.15')] })).toBe('10.0.0.15');
  });

  it('accepts 172.16-31 but prefers 192.168 when both exist', () => {
    const interfaces: NetworkInterfaces = {
      Ethernet: [v4('172.16.5.5')],
      'Wi-Fi': [v4('192.168.1.9')],
    };
    expect(pickLanAddress(interfaces)).toBe('192.168.1.9');
  });

  it('prefers a well-named adapter when two addresses rank equally', () => {
    const interfaces: NetworkInterfaces = {
      'Some Random Adapter': [v4('192.168.1.2')],
      'Wi-Fi': [v4('192.168.1.42')],
    };
    expect(pickLanAddress(interfaces)).toBe('192.168.1.42');
  });

  it('returns null when the machine is offline', () => {
    expect(pickLanAddress({})).toBeNull();
  });
});

describe('rankLanAddress', () => {
  it('ranks the private ranges by how likely they are to be real Wi-Fi', () => {
    expect(rankLanAddress('192.168.1.1')).toBeGreaterThan(rankLanAddress('10.1.1.1'));
    expect(rankLanAddress('10.1.1.1')).toBeGreaterThan(rankLanAddress('172.16.1.1'));
  });

  it('rejects 172.x outside the private 16-31 block', () => {
    expect(rankLanAddress('172.15.0.1')).toBe(0);
    expect(rankLanAddress('172.32.0.1')).toBe(0);
    expect(rankLanAddress('172.16.0.1')).toBeGreaterThan(0);
    expect(rankLanAddress('172.31.255.254')).toBeGreaterThan(0);
  });
});

describe('buildPairingUrl', () => {
  it('builds an https URL carrying the token', () => {
    expect(buildPairingUrl('192.168.1.42', 45123, 'abc123')).toBe(
      'https://192.168.1.42:45123/?t=abc123',
    );
  });

  it('escapes a token so it cannot break out of the query string', () => {
    expect(buildPairingUrl('10.0.0.1', 8443, 'a&b=c')).toBe('https://10.0.0.1:8443/?t=a%26b%3Dc');
  });

  it('is https — getUserMedia refuses to run on a plain-http origin', () => {
    expect(buildPairingUrl('192.168.1.42', 45123, 't')).toMatch(/^https:\/\//);
  });
});

describe('tokenMatches', () => {
  it('accepts the exact token', () => {
    expect(tokenMatches('s3cret-token', 's3cret-token')).toBe(true);
  });

  it('rejects a wrong, short, long, empty or missing token', () => {
    expect(tokenMatches('s3cret-token', 's3cret-toker')).toBe(false);
    expect(tokenMatches('s3cret-token', 's3cret')).toBe(false);
    expect(tokenMatches('s3cret-token', 's3cret-token-extra')).toBe(false);
    expect(tokenMatches('s3cret-token', '')).toBe(false);
    expect(tokenMatches('s3cret-token', null)).toBe(false);
    expect(tokenMatches('s3cret-token', undefined)).toBe(false);
  });
});

describe('formatPairingCode', () => {
  it('renders six digits in two groups', () => {
    expect(formatPairingCode('12345678ab')).toBe('123 456');
  });

  it('pads when the token has too few digits to fill the code', () => {
    expect(formatPairingCode('ab1cd')).toBe('100 000');
  });
});

describe('USB-tethered phones', () => {
  // Android USB tethering on Windows registers this adapter and hands the PC an
  // address on the PHONE's little network. The phone can only reach the PC
  // there — its Wi-Fi address is unreachable across the cable.
  const TETHERED: NetworkInterfaces = {
    'Wi-Fi': [v4('192.168.1.42')],
    'Ethernet 3 (Remote NDIS based Internet Sharing Device)': [v4('192.168.42.129')],
  };

  it('prefers the tethered address over Wi-Fi when a cable is plugged in', () => {
    expect(pickLanAddress(TETHERED)).toBe('192.168.42.129');
  });

  it('recognises an iPhone USB adapter', () => {
    const interfaces: NetworkInterfaces = {
      'Apple Mobile Device Ethernet': [v4('172.20.10.2')],
    };
    expect(listLanAddresses(interfaces)[0]?.kind).toBe('usb');
  });

  it('still offers Wi-Fi as an alternative, so a wrong guess is recoverable', () => {
    const all = listLanAddresses(TETHERED);
    expect(all.map((a) => a.address)).toEqual(['192.168.42.129', '192.168.1.42']);
    expect(all[1]?.kind).toBe('wifi');
  });

  it('names the adapter for each address, so the user can tell them apart', () => {
    const all = listLanAddresses(TETHERED);
    expect(all[0]?.adapter).toContain('Remote NDIS');
    expect(all[1]?.adapter).toBe('Wi-Fi');
  });

  it('falls back to Wi-Fi when nothing is tethered', () => {
    expect(pickLanAddress({ 'Wi-Fi': [v4('192.168.1.42')] })).toBe('192.168.1.42');
  });

  it('never offers an unreachable virtual adapter, tethered or not', () => {
    const withVirtual: NetworkInterfaces = {
      ...TETHERED,
      'vEthernet (WSL)': [v4('172.20.176.1')],
      'VirtualBox Host-Only Network': [v4('192.168.56.1')],
    };
    const addresses = listLanAddresses(withVirtual).map((a) => a.address);
    expect(addresses).not.toContain('172.20.176.1');
    expect(addresses).not.toContain('192.168.56.1');
  });
});

describe('listLanAddresses', () => {
  it('returns an empty list when the machine is offline', () => {
    expect(listLanAddresses({})).toEqual([]);
  });

  it('classifies ordinary links', () => {
    const interfaces: NetworkInterfaces = {
      'Wi-Fi': [v4('192.168.1.2')],
      Ethernet: [v4('192.168.1.3')],
      'Some Adapter': [v4('10.0.0.9')],
    };
    const byAddress = new Map(listLanAddresses(interfaces).map((a) => [a.address, a.kind]));
    expect(byAddress.get('192.168.1.2')).toBe('wifi');
    expect(byAddress.get('192.168.1.3')).toBe('ethernet');
    expect(byAddress.get('10.0.0.9')).toBe('other');
  });
});
