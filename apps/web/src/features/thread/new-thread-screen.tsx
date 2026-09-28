import type { ThreadSummary } from '@querent/shared';
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { type SubmitTarget, useLoaderData, useSubmit } from 'react-router';
import type { NewThreadIntent } from './data.ts';
import { HistoryMenu } from './history-menu.tsx';
import styles from './new-thread.module.css';

/**
 * The question box's behaviour: Enter sends, Shift+Enter breaks the line, and a sent question
 * stays on screen while the thread starts.
 *
 * @returns The text, its setter, the question sent (if any), and the handlers.
 */
function useAsk() {
  const [question, setQuestion] = useState('');
  const [sent, setSent] = useState<string | undefined>(undefined);
  const submit = useSubmit();
  const start = (event?: FormEvent) => {
    event?.preventDefault();
    const text = question.trim();
    if (text === '' || sent !== undefined) return;
    setSent(text);
    const intent: NewThreadIntent = { intent: 'start', question: text };
    void submit(intent as SubmitTarget, {
      method: 'post',
      encType: 'application/json',
    });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    start();
  };
  return { question, setQuestion, sent, start, onKeyDown };
}

/**
 * The question box, in the middle of the screen.
 *
 * @param props - The box's state.
 * @param props.ask - What {@link useAsk} returns.
 * @returns The form.
 */
function AskForm({ ask }: { readonly ask: ReturnType<typeof useAsk> }) {
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => input.current?.focus(), []);
  return (
    <form className={styles.ask} onSubmit={ask.start}>
      <textarea
        ref={input}
        className={styles.input}
        rows={3}
        aria-label="Question"
        placeholder="What happened to checkout yesterday around 14:00?"
        value={ask.question}
        onChange={(event) => ask.setQuestion(event.target.value)}
        onKeyDown={ask.onKeyDown}
      />
      <div className={styles.bar}>
        <span className={styles.hint}>Enter to send · Shift+Enter for a new line</span>
        <button
          type="submit"
          className={styles.send}
          aria-label="Send"
          disabled={ask.question.trim() === ''}
        >
          ↑
        </button>
      </div>
    </form>
  );
}

/**
 * The question as sent, while the thread starts.
 *
 * @param props - The question.
 * @param props.question - The question sent.
 * @returns The bubble and the progress line.
 */
function Sent({ question }: { readonly question: string }) {
  return (
    <div className={styles.sent}>
      <p className={styles.bubble}>{question}</p>
      <p className={styles.starting} role="status">
        Starting the thread…
      </p>
    </div>
  );
}

/**
 * The new-thread screen: one question box in the middle, and past threads at the top right.
 * Sending keeps the question on screen until the thread opens and the agent starts on it.
 *
 * @returns The screen.
 */
export function NewThreadScreen() {
  const threads = useLoaderData() as readonly ThreadSummary[];
  const ask = useAsk();
  return (
    <div className={styles.screen}>
      <header className={styles.top}>
        <HistoryMenu threads={threads} />
      </header>
      <div className={styles.center}>
        <h1 className={styles.heading}>What do you want to see?</h1>
        {ask.sent === undefined ? <AskForm ask={ask} /> : <Sent question={ask.sent} />}
        <p className={styles.note}>
          The agent explores your connectors, proposes a plan, then builds a live dashboard you can
          refine and pin.
        </p>
      </div>
    </div>
  );
}
