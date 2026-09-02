/**
 * Pure pairing helpers for "use my phone as a camera".
 *
 * The phone reaches NovaRec over the LAN, so the desktop has to advertise an
 * address the phone can actually route to. That is the whole difficulty: a
 * Windows dev machine typically has half a dozen IPv4 addresses, and most of
 * them (Hyper-V switches, WSL, VirtualBox host-only, Docker, VPN adapters) are
 * host-local networks a phone can never reach. Picking one of those produces a
 * QR code that silently never connects.
 *
 * All of this is pure so the adapter-ranking rules can be tested against real
 * `os.networkInterfaces()` shapes without a network.
 */
export interface NetAddress {
  address: string;
  /** Node <18 reported 4/6; newer reports 'IPv4'/'IPv6'. Accept both. */
  family: string | number;
  internal: boolean;
}

export type NetworkInterfaces = Record<string, NetAddress[] | undefined>;

/**
 * Adapter names that are virtual or host-only — reachable from this machine but
 * not from a phone on the Wi-Fi. Matched case-insensitively as substrings.
 */
const UNREACHABLE_ADAPTERS: readonly string[] = [
  'vethernet',
  'hyper-v',
  'wsl',
  'virtualbox',
  'vmware',
  'docker',
  'loopback',
  'tailscale',
  'zerotier',
  'bluetooth',
  'tap-windows',
  'openvpn',
  'wireguard',
  'npcap',
];

/** Adapter names that are almost certainly the real LAN link. */
const PREFERRED_ADAPTERS: readonly string[] = ['wi-fi', 'wifi', 'wlan', 'ethernet', 'en0', 'eth0'];

/**
 * A phone tethered over USB. Tethering puts the phone and this computer on the
 * same little network across the cable, so the ordinary pairing flow works over
 * it — no Wi-Fi involved, and no separate transport to build.
 *
 * These rank ABOVE Wi-Fi: plugging a cable in is a deliberate act, and a phone
 * on the far end of it can only reach this machine at its tethered address, not
 * its Wi-Fi one. The UI still lets the user pick another address when the guess
 * is wrong.
 */
const USB_TETHER_ADAPTERS: readonly string[] = [
  'remote ndis', // Android USB tethering on Windows
  'ndis',
  'usb',
  'rndis',
  'apple mobile device', // iPhone USB on Windows
  'iphone',
];

export type LanAddressKind = 'usb' | 'wifi' | 'ethernet' | 'other';

export interface LanAddress {
  address: string;
  /** OS adapter name, shown to the user when they need to choose. */
  adapter: string;
  kind: LanAddressKind;
}

function classifyAdapter(name: string): LanAddressKind {
  const l = name.toLowerCase();
  if (containsAny(l, USB_TETHER_ADAPTERS)) return 'usb';
  if (l.includes('wi-fi') || l.includes('wifi') || l.includes('wlan')) return 'wifi';
  if (l.includes('ethernet') || l.includes('en0') || l.includes('eth0')) return 'ethernet';
  return 'other';
}

/** Higher wins. A cable beats Wi-Fi; a named link beats an anonymous one. */
function kindBonus(kind: LanAddressKind): number {
  if (kind === 'usb') return 3;
  if (kind === 'wifi' || kind === 'ethernet') return 2;
  return 0;
}

function isIPv4(entry: NetAddress): boolean {
  return entry.family === 'IPv4' || entry.family === 4;
}

function containsAny(haystack: string, needles: readonly string[]): boolean {
  const l = haystack.toLowerCase();
  return needles.some((n) => l.includes(n));
}

/**
 * Rank a private IPv4 address. Home and office Wi-Fi is overwhelmingly
 * 192.168/16, then 10/8; 172.16/12 is common on corporate and virtual networks,
 * so it ranks last among the private ranges. Anything else (public, CGNAT,
 * link-local) is not a LAN we should advertise.
 */
export function rankLanAddress(address: string): number {
  if (address.startsWith('192.168.')) return 3;
  if (address.startsWith('10.')) return 2;
  const match = /^172\.(\d+)\./.exec(address);
  if (match) {
    const second = Number(match[1]);
    if (second >= 16 && second <= 31) return 1;
  }
  return 0; // not a private LAN address
}

/**
 * Every address a phone could plausibly reach this machine at, best first.
 *
 * More than one is common — Wi-Fi plus a tethered phone, say — and only the
 * caller's user knows which cable or network the phone is actually on, so the
 * full list is returned rather than silently guessing once.
 */
export function listLanAddresses(interfaces: NetworkInterfaces): LanAddress[] {
  const found: { entry: LanAddress; score: number }[] = [];

  for (const [name, entries] of Object.entries(interfaces)) {
    if (!entries || containsAny(name, UNREACHABLE_ADAPTERS)) continue;
    for (const address of entries) {
      if (!isIPv4(address) || address.internal) continue;
      // 169.254.x.x means DHCP failed — the link is up but unusable.
      if (address.address.startsWith('169.254.')) continue;
      const rangeScore = rankLanAddress(address.address);
      if (rangeScore === 0) continue;
      const kind = classifyAdapter(name);
      found.push({
        entry: { address: address.address, adapter: name, kind },
        // Range dominates (a real private LAN beats an odd one); then the kind
        // of link; then a recognisable adapter name.
        score: rangeScore * 10 + kindBonus(kind) + (containsAny(name, PREFERRED_ADAPTERS) ? 1 : 0),
      });
    }
  }

  return found.sort((a, b) => b.score - a.score).map((f) => f.entry);
}

/**
 * The single best address to advertise, or null when this machine has no
 * reachable LAN address (offline, or only virtual adapters).
 */
export function pickLanAddress(interfaces: NetworkInterfaces): string | null {
  return listLanAddresses(interfaces)[0]?.address ?? null;
}

/**
 * The URL the phone opens. The token is in the query string so scanning the QR
 * is the whole handshake — there is nothing to type, and a device that did not
 * see the code cannot talk to the server.
 */
export function buildPairingUrl(host: string, port: number, token: string): string {
  return `https://${host}:${String(port)}/?t=${encodeURIComponent(token)}`;
}

/**
 * Length-independent comparison of the pairing token. The token is short-lived
 * and local, but comparing secrets with `===` is a habit worth not having.
 */
export function tokenMatches(expected: string, given: string | null | undefined): boolean {
  if (!given || expected.length !== given.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * A short human-readable code shown on both screens. It is NOT the security
 * boundary (the token is) — it lets the user confirm the phone in their hand is
 * the device that just connected.
 */
export function formatPairingCode(token: string): string {
  const digits = token.replace(/\D/g, '').padEnd(6, '0').slice(0, 6);
  return `${digits.slice(0, 3)} ${digits.slice(3)}`;
}
