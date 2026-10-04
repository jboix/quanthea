/**
 * One turn of a conversation in the Ask tab: the line saying the view changed, when it did, the
 * question as a bubble with who asked and when, and its answer, stored or on its way. Everything
 * the model wrote is shown as plain text.
 */
import type { DashboardQuestion, DashboardSpec } from '@quanthea/shared';
import styles from './ask.module.css';
import { AnswerText, EvidenceList, ExplainOnlyNote } from './ask-answer.tsx';
import { instantLabel } from './ask-words.ts';
import turnStyles from './conversation.module.css';
import type { LiveAnswer } from './use-ask.ts';

/**
 * The line before a question asked about another view than the question before it.
 *
 * @param props - The line.
 * @param props.note - Such as `Now asking about 27 Sep 09:00–10:00`.
 * @returns The line, or nothing.
 */
export function ContextNote({ note }: { readonly note: string | undefined }) {
  if (!note) return null;
  return <p className={turnStyles.contextNote}>{note}</p>;
}

/**
 * A question, as a bubble on the right, and who asked it and when under it.
 *
 * @param props - The question and the line under it.
 * @param props.question - The question.
 * @param props.meta - Who asked and when, if known.
 * @returns The bubble.
 */
export function Asked({ question, meta }: { readonly question: string; readonly meta?: string }) {
  return (
    <div className={turnStyles.askedTurn}>
      <p className={turnStyles.asked}>{question}</p>
      {meta && <p className={turnStyles.askedMeta}>{meta}</p>}
    </div>
  );
}

/** Props of {@link StoredTurn}. */
interface StoredTurnProps {
  /** The question. */
  readonly question: DashboardQuestion;
  /** The line before it, when the view changed since the question before. */
  readonly note: string | undefined;
  /** The spec shown, for the panels' titles. */
  readonly spec: DashboardSpec;
  /** The version shown. */
  readonly shownVersion: number;
  /** Whether its answer marks the charts. */
  readonly shown: boolean;
  /** Whether it was just opened from a search, to catch the eye. */
  readonly flashing: boolean;
  /** Makes its answer the one the charts show. */
  readonly onPick: (questionId: string) => void;
}

/**
 * A stored question's answer: its text, or why there is none, and what it looked at. An answer
 * about the version shown can be picked to mark the charts.
 *
 * @param props - The question, what the page shows, and the pick callback.
 * @returns The answer.
 */
function StoredAnswer({ question, spec, shownVersion, shown, onPick }: StoredTurnProps) {
  const { outcome } = question;
  const evidence = outcome.ok ? outcome.answer.evidence : outcome.evidence;
  const pick = question.version === shownVersion ? () => onPick(question.id) : undefined;
  return (
    <div className={styles.answer} data-shown={shown}>
      {question.explainOnly && <ExplainOnlyNote />}
      {outcome.ok ? (
        <AnswerText text={outcome.answer.text} onPick={pick} shown={shown} />
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
        citations={outcome.ok ? outcome.answer.citations : []}
        spec={spec}
        timeZone={question.timeZone}
      />
      <p className={styles.tokens}>
        {question.tokens.toLocaleString('en-GB')} tokens{shown && ' · on the charts'}
      </p>
    </div>
  );
}

/**
 * A stored question and its answer.
 *
 * @param props - The question, the line before it, what the page shows, and its state.
 * @returns The turn.
 */
export function StoredTurn(props: StoredTurnProps) {
  const { question } = props;
  const meta = `${question.askedBy} · ${instantLabel(question.askedAt, question.timeZone)}`;
  return (
    <article
      id={`question-${question.id}`}
      className={turnStyles.turn}
      data-flash={props.flashing}
      aria-label={question.question}
    >
      <ContextNote note={props.note} />
      <Asked question={question.question} meta={meta} />
      <StoredAnswer {...props} />
    </article>
  );
}

/** Props of {@link LiveTurn}. */
interface LiveTurnProps {
  /** The answer on its way. */
  readonly live: LiveAnswer;
  /** The spec shown, for the panels' titles. */
  readonly spec: DashboardSpec;
  /** The time zone of the times. */
  readonly timeZone: string;
}

/**
 * The question being answered: its text as it is written, then the checked answer, or why it
 * stopped.
 *
 * @param props - The answer, the spec and the time zone.
 * @returns The turn.
 */
export function LiveTurn({ live, spec, timeZone }: LiveTurnProps) {
  const { outcome } = live;
  const status = live.reads === 0 ? 'Answering…' : `Answering… ${live.reads} reads so far`;
  return (
    <article className={turnStyles.turn} aria-live="polite" aria-busy={live.answering}>
      <ContextNote note={live.contextNote} />
      <Asked question={live.question} />
      <div className={styles.answer} data-shown={outcome?.ok ?? false}>
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
      </div>
    </article>
  );
}
