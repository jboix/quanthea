/**
 * The loaders of the side panel's resource routes: a dashboard's conversations, found by words or
 * not, one conversation's questions, the earlier questions that share words with a text, and the
 * sources of a version with their access levels. Each loads through a fetcher, so the panel loads
 * and fails on its own. One action moves a conversation to the bin.
 */
import {
  binConversationEndpoint,
  type Conversation,
  type DashboardQuestion,
  type DashboardSource,
  dashboardSourcesEndpoint,
  getConversationEndpoint,
  listConversationsEndpoint,
  type SimilarQuestion,
  similarQuestionsEndpoint,
} from '@quanthea/shared';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import type { ApiClient } from '../../lib/api-client.ts';
import { type Loaded, loaded } from './loaded.ts';

/**
 * The loader of a dashboard's conversations, the latest activity first, or those whose questions
 * and answers hold the words in `?q=`.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadConversations(api: ApiClient) {
  return async ({ params, request }: LoaderFunctionArgs): Promise<Loaded<Conversation[]>> => {
    const q = new URL(request.url).searchParams.get('q') ?? '';
    const input = { params: { dashboardId: params.dashboardId ?? '' }, query: { q } };
    const call = api.call(listConversationsEndpoint, input, { signal: request.signal });
    const result = await loaded(call);
    return result.ok ? { ok: true, value: result.value.conversations } : result;
  };
}

/** One conversation as the Ask tab shows it. */
export interface OpenConversation {
  /** Its questions, in the order they were asked. */
  readonly questions: DashboardQuestion[];
  /** Whether the person may move it to the bin. */
  readonly canBin: boolean;
}

/**
 * The ids of a conversation, from the route's parameters.
 *
 * @param params - The route's parameters.
 * @returns The dashboard and the conversation.
 */
function conversationIds(params: LoaderFunctionArgs['params']) {
  return { dashboardId: params.dashboardId ?? '', conversationId: params.conversationId ?? '' };
}

/**
 * The loader of one conversation's questions, in the order they were asked.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadConversation(api: ApiClient) {
  return async ({ params, request }: LoaderFunctionArgs): Promise<Loaded<OpenConversation>> => {
    const input = { params: conversationIds(params) };
    const call = api.call(getConversationEndpoint, input, { signal: request.signal });
    const result = await loaded(call);
    if (!result.ok) return result;
    return { ok: true, value: { questions: result.value.questions, canBin: result.value.canBin } };
  };
}

/**
 * The action that moves a conversation to the bin.
 *
 * @param api - The API client.
 * @returns The action. A refusal comes back as a message.
 */
export function binConversation(api: ApiClient) {
  return async ({ params }: ActionFunctionArgs): Promise<Loaded<{ binned: true }>> =>
    loaded(api.call(binConversationEndpoint, { params: conversationIds(params) }));
}

/**
 * The loader of the earlier questions that share words with the text in `?q=`.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadSimilarQuestions(api: ApiClient) {
  return async ({ params, request }: LoaderFunctionArgs): Promise<Loaded<SimilarQuestion[]>> => {
    const q = new URL(request.url).searchParams.get('q') ?? '';
    const input = { params: { dashboardId: params.dashboardId ?? '' }, query: { q } };
    const result = await loaded(
      api.call(similarQuestionsEndpoint, input, { signal: request.signal }),
    );
    return result.ok ? { ok: true, value: result.value.questions } : result;
  };
}

/**
 * The loader of a version's sources, by name and access level.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadSources(api: ApiClient) {
  return async ({ params, request }: LoaderFunctionArgs): Promise<Loaded<DashboardSource[]>> => {
    const input = {
      params: { dashboardId: params.dashboardId ?? '', version: params.version ?? '' },
    };
    const result = await loaded(
      api.call(dashboardSourcesEndpoint, input, { signal: request.signal }),
    );
    return result.ok ? { ok: true, value: result.value.sources } : result;
  };
}
