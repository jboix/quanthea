/**
 * The new-thread screen's data and action: the past threads and the providers, starting a thread
 * and handing the first question over, and moving past threads to the bin.
 */
import {
  binDraftsEndpoint,
  createThreadEndpoint,
  deleteThreadEndpoint,
  listProviderChoicesEndpoint,
  listQueryChoicesEndpoint,
  listThreadsEndpoint,
  type ProviderChoice,
  type QueryChoice,
  type ThreadKind,
  type ThreadListItem,
  type ThreadQueries,
} from '@quanthea/shared';
import { type ActionFunctionArgs, type LoaderFunctionArgs, redirect } from 'react-router';
import { type ApiClient, ApiError } from '../../lib/api-client.ts';
import type { ThreadOutcome } from './data.ts';

/** What the new-thread screen shows: the past threads, and the providers a thread may use. */
export interface NewThreadData {
  /** Every past thread, the latest first, each marked when its dashboard is pinned. */
  readonly threads: readonly ThreadListItem[];
  /** The providers a thread may use. */
  readonly providers: readonly ProviderChoice[];
  /** The default provider. */
  readonly defaultProviderId: string;
  /** The query builders and saved queries a thread may use. */
  readonly queries: readonly QueryChoice[];
}

/**
 * The loader of the new-thread screen: the past threads and the providers.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadRecentThreads(api: ApiClient) {
  return async ({ request }: LoaderFunctionArgs): Promise<NewThreadData> => {
    const options = { signal: request.signal };
    const [threads, choices, { queries }] = await Promise.all([
      // Admins get everyone's threads, the drawer shows their own first; others get their own.
      api.call(listThreadsEndpoint, { query: { scope: 'everyone' } }, options),
      api.call(listProviderChoicesEndpoint, undefined, options),
      api.call(listQueryChoicesEndpoint, undefined, options),
    ]);
    return { threads, ...choices, queries };
  };
}

/** What the new-thread screen submits, as JSON: a first question, or a past thread to delete. */
export type NewThreadIntent =
  | {
      readonly intent: 'start';
      readonly question: string;
      readonly providerId?: string;
      readonly queries?: ThreadQueries;
      readonly kind?: ThreadKind;
    }
  | { readonly intent: 'delete'; readonly threadId: string }
  | { readonly intent: 'binDrafts' };

/**
 * Moves a past thread to the bin, or every draft of the person.
 *
 * @param api - The API client.
 * @param threadId - The thread, or `null` for every draft.
 * @returns Done, or why not, such as a pinned dashboard.
 */
async function binThread(api: ApiClient, threadId: string | null): Promise<ThreadOutcome> {
  try {
    if (threadId === null) await api.call(binDraftsEndpoint);
    else await api.call(deleteThreadEndpoint, { params: { threadId } });
    return { ok: true };
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    return { ok: false, message: error.message };
  }
}

/**
 * What a delete intent moves to the bin.
 *
 * @param intent - One past thread, or every draft.
 * @returns The thread, or `null` for every draft.
 */
function binTarget(intent: Exclude<NewThreadIntent, { readonly intent: 'start' }>): string | null {
  return intent.intent === 'delete' ? intent.threadId : null;
}

/**
 * The action of the new-thread screen: starts a thread and hands the first question over, or
 * moves a past thread, or every draft of the person, to the bin.
 *
 * @param api - The API client.
 * @returns The action. Starting redirects to the thread, which sends the question.
 */
export function newThreadAction(api: ApiClient) {
  return async ({ request }: ActionFunctionArgs): Promise<Response | ThreadOutcome> => {
    const intent = (await request.json()) as NewThreadIntent;
    if (intent.intent !== 'start') return binThread(api, binTarget(intent));
    const { providerId, queries, kind } = intent;
    const body = {
      ...(providerId === undefined ? {} : { providerId }),
      ...(queries === undefined ? {} : { queries }),
      ...(kind === undefined ? {} : { kind }),
    };
    const thread = await api.call(createThreadEndpoint, { body });
    return redirect(`/threads/${thread.id}?ask=${encodeURIComponent(intent.question)}`);
  };
}
