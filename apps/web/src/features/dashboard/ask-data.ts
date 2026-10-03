/**
 * The loaders of the Ask tab's resource routes: a dashboard's questions, one question by id, the
 * earlier ones that share words with a text, and the sources of a version with their access levels. Each loads
 * through a fetcher, so the tab loads and fails on its own.
 */
import {
  type DashboardQuestion,
  type DashboardSource,
  dashboardSourcesEndpoint,
  getQuestionEndpoint,
  listQuestionsEndpoint,
  type SimilarQuestion,
  similarQuestionsEndpoint,
} from '@quanthea/shared';
import type { LoaderFunctionArgs } from 'react-router';
import type { ApiClient } from '../../lib/api-client.ts';
import { type Loaded, loaded } from './loaded.ts';

/**
 * The loader of a dashboard's questions, the newest first.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadQuestions(api: ApiClient) {
  return async ({ params, request }: LoaderFunctionArgs): Promise<Loaded<DashboardQuestion[]>> => {
    const input = { params: { dashboardId: params.dashboardId ?? '' } };
    const result = await loaded(api.call(listQuestionsEndpoint, input, { signal: request.signal }));
    return result.ok ? { ok: true, value: result.value.questions } : result;
  };
}

/**
 * The loader of one question by id, for one older than the questions listed.
 *
 * @param api - The API client.
 * @returns The loader.
 */
export function loadQuestion(api: ApiClient) {
  return ({ params, request }: LoaderFunctionArgs): Promise<Loaded<DashboardQuestion>> => {
    const ids = { dashboardId: params.dashboardId ?? '', questionId: params.questionId ?? '' };
    return loaded(api.call(getQuestionEndpoint, { params: ids }, { signal: request.signal }));
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
