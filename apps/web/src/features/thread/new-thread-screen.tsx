import type { ProviderChoice, ThreadQueries } from '@querent/shared';
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { type SubmitTarget, useLoaderData, useSubmit } from 'react-router';
import { Select } from '../../ui/select.tsx';
import type { NewThreadData, NewThreadIntent } from './data.ts';
import { HistoryMenu } from './history-menu.tsx';
import styles from './new-thread.module.css';
import { QueryModeMenu, QueryPicker, useQueryChoice } from './query-choice.tsx';

/**
 * The question box's behaviour: Enter sends, Shift+Enter breaks the line, and a sent question
 * stays on screen while the thread starts.
 *
 * @param providerId - The provider the thread starts on.
 * @param queries - The queries the thread uses.
 * @returns The text, its setter, the question sent (if any), and the handlers.
 */
function useAsk(providerId: string, queries: ThreadQueries) {
  const [question, setQuestion] = useState('');
  const [sent, setSent] = useState<string | undefined>(undefined);
  const submit = useSubmit();
  const start = (event?: FormEvent) => {
    event?.preventDefault();
    const text = question.trim();
    if (text === '' || sent !== undefined) return;
    setSent(text);
    const intent: NewThreadIntent = { intent: 'start', question: text, providerId, queries };
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
 * The provider a new thread starts on, when there is more than one.
 *
 * @param props - The providers, the one chosen, and the change callback.
 * @param props.providers - The providers.
 * @param props.value - The chosen provider's id.
 * @param props.onChange - Called with another provider's id.
 * @returns The menu.
 */
function ProviderMenu({
  providers,
  value,
  onChange,
}: {
  readonly providers: readonly ProviderChoice[];
  readonly value: string;
  readonly onChange: (id: string) => void;
}) {
  const options = providers.map((provider) => ({
    value: provider.id,
    label: `${provider.name} · ${provider.buildModel}`,
  }));
  return (
    <Select
      label="Model provider"
      hideLabel
      compact
      className={styles.provider}
      options={options}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/**
 * The question box, in the middle of the screen.
 *
 * @param props - The box's state.
 * @param props.ask - What {@link useAsk} returns.
 * @param props.choice - The provider menu, when there is a choice, and the recipe menu.
 * @returns The form.
 */
function AskForm({
  ask,
  choice,
}: {
  readonly ask: ReturnType<typeof useAsk>;
  readonly choice: ReactNode;
}) {
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
        {choice}
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
  const { threads, providers, defaultProviderId, queries } = useLoaderData() as NewThreadData;
  const [providerId, setProviderId] = useState(defaultProviderId);
  const queryChoice = useQueryChoice(queries);
  const ask = useAsk(providerId, queryChoice.value);
  const choice = (
    <>
      {providers.length > 1 && (
        <ProviderMenu providers={providers} value={providerId} onChange={setProviderId} />
      )}
      <QueryModeMenu choice={queryChoice} />
    </>
  );
  return (
    <div className={styles.screen}>
      <header className={styles.top}>
        <HistoryMenu threads={threads} />
      </header>
      <div className={styles.center}>
        <h1 className={styles.heading}>What do you want to see?</h1>
        {ask.sent === undefined ? (
          <>
            <AskForm ask={ask} choice={choice} />
            <QueryPicker queries={queries} choice={queryChoice} />
          </>
        ) : (
          <Sent question={ask.sent} />
        )}
        <p className={styles.note}>
          The agent explores your connectors, proposes a plan, then builds a live dashboard you can
          refine and pin.
        </p>
      </div>
    </div>
  );
}
