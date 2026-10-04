/**
 * One turn of a conversation about a run: the question as a bubble with who asked and when, then
 * its answer, stored or on its way, what it looked at, and what it proposed to watch. Everything
 * the model wrote is shown as plain text.
 */
import type { ReportSpec, RunQuestion } from '@quanthea/shared';
import { AnswerText, Asked, EvidenceList, instantLabel } from '../dashboard/index.ts';
import { FollowUpCards } from './follow-up-cards.tsx';
import styles from './run-ask.module.css';
import type { LiveRunAnswer } from './use-run-ask.ts';

/**
 * The honest note of an answer given when no source of the run shows numbers.
 *
 * @returns The note.
 */
function ShapesOnlyNote() {
  return (
    <p className={styles.note}>
      Shapes only: no source of this report shows numbers, so this answer saw the shape of the
      results, not what they hold.
    </p>
  );
}

/** Props of {@link StoredRunTurn}. */
interface StoredRunTurnProps {
  /** The question. */
  readonly question: RunQuestion;
  /** The report's spec, for the panels' titles. */
  readonly spec: ReportSpec;
  /** Whether it was just opened from a search, to catch the eye. */
  readonly flashing: boolean;
}

/**
 * A stored question about a run and its answer.
 *
 * @param props - The question, the spec and whether it flashes.
 * @returns The turn.
 */
export function StoredRunTurn({ question, spec, flashing }: StoredRunTurnProps) {
  const { outcome } = question;
  const meta = `${question.askedBy} · ${instantLabel(question.askedAt, question.timeZone)}`;
  const evidence = outcome.ok ? outcome.answer.evidence : outcome.evidence;
  return (
    <article
      id={`question-${question.id}`}
      className={styles.turn}
      data-flash={flashing}
      aria-label={question.question}
    >
      <Asked question={question.question} meta={meta} />
      <div className={styles.answer}>
        {question.explainOnly && <ShapesOnlyNote />}
        {outcome.ok ? (
          <AnswerText text={outcome.answer.text} />
        ) : (
          <p className={styles.failure}>{outcome.message}</p>
        )}
        <EvidenceList
          evidence={evidence}
          citations={outcome.ok ? outcome.answer.citations : []}
          spec={spec}
          timeZone={question.timeZone}
        />
        {outcome.ok && <FollowUpCards cards={outcome.answer.followUps} />}
        <p className={styles.meta}>{question.tokens.toLocaleString('en-GB')} tokens</p>
      </div>
    </article>
  );
}

/** Props of {@link LiveRunTurn}. */
interface LiveRunTurnProps {
  /** The answer on its way. */
  readonly live: LiveRunAnswer;
  /** The report's spec, for the panels' titles. */
  readonly spec: ReportSpec;
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
export function LiveRunTurn({ live, spec, timeZone }: LiveRunTurnProps) {
  const { outcome } = live;
  const status = live.reads === 0 ? 'Answering…' : `Answering… ${live.reads} reads so far`;
  return (
    <article className={styles.turn} aria-live="polite" aria-busy={live.answering}>
      <Asked question={live.question} />
      <div className={styles.answer}>
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
            <FollowUpCards cards={outcome.answer.followUps} />
          </>
        ) : (
          live.text !== '' && <AnswerText text={live.text} />
        )}
        {live.answering && <p className={styles.meta}>{status}</p>}
      </div>
    </article>
  );
}
