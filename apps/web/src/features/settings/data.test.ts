import { describe, expect, test } from 'bun:test';
import type { ActionFunctionArgs } from 'react-router';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';
import { modelSettingsAction } from './data.ts';

/**
 * An API client whose every call fails with the error given.
 *
 * @param error - The error each call throws.
 * @returns The client.
 */
function failingApi(error: Error): ApiClient {
  return { call: () => Promise.reject(error) } as unknown as ApiClient;
}

/**
 * Lists the models through the action, with a client that fails.
 *
 * @param error - The error the client throws.
 * @returns The action's outcome.
 */
function listWith(error: Error) {
  const body = { intent: 'models', provider: 'openai-compatible', baseUrl: 'https://gw.test/v1' };
  const request = new Request('http://quanthea.test/settings', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  return modelSettingsAction(failingApi(error))({ request } as ActionFunctionArgs);
}

describe('listing the models', () => {
  test('says the base URL is wrong only when the server names the base URL', async () => {
    const baseUrl = [{ part: 'body', path: 'baseUrl', message: 'Invalid URL' }];
    const refused = new ApiError('bad_request', 400, 'The request is invalid.', baseUrl);
    expect(await listWith(refused)).toEqual({
      intent: 'models',
      models: [],
      message: 'Enter an http or https base URL.',
    });
  });

  test('shows the server’s message for any other refused field', async () => {
    const apiKey = [{ part: 'body', path: 'apiKey', message: 'Too long' }];
    const refused = new ApiError('bad_request', 400, 'The request is invalid.', apiKey);
    expect(await listWith(refused)).toEqual({
      intent: 'models',
      models: [],
      message: 'The request is invalid.',
    });
  });

  test('lets any other error through', async () => {
    await expect(listWith(new ApiError('forbidden', 403, 'No.'))).rejects.toThrow('No.');
  });
});
