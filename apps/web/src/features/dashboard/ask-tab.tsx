/**
 * The Ask tab of a pinned dashboard: the questions asked about it and their answers, the newest
 * first with their follow-ups under them, and, for analysts and above, the question box. A
 * question is asked about the dashboard as it is shown: its range, its variables and its version.
 */
import type { DashboardQuestion } from '@quanthea/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import styles from './ask.module.css';
import { AskForm, ExplainOnlyCard, QuestionSearch, SimilarQuestions } from './ask-form.tsx';
import { type OpenAnswer, questionThreads } from './ask-marks.ts';
import { LiveAnswerCard, QuestionCard } from './ask-question.tsx';
import {
  browserTimeZone,
  useCanAsk,
  useOpenAnswer,
  useOpenQuestion,
  useQuestions,
  useSimilar,
  useSources,
} from './ask-state.ts';
import { contextLabel } from './ask-words.ts';
import type { DashboardData } from './data.ts';
import { hiddenMarkersOf } from './marker-sets.ts';
import { type AskBody, useAsk } from './use-ask.ts';
import { choicesFromSearch } from './view-state.ts';

/** Props of {@link AskTab}. */
interface AskTabProps extends DashboardData {
  /** Receives the answer the dashboard should mark, or `undefined` for none. */
  readonly onOpenAnswer: (open: OpenAnswer | undefined) => void;
}

/**
 * What a question is asked about: the version, the range, the variables and the hidden sets of
 * markers in the address, as the request and as the question box's label.
 *
 * @param version - The version shown.
 * @returns The request body of a question, and the label.
 */
function useShown(version: DashboardData['version']) {
  const [search] = useSearchParams();
  const { spec } = version;
  const choices = choicesFromSearch(search, spec);
  const timeZone = spec.timezone ?? browserTimeZone();
  const body = (question: string, parentId: string | undefined): AskBody => ({
    version: version.version,
    question,
    variables: choices.variables,
    ...(choices.time ? { time: choices.time } : {}),
    hiddenMarkers: [...hiddenMarkersOf(search, spec)],
    timeZone: browserTimeZone(),
    ...(parentId ? { parentId } : {}),
  });
  const label = contextLabel({ spec, ...choices, timeZone, now: Date.now() });
  return { body, label, timeZone };
}

/**
 * The tab's state: the questions, the open one, and the answer on its way. Once an answer ends,
 * the questions load again and the new one opens.
 *
 * @param props - The dashboard and the version shown.
 * @returns The state, and the function that asks.
 */
function useAskAsShown({ dashboard, version }: DashboardData) {
  const { body, label, timeZone } = useShown(version);
  const questions = useQuestions(dashboard.id);
  const opened = useOpenQuestion();
  const { reload } = questions;
  const { setExpanded } = opened;
  const onEnd = useCallback(
    (questionId: string | null) => {
      reload();
      if (questionId) setExpanded(questionId);
    },
    [reload, setExpanded],
  );
  const { live, ask, clear } = useAsk(dashboard.id, onEnd);
  const send = (question: string, parentId: string | undefined) =>
    void ask(body(question, parentId));
  return { dashboardId: dashboard.id, questions, live, clear, send, label, timeZone, ...opened };
}

/**
 * Drops the live answer once the stored list holds it, and tells the dashboard which answer to
 * mark.
 *
 * @param state - The tab's state.
 * @param version - The version shown.
 * @param onOpenAnswer - Receives the answer to mark.
 */
function useSyncedAnswer(
  state: ReturnType<typeof useAskAsShown>,
  version: number,
  onOpenAnswer: AskTabProps['onOpenAnswer'],
): void {
  const { live, clear, expanded } = state;
  const { questions } = state.questions;
  const stored = live?.questionId && questions.some((each) => each.id === live.questionId);
  useEffect(() => {
    if (live && !live.answering && stored) clear();
  }, [live, stored, clear]);
  const openAnswer = useOpenAnswer(live, questions, expanded, version);
  useEffect(() => onOpenAnswer(openAnswer), [openAnswer, onOpenAnswer]);
}

