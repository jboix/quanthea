/**
 * The words a failed run shows the person: the error, and the provider's own message when it gave
 * one, such as Mistral's "Service tier capacity exceeded for this model."
 */
import { APICallError, InvalidToolInputError, RetryError } from 'ai';

/**
 * The first `message` string in a parsed error body, however the provider nests it.
 *
 * @param value - The parsed body, or a part of it.
 * @param depth - How deep the search has gone.
 * @returns The message, if any.
 */
function messageIn(value: unknown, depth = 0): string | undefined {
  if (depth > 3 || typeof value !== 'object' || value === null) return undefined;
  const direct = (value as { message?: unknown }).message;
  if (typeof direct === 'string') return direct;
  for (const nested of Object.values(value)) {
    const found = messageIn(nested, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * The provider's own message behind a failed call, when its response body has one.
 *
 * @param error - What failed; after retries, the last attempt's error counts.
 * @returns The message, if any.
 */
export function providerMessage(error: unknown): string | undefined {
  const last = RetryError.isInstance(error) ? error.lastError : error;
  if (!APICallError.isInstance(last) || last.responseBody === undefined) return undefined;
  try {
    return messageIn(JSON.parse(last.responseBody))?.slice(0, 200);
  } catch {
    return undefined;
  }
}

/**
 * The words a stream error shows the person. Text passes as it is: it is a message this function
 * already wrote, which the stream hands over again when one stream is merged into another.
 *
 * @param error - What failed.
 * @returns The message.
 */
export function publicError(error: unknown): string {
  if (typeof error === 'string') return error.slice(0, 400);
  if (InvalidToolInputError.isInstance(error))
    return `The agent's ${error.toolName} call did not fit the tool's schema, so it did not run. The agent sees why and can try again.`;
  if (!(error instanceof Error)) return 'The run failed.';
  const detail = providerMessage(error);
  const said = detail && !error.message.includes(detail) ? ` The provider says: ${detail}` : '';
  return `The run failed: ${error.message.slice(0, 300)}${said}`;
}
