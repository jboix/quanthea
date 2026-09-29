/**
 * Reuse before generating: on a thread's first question, pinned dashboards that may already
 * answer it are offered before any model runs. The answer is a card with no tokens spent; the
 * person opens one, starts from one, or asks for a new dashboard, which continues this answer.
 */

import {
  createIdGenerator,
  createUIMessageStream,
  createUIMessageStreamResponse,
  type UIMessageStreamWriter,
} from 'ai';
import type { PinnedMatch } from '../dashboards/pinned.ts';
import type { AgentServices, ThreadMessage } from './run-context.ts';

/** New message and part ids. */
const newId = createIdGenerator({ prefix: 'msg', size: 16 });

/**
 * The text of a message.
 *
 * @param message - The message.
 * @returns Its text parts, joined.
 */
function textOf(message: ThreadMessage | undefined): string {
  return (message?.parts ?? [])
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join(' ');
}

/**
 * The pinned dashboards that may answer the thread's first question: only for a new question in a
 * thread with no answer and no dashboard yet.
 *
 * @param services - The agent's services.
 * @param threadId - The thread.
 * @param messages - The conversation, the new question last.
 * @returns The matches; none when the thread is past its first question.
 */
export function firstQuestionMatches(
  services: AgentServices,
  threadId: string,
  messages: readonly ThreadMessage[],
): PinnedMatch[] {
  const last = messages.at(-1);
  if (last?.role !== 'user' || messages.some((message) => message.role === 'assistant')) return [];
  if (services.threads.row(threadId).dashboardId !== null) return [];
  return services.dashboards.findPinned(textOf(last));
}

/**
 * Writes the matches card and one sentence.
 *
 * @param writer - The stream writer.
 * @param matches - The matches.
 */
function writeMatches(
  writer: UIMessageStreamWriter<ThreadMessage>,
  matches: readonly PinnedMatch[],
): void {
  const text = newId();
  const words =
    matches.length === 1
      ? 'A pinned dashboard may already answer this.'
      : 'These pinned dashboards may already answer this.';
  writer.write({ type: 'start', messageId: newId() });
  writer.write({ type: 'text-start', id: text });
  writer.write({ type: 'text-delta', id: text, delta: words });
  writer.write({ type: 'text-end', id: text });
  writer.write({
    type: 'data-matches',
    data: { dashboards: matches.map((match) => ({ ...match, panels: [...match.panels] })) },
  });
  writer.write({ type: 'finish' });
}

/**
 * Answers the first question with the matching pinned dashboards, and no model.
 *
 * @param save - Stores the conversation when the answer ends.
 * @param messages - The conversation, the question last.
 * @param matches - The matches.
 * @returns The UI message stream response.
 */
export function matchesResponse(
  save: (messages: ThreadMessage[]) => void,
  messages: ThreadMessage[],
  matches: readonly PinnedMatch[],
): Response {
  const stream = createUIMessageStream<ThreadMessage>({
    originalMessages: messages,
    generateId: newId,
    execute: ({ writer }) => writeMatches(writer, matches),
    onEnd: ({ messages: ended }) => save(ended),
  });
  return createUIMessageStreamResponse({ stream });
}
