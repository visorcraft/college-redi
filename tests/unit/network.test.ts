import { afterEach, describe, expect, it } from 'vitest';
import { assertPublicHttpUrl, assertPublicNetworkHost } from '@/server/network';

describe('network target validation', () => {
  afterEach(() => {
    process.env.ALLOW_PRIVATE_NETWORK_TARGETS = 'true';
  });

  it.each(['127.0.0.1', '169.254.169.254', '10.0.0.1', '::1', 'fc00::1'])(
    'blocks non-public address %s',
    async (host) => {
      delete process.env.ALLOW_PRIVATE_NETWORK_TARGETS;
      await expect(assertPublicNetworkHost(host)).rejects.toThrow('Private or non-public');
    },
  );

  it('blocks non-HTTP URLs and embedded credentials', async () => {
    await expect(assertPublicHttpUrl('file:///etc/passwd')).rejects.toThrow('Only HTTP(S)');
    await expect(assertPublicHttpUrl('https://user:secret@example.com')).rejects.toThrow('Only HTTP(S)');
  });

  it('permits trusted local services only with explicit opt-in', async () => {
    process.env.ALLOW_PRIVATE_NETWORK_TARGETS = 'true';
    await expect(assertPublicHttpUrl('http://127.0.0.1:11434/v1')).resolves.toBeUndefined();
  });
});
