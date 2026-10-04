/**
 * The state of the side panel's loads: a dashboard's conversations, found by words or not, one
 * conversation's questions, a version's sources, and the earlier answers that look like the text
 * being typed. Each loads through a fetcher from a resource route.
 */
import {
  type Conversation,
  type DashboardQuestion,
  type DashboardSource,
  hasRole,
  type Role,
  type SimilarQuestion,
} from '@quanthea/shared';
import { useCallback, useEffect, useState } from 'react';
import { useFetcher, useRouteLoaderData } from 'react-router';
import type { Loaded } from './loaded.ts';

/** How long typing pauses before the earlier answers are looked up, in milliseconds. */
const typingPauseMs = 350;

/** No questions, kept as one value so it never changes identity. */
const noQuestions: readonly DashboardQuestion[] = [];

/** No conversations, kept as one value so it never changes identity. */
const noConversations: readonly Conversation[] = [];

/**
 * Whether the person may ask: analysts and above, from the session the root route loads.
 *
 * @returns Whether they may.
 */
export function useCanAsk(): boolean {
  const session = useRouteLoaderData('root') as { principal: { role: Role } } | undefined;
  return session !== undefined && hasRole(session.principal.role, 'analyst');
}

/**
 * The browser's time zone.
 *
 * @returns An IANA time zone.
 */
export function browserTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * A dashboard's conversations, the latest activity first, or those whose questions and answers
 * hold the words searched, looked up once typing pauses.
 *
 * @param dashboardId - The dashboard.
 * @param search - The words searched, empty for every conversation.
 * @returns The conversations, whether they failed to load or are loading, and the reload function.
 */
export function useConversations(dashboardId: string, search: string) {
  const fetcher = useFetcher<Loaded<Conversation[]>>();
  const { load, data, state } = fetcher;
  const query = search.trim();
  const url = `/d/${dashboardId}/conversations${query === '' ? '' : `?q=${encodeURIComponent(query)}`}`;
  useEffect(() => {
    const timer = setTimeout(() => void load(url), query === '' ? 0 : typingPauseMs);
    return () => clearTimeout(timer);
  }, [load, url, query]);
  const reload = useCallback(() => void load(url), [load, url]);
  const conversations = data?.ok ? data.value : noConversations;
  const failed = data?.ok === false ? data.message : undefined;
  return { conversations, failed, loading: state !== 'idle' || data === undefined, reload };
}

/**
 * One conversation's questions, in the order they were asked, and a way to load them again.
 *
 * @param dashboardId - The dashboard.
 * @param conversationId - The conversation, or `undefined` for a new one, which has none.
 * @returns The questions, whether they failed to load, and the reload function.
 */
export function useConversationQuestions(dashboardId: string, conversationId: string | undefined) {
  const fetcher = useFetcher<Loaded<DashboardQuestion[]>>();
  const { load, data } = fetcher;
  const url =
    conversationId && `/d/${dashboardId}/conversations/${encodeURIComponent(conversationId)}`;
  useEffect(() => {
    if (url) void load(url);
  }, [load, url]);
  const reload = useCallback(() => {
    if (url) void load(url);
  }, [load, url]);
  const current = url !== undefined && data !== undefined;
  const loadedFor = current && data.ok ? data.value : noQuestions;
  // A conversation's questions all name it, so stale ones of another conversation never show.
  const questions = loadedFor.every((each) => each.conversationId === conversationId)
    ? loadedFor
    : noQuestions;
  const failed = current && data.ok === false ? data.message : undefined;
  return { questions, failed, reload };
}

/**
 * The sources of a version, with their access levels.
 *
 * @param dashboardId - The dashboard.
 * @param version - The version.
 * @returns The sources, once loaded.
 */
export function useSources(dashboardId: string, version: number) {
  const fetcher = useFetcher<Loaded<DashboardSource[]>>();
  const { load, data } = fetcher;
  const url = `/d/${dashboardId}/v/${version}/sources`;
  useEffect(() => {
    void load(url);
  }, [load, url]);
  return data?.ok ? data.value : undefined;
}

/**
 * The earlier answered questions that share words with the text typed, looked up once typing
 * pauses.
 *
 * @param dashboardId - The dashboard.
 * @returns The matches, and the callback the text goes to.
 */
export function useSimilar(dashboardId: string) {
  const fetcher = useFetcher<Loaded<SimilarQuestion[]>>();
  const { load, data } = fetcher;
  const [text, setText] = useState('');
  const query = text.trim();
  useEffect(() => {
    if (query.length < 3) return;
    const url = `/d/${dashboardId}/similar-questions?q=${encodeURIComponent(query)}`;
    const timer = setTimeout(() => void load(url), typingPauseMs);
    return () => clearTimeout(timer);
  }, [dashboardId, load, query]);
  const matches = query.length >= 3 && data?.ok ? data.value : [];
  return { matches, onType: setText };
}
