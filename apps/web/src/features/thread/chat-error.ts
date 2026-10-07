/**
 * What a failed chat request says. The chat transport puts the response's body in the error's
 * message as it came, so a refusal from quanthea arrives as `{ error: { code, message } }` JSON.
 */
import { apiErrorBodySchema } from '@quanthea/shared';

/**
 * The words of a chat error: the API's message when the error carries quanthea's error body,
 * else the error's own message.
 *
 * @param error - The chat's error, if any.
 * @returns The words, or `undefined` without an error.
 */
export function chatErrorText(error: Error | undefined): string | undefined {
  if (!error) return undefined;
  try {
    const parsed = apiErrorBodySchema.safeParse(JSON.parse(error.message));
    if (parsed.success) return parsed.data.error.message;
  } catch {
    // Not JSON: a network failure or another error, worded already.
  }
  return error.message;
}
