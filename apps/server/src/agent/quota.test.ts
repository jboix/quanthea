import { describe, expect, test } from 'bun:test';
import { APICallError, generateText, wrapLanguageModel } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { isQuotaSpent, quotaMiddleware, quotaSpentMessage } from './quota.ts';

/**
 * A 429 as a provider sends it.
 *
 * @param responseBody - The response body.
 * @returns The error.
 */
function tooManyRequests(responseBody: string): APICallError {
  return new APICallError({
    message: 'Too Many Requests',
    url: 'https://example.test/v1/chat/completions',
    requestBodyValues: {},
    statusCode: 429,
    responseBody,
    isRetryable: true,
  });
}

/**
 * How many requests a call makes when every one of them fails with the error.
 *
 * @param error - The error.
 * @returns The request count and the final error's message.
 */
async function attemptsWith(error: APICallError) {
  let attempts = 0;
  const failing = new MockLanguageModelV4({
    doGenerate: () => {
      attempts += 1;
      return Promise.reject(error);
    },
  });
  const model = wrapLanguageModel({ model: failing, middleware: quotaMiddleware });
  const failure = await generateText({ model, prompt: 'hi', maxRetries: 2 }).catch(
    (caught: unknown) => caught as Error,
  );
  return { attempts, message: failure instanceof Error ? failure.message : '' };
}

describe('a spent quota', () => {
  test('is not retried, and says what to do', async () => {
    const daily = tooManyRequests(
      '{"error":{"details":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}}',
    );
    expect(isQuotaSpent(daily)).toBe(true);
    expect(await attemptsWith(daily)).toEqual({ attempts: 1, message: quotaSpentMessage });
  });

  test('leaves a per-minute limit to the retries', async () => {
    const perMinute = tooManyRequests(
      '{"error":{"details":[{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel"}]}}',
    );
    expect(isQuotaSpent(perMinute)).toBe(false);
    const wrapGenerate = quotaMiddleware.wrapGenerate;
    const options = { doGenerate: () => Promise.reject(perMinute) };
    const call = wrapGenerate?.(
      options as unknown as Parameters<NonNullable<typeof wrapGenerate>>[0],
    );
    await expect(Promise.resolve(call)).rejects.toBe(perMinute);
  });
});
