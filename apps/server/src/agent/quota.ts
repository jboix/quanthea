/**
 * Stops retrying when a provider says a quota is spent for the day. The AI SDK retries every 429,
 * which suits a per-minute limit but only burns requests against a daily one, so this middleware
 * turns a spent daily quota into an error that is not retried and says what to do.
 */
import { APICallError, type LanguageModelMiddleware } from 'ai';

/** What a provider's 429 says when the quota is spent for the day, or for good. */
const spentQuota = /per ?day|daily|insufficient_quota/i;

/** The words a spent quota shows the person. */
export const quotaSpentMessage =
  "The provider says this model's quota is used up for today. Try again later, or pick another model in Settings → Model.";

/**
 * Whether an error is a 429 for a quota that waiting a minute will not restore.
 *
 * @param error - The error.
 * @returns Whether the quota is spent for the day.
 */
export function isQuotaSpent(error: unknown): error is APICallError {
  if (!APICallError.isInstance(error) || error.statusCode !== 429) return false;
  return spentQuota.test(`${error.responseBody ?? ''} ${error.message}`);
}

/**
 * The error to rethrow: a spent quota becomes one that is not retried; anything else is kept.
 *
 * @param error - What the provider call threw.
 * @returns The error.
 */
function notRetriedWhenSpent(error: unknown): unknown {
  if (!isQuotaSpent(error)) return error;
  return new APICallError({
    message: quotaSpentMessage,
    url: error.url,
    requestBodyValues: error.requestBodyValues,
    statusCode: 429,
    ...(error.responseBody === undefined ? {} : { responseBody: error.responseBody }),
    cause: error,
    isRetryable: false,
  });
}

/** The middleware every model is wrapped in. */
export const quotaMiddleware: LanguageModelMiddleware = {
  specificationVersion: 'v4',
  wrapGenerate: async ({ doGenerate }) => {
    try {
      return await doGenerate();
    } catch (error) {
      throw notRetriedWhenSpent(error);
    }
  },
  wrapStream: async ({ doStream }) => {
    try {
      return await doStream();
    } catch (error) {
      throw notRetriedWhenSpent(error);
    }
  },
};
