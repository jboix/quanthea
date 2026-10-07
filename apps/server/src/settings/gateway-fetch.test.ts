import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { gatewayFetch } from './gateway-fetch.ts';

let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    fetch: (request) =>
      new URL(request.url).pathname === '/away'
        ? Response.redirect('http://169.254.169.254/latest/meta-data', 302)
        : new Response('ok'),
  });
});

afterAll(() => {
  server.stop(true);
});

describe('gatewayFetch', () => {
  test('calls an ordinary address, and never follows a redirect', async () => {
    expect(await (await gatewayFetch(`http://127.0.0.1:${server.port}/v1/models`)).text()).toBe(
      'ok',
    );
    const redirected = await gatewayFetch(`http://127.0.0.1:${server.port}/away`);
    expect(redirected.status).toBe(302);
  });

  test('refuses a cloud metadata address and a URL that is not HTTP', async () => {
    for (const url of ['http://169.254.169.254/v1/models', 'http://[fd20:ce::254]/v1/models'])
      await expect(gatewayFetch(url)).rejects.toThrow('cloud metadata address');
    await expect(gatewayFetch('file:///etc/hostname')).rejects.toThrow('not HTTP or HTTPS');
    await expect(gatewayFetch(new Request('http://169.254.169.254/'))).rejects.toThrow('metadata');
  });
});
