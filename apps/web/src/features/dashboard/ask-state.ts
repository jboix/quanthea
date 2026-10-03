/**
 * The state of the Ask tab: the dashboard's questions, its sources, the earlier answers that look
 * like the text being typed, and which question is open. Each loads through a fetcher from a
 * resource route.
 */
import {
  type DashboardQuestion,
  type DashboardSource,
  hasRole,
  type Role,
  type SimilarQuestion,
} from '@quanthea/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFetcher, useRouteLoaderData } from 'react-router';
import type { OpenAnswer } from './ask-marks.ts';
import type { Loaded } from './loaded.ts';
import type { LiveAnswer } from './use-ask.ts';

/** How long typing pauses before the earlier answers are looked up, in milliseconds. */
const typingPauseMs = 350;

/** How long a question opened from a search stays highlighted, in milliseconds. */
const flashMs = 1600;

/** No questions, kept as one value so it never changes identity. */
const noQuestions: readonly DashboardQuestion[] = [];

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
 * A dashboard's questions, loaded when the tab opens, and a way to load them again.
 *
 * @param dashboardId - The dashboard.
 * @returns The questions, whether they failed to load, and the reload function.
 */
export function useQuestions(dashboardId: string) {
  const fetcher = useFetcher<Loaded<DashboardQuestion[]>>({ key: `questions-${dashboardId}` });
  const { load, data } = fetcher;
  const url = `/d/${dashboardId}/questions`;
  useEffect(() => {
    void load(url);
  }, [load, url]);
  const reload = useCallback(() => void load(url), [load, url]);
  const questions = data?.ok ? data.value : noQuestions;
  return { questions, failed: data?.ok === false ? data.message : undefined, reload };
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

/**
 * Which question is open, and which one was just opened from a search: it scrolls into view and
 * stays highlighted for a moment.
 *
 * @returns The open question, the highlighted one, and the toggle and open callbacks.
 */
export function useOpenQuestion() {
  const [expanded, setExpanded] = useState<string | undefined>();
  const [flash, setFlash] = useState<string | undefined>();
  useEffect(() => {
    if (flash === undefined) return;
    document.getElementById(`question-${flash}`)?.scrollIntoView({ block: 'nearest' });
    const timer = setTimeout(() => setFlash(undefined), flashMs);
    return () => clearTimeout(timer);
  }, [flash]);
  const toggle = useCallback(
    (questionId: string) => setExpanded((open) => (open === questionId ? undefined : questionId)),
    [],
  );
  const open = useCallback((questionId: string) => {
    setExpanded(questionId);
    setFlash(questionId);
  }, []);
  return { expanded, flash, toggle, open, setExpanded };
}

/**
 * The answer the dashboard marks: the one just answered, else the open question's.
 *
 * @param live - The answer on its way or just ended.
 * @param questions - The stored questions.
 * @param expanded - The open question.
 * @param version - The version shown, which a live answer is about.
 * @returns The answer and its version, or `undefined`.
 */
export function useOpenAnswer(
  live: LiveAnswer | undefined,
  questions: readonly DashboardQuestion[],
  expanded: string | undefined,
  version: number,
): OpenAnswer | undefined {
  const liveOutcome = live?.outcome;
  return useMemo(() => {
    if (liveOutcome?.ok) return { version, answer: liveOutcome.answer };
    const question = questions.find((each) => each.id === expanded);
    if (!question?.outcome.ok) return undefined;
    return { version: question.version, answer: question.outcome.answer };
  }, [liveOutcome, questions, expanded, version]);
}
