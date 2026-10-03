/**
 * A question in the Ask tab: the stored ones, expandable, and the one being answered. Each says
 * when it was asked, by whom, on which version and over which range.
 */
import type { DashboardQuestion, DashboardSpec } from '@quanthea/shared';
import { Button } from '../../ui/button.tsx';
import { ChevronDownIcon } from '../../ui/icons.tsx';
import styles from './ask.module.css';
import { AnswerText, EvidenceList, ExplainOnlyNote } from './ask-answer.tsx';
import { absoluteRangeLabel, instantLabel } from './ask-words.ts';
import type { LiveAnswer } from './use-ask.ts';

/**
 * The line under a question: when, by whom, on which version, over which range and values.
 *
 * @param question - The question.
 * @returns Such as `26 Sep 14:10 by Ana · v3 · 26 Sep 13:30–15:00 · $env prod`.
 */
export function questionMeta(question: DashboardQuestion): string {
  const zone = question.timeZone;
  const values = Object.entries(question.variables).map(
    ([name, value]) => `$${name} ${[value].flat().join(' + ')}`,
  );
  return [
    `${instantLabel(question.askedAt, zone)} by ${question.askedBy}`,
    `v${question.version}`,
    absoluteRangeLabel(question.time, zone),
    ...values,
  ].join(' · ');
}

/** Props of {@link QuestionCard}. */
interface QuestionCardProps {
  /** The question. */
  readonly question: DashboardQuestion;
  /** The spec shown, for the panels' titles. */
  readonly spec: DashboardSpec;
  /** The version shown. */
  readonly shownVersion: number;
  /** Whether its answer shows. */
  readonly expanded: boolean;
  /** Whether it was just opened from a search, to catch the eye. */
  readonly flashing: boolean;
  /** Shows or hides its answer. */
  readonly onToggle: (questionId: string) => void;
  /** Asks a follow-up, for those who may ask. */
  readonly onFollowUp: ((question: DashboardQuestion) => void) | undefined;
}

/**
 * A stored question's answer: its text, or why there is none, and what it looked at.
 *
 * @param props - The question, the spec and the version shown, and the follow-up callback.
 * @returns The answer.
 */
function StoredAnswer({
  question,
  spec,
  shownVersion,
  onFollowUp,
}: Omit<QuestionCardProps, 'expanded' | 'flashing' | 'onToggle'>) {
  const { outcome } = question;
  const citations = outcome.ok ? outcome.answer.citations : [];
  const evidence = outcome.ok ? outcome.answer.evidence : outcome.evidence;
  return (
    <div className={styles.answer}>
      {question.explainOnly && <ExplainOnlyNote />}
      {outcome.ok ? (
        <AnswerText text={outcome.answer.text} />
      ) : (
        <p className={styles.failure}>{outcome.message}</p>
      )}
      {question.version !== shownVersion && (
        <p className={styles.versionNote}>
          Asked on v{question.version}. This page shows v{shownVersion}, so its panels carry no
          badges.
        </p>
      )}
      <EvidenceList
        evidence={evidence}
        citations={citations}
        spec={spec}
        timeZone={question.timeZone}
      />
      <div className={styles.answerFooter}>
        <span className={styles.tokens}>{question.tokens.toLocaleString('en-GB')} tokens</span>
        {onFollowUp && outcome.ok && (
          <Button size="small" onClick={() => onFollowUp(question)}>
            Follow up
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * A stored question: the question and its line, and its answer when expanded.
 *
 * @param props - The question, what the page shows, its state and callbacks.
 * @returns The card.
 */
export function QuestionCard(props: QuestionCardProps) {
  const { question, expanded, flashing, onToggle } = props;
  return (
    <article
      id={`question-${question.id}`}
      className={styles.question}
      data-expanded={expanded}
      data-flash={flashing}
      data-failed={!question.outcome.ok}
    >
      <button
        type="button"
        className={styles.questionToggle}
        aria-expanded={expanded}
        onClick={() => onToggle(question.id)}
      >
        <span className={styles.questionText}>{question.question}</span>
        <ChevronDownIcon />
      </button>
      <p className={styles.meta}>{questionMeta(question)}</p>
      {expanded && <StoredAnswer {...props} />}
    </article>
  );
}

/** Props of {@link LiveAnswerCard}. */
interface LiveAnswerCardProps {
  /** The answer on its way. */
  readonly live: LiveAnswer;
  /** The spec shown, for the panels' titles. */
  readonly spec: DashboardSpec;
  /** The time zone of the times. */
  readonly timeZone: string;
}

/**
 * The question being answered: its text as it is written, then the checked answer.
 *
 * @param props - The answer, the spec and the time zone.
 * @returns The card.
 */
export function LiveAnswerCard({ live, spec, timeZone }: LiveAnswerCardProps) {
  const { outcome } = live;
  const status = live.reads === 0 ? 'Answering…' : `Answering… ${live.reads} reads so far`;
  return (
    <article className={styles.question} data-expanded="true" aria-live="polite">
      <p className={styles.asked}>{live.question}</p>
      {live.error && <p className={styles.failure}>{live.error}</p>}
      {outcome?.ok === false && <p className={styles.failure}>{outcome.message}</p>}
      {outcome?.ok ? (
        <>
          <AnswerText text={outcome.answer.text} />
          <EvidenceList
            evidence={outcome.answer.evidence}
            citations={outcome.answer.citations}
            spec={spec}
            timeZone={timeZone}
          />
        </>
      ) : (
        live.text !== '' && <AnswerText text={live.text} />
      )}
      {live.answering && <p className={styles.meta}>{status}</p>}
    </article>
  );
}
