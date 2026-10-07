import { describe, expect, test } from 'bun:test';
import type { StoredProvider } from '@quanthea/shared';
import type * as client from 'openid-client';
import { drivers } from './drivers.ts';

/** An Entra provider that lets the tenant in. */
const provider: StoredProvider = {
  id: 'entra',
  kind: 'entra',
  name: 'Entra ID',
  enabled: true,
  baseUrl: null,
  tenant: 'contoso.onmicrosoft.com',
  join: { mode: 'tenant', values: [] },
  testedAt: 1,
};

/**
 * Who Entra says a person is, from the claims of an ID token.
 *
 * @param claims - The ID token's claims, besides the tenant and object ids.
 * @returns The identity.
 */
function entraIdentity(claims: Record<string, unknown>) {
  const tokens = { claims: () => ({ tid: 'tenant-1', oid: 'object-1', ...claims }) };
  return drivers.entra.identify(
    {} as client.Configuration,
    tokens as unknown as client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    provider,
    {},
  );
}

describe('the Entra ID driver', () => {
  test('vouches for the email only when the xms_edov claim is true', async () => {
    const verified = await entraIdentity({ email: 'ada@partner.com', xms_edov: true });
    expect(verified).toMatchObject({ email: 'ada@partner.com', emailVerified: true });
    expect(verified.subject).toBe('tenant-1:object-1');
  });

  test('never takes the sign-in name, or an email alone, as a verified email', async () => {
    const byName = await entraIdentity({ preferred_username: 'ada@partner.com' });
    expect(byName.emailVerified).toBe(false);
    const byEmail = await entraIdentity({ email: 'ada@partner.com' });
    expect(byEmail.emailVerified).toBe(false);
    const notTrue = await entraIdentity({ email: 'ada@partner.com', xms_edov: 'true' });
    expect(notTrue.emailVerified).toBe(false);
    const nameOnly = await entraIdentity({ preferred_username: 'ada@partner.com', xms_edov: true });
    expect(nameOnly.emailVerified).toBe(false);
  });
});
