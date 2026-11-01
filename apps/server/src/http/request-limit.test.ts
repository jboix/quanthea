import { afterAll, describe, expect, test } from 'bun:test';
import { maxRequestBytes } from './request-limit.ts';

// The server's options as `main.ts` passes them, with a handler that reads the whole body.
const server = Bun.serve({
  port: 0,
  maxRequestBodySize: maxRequestBytes,
  fetch: async (request) => new Response(String((await request.arrayBuffer()).byteLength)),
});
afterAll(() => server.stop(true));

/**
 * A body sent in chunks, with no `Content-Length`.
 *
 * @param bytes - How many bytes in all.
 * @returns The stream.
 */
function chunked(bytes: number): ReadableStream<Uint8Array> {
  const chunk = 1024 * 1024;
  return new ReadableStream({
    start(controller) {
      for (let sent = 0; sent < bytes; sent += chunk)
        controller.enqueue(new Uint8Array(Math.min(chunk, bytes - sent)));
      controller.close();
    },
  });
}

describe('the request body limit', () => {
  test('reads a body up to 8 MB', async () => {
    const response = await fetch(server.url, {
      method: 'POST',
      body: new Uint8Array(maxRequestBytes),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(String(maxRequestBytes));
  });

  test('refuses a larger body that states its length', async () => {
    const response = await fetch(server.url, {
      method: 'POST',
      body: new Uint8Array(maxRequestBytes + 1),
    });
    expect(response.status).toBe(413);
  });

  test('refuses a larger body sent in chunks, with no length', async () => {
    const response = await fetch(server.url, {
      method: 'POST',
      body: chunked(maxRequestBytes + 1),
      duplex: 'half',
    } as RequestInit);
    expect(response.status).toBe(413);
  });
});
