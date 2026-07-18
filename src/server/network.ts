import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const PRIVATE_TARGETS_ENV = 'ALLOW_PRIVATE_NETWORK_TARGETS';

function ipv4Number(address: string): number | null {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return parts.reduce((value, part) => value * 256 + part, 0) >>> 0;
}

function publicIpv4(address: string): boolean {
  const value = ipv4Number(address);
  if (value === null) return false;
  const first = value >>> 24;
  const firstTwo = value >>> 16;
  return !(
    first === 0
    || first === 10
    || first === 127
    || (value >= 0x64400000 && value <= 0x647fffff)
    || firstTwo === 0xa9fe
    || (value >= 0xac100000 && value <= 0xac1fffff)
    || firstTwo === 0xc0a8
    || (value >= 0xc0000000 && value <= 0xc00000ff)
    || (value >= 0xc6120000 && value <= 0xc613ffff)
    || first >= 224
  );
}

function ipv6Parts(address: string): number[] | null {
  const clean = address.split('%', 1)[0]!.toLowerCase();
  const halves = clean.split('::');
  if (halves.length > 2) return null;
  const parse = (half: string): number[] | null => {
    if (!half) return [];
    const result: number[] = [];
    for (const raw of half.split(':')) {
      if (raw.includes('.')) {
        const ipv4 = ipv4Number(raw);
        if (ipv4 === null) return null;
        result.push((ipv4 >>> 16) & 0xffff, ipv4 & 0xffff);
      } else if (!/^[0-9a-f]{1,4}$/.test(raw)) {
        return null;
      } else {
        result.push(Number.parseInt(raw, 16));
      }
    }
    return result;
  };
  const left = parse(halves[0] ?? '');
  const right = parse(halves[1] ?? '');
  if (!left || !right) return null;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  return [...left, ...Array(missing).fill(0), ...right];
}

function publicIpv6(address: string): boolean {
  const parts = ipv6Parts(address);
  if (!parts) return false;
  const [first, second] = parts;
  if (parts.slice(0, 7).every((part) => part === 0) && parts[7]! <= 1) return false;
  if ((first! & 0xfe00) === 0xfc00) return false;
  if ((first! & 0xffc0) === 0xfe80) return false;
  if ((first! & 0xff00) === 0xff00) return false;
  if (first === 0x2001 && second === 0x0db8) return false;
  if (parts.slice(0, 5).every((part) => part === 0) && parts[5] === 0xffff) {
    return publicIpv4(`${parts[6]! >>> 8}.${parts[6]! & 255}.${parts[7]! >>> 8}.${parts[7]! & 255}`);
  }
  return true;
}

function publicAddress(address: string): boolean {
  const family = isIP(address.split('%', 1)[0]!);
  return family === 4 ? publicIpv4(address) : family === 6 ? publicIpv6(address) : false;
}

export async function assertPublicNetworkHost(hostname: string): Promise<void> {
  if (process.env[PRIVATE_TARGETS_ENV] === 'true') return;
  const host = hostname.trim().replace(/^\[|\]$/g, '');
  if (!host) throw new Error('Network host is required.');
  const addresses = isIP(host)
    ? [{ address: host }]
    : await lookup(host, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some(({ address }) => !publicAddress(address))) {
    throw new Error(`Private or non-public network targets are blocked. Set ${PRIVATE_TARGETS_ENV}=true only for trusted local services.`);
  }
}

export async function assertPublicHttpUrl(raw: string): Promise<void> {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Only HTTP(S) URLs without embedded credentials are allowed.');
  }
  await assertPublicNetworkHost(url.hostname);
}
