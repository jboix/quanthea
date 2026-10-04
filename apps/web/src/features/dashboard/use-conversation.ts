/**
 * The conversation the Ask tab shows: its questions, the answer on its way, the answer that marks
 * the charts, and the question just opened from a search. A new question continues the open
 * conversation, or starts one; the server makes it follow up on the conversation's latest question.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import {
  askedContextOf,
  contextChange,
  drivingAnswer,
  shownContextOf,
} from './ask-conversation.ts';
import type { OpenAnswer } from './ask-marks.ts';
import { browserTimeZone, useConversationQuestions } from './ask-state.ts';
import { contextLabel } from './ask-words.ts';
import type { DashboardData } from './data.ts';
import { hiddenMarkersOf } from './marker-sets.ts';
import { type AskBody, type LiveAnswer, useAsk } from './use-ask.ts';
import { choicesFromSearch } from './view-state.ts';

/** How long a question opened from a search stays highlighted, in milliseconds. */
const flashMs = 1600;

/**
 * What a question is asked about: the version, the range, the variables and the hidden sets of
 * markers in the address, as the request, the question box's label and the context.
 *
 * @param version - The version shown.
 * @returns The request body of a question, the label, the time zone and the context.
 */
function useShown(version: DashboardData['version']) {
  const [search] = useSearchParams();
  const { spec } = version;
  const choices = choicesFromSearch(search, spec);
  const timeZone = spec.timezone ?? browserTimeZone();
  const body = (question: string, conversationId: string | undefined): AskBody => ({
    version: version.version,
    question,
    variables: choices.variables,
    ...(choices.time ? { time: choices.time } : {}),
    hiddenMarkers: [...hiddenMarkersOf(search, spec)],
    timeZone: browserTimeZone(),
    ...(conversationId ? { conversationId } : {}),
  });
  const view = { spec, ...choices, timeZone, now: Date.now() };
  const context = shownContextOf({ ...view, version: version.version });
  return { body, label: contextLabel(view), timeZone, context };
}

/**
 * The question just opened from a search: it scrolls into view once shown, and stays highlighted
 * for a moment.
 *
 * @param shownIds - The ids of the questions shown, so it scrolls once its question is there.
 * @returns The highlighted question, and the function that highlights one.
 */
function useFlash(shownIds: string) {
  const [flash, setFlash] = useState<string | undefined>();
  useEffect(() => {
    if (flash === undefined || !shownIds.includes(flash)) return;
    document.getElementById(`question-${flash}`)?.scrollIntoView({ block: 'center' });
    const timer = setTimeout(() => setFlash(undefined), flashMs);
    return () => clearTimeout(timer);
  }, [flash, shownIds]);
  return { flash, setFlash };
}

/**
 * Whether the answer on its way belongs to the conversation shown: it continues it, or it started
 * it.
 *
 * @param live - The answer, if any.
 * @param conversationId - The conversation shown, `undefined` for a new one.
 * @returns The answer when it belongs, else `undefined`.
 */
function liveIn(live: LiveAnswer | undefined, conversationId: string | undefined) {
  if (!live) return undefined;
  const started = live.conversationId === undefined && live.questionId === conversationId;
  return live.conversationId === conversationId || started ? live : undefined;
}

/**
 * The answer on its way, as the conversation shown sees it: shown while it belongs to it and is
 * not stored yet, then forgotten.
 *
 * @param dashboardId - The dashboard.
 * @param onEnd - Called when an answer ends, with the stored question and the conversation.
 * @param conversationId - The conversation shown.
 * @param questions - Its stored questions.
 * @returns The answer shown, whether one is on its way, and the ask and forget functions.
 */
function useConversationAnswer(
  dashboardId: string,
  onEnd: (questionId: string | null, conversationId: string | undefined) => void,
  conversationId: string | undefined,
  questions: readonly { readonly id: string }[],
) {
  const { live, ask, clear } = useAsk(dashboardId, onEnd);
  const shownLive = liveIn(live, conversationId);
  const stored = questions.some((each) => each.id === shownLive?.questionId);
  useEffect(() => {
    if (shownLive && !shownLive.answering && stored) clear();
  }, [shownLive, stored, clear]);
  const answering = live?.answering ?? false;
  const forgetEnded = () => {
    if (!answering) clear();
  };
  return { live: stored ? undefined : shownLive, answering, ask, forgetEnded };
}

/**
 * The open conversation, and the answer on its way.
 *
 * @param dashboardId - The dashboard.
 * @returns The conversation's id and questions, the answer shown and whether one is on its way,
 *   and the functions that ask, switch and forget an answer that ended.
 */
function useOpenConversation(dashboardId: string) {
  const [conversationId, setConversationId] = useState<string | undefined>();
  const loaded = useConversationQuestions(dashboardId, conversationId);
  const { reload } = loaded;
  const onEnd = useCallback(
    (questionId: string | null, continued: string | undefined) => {
      // A first question names its conversation: open it, unless another one was opened since.
      if (continued === undefined && questionId)
        setConversationId((current) => current ?? questionId);
      else reload();
    },
    [reload],
  );
  const answer = useConversationAnswer(dashboardId, onEnd, conversationId, loaded.questions);
  return { conversationId, setConversationId, loaded, ...answer };
}

/**
 * The Ask tab's conversation.
 *
 * @param data - The dashboard and the version shown.
 * @returns The conversation, what is shown, the answer that marks the charts, and the actions.
 */
export function useConversation({ dashboard, version }: DashboardData) {
  const open = useOpenConversation(dashboard.id);
  const { questions } = open.loaded;
  const shown = useShown(version);
  const [picked, setPicked] = useState<string | undefined>();
  const { flash, setFlash } = useFlash(questions.map((each) => each.id).join(' '));
  const last = questions.at(-1);
  const note = contextChange(last && askedContextOf(last), shown.context);
  const marks = useDrivingAnswer(questions, picked, open.live, version.version);
  const send = (question: string) => {
    setPicked(undefined);
    void open.ask(shown.body(question, open.conversationId), note);
  };
  const show = (conversationId: string | undefined, questionId?: string) => {
    open.setConversationId(conversationId);
    setPicked(questionId);
    setFlash(questionId);
  };
  const startNew = () => {
    open.forgetEnded();
    show(undefined);
  };
  return { ...open, questions, shown, note, picked, setPicked, flash, marks, send, show, startNew };
}

/**
 * The answer that marks the charts, kept the same object while it stays the same.
 *
 * @param questions - The conversation's questions.
 * @param picked - The question whose answer was picked.
 * @param live - The answer on its way in this conversation.
 * @param shownVersion - The version shown.
 * @returns The answer, its version and its question, or `undefined`.
 */
function useDrivingAnswer(
  questions: ReturnType<typeof useConversationQuestions>['questions'],
  picked: string | undefined,
  live: LiveAnswer | undefined,
  shownVersion: number,
): (OpenAnswer & { readonly questionId: string | undefined }) | undefined {
  const outcome = live?.outcome;
  return useMemo(
    () => drivingAnswer(questions, picked, { outcome }, shownVersion),
    [questions, picked, outcome, shownVersion],
  );
}
