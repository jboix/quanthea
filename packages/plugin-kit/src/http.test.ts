import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import type { ConnectorError } from './errors.ts';
import { createHttpClient, type HttpClientOptions } from './http.ts';
import { isMetadataAddress } from './http-address.ts';

let server: ReturnType<typeof Bun.serve>;
let other: ReturnType<typeof Bun.serve>;

/**
 * Answers the test server's routes.
 *
 * @param request - The request.
 * @returns The response.
 */
async function route(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const routes: Record<string, () => Response | Promise<Response>> = {
    '/base/echo': async () =>
      Response.json({
        method: request.method,
        query: url.searchParams.getAll('a'),
        header: request.headers.get('x-test'),
        body: await request.text(),
      }),
    '/base/lines': () => new Response('one\r\ntwo\nthree'),
    '/base/big': () => new Response('x'.repeat(4096)),
    '/base/slow': async () => {
      await Bun.sleep(1000);
      return new Response('late');
    },
    '/base/here': () => Response.redirect(`${url.origin}/base/echo?a=moved`, 302),
    '/base/away': () => Response.redirect(`http://127.0.0.1:${other.port}/`, 302),
  };
  return (await routes[url.pathname]?.()) ?? new Response('missing', { status: 404 });
}

beforeAll(() => {
  server = Bun.serve({ port: 0, fetch: route });
  other = Bun.serve({ port: 0, fetch: () => new Response('other origin') });
});

afterAll(() => {
  server.stop(true);
  other.stop(true);
});

/**
 * A client for the test server, under `/base/`.
 *
 * @param options - Options to replace.
 * @returns The client.
 */
function client(options: Partial<HttpClientOptions> = {}) {
  return createHttpClient({
    baseUrl: `http://127.0.0.1:${server.port}/base/`,
    sourceName: 'Test',
    headers: { 'x-test': 'from-client' },
    ...options,
  });
}

/**
 * Runs a request and its body read, and returns what it rejected with.
 *
 * @param work - The request and read.
 * @returns The connector error.
 */
function failureOf(work: () => Promise<unknown>): Promise<ConnectorError> {
  return work().then(
    () => {
      throw new Error('Expected a failure.');
    },
    (error: unknown) => error as ConnectorError,
  );
}

