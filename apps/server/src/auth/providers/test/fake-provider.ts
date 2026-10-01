/**
 * A fake OpenID Connect provider for tests: discovery, JWKS, a token endpoint that checks PKCE and
 * the client secret, ES256 ID tokens, and userinfo. It can misbehave on purpose, so the tests show
 * quanthea refuses what a real attacker could send.
 */

/** Who the fake provider says signs in. */
export interface FakePerson {
  /** The subject. */
  readonly sub: string;
  /** The email. */
  readonly email: string;
  /** Whether the email is verified. */
  readonly email_verified: boolean;
  /** The name. */
  readonly name: string;
  /** The GitLab groups, full paths. */
  readonly groups?: readonly string[];
}

/** Ways the fake provider can misbehave. */
export interface Misbehaviour {
  /** Signs this nonce instead of the one asked for. */
  readonly nonce?: string;
  /** Signs this audience instead of the client id. */
  readonly audience?: string;
  /** Signs with a key it never published. */
  readonly foreignKey?: boolean;
  /** Sends an unsigned token, `alg: none`. */
  readonly unsigned?: boolean;
  /** Names this issuer instead of itself. */
  readonly issuer?: string;
  /** Sends a token that expired ten minutes ago. */
  readonly expired?: boolean;
}

/** An authorization the fake provider granted, waiting for its code to be traded. */
interface Grant {
  /** The person. */
  readonly person: FakePerson;
  /** The nonce asked for. */
  readonly nonce: string | undefined;
  /** The PKCE challenge. */
  readonly challenge: string;
  /** The redirect URI asked for. */
  readonly redirectUri: string;
}

/** The fake provider. */
export interface FakeProvider {
  /** Its origin, the issuer. */
  readonly issuer: string;
  /** The client id it accepts. */
  readonly clientId: string;
  /** The client secret it accepts. */
  readonly clientSecret: string;
  /**
   * Plays the person approving an authorization request.
   *
   * @param authorizationUrl - The URL quanthea sent the person to.
   * @param person - Who approves.
   * @returns The callback's query string, with its `?`.
   */
  approve(authorizationUrl: string, person: FakePerson): string;
  /** Makes it misbehave from now on. */
  misbehave(misbehaviour: Misbehaviour): void;
  /** Stops it. */
  stop(): void;
}

/**
 * Base64url of bytes or text.
 *
 * @param value - The bytes or text.
 * @returns The encoding.
 */
function base64url(value: Uint8Array | string): string {
  return Buffer.from(value).toString('base64url');
}

/**
 * Signs a JWT with ES256.
 *
 * @param key - The private key.
 * @param kid - The key id.
 * @param payload - The claims.
 * @returns The JWT.
 */
async function signJwt(
  key: CryptoKey,
  kid: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const header = base64url(JSON.stringify({ alg: 'ES256', typ: 'JWT', kid }));
  const body = base64url(JSON.stringify(payload));
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(`${header}.${body}`),
  );
  return `${header}.${body}.${base64url(new Uint8Array(signature))}`;
}

/**
 * An unsigned JWT, `alg: none`, as an attacker would forge one.
 *
 * @param payload - The claims.
 * @returns The JWT.
 */
function unsignedJwt(payload: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  return `${header}.${base64url(JSON.stringify(payload))}.`;
}

/**
 * The S256 PKCE challenge of a verifier.
 *
 * @param verifier - The verifier.
 * @returns The challenge.
 */
async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

/**
 * Starts a fake provider on a free port of this machine.
 *
 * @returns The provider.
 */
export async function startFakeProvider(): Promise<FakeProvider> {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const foreign = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
  ]);
  const jwk = {
    ...(await crypto.subtle.exportKey('jwk', keys.publicKey)),
    kid: 'k1',
    alg: 'ES256',
    use: 'sig',
  };
  const grants = new Map<string, Grant>();
  const tokens = new Map<string, FakePerson>();
  let misbehaviour: Misbehaviour = {};
  const clientId = 'quanthea-test';
  const clientSecret = 'fake-client-secret';
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    fetch: async (request) => {
      const url = new URL(request.url);
      const issuer = url.origin;
      if (url.pathname === '/.well-known/openid-configuration')
        return Response.json({
          issuer,
          authorization_endpoint: `${issuer}/authorize`,
          token_endpoint: `${issuer}/token`,
          jwks_uri: `${issuer}/jwks`,
          userinfo_endpoint: `${issuer}/userinfo`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['ES256'],
          code_challenge_methods_supported: ['S256'],
        });
      if (url.pathname === '/jwks') return Response.json({ keys: [jwk] });
      if (url.pathname === '/userinfo') {
        const person = tokens.get(
          (request.headers.get('authorization') ?? '').replace('Bearer ', ''),
        );
        return person
          ? Response.json({ sub: person.sub, groups: person.groups ?? [] })
          : new Response(null, { status: 401 });
      }
      if (url.pathname === '/token') {
        const form = new URLSearchParams(await request.text());
        const grant = grants.get(form.get('code') ?? '');
        grants.delete(form.get('code') ?? '');
        const verified =
          grant !== undefined &&
          form.get('client_id') === clientId &&
          form.get('client_secret') === clientSecret &&
          form.get('redirect_uri') === grant.redirectUri &&
          (await challengeOf(form.get('code_verifier') ?? '')) === grant.challenge;
        if (!verified || !grant) return Response.json({ error: 'invalid_grant' }, { status: 400 });
        const accessToken = crypto.randomUUID();
        tokens.set(accessToken, grant.person);
        const now = Math.floor(Date.now() / 1000) - (misbehaviour.expired ? 900 : 0);
        const claims = {
          iss: misbehaviour.issuer ?? issuer,
          aud: misbehaviour.audience ?? clientId,
          sub: grant.person.sub,
          iat: now,
          exp: now + 300,
          nonce: misbehaviour.nonce ?? grant.nonce,
          email: grant.person.email,
          email_verified: grant.person.email_verified,
          name: grant.person.name,
        };
        const key = misbehaviour.foreignKey ? foreign.privateKey : keys.privateKey;
        const idToken = misbehaviour.unsigned
          ? unsignedJwt(claims)
          : await signJwt(key, 'k1', claims);
        return Response.json({
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: 300,
          id_token: idToken,
        });
      }
      return new Response(null, { status: 404 });
    },
  });
  const issuer = `http://127.0.0.1:${server.port}`;
  return {
    issuer,
    clientId,
    clientSecret,
    approve: (authorizationUrl, person) => {
      const asked = new URL(authorizationUrl).searchParams;
      const code = crypto.randomUUID();
      grants.set(code, {
        person,
        nonce: asked.get('nonce') ?? undefined,
        challenge: asked.get('code_challenge') ?? '',
        redirectUri: asked.get('redirect_uri') ?? '',
      });
      return `?${new URLSearchParams({ code, state: asked.get('state') ?? '' })}`;
    },
    misbehave: (next) => {
      misbehaviour = next;
    },
    stop: () => void server.stop(true),
  };
}
