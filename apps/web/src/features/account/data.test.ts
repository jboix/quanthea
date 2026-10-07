import { expect, test } from 'bun:test';
import type { ApiClient } from '../../lib/api-client.ts';
import { accountAction, signInAction } from './data.ts';

/** An API client whose every call succeeds. */
const api = { call: async () => ({}) } as unknown as ApiClient;

/**
 * Runs an action on a JSON body.
 *
 * @param action - The action.
 * @param body - The body it receives.
 * @returns What it answers.
 */
function run<Outcome>(action: (args: never) => Promise<Outcome>, body: unknown): Promise<Outcome> {
  const request = new Request('http://localhost/login', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return action({ request, params: {}, context: {} } as never);
}

test('signing in goes on to a local path, never to the API', async () => {
  const signIn = signInAction(api);
  const credentials = { email: 'ada@example.com', password: 'secret' };
  expect(await run(signIn, { ...credentials, next: '/bin' })).toEqual({ ok: true, next: '/bin' });
  const start = '/api/auth/providers/okta/start?intent=link&next=/';
  expect(await run(signIn, { ...credentials, next: start })).toEqual({ ok: true, next: '/' });
});

test('an account intent goes back to a local path only', async () => {
  const unlink = { intent: 'unlink', providerId: 'okta', back: '/library\\evil' };
  expect(await run(accountAction(api), unlink)).toEqual({ ok: true, next: '/?account=unlinked' });
});
