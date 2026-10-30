import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  bearerFetch,
  type ClientCredentials,
  clientCredentialsOf,
  createTokenSource,
  TokenError,
} from './model-token.ts';

/** What the fake identity provider and gateway saw. */
const seen = {
  tokenRequests: [] as { authorization: string | null; form: URLSearchParams }[],
  modelRequests: [] as Headers[],
  methods: ['client_secret_basic', 'client_secret_post'] as string[],
  refuse: false,
  refuseModelOnce: false,
};

let server: ReturnType<typeof Bun.serve>;
let issuer = '';

/**
 * Answers as an identity provider and a model gateway would.
 *
 * @param request - The request.
 * @returns The answer.
 */
async function answer(request: Request): Promise<Response> {
  const { pathname } = new URL(request.url);
  if (pathname === '/realms/acme/.well-known/openid-configuration')
    return Response.json({
      issuer,
      token_endpoint: `${issuer}/token`,
      token_endpoint_auth_methods_supported: seen.methods,
    });
  if (pathname === '/realms/acme/token') {
    const form = new URLSearchParams(await request.text());
    seen.tokenRequests.push({ authorization: request.headers.get('authorization'), form });
    if (seen.refuse)
      return Response.json(
        { error: 'invalid_client', error_description: 'Bad secret s3cret-value.' },
        { status: 401 },
      );
    const number = seen.tokenRequests.length;
    return Response.json({
      access_token: `token-${number}`,
      token_type: 'Bearer',
      expires_in: 3600,
    });
  }
  seen.modelRequests.push(request.headers);
  if (seen.refuseModelOnce) {
    seen.refuseModelOnce = false;
    return new Response('expired', { status: 401 });
  }
  return Response.json({ ok: true });
}

beforeAll(() => {
  server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: answer });
  issuer = `http://127.0.0.1:${server.port}/realms/acme`;
});

afterAll(() => {
  server.stop(true);
});

beforeEach(() => {
  seen.tokenRequests = [];
  seen.modelRequests = [];
  seen.methods = ['client_secret_basic', 'client_secret_post'];
  seen.refuse = false;
  seen.refuseModelOnce = false;
});

/**
 * The credentials of the fake identity provider.
 *
 * @param overrides - Fields to change.
 * @returns The credentials.
 */
function credentials(overrides: Partial<ClientCredentials> = {}): ClientCredentials {
  return {
    type: 'oauth-client-credentials',
    issuer,
    tokenUrl: null,
    clientId: 'quanthea',
    clientSecret: 's3cret-value',
    scope: 'models.invoke',
    audience: 'llm-gateway',
    ...overrides,
  };
}

describe('the token source', () => {
  test('finds the token URL, asks once, and keeps the token until a minute before it expires', async () => {
    let clock = 1_000_000;
    const tokens = createTokenSource({ now: () => clock });
    const first = await tokens.token(credentials());
    expect(first).toMatchObject({ accessToken: 'token-1', issuerHost: `127.0.0.1:${server.port}` });
    expect(first.expiresAt).toBe(1_000_000 + 3_600_000);
    clock += 3_500_000;
    expect((await tokens.token(credentials())).accessToken).toBe('token-1');
    clock += 50_000;
    expect((await tokens.token(credentials())).accessToken).toBe('token-2');
    const [request] = seen.tokenRequests;
    // RFC 6749 form-encodes the client id and secret before Basic encoding.
    const pair = atob(request?.authorization?.replace('Basic ', '') ?? '');
    expect(pair.split(':').map(decodeURIComponent)).toEqual(['quanthea', 's3cret-value']);
    expect(request?.form.get('grant_type')).toBe('client_credentials');
    expect(request?.form.get('scope')).toBe('models.invoke');
    expect(request?.form.get('audience')).toBe('llm-gateway');
  });

  test('sends one request for calls made at once, and a new one for a new secret', async () => {
    const tokens = createTokenSource();
    const both = await Promise.all([tokens.token(credentials()), tokens.token(credentials())]);
    expect(both.map((each) => each.accessToken)).toEqual(['token-1', 'token-1']);
    await tokens.token(credentials({ clientSecret: 'another' }));
    expect(seen.tokenRequests).toHaveLength(2);
  });

  test('puts the client in the form when the issuer takes only that', async () => {
    seen.methods = ['client_secret_post'];
    await createTokenSource().token(credentials({ scope: '', audience: '' }));
    const [request] = seen.tokenRequests;
    expect(request?.authorization).toBeNull();
    expect(request?.form.get('client_secret')).toBe('s3cret-value');
    expect(request?.form.has('scope')).toBe(false);
  });

  test('uses a token URL given without discovery', async () => {
    const tokens = createTokenSource();
    const token = await tokens.token(credentials({ issuer: null, tokenUrl: `${issuer}/token` }));
    expect(token.accessToken).toBe('token-1');
  });

  test('says why the identity provider refused, without the secret', async () => {
    seen.refuse = true;
    const failure = createTokenSource().token(credentials());
    await expect(failure).rejects.toBeInstanceOf(TokenError);
    await expect(failure).rejects.toThrow(
      'The identity provider refused the client (invalid_client): Bad secret •••.',
    );
  });

  test('says when the issuer has no discovery document', async () => {
    const failure = createTokenSource().token(credentials({ issuer: `${issuer}/missing` }));
    await expect(failure).rejects.toThrow('enter the token URL');
  });
});

describe('the bearer fetch', () => {
  test('sends the token in place of a key, and asks for a new one after a 401', async () => {
    const tokens = createTokenSource();
    const send = bearerFetch(tokens, credentials());
    const url = `http://127.0.0.1:${server.port}/v1/chat`;
    const init = { method: 'POST', headers: { 'x-api-key': 'placeholder' }, body: '{}' };
    await send(url, init);
    seen.refuseModelOnce = true;
    expect((await send(url, init)).status).toBe(200);
    const sent = seen.modelRequests.map((headers) => headers.get('authorization'));
    expect(sent).toEqual(['Bearer token-1', 'Bearer token-1', 'Bearer token-2']);
    expect(seen.modelRequests[0]?.get('x-api-key')).toBeNull();
  });
});

describe('clientCredentialsOf', () => {
  test('gives credentials only for an identity provider with a secret', () => {
    const auth = { ...credentials(), clientSecret: undefined };
    expect(clientCredentialsOf({ type: 'api-key' }, 'sk')).toBeNull();
    expect(clientCredentialsOf(auth, null)).toBeNull();
    expect(clientCredentialsOf(auth, 'secret')?.clientSecret).toBe('secret');
  });
});
