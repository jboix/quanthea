/**
 * What a turn reads of the conversation, and the instructions of the threads of their own mode:
 * an alert, a report or definitions. A dashboard thread's are in `turn.ts`.
 */
import type { Instructions } from 'ai';
import { alertInstructions } from './alert-turn.ts';
import { definitionInstructions } from './definition-turn.ts';
import { reportInstructions } from './report-turn.ts';
import type { AgentServices, ThreadMessage } from './run-context.ts';

/** What the person's latest message tells the agent besides its text. */
export interface TurnHints {
  /** The panels it mentions. */
  readonly mentions: readonly { readonly panelId: string; readonly title: string }[];
  /** The person's IANA time zone, when their browser said. */
  readonly timeZone?: string | undefined;
}

/** The thread's plans, as the turn reads them. */
export type Plans = ReturnType<AgentServices['threads']['get']>['plans'];

/**
 * The text of the person's messages in the thread.
 *
 * @param messages - The conversation.
 * @returns The texts, joined.
 */
export function questionsOf(messages: readonly ThreadMessage[]): string {
  return messages
    .filter((message) => message.role === 'user')
    .flatMap((message) =>
      message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])),
    )
    .join(' ');
}

/**
 * The instructions of a turn in a thread of its own mode: an alert, a report or definitions.
 *
 * @param context - The run.
 * @param messages - The conversation, whose questions trim big connectors' catalogs.
 * @param plans - The thread's plans.
 * @param hints - The person's time zone.
 * @param now - The current instant.
 * @returns The instructions, or `undefined` in a dashboard thread.
 */
export function modeInstructions(
  context: Parameters<typeof alertInstructions>[0],
  messages: readonly ThreadMessage[],
  plans: Plans,
  hints: TurnHints,
  now: number,
): Promise<Instructions> | undefined {
  const { kind } = context.threads.row(context.threadId);
  const questions = questionsOf(messages);
  if (kind === 'alert') return alertInstructions(context, plans, hints, now, questions);
  if (kind === 'report') return reportInstructions(context, plans, hints, now, questions);
  if (kind === 'definition') return definitionInstructions(context, hints, now, questions);
  return undefined;
}
