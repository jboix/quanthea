import type { ProviderChoice, ThreadKind, ThreadQueries } from '@quanthea/shared';
import {
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { type SubmitTarget, useLoaderData, useSearchParams, useSubmit } from 'react-router';
import { BellIcon, DashboardIcon, ReportIcon } from '../../ui/icons.tsx';
import { Segmented } from '../../ui/segmented.tsx';
import { Select } from '../../ui/select.tsx';
import styles from './new-thread.module.css';
import type { NewThreadData, NewThreadIntent } from './new-thread-data.ts';
import { QueryModeMenu, QueryPicker, useQueryChoice } from './query-choice.tsx';
import { kindFrom, kindWords, promptFrom } from './thread-kinds.ts';
import { ThreadsDrawer } from './threads-drawer.tsx';

/**
 * The question box's behaviour: it starts with `?prompt=` (or `?question=`) when a link fills it
 * in, and never sends it on its own. Enter sends, Shift+Enter breaks the line, and a sent question
 * stays on screen while the thread starts.
 *
 * @param providerId - The provider the thread starts on.
 * @param queries - The queries the thread uses.
 * @param kind - What the thread makes.
 * @returns The text, its setter, the question sent (if any), and the handlers.
 */
function useAsk(providerId: string, queries: ThreadQueries, kind: ThreadKind) {
  const [params] = useSearchParams();
  const [question, setQuestion] = useState(() => promptFrom(params));
  const [sent, setSent] = useState<string | undefined>(undefined);
  const submit = useSubmit();
  const start = (event?: FormEvent) => {
    event?.preventDefault();
    const text = question.trim();
    if (text === '' || sent !== undefined) return;
    setSent(text);
    const intent: NewThreadIntent = {
      intent: 'start',
      question: text,
      providerId,
      ...(kind === 'dashboard' ? { queries } : { kind }),
    };
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
 * @param props.choice - The provider menu, when there is a choice, and the queries menu.
 * @param props.placeholder - What the empty box suggests.
 * @returns The form.
 */
function AskForm({
  ask,
  choice,
  placeholder,
}: {
  readonly ask: ReturnType<typeof useAsk>;
  readonly choice: ReactNode;
  readonly placeholder: string;
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
        placeholder={placeholder}
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

/** The kinds of conversation, as the switch offers them. */
const kindOptions = [
  { value: 'dashboard' as const, label: kindWords.dashboard.label, icon: <DashboardIcon /> },
  { value: 'alert' as const, label: kindWords.alert.label, icon: <BellIcon /> },
  { value: 'report' as const, label: kindWords.report.label, icon: <ReportIcon /> },
];

/**
 * The example requests of a kind, as buttons that fill the box.
 *
 * @param props - The kind and the box's setter.
 * @param props.kind - What the thread makes.
 * @param props.onPick - Fills the box.
 * @returns The examples.
 */
function Examples({
  kind,
  onPick,
}: {
  readonly kind: ThreadKind;
  readonly onPick: (text: string) => void;
}) {
  return (
    <div className={styles.examples}>
      <span className={styles.examplesLabel}>Try</span>
      {kindWords[kind].examples.map((example) => (
        <button
          key={example}
          type="button"
          className={styles.example}
          onClick={() => onPick(example)}
        >
          {example}
        </button>
      ))}
    </div>
  );
}

/**
 * The new-thread screen: what to make (a dashboard, an alert or a report), one question box in the
 * middle, and past threads at the top right. Sending keeps the question on screen until the thread
 * opens and the agent starts on it.
 *
 * @returns The screen.
 */
export function NewThreadScreen() {
  const { threads, providers, defaultProviderId, queries } = useLoaderData() as NewThreadData;
  const [search] = useSearchParams();
  const [kind, setKind] = useState<ThreadKind>(() => kindFrom(search.get('make')));
  const [providerId, setProviderId] = useState(defaultProviderId);
  const queryChoice = useQueryChoice(queries);
  const ask = useAsk(providerId, queryChoice.value, kind);
  const choice = (
    <>
      {providers.length > 1 && (
        <ProviderMenu providers={providers} value={providerId} onChange={setProviderId} />
      )}
      {kind === 'dashboard' && <QueryModeMenu choice={queryChoice} />}
    </>
  );
  return (
    <div className={styles.screen}>
      <header className={styles.top}>
        <ThreadsDrawer threads={threads} />
      </header>
      <div className={styles.center}>
        <h1 className={styles.heading}>What do you want to make?</h1>
        {ask.sent === undefined ? (
          <>
            <Segmented label="What to make" options={kindOptions} value={kind} onChange={setKind} />
            <AskForm ask={ask} choice={choice} placeholder={kindWords[kind].placeholder} />
            {kind === 'dashboard' && <QueryPicker queries={queries} choice={queryChoice} />}
            <Examples kind={kind} onPick={ask.setQuestion} />
          </>
        ) : (
          <Sent question={ask.sent} />
        )}
        <p className={styles.note}>{kindWords[kind].note}</p>
      </div>
    </div>
  );
}
