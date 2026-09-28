/**
 * The thread screen's state: the streamed chat, the thread's intents (approve, undo, pin), the
 * composer's text, and the panel the inspector shows.
 */
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type SubmitTarget,
  useFetcher,
  useLoaderData,
  useNavigate,
  useRevalidator,
  useSearchParams,
} from 'react-router';
import type { ThreadData, ThreadIntent, ThreadOutcome } from './data.ts';
import type { ThreadMessage } from './messages.ts';

/**
 * The chat of a thread, streamed from its chat endpoint. Only the new message is sent; the server
 * holds the conversation.
 *
 * @param data - The thread's data.
 * @param onChange - Called when a new version streams in or the run ends.
 * @returns The chat helpers.
 */
function useThreadChat(data: ThreadData, onChange: () => void) {
  const { thread } = data;
  const transport = useMemo(
    () =>
      new DefaultChatTransport<ThreadMessage>({
        api: `/api/threads/${thread.id}/chat`,
        headers: { 'X-Requested-With': 'querent' },
        prepareSendMessagesRequest: ({ messages }) => ({ body: { message: messages.at(-1) } }),
      }),
    [thread.id],
  );
  return useChat<ThreadMessage>({
    id: thread.id,
    messages: thread.messages as ThreadMessage[],
    transport,
    onData: (part) => {
      if (part.type === 'data-version') onChange();
    },
    onFinish: onChange,
  });
}

/**
 * Sends the question the new-thread screen handed over in `?ask=`, once.
 *
 * @param send - Sends a question.
 * @param empty - Whether the thread has no messages yet.
 */
function useFirstQuestion(send: (text: string) => void, empty: boolean): void {
  const [search, setSearch] = useSearchParams();
  const sent = useRef(false);
  const ask = search.get('ask');
  useEffect(() => {
    if (ask === null || sent.current) return;
    sent.current = true;
    setSearch(
      (current) => {
        current.delete('ask');
        return current;
      },
      { replace: true },
    );
    if (empty) send(ask);
  }, [ask, empty, send, setSearch]);
}

/**
 * The thread's intents, sent to the route action.
 *
 * @returns Submits an intent and resolves when it is done, with its outcome; and whether one runs.
 */
function useIntents() {
  const fetcher = useFetcher<ThreadOutcome>();
  const run = async (intent: ThreadIntent): Promise<void> => {
    await fetcher.submit(intent as SubmitTarget, { method: 'post', encType: 'application/json' });
  };
  return { run, busy: fetcher.state !== 'idle', outcome: fetcher.data };
}

/** What the thread's actions need. */
interface ActionContext {
  /** The thread's data. */
  readonly data: ThreadData;
  /** The chat. */
  readonly chat: ReturnType<typeof useThreadChat>;
  /** Runs an intent. */
  readonly run: (intent: ThreadIntent) => Promise<void>;
  /** Reloads the thread's data. */
  readonly revalidate: () => void;
  /** Shows a version, or the latest. */
  readonly showVersion: (version: number | undefined) => void;
  /** Sets the composer's text. */
  readonly setDraft: (draft: string) => void;
}

/**
 * The thread's actions: approve and continue, edit a plan, undo, pin.
 *
 * @param context - What the actions need.
 * @returns The actions.
 */
function useThreadActions(context: ActionContext) {
  const navigate = useNavigate();
  const { data, chat, run, revalidate, showVersion, setDraft } = context;
  return {
    approve: async (planId: string) => {
      await run({ intent: 'approve', planId });
      revalidate();
      void chat.sendMessage();
    },
    editPlan: async (planId: string) => {
      await run({ intent: 'reject', planId });
      revalidate();
      setDraft('Change the plan: ');
    },
    undo: async (version: number) => {
      await run({ intent: 'restore', version });
      showVersion(undefined);
      revalidate();
    },
    pin: async (version: number) => {
      await run({ intent: 'pin', version });
      if (data.thread.dashboardId) navigate(`/d/${data.thread.dashboardId}`);
    },
  };
}

/**
 * Shows a version in the draft pane through `?v=`, or the latest without it.
 *
 * @returns The setter.
 */
function useShownVersion() {
  const [, setSearch] = useSearchParams();
  return (version: number | undefined) =>
    setSearch((current) => {
      if (version === undefined) current.delete('v');
      else current.set('v', String(version));
      return current;
    });
}

/**
 * The composer's text, and sending a question with the person's time zone.
 *
 * @param chat - The chat.
 * @returns The text, its setter, and the sender.
 */
function useDraft(chat: ReturnType<typeof useThreadChat>) {
  const [draft, setDraft] = useState('');
  const send = (text: string, mentions: readonly { panelId: string; title: string }[] = []) => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    void chat.sendMessage({ text, metadata: { mentions: [...mentions], timeZone } });
    setDraft('');
  };
  return { draft, setDraft, send };
}

/**
 * The state and actions of the thread screen.
 *
 * @returns Everything the screen renders and does.
 */
export function useThread() {
  const data = useLoaderData() as ThreadData;
  const { revalidate } = useRevalidator();
  const chat = useThreadChat(data, () => void revalidate());
  const intents = useIntents();
  const composer = useDraft(chat);
  const [selectedPanelId, setSelectedPanelId] = useState<string | undefined>(undefined);
  const selection = { selectedPanelId, setSelectedPanelId };
  const showVersion = useShownVersion();
  useFirstQuestion((text) => composer.send(text), chat.messages.length === 0);
  const actions = useThreadActions({
    data,
    chat,
    run: intents.run,
    revalidate: () => void revalidate(),
    showVersion,
    setDraft: composer.setDraft,
  });
  const running = chat.status === 'submitted' || chat.status === 'streaming';
  return { data, chat, running, intents, composer, selection, showVersion, actions };
}
