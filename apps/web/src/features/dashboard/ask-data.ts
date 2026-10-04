/**
 * The loaders of the side panel's resource routes: a dashboard's conversations, found by words or
 * not, one conversation's questions, the earlier questions that share words with a text, and the
 * sources of a version with their access levels. Each loads through a fetcher, so the panel loads
 * and fails on its own.
 */
import {
  type Conversation,
  type DashboardQuestion,
  type DashboardSource,
  dashboardSourcesEndpoint,
  getConversationEndpoint,
  listConversationsEndpoint,
  type SimilarQuestion,
  similarQuestionsEndpoint,
} from '@quanthea/shared';
import type { LoaderFunctionArgs } from 'react-router';
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

/**
 * The loader of one conversation's questions, in the order they were asked.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadConversation(api: ApiClient) {
  return async ({ params, request }: LoaderFunctionArgs): Promise<Loaded<DashboardQuestion[]>> => {
    const ids = {
      dashboardId: params.dashboardId ?? '',
      conversationId: params.conversationId ?? '',
    };
    const call = api.call(getConversationEndpoint, { params: ids }, { signal: request.signal });
    const result = await loaded(call);
    return result.ok ? { ok: true, value: result.value.questions } : result;
  };
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
