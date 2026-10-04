/**
 * The loaders of a run's side panel: its conversations, found by words or not, one
 * conversation's questions, the earlier questions that share words with a text, and the sources
 * with their access levels. Each loads through a fetcher from a resource route, so the panel loads
 * and fails on its own. One action moves a conversation to the bin.
 */
import {
  binRunConversationEndpoint,
  type Conversation,
  type DashboardSource,
  getRunConversationEndpoint,
  listRunConversationsEndpoint,
  type RunQuestion,
  runSourcesEndpoint,
  type SimilarRunQuestion,
  similarRunQuestionsEndpoint,
} from '@quanthea/shared';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import type { ApiClient } from '../../lib/api-client.ts';
import { type Loaded, loaded } from '../dashboard/index.ts';

/** One conversation about a run as the Ask tab shows it. */
export interface OpenRunConversation {
  /** Its questions, in the order they were asked. */
  readonly questions: RunQuestion[];
  /** Whether the person may move it to the bin. */
  readonly canBin: boolean;
}

/**
 * The run of a resource route, from its parameters.
 *
 * @param params - The route's parameters.
 * @returns The report and the run.
 */
function runOf(params: LoaderFunctionArgs['params']) {
  return { reportId: params.reportId ?? '', runId: params.runId ?? '' };
}

/**
 * The words searched, from `?q=`.
 *
 * @param request - The request.
 * @returns The words, empty for none.
 */
function searched(request: Request): string {
  return new URL(request.url).searchParams.get('q') ?? '';
}

/**
 * The loader of a run's conversations, the latest activity first, or those a search finds.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadRunConversations(api: ApiClient) {
  return async ({ params, request }: LoaderFunctionArgs): Promise<Loaded<Conversation[]>> => {
    const input = { params: runOf(params), query: { q: searched(request) } };
    const result = await loaded(
      api.call(listRunConversationsEndpoint, input, { signal: request.signal }),
    );
    return result.ok ? { ok: true, value: result.value.conversations } : result;
  };
}

/**
 * The loader of one conversation's questions, in the order they were asked.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadRunConversation(api: ApiClient) {
  return async ({ params, request }: LoaderFunctionArgs): Promise<Loaded<OpenRunConversation>> => {
    const input = { params: { ...runOf(params), conversationId: params.conversationId ?? '' } };
    const result = await loaded(
      api.call(getRunConversationEndpoint, input, { signal: request.signal }),
    );
    if (!result.ok) return result;
    return { ok: true, value: { questions: result.value.questions, canBin: result.value.canBin } };
  };
}

/**
 * The action that moves a conversation about a run to the bin.
 *
 * @param api - The API client.
 * @returns The action. A refusal comes back as a message.
 */
export function binRunConversation(api: ApiClient) {
  return async ({ params }: ActionFunctionArgs): Promise<Loaded<{ binned: true }>> => {
    const input = { params: { ...runOf(params), conversationId: params.conversationId ?? '' } };
    return loaded(api.call(binRunConversationEndpoint, input));
  };
}

/**
 * The loader of the earlier questions about the run that share words with `?q=`.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadSimilarRunQuestions(api: ApiClient) {
  return async ({ params, request }: LoaderFunctionArgs): Promise<Loaded<SimilarRunQuestion[]>> => {
    const input = { params: runOf(params), query: { q: searched(request) } };
    const result = await loaded(
      api.call(similarRunQuestionsEndpoint, input, { signal: request.signal }),
    );
    return result.ok ? { ok: true, value: result.value.questions } : result;
  };
}

/**
 * The loader of a run's sources, by name and access level.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadRunSources(api: ApiClient) {
  return async ({ params, request }: LoaderFunctionArgs): Promise<Loaded<DashboardSource[]>> => {
    const input = { params: runOf(params) };
    const result = await loaded(api.call(runSourcesEndpoint, input, { signal: request.signal }));
    return result.ok ? { ok: true, value: result.value.sources } : result;
  };
}