describe('createHttpClient', () => {
  test('sends the method, query, headers and body under the base path', async () => {
    const response = await client().request({
      method: 'POST',
      path: '/echo',
      query: { a: ['1', '2'] },
      body: 'payload',
      signal: AbortSignal.timeout(5000),
    });
    expect(response.ok).toBe(true);
    expect(await response.json()).toEqual({
      method: 'POST',
      query: ['1', '2'],
      header: 'from-client',
      body: 'payload',
    });
  });

  test('takes an absolute URL on the origin, and refuses one elsewhere', async () => {
    const signal = AbortSignal.timeout(5000);
    const echo = await client().request({
      method: 'DELETE',
      path: `http://127.0.0.1:${server.port}/base/echo?a=next`,
      signal,
    });
    expect(await echo.json()).toMatchObject({ method: 'DELETE', query: ['next'] });
    const elsewhere = await failureOf(() =>
      client().request({ path: `http://127.0.0.1:${other.port}/`, signal }),
    );
    expect(elsewhere).toMatchObject({ code: 'rejected' });
  });

  test('reads a body line by line, without the line ends', async () => {
    const response = await client().request({ path: '/lines', signal: AbortSignal.timeout(5000) });
    const lines: string[] = [];
    for await (const line of response.lines()) lines.push(line);
    expect(lines).toEqual(['one', 'two', 'three']);
  });

  test('follows a redirect within the origin and refuses one to another origin', async () => {
    const signal = AbortSignal.timeout(5000);
    const moved = await client().request({ path: '/here', signal });
    expect(await moved.json()).toMatchObject({ method: 'GET', query: ['moved'] });
    const away = await failureOf(() => client().request({ path: '/away', signal }));
    expect(away).toMatchObject({ code: 'rejected' });
    expect(away.safeMessage).toContain('another origin');
  });

  test('stops reading past the byte cap', async () => {
    const response = await client({ maxBytes: 1024 }).request({
      path: '/big',
      signal: AbortSignal.timeout(5000),
    });
    const failure = await failureOf(() => response.text());
    expect(failure).toMatchObject({ code: 'rejected' });
    expect(failure.safeMessage).toStartWith('Test sent more than');
  });

  test('turns the caller giving up and its own timeout into a timeout error', async () => {
    const aborted = await failureOf(() =>
      client().request({ path: '/slow', signal: AbortSignal.timeout(50) }),
    );
    expect(aborted.code).toBe('timeout');
    const timedOut = await failureOf(() =>
      client({ timeoutMs: 50 }).request({ path: '/slow', signal: AbortSignal.timeout(5000) }),
    );
    expect(timedOut.code).toBe('timeout');
  });

  test('keeps a path under the base path, dot segments resolved first', async () => {
    const signal = AbortSignal.timeout(5000);
    for (const path of ['/../echo', '/%2e%2e/echo', '/x/../../echo', '/%2E%2E/base/../echo']) {
      const failure = await failureOf(() => client().request({ path, signal }));
      expect(failure).toMatchObject({ code: 'rejected' });
    }
    const inside = await client().request({ path: '/x/../echo', signal });
    expect(inside.status).toBe(200);
  });

  test('maps a server that does not answer to unreachable', async () => {
    const closed = createHttpClient({ baseUrl: 'http://127.0.0.1:1', sourceName: 'Test' });
    const failure = await failureOf(() =>
      closed.request({ path: '/', signal: AbortSignal.timeout(5000) }),
    );
    expect(failure).toMatchObject({ code: 'unreachable', safeMessage: 'Test cannot be reached.' });
  });

  test('checks the destination again before each redirect hop', async () => {
    const answers: Bun.DNSLookup[][] = [[{ address: '127.0.0.1', family: 4, ttl: 0 }]];
    const metadata: Bun.DNSLookup[] = [{ address: '169.254.169.254', family: 4, ttl: 0 }];
    const lookup = spyOn(Bun.dns, 'lookup').mockImplementation(() =>
      Promise.resolve(answers.shift() ?? metadata),
    );
    try {
      const failure = await failureOf(() =>
        client({ baseUrl: `http://localhost:${server.port}/base/` }).request({
          path: '/here',
          signal: AbortSignal.timeout(5000),
        }),
      );
      expect(failure).toMatchObject({ code: 'rejected' });
      expect(lookup).toHaveBeenCalledTimes(2);
    } finally {
      lookup.mockRestore();
    }
  });

  test('refuses a base URL that is not HTTP or HTTPS', () => {
    for (const baseUrl of ['file://127.0.0.1/etc/hostname', 'file:///etc', 'ftp://example.com/'])
      expect(() => createHttpClient({ baseUrl, sourceName: 'Test' })).toThrow(
        expect.objectContaining({ code: 'rejected' }),
      );
  });

  test('never calls a cloud metadata address, however it is written', async () => {
    for (const baseUrl of [
      'http://169.254.169.254/latest/meta-data',
      'http://[::ffff:169.254.169.254]/',
      'http://0xa9fea9fe/',
      'http://[fd00:ec2::254]/',
    ]) {
      const failure = await failureOf(() =>
        createHttpClient({ baseUrl, sourceName: 'Test' }).request({
          path: '/',
          signal: AbortSignal.timeout(5000),
        }),
      );
      expect(failure).toMatchObject({ code: 'rejected' });
      expect(failure.safeMessage).toContain('metadata address');
    }
  });
});

describe('isMetadataAddress', () => {
  test('matches link-local and provider addresses, in IPv4 and IPv6 forms', () => {
    const metadata = ['169.254.169.254', '169.254.170.2', '100.100.100.200', 'fd00:ec2::254'];
    const mapped = ['::ffff:169.254.169.254', '[::ffff:a9fe:a9fe]', 'fe80::1'];
    for (const address of [...metadata, ...mapped]) expect(isMetadataAddress(address)).toBe(true);
  });

  test('matches the other providers, in any IPv6 spelling', () => {
    const providers = [
      'fd20:ce::254',
      'FD20:CE::254',
      'fd20:00ce:0:0:0:0:0:0254',
      '[fd20:ce::254]',
    ];
    const others = ['168.63.129.16', '192.0.0.192', 'fe80::1%eth0', 'febf::1'];
    for (const address of [...providers, ...others]) expect(isMetadataAddress(address)).toBe(true);
  });

  test('matches IPv4 metadata addresses embedded in IPv6', () => {
    const embedded = [
      '::169.254.169.254',
      '[::a9fe:a9fe]',
      '64:ff9b::169.254.169.254',
      '64:ff9b::a9fe:a9fe',
      '64:ff9b:1:a9fe:a9:fe00::',
      '64:ff9b:1::a9fe:a9fe',
      '2002:a9fe:a9fe::',
      '2002:6464:64c8::1',
      '::ffff:0:a9fe:a9fe',
    ];
    for (const address of embedded) expect(isMetadataAddress(address)).toBe(true);
  });

  test('leaves other addresses and names alone', () => {
    for (const address of ['127.0.0.1', '10.0.0.5', '::1', '::', '::ffff:10.0.0.1', 'clickhouse'])
      expect(isMetadataAddress(address)).toBe(false);
    const ipv6 = ['2002:a00:1::', '64:ff9b::808:808', '2001:db8::1', 'fd20:ce::253', 'fec0::1'];
    for (const address of [...ipv6, '1::2::3', '1:2:3', '169.254.1', '300.254.169.254'])
      expect(isMetadataAddress(address)).toBe(false);
  });
});
