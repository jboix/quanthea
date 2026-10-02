/** The outcome of a call a fetcher or an action makes: the data, or why it failed. */
import { ApiError } from '../../lib/api-client.ts';

/** The outcome of a load a fetcher makes: the data, or why it failed. */
export type Loaded<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly message: string };

/**
 * Awaits a call a fetcher made, keeping any API error as a message.
 *
 * @param call - The pending call.
 * @returns The value, or the message.
 * @throws {unknown} Anything that is not an API error.
 */
export async function loaded<Value>(call: Promise<Value>): Promise<Loaded<Value>> {
  try {
    return { ok: true, value: await call };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return { ok: false, message: error.message };
  }
}
