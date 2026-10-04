/**
 * The bin's loader and action: the binned threads and conversations, restoring one, and deleting
 * for good. Analysts see only conversations: they have no threads.
 */
import {
  type BinnedConversation,
  type BinnedThread,
  emptyBinEndpoint,
  hasRole,
  listBinEndpoint,
  listBinnedConversationsEndpoint,
  purgeConversationEndpoint,
  purgeThreadEndpoint,
  type Role,
  restoreConversationEndpoint,
  restoreThreadEndpoint,
  saveRetentionSettingsEndpoint,
} from '@quanthea/shared';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';

/** What the bin screen shows. */
export interface BinData {
  /** The threads in the bin, the most recently binned first. */
  readonly threads: readonly BinnedThread[];
  /** The conversations about dashboards in the bin, the most recently binned first. */
  readonly conversations: readonly BinnedConversation[];
  /** How many days a thread stays in the bin; `null` until someone deletes it. */
  readonly binDays: number | null;
  /** For admins: the configuration file that sets the retention, when one does. */
  readonly retentionManagedBy?: string | undefined;
}

/** What the bin screen submits, as JSON. */
export type BinIntent =
  | { readonly intent: 'restore' | 'purge'; readonly threadId: string }
  | {
      readonly intent: 'restore-conversation' | 'purge-conversation';
      readonly conversationId: string;
    }
  | { readonly intent: 'empty' }
  | { readonly intent: 'retention'; readonly binDays: number | null };

/** The outcome of an intent: done, or why not. */
export type BinOutcome = { readonly ok: true } | { readonly ok: false; readonly message: string };

/**
 * The loader of the bin screen: the binned threads for editors and admins, and the binned
 * conversations.
 *
 * @param api - The API client.
 * @param roleOf - The signed-in person's role, `null` without a session.
 * @returns The loader.
 */
export function loadBin(api: ApiClient, roleOf: () => Promise<Role | null>) {
  return async ({ request }: LoaderFunctionArgs): Promise<BinData> => {
    const role = await roleOf();
    const editor = role !== null && hasRole(role, 'editor');
    const options = { signal: request.signal };
    const [threads, binned] = await Promise.all([
      editor ? api.call(listBinEndpoint, undefined, options) : undefined,
      api.call(listBinnedConversationsEndpoint, undefined, options),
    ]);
    return { threads: [], ...binned, ...threads };
  };
}

/**
 * Runs an intent on a binned conversation.
 *
 * @param api - The API client.
 * @param intent - Restore it, or delete it for good.
 * @returns When it is done.
 */
async function runConversation(
  api: ApiClient,
  intent: Extract<BinIntent, { conversationId: string }>,
): Promise<void> {
  const params = { conversationId: intent.conversationId };
  if (intent.intent === 'restore-conversation')
    await api.call(restoreConversationEndpoint, { params });
  else await api.call(purgeConversationEndpoint, { params });
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
  if ('conversationId' in intent) {
    await runConversation(api, intent);
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
