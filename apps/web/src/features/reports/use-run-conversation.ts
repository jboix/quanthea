/**
 * The conversation a run's Ask tab shows: its questions, the answer on its way, and the question
 * just opened from a search. A new question continues the open conversation, or starts one; the
 * server makes it follow up on the conversation's latest question.
 */
import type { RunQuestion } from '@quanthea/shared';
import { useCallback, useEffect, useState } from 'react';
import { runPath, useRunConversationQuestions } from './run-ask-state.ts';
import { type LiveRunAnswer, useRunAsk } from './use-run-ask.ts';

/** How long a question opened from a search stays highlighted, in milliseconds. */
const flashMs = 1600;

/** The run asked about. */
interface RunTarget {
  /** The report. */
  readonly reportId: string;
  /** The run. */
  readonly runId: string;
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
 * Whether the answer on its way belongs to the conversation shown: it continues it, or started it.
 *
 * @param live - The answer, if any.
 * @param conversationId - The conversation shown, `undefined` for a new one.
 * @returns The answer when it belongs, else `undefined`.
 */
function liveIn(live: LiveRunAnswer | undefined, conversationId: string | undefined) {
  if (!live) return undefined;
  const started = live.conversationId === undefined && live.questionId === conversationId;
  return live.conversationId === conversationId || started ? live : undefined;
}

/**
 * The open conversation's id and questions, and what to do when an answer ends.
 *
 * @param base - The run's path.
 * @returns The conversation, its setter, its questions and the end callback.
 */
function useOpenConversation(base: string) {
  const [conversationId, setConversationId] = useState<string | undefined>();
  const loaded = useRunConversationQuestions(base, conversationId);
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
  return { conversationId, setConversationId, loaded, onEnd };
}

/**
 * The answer on its way, as the conversation shown sees it: shown while it belongs to it and is not
 * stored yet, then forgotten.
 *
 * @param target - The run.
 * @param open - The open conversation.
 * @param questions - Its stored questions.
 * @returns The answer shown, whether one is on its way, and the ask and forget functions.
 */
function useShownAnswer(
  target: RunTarget,
  open: ReturnType<typeof useOpenConversation>,
  questions: readonly RunQuestion[],
) {
  const { live, ask, clear } = useRunAsk(target, open.onEnd);
  const shownLive = liveIn(live, open.conversationId);
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
 * The open conversation about a run, and the answer on its way.
 *
 * @param target - The run.
 * @returns The conversation, the answer shown, and the actions.
 */
export function useRunConversation(target: RunTarget) {
  const base = runPath(target.reportId, target.runId);
  const open = useOpenConversation(base);
  const { questions } = open.loaded;
  const answer = useShownAnswer(target, open, questions);
  const { flash, setFlash } = useFlash(questions.map((each) => each.id).join(' '));
  const { conversationId } = open;
  const show = (next: string | undefined, questionId?: string) => {
    open.setConversationId(next);
    setFlash(questionId);
  };
  const send = (question: string) =>
    void answer.ask({ question, ...(conversationId ? { conversationId } : {}) });
  const startNew = () => {
    answer.forgetEnded();
    show(undefined);
  };
  const { live, answering } = answer;
  const shown = { base, conversationId, loaded: open.loaded, questions, live, answering, flash };
  return { ...shown, send, show, startNew };
}

/** The open conversation, as {@link useRunConversation} gives it. */
export type RunConversationState = ReturnType<typeof useRunConversation>;
