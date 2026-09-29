/** The bin's loader and action: the binned threads, restoring one, and deleting for good. */
import {
  type BinnedThread,
  emptyBinEndpoint,
  listBinEndpoint,
  purgeThreadEndpoint,
  restoreThreadEndpoint,
  saveRetentionSettingsEndpoint,
} from '@querent/shared';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';

/** What the bin screen shows. */
export interface BinData {
  /** The threads in the bin, the most recently binned first. */
  readonly threads: readonly BinnedThread[];
  /** How many days a thread stays in the bin; `null` until someone deletes it. */
  readonly binDays: number | null;
  /** For admins: the configuration file that sets the retention, when one does. */
  readonly retentionManagedBy?: string | undefined;
}

/** What the bin screen submits, as JSON. */
export type BinIntent =
  | { readonly intent: 'restore' | 'purge'; readonly threadId: string }
  | { readonly intent: 'empty' }
  | { readonly intent: 'retention'; readonly binDays: number | null };

/** The outcome of an intent: done, or why not. */
export type BinOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

/**
 * The loader of the bin screen.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadBin(api: ApiClient) {
  return async ({ request }: LoaderFunctionArgs): Promise<BinData> =>
    api.call(listBinEndpoint, undefined, { signal: request.signal });
}

/**
 * Runs one intent.
 *
 * @param api - The API client.
 * @param intent - The intent.
 * @returns When it is done.
 */
async function run(api: ApiClient, intent: BinIntent): Promise<void> {
  if (intent.intent === 'empty') {
    await api.call(emptyBinEndpoint);
    return;
  }
  if (intent.intent === 'retention') {
    await api.call(saveRetentionSettingsEndpoint, { body: { binDays: intent.binDays } });
    return;
  }
  const params = { threadId: intent.threadId };
  if (intent.intent === 'restore') await api.call(restoreThreadEndpoint, { params });
  else await api.call(purgeThreadEndpoint, { params });
}

/**
 * The action of the bin screen: restore a thread, delete one for good, or empty the bin.
 *
 * @param api - The API client.
 * @returns The action. A refusal comes back as a message.
 */
export function changeBin(api: ApiClient) {
  return async ({ request }: ActionFunctionArgs): Promise<BinOutcome> => {
    try {
      await run(api, (await request.json()) as BinIntent);
      return { ok: true };
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      return { ok: false, message: error.message };
    }
  };
}
