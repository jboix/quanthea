import { describe, expect, test } from 'bun:test';
import { defaultModelGateway, defaultModelSettings, modelGatewaySchema } from './model-settings.ts';

describe('the default model settings', () => {
  test('give a thread a budget of a million tokens', () => {
    expect(defaultModelSettings.limits.threadTokens).toBe(1_000_000);
    expect(defaultModelGateway.limits.threadTokens).toBe(1_000_000);
  });

  test('make a valid gateway', () => {
    expect(modelGatewaySchema.safeParse(defaultModelGateway).success).toBe(true);
  });
});

describe('a provider reached through an identity provider', () => {
  const [anthropic] = defaultModelGateway.providers;
  const auth = {
    type: 'oauth-client-credentials',
    issuer: 'https://login.example/tenant',
    clientId: 'quanthea',
  };

  /**
   * The issues of a gateway with one provider changed.
   *
   * @param change - The provider's changed fields.
   * @returns The issues' paths and messages.
   */
  function issuesOf(change: Record<string, unknown>) {
    const gateway = { ...defaultModelGateway, providers: [{ ...anthropic, ...change }] };
    const parsed = modelGatewaySchema.safeParse(gateway);
    return parsed.success
      ? []
      : parsed.error.issues.map((issue) => [issue.path.join('.'), issue.message]);
  }

  test('starts on the API key when a stored provider names no way in', () => {
    const { auth: _, ...stored } = anthropic ?? {};
    const parsed = modelGatewaySchema.parse({ ...defaultModelGateway, providers: [stored] });
    expect(parsed.providers[0]?.auth).toEqual({ type: 'api-key' });
  });

  test('points at a gateway and names its issuer or token URL', () => {
    expect(issuesOf({ baseUrl: 'https://gw.test/v1', auth })).toEqual([]);
    expect(issuesOf({ baseUrl: 'https://api.anthropic.com/v1/', auth })).toEqual([
      [
        'providers.0.baseUrl',
        'The vendor’s own API takes keys only. Enter your gateway’s base URL.',
      ],
    ]);
    expect(issuesOf({ baseUrl: 'https://gw.test/v1', auth: { ...auth, issuer: null } })).toEqual([
      ['providers.0.auth.issuer', 'Enter the issuer.'],
    ]);
  });
});
