/**
 * The data of the definitions screen's assistant before a conversation is open: the person's past
 * conversations that make definitions, and starting one with its first message.
 */
import { createThreadEndpoint, listThreadsEndpoint, type ThreadListItem } from '@quanthea/shared';
import { type ActionFunctionArgs, type LoaderFunctionArgs, redirect } from 'react-router';
import type { ApiClient } from '../../lib/api-client.ts';
import { definitionThreadPath } from './data.ts';

/** The most past conversations the assistant lists. */
const pastShown = 6;

/** What the assistant shows before a conversation is open. */
export interface DefinitionAssistantData {
  /** The person's latest conversations that make definitions, the latest first. */
  readonly past: readonly ThreadListItem[];
}

/**
 * The loader of the assistant's start: the person's past conversations that make definitions.
 * Someone who may not start one gets none, and the screen shows no assistant.
 *
 * @param api - The API client.
 * @param mayAsk - Whether the person may start a conversation.
 * @returns The loader.
 */
export function loadDefinitionAssistant(api: ApiClient, mayAsk: () => Promise<boolean>) {
  return async ({ request }: LoaderFunctionArgs): Promise<DefinitionAssistantData> => {
    if (!(await mayAsk())) return { past: [] };
    const threads = await api.call(
      listThreadsEndpoint,
      { query: { scope: 'mine' } },
      { signal: request.signal },
    );
    return { past: threads.filter((thread) => thread.kind === 'definition').slice(0, pastShown) };
  };
}

/** What the assistant's start submits, as JSON: the first message. */
export interface DefinitionAssistantIntent {
  /** The first message. */
  readonly question: string;
}

/**
 * The action of the assistant's start: starts a conversation that makes definitions and opens it,
 * with the first message handed over in `?ask=`.
 *
 * @param api - The API client.
 * @returns The action.
 */
export function startDefinitionThread(api: ApiClient) {
  return async ({ request }: ActionFunctionArgs): Promise<Response> => {
    const { question } = (await request.json()) as DefinitionAssistantIntent;
    const thread = await api.call(createThreadEndpoint, { body: { kind: 'definition' } });
    return redirect(`${definitionThreadPath(thread.id)}?ask=${encodeURIComponent(question)}`);
  };
}