/**
 * The questions, as threads: each first question and its follow-ups.
 *
 * @param props - The tab's state, the spec and version shown, and the follow-up callback.
 * @returns The list.
 */
function QuestionList({
  state,
  data,
  onFollowUp,
}: {
  readonly state: ReturnType<typeof useAskAsShown>;
  readonly data: DashboardData;
  readonly onFollowUp: ((question: DashboardQuestion) => void) | undefined;
}) {
  const { questions, failed } = state.questions;
  const threads = useMemo(() => questionThreads(questions), [questions]);
  if (failed) return <p className={styles.failure}>{failed}</p>;
  if (threads.length === 0 && !state.live)
    return <p className={styles.meta}>No one has asked about this dashboard yet.</p>;
  const card = (question: DashboardQuestion) => (
    <QuestionCard
      key={question.id}
      question={question}
      spec={data.version.spec}
      shownVersion={data.version.version}
      expanded={state.expanded === question.id}
      flashing={state.flash === question.id}
      onToggle={state.toggle}
      onFollowUp={onFollowUp}
    />
  );
  return (
    <div className={styles.threads}>
      {threads.map(({ root, followUps }) => (
        <div key={root.id} className={styles.thread}>
          {card(root)}
          {followUps.length > 0 && <div className={styles.followUps}>{followUps.map(card)}</div>}
        </div>
      ))}
    </div>
  );
}

/** Props of {@link AskFoot}. */
interface AskFootProps {
  /** The tab's state. */
  readonly state: ReturnType<typeof useAskAsShown>;
  /** Whether the person may ask. */
  readonly canAsk: boolean;
  /** The question a new one follows up on. */
  readonly followUp: DashboardQuestion | undefined;
  /** Sets or drops the follow-up. */
  readonly onFollowUp: (question: DashboardQuestion | undefined) => void;
}

/**
 * The foot of the tab: the earlier answers that look like the text typed, and the question box,
 * or the search for those who may not ask.
 *
 * @param props - The tab's state, the right to ask, and the follow-up.
 * @returns The foot.
 */
function AskFoot({ state, canAsk, followUp, onFollowUp }: AskFootProps) {
  const similar = useSimilar(state.dashboardId);
  const ask = (question: string) => {
    state.send(question, followUp?.id);
    onFollowUp(undefined);
  };
  return (
    <div className={styles.foot}>
      <SimilarQuestions matches={similar.matches} timeZone={state.timeZone} onOpen={state.open} />
      {canAsk ? (
        <AskForm
          label={state.label}
          busy={state.live?.answering ?? false}
          followUp={followUp}
          onCancelFollowUp={() => onFollowUp(undefined)}
          onAsk={ask}
          onType={similar.onType}
        />
      ) : (
        <QuestionSearch onType={similar.onType} />
      )}
    </div>
  );
}

/**
 * The Ask tab.
 *
 * @param props - The dashboard, the version shown, and the callback of the answer to mark.
 * @returns The tab's content.
 */
export function AskTab({ onOpenAnswer, ...data }: AskTabProps) {
  const canAsk = useCanAsk();
  const state = useAskAsShown(data);
  useSyncedAnswer(state, data.version.version, onOpenAnswer);
  const sources = useSources(data.dashboard.id, data.version.version);
  const [followUp, setFollowUp] = useState<DashboardQuestion | undefined>();
  const explainOnly = sources?.every((source) => (source.accessLevel ?? 0) < 3) ?? false;
  return (
    <div className={styles.tab}>
      <div className={styles.scroll}>
        {explainOnly && sources && <ExplainOnlyCard sources={sources} />}
        {state.live && (
          <LiveAnswerCard live={state.live} spec={data.version.spec} timeZone={state.timeZone} />
        )}
        <QuestionList state={state} data={data} onFollowUp={canAsk ? setFollowUp : undefined} />
      </div>
      <AskFoot state={state} canAsk={canAsk} followUp={followUp} onFollowUp={setFollowUp} />
    </div>
  );
}
