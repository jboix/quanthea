import type { ThreadState, ThreadSummary } from '@querent/shared';
import { type FormEvent, type KeyboardEvent, useState } from 'react';
import { Link, type SubmitTarget, useLoaderData, useNavigation, useSubmit } from 'react-router';
import { Button } from '../../ui/button.tsx';
import { Page } from '../../ui/page.tsx';
import styles from './new-thread.module.css';

/** How each thread state reads in the list. */
const stateWords: Readonly<Record<ThreadState, string>> = {
  idle: 'idle',
  plan_pending: 'plan waiting',
  building: 'building',
  ready: 'draft ready',
};

/**
 * The first question: a text area and Start. Enter starts, Shift+Enter breaks the line.
 *
 * @returns The form.
 */
function AskForm() {
  const [question, setQuestion] = useState('');
  const submit = useSubmit();
  const starting = useNavigation().state !== 'idle';
  const start = (event?: FormEvent) => {
    event?.preventDefault();
    if (question.trim() === '' || starting) return;
    const body = { question: question.trim() };
    void submit(body as SubmitTarget, { method: 'post', encType: 'application/json' });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    start();
  };
  return (
    <form className={styles.ask} onSubmit={start}>
      <textarea
        className={styles.input}
        rows={3}
        aria-label="Question"
        placeholder="What happened to checkout yesterday around 14:00?"
        value={question}
        onChange={(event) => setQuestion(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <div className={styles.bar}>
        <span className={styles.hint}>The agent explores your sources and proposes a plan.</span>
        <Button type="submit" variant="primary" disabled={question.trim() === '' || starting}>
          {starting ? 'Starting…' : 'Start'}
        </Button>
      </div>
    </form>
  );
}

/**
 * The recent threads, the latest first.
 *
 * @param props - The threads.
 * @param props.threads - The threads.
 * @returns The list, or nothing when there are none.
 */
function RecentThreads({ threads }: { readonly threads: readonly ThreadSummary[] }) {
  if (threads.length === 0) return null;
  const date = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  return (
    <section className={styles.recent} aria-label="Recent threads">
      <h2 className={styles.recentTitle}>Recent threads</h2>
      <ul className={styles.list}>
        {threads.map((thread) => (
          <li key={thread.id}>
            <Link to={`/threads/${thread.id}`} className={styles.item}>
              <span className={styles.itemTitle}>{thread.title ?? 'Untitled thread'}</span>
              <span className={styles.state}>{stateWords[thread.state]}</span>
              <span className={styles.date}>{date.format(thread.updatedAt)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The new-thread screen: ask the first question, or go back to a recent thread.
 *
 * @returns The screen.
 */
export function NewThreadScreen() {
  const threads = useLoaderData() as readonly ThreadSummary[];
  return (
    <Page
      title="New thread"
      subtitle="Describe the dashboard you want, or the question it should answer."
    >
      <div className={styles.layout}>
        <AskForm />
        <RecentThreads threads={threads} />
      </div>
    </Page>
  );
}
