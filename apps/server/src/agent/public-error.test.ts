import { describe, expect, test } from 'bun:test';
import { APICallError, InvalidToolInputError, RetryError } from 'ai';
import { publicError } from './public-error.ts';

/**
 * A provider's 429 with a body.
 *
 * @param responseBody - The body.
 * @returns The error.
 */
function tooMany(responseBody: string): APICallError {
  return new APICallError({
    message: 'Too Many Requests',
    url: 'https://api.mistral.ai/v1/chat/completions',
    requestBodyValues: {},
    statusCode: 429,
    responseBody,
  });
}

describe('publicError', () => {
  test('adds what the provider said, after the retries too', () => {
    const mistral = tooMany(
      '{"object":"error","message":"Service tier capacity exceeded for this model.","code":"3505"}',
    );
    const retried = new RetryError({
      message: 'Failed after 3 attempts. Last error: Too Many Requests',
      reason: 'maxRetriesExceeded',
      errors: [mistral],
    });
    expect(publicError(retried)).toBe(
      'The run failed: Failed after 3 attempts. Last error: Too Many Requests The provider says: Service tier capacity exceeded for this model.',
    );
  });

  test('reads a nested message, as Gemini sends it', () => {
    const gemini = tooMany('[{"error":{"code":429,"message":"Resource has been exhausted."}}]');
    expect(publicError(gemini)).toContain('The provider says: Resource has been exhausted.');
  });

  test('keeps the plain message when the body has none', () => {
    expect(publicError(tooMany('not json'))).toBe('The run failed: Too Many Requests');
    expect(publicError({ odd: true })).toBe('The run failed.');
  });

  test('says a tool call did not fit its schema without quoting the input, and keeps text', () => {
    const invalid = new InvalidToolInputError({
      toolName: 'edit_dashboard',
      toolInput: '{"panels":[{"data":{"kind":"sum"}}]}',
      cause: new Error('Invalid option'),
    });
    const said = publicError(invalid);
    expect(said).toBe(
      "The agent's edit_dashboard call did not fit the tool's schema, so it did not run. The agent sees why and can try again.",
    );
    expect(publicError(said)).toBe(said);
  });
});
