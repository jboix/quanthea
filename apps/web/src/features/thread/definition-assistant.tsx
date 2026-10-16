/**
 * The assistant of the definitions screen: a conversation that proposes definitions, beside them.
 * Before one is open it offers a box for the first message, examples, and the person's past
 * conversations; once open it is the thread's conversation with a header of its own.
 */
import { type FormEvent, type KeyboardEvent, useEffect, useState } from 'react';
import {
  Link,
  type SubmitTarget,
  useFetcher,
  useLoaderData,
  useOutletContext,
  useSearchParams,
} from 'react-router';
import { Button } from '../../ui/button.tsx';
import type { AssistantOutletContext } from '../definitions/index.ts';
import { definitionThreadPath } from './data.ts';
import styles from './definition-assistant.module.css';
import type {
  DefinitionAssistantData,
  DefinitionAssistantIntent,
} from './definition-assistant-data.ts';
import { promptFrom } from './thread-kinds.ts';
import { ThreadPane } from './thread-pane.tsx';
import { useThread } from './use-thread.ts';

/** First messages the start offers, to show what the assistant does. */
const examples = [
  'Failure rate is the share of orders that fail, out of all orders.',
  'Revenue is what customers paid, without cancelled orders.',
  'Here is our glossary: ',
];

/**
 * The assistant's header: its name, what is open, a new conversation, and close where it covers
 * the definitions.
 *
 * @param props - The conversation's title, if one is open.
 * @param props.title - The open conversation's title.
 * @returns The header.
 */
function AssistantHead({ title }: { readonly title?: string | undefined }) {
  const outlet = useOutletContext<AssistantOutletContext | undefined>();
  return (
    <header className={styles.head}>
      <div className={styles.headText}>
        <h2>Assistant</h2>
        <p title={title}>{title ?? 'Proposes definitions from your words and your data.'}</p>
      </div>
      {title !== undefined && (
        <Link className={styles.headLink} to="/definitions">
          New conversation
        </Link>
      )}
      {outlet && (
        <button
          type="button"
          className={styles.close}
          aria-label="Close the assistant"
          onClick={outlet.onClose}
        >
          ×
        </button>
      )}
    </header>
  );
}

/**
 * The first message's box: Enter sends, Shift+Enter breaks the line. A link may fill it with
 * `?prompt=`, such as Ask the assistant on a definition.
 *
 * @returns The text, its setter, sending, and whether it is on its way.
 */
function useFirstMessage() {
  const [search] = useSearchParams();
  const prompt = promptFrom(search);
  const [text, setText] = useState(prompt);
  useEffect(() => {
    if (prompt !== '') setText(prompt);
  }, [prompt]);
  const fetcher = useFetcher();
  const send = (event?: FormEvent) => {
    event?.preventDefault();
    if (text.trim() === '') return;
    const intent: DefinitionAssistantIntent = { question: text.trim() };
    void fetcher.submit(intent as unknown as SubmitTarget, {
      method: 'post',
      encType: 'application/json',
    });
  };
  return { text, setText, send, busy: fetcher.state !== 'idle' };
}

/**
 * The person's past conversations that make definitions.
 *
 * @param props - The conversations.
 * @param props.past - The conversations, the latest first.
 * @returns The list, or nothing before the first.
 */
function PastConversations({ past }: Pick<DefinitionAssistantData, 'past'>) {
  if (past.length === 0) return null;
  return (
    <nav className={styles.past} aria-label="Past conversations">
      <h3>Past conversations</h3>
      <ul>
        {past.map((thread) => (
          <li key={thread.id}>
            <Link to={definitionThreadPath(thread.id)}>{thread.title ?? 'Untitled'}</Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/**
 * The assistant before a conversation is open: what it does, a box for the first message, examples
 * that fill the box, and the past conversations.
 *
 * @returns The start.
 */
export function DefinitionAssistantStart() {
  const { past } = useLoaderData() as DefinitionAssistantData;
  const message = useFirstMessage();
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    message.send();
  };
  return (
    <div className={styles.assistant}>
      <AssistantHead />
      <div className={styles.start}>
        <p className={styles.intro}>
          Describe the terms your team uses, or paste a whole glossary. The assistant reads your
          connectors, asks which ones to check, tests the filters on your data, and proposes each
          definition for you to save.
        </p>
        <form className={styles.box} onSubmit={message.send}>
          <textarea
            aria-label="Your first message"
            rows={5}
            placeholder="Failure rate is the share of orders that fail…"
            value={message.text}
            onChange={(event) => message.setText(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <Button
            type="submit"
            variant="primary"
            disabled={message.busy || message.text.trim() === ''}
          >
            {message.busy ? 'Starting…' : 'Start'}
          </Button>
        </form>
        <div className={styles.examples}>
          {examples.map((example) => (
            <button key={example} type="button" onClick={() => message.setText(example)}>
              {example}
            </button>
          ))}
        </div>
        <PastConversations past={past} />
      </div>
    </div>
  );
}

/**
 * The assistant with a conversation open: the thread's conversation and composer, under the
 * assistant's header.
 *
 * @returns The conversation.
 */
export function DefinitionAssistantChat() {
  const state = useThread();
  return (
    <div className={styles.assistant}>
      <ThreadPane
        state={state}
        openDraft={null}
        header={<AssistantHead title={state.data.thread.title ?? 'New conversation'} />}
      />
    </div>
  );
}
