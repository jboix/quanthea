import { describe, expect, test } from 'bun:test';
import { createApiClient } from '../lib/api-client.ts';
import { createSessionLoader, type Session } from './session.ts';

/**
 * Creates a client whose fetch answers from a queue of responses and counts the calls.
 *
 * @param responses - Responses, in the order they are returned.
 * @returns The client and a call counter.
 */
function queuedClient(responses: Response[]) {
  const calls = { count: 0 };
  const client = createApiClient(() => {
    calls.count += 1;
    const next = responses.shift();
    return next ? Promise.resolve(next) : Promise.reject(new Error('no more responses'));
  });
  return { client, calls };
}

const me: Session = {
  principal: { id: 'anonymous', name: 'Anonymous', role: 'admin' },
  authMode: 'none',
};

describe('createSessionLoader', () => {
  test('asks the server once and reuses the answer', async () => {
    const { client, calls } = queuedClient([Response.json(me)]);
    const loadSession = createSessionLoader(client);
    expect(await loadSession()).toEqual(me);
    expect(await loadSession()).toEqual(me);
    expect(calls.count).toBe(1);
  });

  test('resolves to null when the server says the user is not signed in', async () => {
    const unauthorized = Response.json(
      { error: { code: 'unauthorized', message: 'Sign in to continue.' } },
      { status: 401 },
    );
    expect(await createSessionLoader(queuedClient([unauthorized]).client)()).toBeNull();
  });

  test('does not cache a failure, so the next navigation retries', async () => {
    const failure = Response.json(
      { error: { code: 'internal', message: 'down' } },
      { status: 500 },
    );
    const { client, calls } = queuedClient([failure, Response.json(me)]);
    const loadSession = createSessionLoader(client);
    await expect(loadSession()).rejects.toThrow('down');
    expect(await loadSession()).toEqual(me);
    expect(calls.count).toBe(2);
  });
});
