/**
 * The foot of the Ask tab: the questions already answered that look like the one being typed, and
 * the question box, labelled with what the question will be asked about. Viewers get a line saying
 * who can ask instead. Above the conversation, when no source shows numbers, the honest note that
 * answers can only explain.
 */
import type { DashboardSource, SimilarQuestion } from '@quanthea/shared';
import { type FormEvent, type KeyboardEvent, useState } from 'react';
import { Button } from '../../ui/button.tsx';
import { TextArea } from '../../ui/text-area.tsx';
import { accessLevelName } from '../connectors/index.ts';
import styles from './ask.module.css';
import { dayLabel } from './ask-words.ts';

/**
 * The honest note when no source of the dashboard shows numbers: answers can only explain.
 *
 * @param props - The sources.
 * @param props.sources - The dashboard's sources and their access levels.
 * @returns The note.
 */
export function ExplainOnlyCard({ sources }: { readonly sources: readonly DashboardSource[] }) {
  return (
    <section className={styles.gate} aria-label="Explain only">
      <h3 className={styles.gateTitle}>Explain only</h3>
      <p className={styles.gateText}>
        No source of this dashboard is at Aggregates or Full access. Answers can explain the panels,
        their queries and the tables, but can't read the numbers, so they can't tell you what
        happened.
      </p>
      <ul className={styles.gateSources}>
        {sources.map((source) => (
          <li key={source.name}>
            {source.name} ·{' '}
            {source.accessLevel === null ? 'not configured' : accessLevelName(source.accessLevel)}
          </li>
        ))}
      </ul>
      <p className={styles.meta}>An admin can raise a source to Aggregates in Connectors.</p>
    </section>
  );
}

/**
 * The questions already answered that share words with the text typed. Each opens its
 * conversation at its answer.
 *
 * @param props - The matches, the time zone and the open callback.
 * @param props.matches - The earlier questions, the best first.
 * @param props.timeZone - The time zone of the dates.
 * @param props.onOpen - Opens a question's conversation at it.
 * @returns The list, or nothing without matches.
 */
export function SimilarQuestions({
  matches,
  timeZone,
  onOpen,
}: {
  readonly matches: readonly SimilarQuestion[];
  readonly timeZone: string;
  readonly onOpen: (match: SimilarQuestion) => void;
}) {
  if (matches.length === 0) return null;
  return (
    <section className={styles.similar} aria-label="Already answered">
      <h3 className={styles.similarTitle}>Already answered</h3>
      {matches.map((match) => (
        <button
          key={match.id}
          type="button"
          className={styles.similarItem}
          onClick={() => onOpen(match)}
        >
          Asked on {dayLabel(match.askedAt, timeZone)} by {match.askedBy}: {match.question}
        </button>
      ))}
    </section>
  );
}

/** Props of {@link AskForm}. */
interface AskFormProps {
  /** What a question will be asked about, as the box's label. */
  readonly label: string;
  /** Whether an answer is on its way. */
  readonly busy: boolean;
  /**
   * Such as `Now asking about 27 Sep 09:00–10:00`, when the view changed since the conversation's
   * latest question: it replaces the label, emphasised.
   */
  readonly note: string | undefined;
  /** Asks. */
  readonly onAsk: (question: string) => void;
  /** Receives the text as it is typed, to look for earlier answers. */
  readonly onType: (text: string) => void;
}

/**
 * The question box, for those who may ask. Enter asks; Shift and Enter starts a new line. Its
 * label says what the question is about, emphasised when the view changed.
 *
 * @param props - The label, the state, the line of a changed view and the callbacks.
 * @returns The form.
 */
export function AskForm({ label, busy, note, onAsk, onType }: AskFormProps) {
  const [text, setText] = useState('');
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (busy || text.trim() === '') return;
    onAsk(text.trim());
    setText('');
    onType('');
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) submit(event);
  };
  return (
    <form className={styles.form} onSubmit={submit}>
      <TextArea
        label={note ? <span className={styles.changedLabel}>{note}, as shown</span> : label}
        rows={2}
        className={styles.box}
        value={text}
        placeholder="What happened around 14:00?"
        onChange={(event) => {
          setText(event.target.value);
          onType(event.target.value);
        }}
        onKeyDown={onKeyDown}
      />
      <Button type="submit" variant="primary" disabled={busy || text.trim() === ''}>
        {busy ? 'Answering…' : 'Ask'}
      </Button>
    </form>
  );
}

/**
 * The line viewers get instead of the question box.
 *
 * @returns The line.
 */
export function WhoCanAsk() {
  return (
    <p className={styles.meta}>
      Analysts, editors and admins can ask about this dashboard. You can read every conversation.
    </p>
  );
}
