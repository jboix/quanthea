/**
 * The loads of a run's side panel that differ from a dashboard's: one conversation's questions,
 * the sources, and the earlier answers that look like the text being typed. Each loads through a
 * fetcher from a resource route under the run's path. The list of conversations and the bin are the
 * dashboard's own, under that path.
 */
import type { DashboardSource, RunQuestion, SimilarRunQuestion } from '@quanthea/shared';
import { useCallback, useEffect, useState } from 'react';
import { useFetcher } from 'react-router';
import type { Loaded } from '../dashboard/index.ts';
import type { OpenRunConversation } from './ask-data.ts';

/** How long typing pauses before a lookup, in milliseconds. */
const typingPauseMs = 350;

/** No questions, kept as one value so it never changes identity. */
const noQuestions: readonly RunQuestion[] = [];

/**
 * The path of a run's page, under which its side panel's resource routes are.
 *
 * @param reportId - The report.
 * @param runId - The run.
 * @returns Such as `/reports/<id>/runs/<run>`.
 */
export function runPath(reportId: string, runId: string): string {
  return `/reports/${encodeURIComponent(reportId)}/runs/${encodeURIComponent(runId)}`;
}

/**
 * One conversation's questions, in the order they were asked.
 *
 * @param base - The run's path.
 * @param conversationId - The conversation, or `undefined` for a new one.
 * @returns The questions, whether the person may bin it, the failure, and the reload function.
 */
export function useRunConversationQuestions(base: string, conversationId: string | undefined) {
  const { load, data } = useFetcher<Loaded<OpenRunConversation>>();
  const url = conversationId && `${base}/conversations/${encodeURIComponent(conversationId)}`;
  useEffect(() => {
    if (url) void load(url);
  }, [load, url]);
  const reload = useCallback(() => {
    if (url) void load(url);
  }, [load, url]);
  const current = url !== undefined && data !== undefined;
  const loadedFor = current && data.ok ? data.value.questions : noQuestions;
  // A conversation's questions all name it, so stale ones of another never show.
  const questions = loadedFor.every((each) => each.conversationId === conversationId)
    ? loadedFor
    : noQuestions;
  const failed = current && data.ok === false ? data.message : undefined;
  const canBin = questions !== noQuestions && data?.ok === true && data.value.canBin;
  return { questions, canBin, failed, reload };
}

/**
 * A run's sources, with their access levels.
 *
 * @param base - The run's path.
 * @returns The sources, once loaded.
 */
export function useRunSources(base: string): readonly DashboardSource[] | undefined {
  const { load, data } = useFetcher<Loaded<DashboardSource[]>>();
  useEffect(() => {
    void load(`${base}/sources`);
  }, [load, base]);
  return data?.ok ? data.value : undefined;
}

/**
 * The earlier answered questions about the run that share words with the text typed.
 *
 * @param base - The run's path.
 * @returns The matches, and the callback the text goes to.
 */
export function useRunSimilar(base: string) {
  const { load, data } = useFetcher<Loaded<SimilarRunQuestion[]>>();
  const [text, setText] = useState('');
  const query = text.trim();
  useEffect(() => {
    if (query.length < 3) return;
    const url = `${base}/similar-questions?q=${encodeURIComponent(query)}`;
    const timer = setTimeout(() => void load(url), typingPauseMs);
    return () => clearTimeout(timer);
  }, [base, load, query]);
  const matches = query.length >= 3 && data?.ok ? data.value : [];
  return { matches, onType: setText };
}
