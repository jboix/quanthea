/**
 * The foot of the Ask tab: the questions already answered that look like the one being typed, and
 * the question box, labelled with what the question will be asked about. Viewers get a search box
 * instead, and a line saying who can ask. Above them, when no source shows numbers, the honest
 * note that answers can only explain.
 */
import type { DashboardQuestion, DashboardSource, SimilarQuestion } from '@quanthea/shared';
import { type FormEvent, type KeyboardEvent, useState } from 'react';
import { Button } from '../../ui/button.tsx';
import { Input } from '../../ui/input.tsx';
import { Pill } from '../../ui/pill.tsx';
import { TextArea } from '../../ui/text-area.tsx';
import { accessLevelName } from '../connectors/index.ts';
import styles from './ask.module.css';
import { dayLabel } from './ask-words.ts';

/** How much of a question a follow-up chip shows. */
const chipLength = 60;

/**
 * Shortens a text to a length, with an ellipsis.
 *
 * @param text - The text.
 * @param length - The most characters.
 * @returns The text, or its start and an ellipsis.
 */
function shortened(text: string, length: number): string {
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`;
}

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
 * The questions already answered that share words with the text typed.
 *
 * @param props - The matches, the time zone and the open callback.
 * @param props.matches - The earlier questions, the best first.
 * @param props.timeZone - The time zone of the dates.
 * @param props.onOpen - Opens one in the list.
 * @returns The list, or nothing without matches.
 */
export function SimilarQuestions({
  matches,
  timeZone,
  onOpen,
}: {
  readonly matches: readonly SimilarQuestion[];
  readonly timeZone: string;
  readonly onOpen: (questionId: string) => void;
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
          onClick={() => onOpen(match.id)}
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
  /** The question a new one follows up on. */
  readonly followUp: DashboardQuestion | undefined;
  /** Drops the follow-up. */
  readonly onCancelFollowUp: () => void;
  /** Asks. */
  readonly onAsk: (question: string) => void;
  /** Receives the text as it is typed, to look for earlier answers. */
  readonly onType: (text: string) => void;
}

/**
 * The question box, for those who may ask. Enter asks; Shift and Enter starts a new line.
 *
 * @param props - The label, the state, the follow-up and the callbacks.
 * @returns The form.
 */
export function AskForm({ label, busy, followUp, onCancelFollowUp, onAsk, onType }: AskFormProps) {
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
      {followUp && (
        <Pill tone="accent" onRemove={onCancelFollowUp} removeLabel="Ask a new question instead">
          Following up: {shortened(followUp.question, chipLength)}
        </Pill>
      )}
      <TextArea
        label={label}
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
 * The search box viewers get, with who may ask.
 *
 * @param props - The callback.
 * @param props.onType - Receives the text as it is typed.
 * @returns The search.
 */
export function QuestionSearch({ onType }: { readonly onType: (text: string) => void }) {
  return (
    <div className={styles.form}>
      <p className={styles.meta}>Analysts, editors and admins can ask about this dashboard.</p>
      <Input
        label="Search the questions asked so far"
        type="search"
        onChange={(event) => onType(event.target.value)}
      />
    </div>
  );
}
