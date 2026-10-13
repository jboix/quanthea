import { describe, expect, test } from 'bun:test';
import { flagFindings } from './access.ts';
import { prometheusConnector } from './prometheus-connector.ts';

/**
 * Tests a connector against a server that answers the status API with some flags, or without
 * the flags endpoint, and records what it was asked.
 *
 * @param flags - The flags, or `undefined` for a server that lists none.
 * @returns The health report and the requests, as method and path.
 */
async function healthWith(flags: Record<string, string> | undefined) {
  const asked: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url);
      asked.push(`${request.method} ${pathname}`);
      if (pathname === '/api/v1/status/buildinfo')
        return Response.json({ status: 'success', data: { version: '3.15.0' } });
      if (pathname === '/api/v1/status/flags' && flags)
        return Response.json({ status: 'success', data: flags });
      return new Response('not found', { status: 404 });
    },
  });
  try {
    const connection = prometheusConnector.open({
      config: prometheusConnector.configSchema.parse({ url: `http://127.0.0.1:${server.port}` }),
      secret: {},
    });
    return { health: await connection.test(AbortSignal.timeout(5000)), asked };
  } finally {
    server.stop(true);
  }
}

/** The flags of a server started with none of the write APIs. */
const closed = {
  'web.enable-admin-api': 'false',
  'web.enable-lifecycle': 'false',
  'web.enable-remote-write-receiver': 'false',
};

describe('what a request to a Prometheus server may do', () => {
  test('a server with its write APIs off only reads, and the test only sends GETs', async () => {
    const { health, asked } = await healthWith(closed);
    expect(health).toMatchObject({ ok: true, readOnly: true, canDo: [] });
    expect(asked).toEqual(['GET /api/v1/status/buildinfo', 'GET /api/v1/status/flags']);
  });

  test('names each API that is on', async () => {
    const { health } = await healthWith({
      ...closed,
      'web.enable-admin-api': 'true',
      'web.enable-lifecycle': 'true',
    });
    expect(health).toMatchObject({ ok: true, readOnly: false });
    expect(health.canDo).toEqual([
      'The admin API is on: a request can delete series and take snapshots.',
      'The lifecycle API is on: a request can reload or shut down the server.',
    ]);
    expect(health.readOnlySetup).toContain('--web.enable-admin-api');
  });

  test('a server that lists no flags is unknown, never read-only', async () => {
    const { health } = await healthWith(undefined);
    expect(health).toMatchObject({ ok: true, readOnly: null, canDo: [] });
    expect(health.message).toContain('unknown');
  });

  test('a server that answers with other flags, or none, is unknown too', async () => {
    for (const flags of [{}, { 'query.timeout': '2m' }, { 'web.enable-admin-api': 'false' }]) {
      const { health } = await healthWith(flags);
      expect(health).toMatchObject({ ok: true, readOnly: null, canDo: [] });
    }
  });

  test('reads a receiver turned on as a feature, as older servers do', async () => {
    const features = 'exemplar-storage, otlp-write-receiver,remote-write-receiver';
    const { health } = await healthWith({ ...closed, 'enable-feature': features });
    expect(health).toMatchObject({ ok: true, readOnly: false });
    expect(health.canDo).toEqual([
      'The server accepts remote writes: a request can add samples.',
      'The server accepts OTLP writes: a request can add samples.',
    ]);
    expect(flagFindings({ 'enable-feature': 'exemplar-storage' })).toEqual([]);
  });

  test('reads a flag as on only when it says true', () => {
    expect(flagFindings({ 'web.enable-remote-write-receiver': 'true' })).toHaveLength(1);
    expect(flagFindings({ 'web.enable-remote-write-receiver': 'false' })).toEqual([]);
    expect(flagFindings({})).toEqual([]);
  });
});
