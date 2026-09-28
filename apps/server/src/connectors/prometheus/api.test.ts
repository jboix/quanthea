import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { ConnectorError } from '../_shared/index.ts';
import { createPrometheusApi, redactLiterals } from './api.ts';

let server: ReturnType<typeof Bun.serve>;
let lastAuthorization: string | null = null;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch: async (request) => {
      lastAuthorization = request.headers.get('Authorization');
      const url = new URL(request.url);
      if (url.pathname === '/prom/api/v1/ok') {
        return Response.json({
          status: 'success',
          data: url.searchParams.getAll('match[]'),
          warnings: ['w'],
        });
      }
      if (url.pathname === '/prom/api/v1/slow') {
        await Bun.sleep(1000);
        return Response.json({ status: 'success', data: [] });
      }
      if (url.pathname === '/prom/api/v1/secret') return new Response('nope', { status: 401 });
      return Response.json(
        {
          status: 'error',
          errorType: 'bad_data',
          error: 'parse error: unexpected "secret-token" at char 3',
        },
        { status: 400 },
      );
    },
  });
});

afterAll(() => server.stop(true));

/**
 * A client for the fake server, under a path prefix.
 *
 * @param headers - Headers to send.
 * @returns The client.
 */
function client(headers: Record<string, string> = {}) {
  return createPrometheusApi({
    url: `http://127.0.0.1:${server.port}/prom/`,
    headers,
    verifyTls: true,
  });
}

/**
 * Calls a path and returns what it rejected with.
 *
 * @param path - The API path.
 * @param signal - The signal.
 * @returns The connector error.
 */
function failureOf(path: string, signal: AbortSignal = AbortSignal.timeout(5000)) {
  return client()
    .get(path, {}, signal)
    .then(
      (): ConnectorError => {
        throw new Error(`Expected ${path} to fail.`);
      },
      (error: unknown) => error as ConnectorError,
    );
}

describe('createPrometheusApi', () => {
  test('returns data and warnings, repeats array parameters and sends the headers', async () => {
    const result = await client({ Authorization: 'Bearer t' }).get<string[]>(
      '/api/v1/ok',
      { 'match[]': ['{a="1"}', '{b="2"}'] },
      AbortSignal.timeout(5000),
    );
    expect(result).toEqual({ data: ['{a="1"}', '{b="2"}'], warnings: ['w'] });
    expect(lastAuthorization).toBe('Bearer t');
  });

  test('maps an error envelope and redacts the literals from the safe message', async () => {
    const failure = await failureOf('/api/v1/bad');
    expect(failure).toBeInstanceOf(ConnectorError);
    expect(failure.code).toBe('syntax');
    expect(failure.message).toContain('secret-token');
    expect(failure.safeMessage).toBe('Prometheus: parse error: unexpected "…" at char 3');
  });

  test('maps 401 to an authentication error', async () => {
    expect((await failureOf('/api/v1/secret')).code).toBe('authentication');
  });

  test('maps an abort to a timeout', async () => {
    const failure = await failureOf('/api/v1/slow', AbortSignal.timeout(50));
    expect(failure.code).toBe('timeout');
  });

  test('maps a server that does not answer to unreachable', async () => {
    const closed = createPrometheusApi({ url: 'http://127.0.0.1:1', headers: {}, verifyTls: true });
    const failure = await closed.get('/api/v1/ok', {}, AbortSignal.timeout(5000)).then(
      () => undefined,
      (error: unknown) => error as ConnectorError,
    );
    expect(failure?.code).toBe('unreachable');
  });
});

describe('redactLiterals', () => {
  test('replaces double, single and backtick quoted literals', () => {
    expect(redactLiterals('a "x\\"y" b \'z\' `w`')).toBe('a "…" b "…" "…"');
  });
});
