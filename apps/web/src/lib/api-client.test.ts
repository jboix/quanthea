import { describe, expect, test } from 'bun:test';
import { defineEndpoint, healthEndpoint } from '@querent/shared';
import { z } from 'zod';
import { ApiError, createApiClient } from './api-client.ts';

/** A request as the fake fetch saw it. */
interface SentRequest {
  /** The URL. */
  readonly url: string;
  /** The options. */
  readonly init: RequestInit;
}

/**
 * Creates a client whose fetch records the request and answers with `response`.
 *
 * @param response - The response to return.
 * @returns The client and the recorded requests.
 */
function recordingClient(response: Response) {
  const sent: SentRequest[] = [];
  const client = createApiClient((url, init) => {
    sent.push({ url, init });
    return Promise.resolve(response);
  });
  return { client, sent };
}

const renameEndpoint = defineEndpoint({
  method: 'POST',
  path: '/things/:thingId/rename',
  params: z.object({ thingId: z.string() }),
  query: z.object({ dryRun: z.boolean().optional(), note: z.string().optional() }),
  body: z.object({ title: z.string() }),
  output: z.object({ ok: z.boolean() }),
});

describe('createApiClient', () => {
  test('calls an endpoint without input and parses the output', async () => {
    const { client, sent } = recordingClient(Response.json({ status: 'ok', version: '1.0.0' }));
    expect(await client.call(healthEndpoint)).toEqual({ status: 'ok', version: '1.0.0' });
    expect(sent[0]?.url).toBe('/api/health');
    expect(sent[0]?.init).toMatchObject({
      method: 'GET',
      headers: { 'X-Requested-With': 'querent' },
    });
    expect(sent[0]?.init.body).toBeUndefined();
  });

  test('fills params, adds defined query values and sends the body as JSON', async () => {
    const { client, sent } = recordingClient(Response.json({ ok: true }));
    await client.call(renameEndpoint, {
      params: { thingId: 'a b' },
      query: { dryRun: true, note: undefined },
      body: { title: 'New' },
    });
    expect(sent[0]?.url).toBe('/api/things/a%20b/rename?dryRun=true');
    expect(sent[0]?.init).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"title":"New"}',
    });
  });

  test('turns the error shape into an ApiError with the server code', async () => {
    const response = Response.json(
      { error: { code: 'forbidden', message: 'This needs the admin role or higher.' } },
      { status: 403 },
    );
    const failure = await recordingClient(response)
      .client.call(healthEndpoint)
      .catch((error) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ code: 'forbidden', status: 403 });
  });

  test('reports an error body it cannot read as internal', async () => {
    const response = new Response('<html>Bad gateway</html>', { status: 502 });
    await expect(recordingClient(response).client.call(healthEndpoint)).rejects.toMatchObject({
      code: 'internal',
      status: 502,
    });
  });

  test('rejects a success body that breaks the contract', async () => {
    const { client } = recordingClient(Response.json({ status: 'maybe' }));
    await expect(client.call(healthEndpoint)).rejects.toThrow('does not match the contract');
  });
});
